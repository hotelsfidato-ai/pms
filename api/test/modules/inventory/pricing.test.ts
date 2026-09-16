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

    /* No difference is set for the other type, so it sells at the base —
       the owner's rule: where nothing is set for a date, the base applies. */
    const derived = cell(after, other.id, "EP");
    expect(derived.price).toBe(2000);
    expect(derived.source).toBe("derived");
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

    const cleared = await read();
    expect(cleared.offsets.filter((o) => o.roomTypeId === other.id)).toHaveLength(0);
    expect(cell(cleared, other.id, "EP").price).toBe(2000);
  });

  it("prices a meal plan per person, on top of the room", async () => {
    const body = await read();
    const other = body.roomTypes.find((t) => t.code !== "DLX")!;

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
