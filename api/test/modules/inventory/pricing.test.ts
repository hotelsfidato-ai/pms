import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   PRICING — one base, everything else a difference

   The owner's instruction of 16 September, through the API the Pricing
   screen will use. Migration 090 holds the arithmetic and proves it in
   `db/tests/modules/inventory.sql`; what is asserted here is the part
   only the route can get wrong — what it refuses, in words, and that a
   price with no figure behind it travels as NULL rather than 0.

   EVERY WRITE IN THIS FILE IS DATED 2028 and removed afterwards. The
   suite shares one database and runs its files in order, so a base
   price left on a date another test reads would change that test's
   figures and not this one's.
   ══════════════════════════════════════════════════════════════════ */

const FROM = "2028-01-01";
const LATER = "2028-02-01";

let ownerStaffId: string;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  const staff = await db.query<{ id: string }>(
    "select id from staff where email = 'owner@fidato.in'",
  );
  ownerStaffId = staff.rows[0]!.id;
  await db.end();
});

afterAll(async () => {
  const db = await admin();
  try {
    /* In this order: the basis last, because removing a difference or a
       2028 price first leaves nothing deriving from it. */
    await db.query("delete from rate_offsets");
    await db.query("delete from rates where valid_from >= $1", [FROM]);
    await db.query("delete from pricing_basis");
    /* The trigger stamped the basis pair's existing rows. Put them back to
       what every row in this database means: the room type's own occupancy. */
    await db.query("update rates set covers_persons = null where covers_persons is not null");
  } finally {
    await db.end();
  }
  await closePool();
});

const as = (path: string, init?: RequestInit) =>
  app.request(`/api/hotels${path}`, {
    ...init,
    headers: {
      "x-dev-staff-id": ownerStaffId,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

const put = (path: string, body: unknown) =>
  as(path, { method: "PUT", body: JSON.stringify(body) });

type Pricing = {
  from: string;
  basis: { roomTypeId: string; roomType: string; mealPlan: string } | null;
  roomTypes: {
    id: string; code: string; name: string; category: string | null;
    baseOccupancy: number; maxOccupancy: number;
  }[];
  mealPlans: { code: string; name: string }[];
  offsets: { kind: string; roomTypeId: string | null; mealPlan: string | null; amount: number }[];
  cells: {
    date: string; roomTypeId: string; mealPlan: string;
    price: number | null; covers: number | null;
    source: "typed" | "derived" | "rack" | null;
  }[];
};

const read = async (query = `?from=${FROM}&days=2`) => {
  const res = await as(`/5EL/pricing${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Pricing;
};

const cell = (b: Pricing, typeId: string, plan: string, date = FROM) =>
  b.cells.find((c) => c.roomTypeId === typeId && c.mealPlan === plan && c.date === date)!;

describe("the pricing screen's data", () => {
  it("answers with no basis until somebody sets one", async () => {
    const body = await read();
    expect(body.basis, "a property starts with no base").toBeNull();
    expect(body.roomTypes.length).toBeGreaterThan(0);
    expect(body.mealPlans.length).toBeGreaterThan(0);
  });

  it("refuses a base price before there is a base, and says what to do", async () => {
    const res = await put("/5EL/pricing/base", { from: FROM, price: 2000 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toMatch(/Choose which room type and meal plan/i);
  });

  it("names the base, then prices it, and everything else follows", async () => {
    const before = await read();
    const deluxe = before.roomTypes.find((t) => t.code === "DLX")!;
    const other = before.roomTypes.find((t) => t.code !== "DLX")!;

    expect((await put("/5EL/pricing/basis", {
      roomTypeId: deluxe.id, mealPlan: "EP",
    })).status).toBe(200);

    expect((await put("/5EL/pricing/base", {
      from: FROM, to: LATER, price: 2000, label: "Test base",
    })).status).toBe(200);

    const after = await read();
    expect(after.basis?.roomTypeId).toBe(deluxe.id);

    const base = cell(after, deluxe.id, "EP");
    expect(base.price).toBe(2000);
    expect(base.covers, "the base covers one person").toBe(1);

    /* RT-3 (the owner, 28 September): no difference has EVER been set for
       the other type, so it is not priced - a dash - not the base. */
    const derived = cell(after, other.id, "EP");
    expect(derived.price).toBeNull();
    expect(derived.source).toBeNull();
  });

  it("adds a difference in rupees, and takes it away again", async () => {
    const body = await read();
    const other = body.roomTypes.find((t) => t.code !== "DLX")!;

    expect((await put("/5EL/pricing/offset", {
      kind: "room_type", roomTypeId: other.id,
      from: FROM, to: LATER, amount: 600, label: "Test difference",
    })).status).toBe(200);

    expect(cell(await read(), other.id, "EP").price).toBe(2600);

    /* Cleared, not zeroed. Nothing set means the base applies; a zero would
       be a different claim that reads the same on a screen. */
    expect((await put("/5EL/pricing/offset", {
      kind: "room_type", roomTypeId: other.id,
      from: FROM, to: LATER, amount: null,
    })).status).toBe(200);

    /* Cleared, it has no difference on file at all again: a dash (RT-3). */
    const cleared = await read();
    expect(cleared.offsets.filter((o) => o.roomTypeId === other.id)).toHaveLength(0);
    expect(cell(cleared, other.id, "EP").price).toBeNull();
  });

  it("prices a meal plan per person, on top of the room", async () => {
    const body = await read();
    const other = body.roomTypes.find((t) => t.code !== "DLX")!;

    /* A typed 0 is an answer: "the same as the base" (RT-3). */
    expect((await put("/5EL/pricing/offset", {
      kind: "room_type", roomTypeId: other.id,
      from: FROM, to: LATER, amount: 0, label: "Same as the base",
    })).status).toBe(200);

    expect((await put("/5EL/pricing/offset", {
      kind: "meal_plan", mealPlan: "CP",
      from: FROM, to: LATER, amount: 350, label: "Breakfast",
    })).status).toBe(200);

    const after = await read();
    expect(cell(after, other.id, "CP").price).toBe(2350);
    expect(cell(after, other.id, "EP").price).toBe(2000);
  });

  it("refuses a difference on the base room, in words a manager can act on", async () => {
    const body = await read();
    const deluxe = body.roomTypes.find((t) => t.code === "DLX")!;

    const res = await put("/5EL/pricing/offset", {
      kind: "room_type", roomTypeId: deluxe.id,
      from: FROM, to: LATER, amount: 500,
    });
    expect(res.status).toBe(409);
    const reason = ((await res.json()) as { reason: string }).reason;
    expect(reason).toMatch(/no difference from itself/i);
    expect(reason, "and says what to do instead").toMatch(/set the base price/i);
  });

  it("refuses a range that ends before it starts", async () => {
    const res = await put("/5EL/pricing/base", {
      from: LATER, to: FROM, price: 1000,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/has to be after its start/i);
  });

  it("refuses a difference that is about nothing", async () => {
    const res = await put("/5EL/pricing/offset", {
      from: FROM, amount: 100,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/room type or a meal plan/i);
  });

  it("answers 404 for a property that is not here", async () => {
    expect((await as("/NOPE/pricing")).status).toBe(404);
  });

  it("leaves a typed price alone, covering what it always covered", async () => {
    /* THE ASSERTION THAT PROTECTS EVERY BOOKING ALREADY TAKEN. A price typed
       through the Inventory and rates screen carries no covers_persons, so it
       covers what its room type says — two here, not the base's one. If that
       ever changed, every two-adult stay on a typed price would gain an
       extra-adult charge that nobody asked for.

       Typed through the grid's own route, not written behind it: the path a
       person actually uses is the one worth proving. */
    const before = await read();
    const other = before.roomTypes.find((t) => t.code !== "DLX")!;

    const wrote = await put("/5EL/rate-grid", {
      roomTypeId: other.id, mealPlan: "EP",
      from: FROM, to: LATER, price: 5000, label: "Typed in the grid",
    });
    expect(wrote.status, await wrote.text()).toBe(200);

    const after = cell(await read(), other.id, "EP");
    expect(after.source, "a typed price beats a derived one").toBe("typed");
    expect(after.price).toBe(5000);
    expect(after.covers, "and covers what the room type says, not one")
      .toBe(other.baseOccupancy);
    expect(after.covers).toBeGreaterThan(1);
  });

  /* ── 162: a base plus add-ons (D27-188, D27-194) ─────────────────── */
  type Extra = {
    addons: Record<string, number | null>;
    older: { roomTypeId: string; mealPlan: string; price: number; covers: number }[];
  };

  it("lists a price typed before 162 as an older price, not the base", async () => {
    const body = (await read()) as Pricing & Extra;
    const other = body.roomTypes.find((t) => t.code !== "DLX")!;
    const deluxe = body.roomTypes.find((t) => t.code === "DLX")!;
    expect(body.older.some((o) => o.roomTypeId === other.id && o.price === 5000)).toBe(true);
    expect(body.older.some((o) => o.roomTypeId === deluxe.id && o.mealPlan === "EP"),
      "the base is not an older price").toBe(false);
  });

  it("sets an add-on once, and 0 only when ticked Free (D27-120)", async () => {
    expect((await put("/5EL/pricing/addon", { kind: "double", amount: 0 })).status).toBe(409);
    expect((await put("/5EL/pricing/addon", { kind: "double", amount: 0, free: true })).status).toBe(200);
    expect(((await read()) as Pricing & Extra).addons["double"]).toBe(0);
    expect((await put("/5EL/pricing/addon", { kind: "double", amount: null })).status).toBe(200);
    expect(((await read()) as Pricing & Extra).addons["double"], "cleared is a dash").toBeNull();
    expect((await put("/5EL/pricing/addon", { kind: "meal_plan", mealPlan: "EP", amount: 100 })).status)
      .toBe(409);
  });

  it("derives a room type by a percentage, to the whole rupee", async () => {
    const other = (await read()).roomTypes.find((t) => t.code !== "DLX")!;
    expect((await put("/5EL/pricing/addon", {
      kind: "room_type", roomTypeId: other.id, amount: 10, unit: "percent",
    })).status).toBe(200);
    /* 2000 + 10% = 2200, and breakfast 350 for one guest. */
    expect(cell(await read(), other.id, "CP").price).toBe(2550);
  });

  it("prices each room type from its own base with no base room type", async () => {
    const other = (await read()).roomTypes.find((t) => t.code !== "DLX")!;
    expect((await put("/5EL/pricing/basis", { roomTypeId: null })).status).toBe(200);
    expect((await put("/5EL/pricing/base", {
      roomTypeId: other.id, from: FROM, to: LATER, price: 3000,
    })).status).toBe(200);
    const after = await read();
    expect(after.basis).toBeNull();
    expect(cell(after, other.id, "EP").price).toBe(3000);
    expect(cell(after, other.id, "EP").covers).toBe(1);
    expect(cell(after, other.id, "CP").price).toBe(3350);
  });

  it("gives a room type's break-up as app.tariff_for prices it, null where an add-on is not set (D27-206)", async () => {
    const other = (await read()).roomTypes.find((t) => t.code !== "DLX")!;
    expect((await put("/5EL/pricing/addon", { kind: "double", amount: 700 })).status).toBe(200);

    const res = await as(`/5EL/pricing?from=${FROM}&days=2&breakup=${other.id}`);
    expect(res.status).toBe(200);
    type Day = {
      date: string; guests: number;
      EP: number | null; CP: number | null; MAP: number | null; AP: number | null; AI: number | null;
      extraAdult: number | null; extraChild: number | null;
    };
    const { breakup } = (await res.json()) as { breakup: Day[] };
    expect(breakup.map((b) => b.date)).toEqual([FROM, "2028-01-02"]);

    /* THE ROWS ARE THE ONE DEFINITION'S: each figure is asked of the database
       again here, and must be the same - so a rule changed in app.tariff_for
       changes the screen with it and cannot be re-derived anywhere else. */
    const num = (v: string | null) => (v === null ? null : Number(v));
    const db = await admin();
    try {
      for (const day of breakup) {
        for (const plan of ["EP", "CP", "MAP", "AP", "AI"] as const) {
          const { rows } = await db.query<{ total: string | null }>(
            "select total::text from app.tariff_for($1, $2, $3::date, $4, 0)",
            [other.id, plan, day.date, day.guests]);
          expect(day[plan], `${plan} on ${day.date}`).toBe(num(rows[0]!.total));
        }
        const { rows: x } = await db.query<{ adult: string | null; child: string | null }>(
          "select adult::text, child::text from app.extra_person_rates($1, 'EP', $2::date)",
          [other.id, day.date]);
        expect(day.extraAdult).toBe(num(x[0]!.adult));
        expect(day.extraChild).toBe(num(x[0]!.child));
      }
    } finally {
      await db.end();
    }

    /* And in rupees: base 3000, the second guest 700, breakfast 350 a guest. */
    expect(breakup[0]!.guests).toBe(2);
    expect(breakup[0]!.EP).toBe(3700);
    expect(breakup[0]!.CP).toBe(4400);
    expect(breakup[0]!.MAP, "an add-on nobody set is null, never 0").toBeNull();
    expect(breakup[0]!.extraAdult, "nor is the extra adult").toBeNull();
  });

  it("never sends a zero for a price nobody has set", async () => {
    const body = await read("?from=2026-08-25&days=1");
    for (const c of body.cells) {
      if (c.source === null) {
        expect(c.price, "an unpriced cell travels as null, never as 0").toBeNull();
      } else {
        expect(c.price).not.toBeNull();
      }
    }
  });
});
