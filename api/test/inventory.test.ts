import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TWO GRIDS

   The inventory grid is DERIVED, and the whole reason it is derived is
   that a stored one drifts from the reservations that produced it. So
   the test that matters is that it agrees with the figures the demo
   was calibrated against — 431 sellable room-nights and 132 sold over
   1–25 August, which every occupancy and ADR number in the product
   rests on.

   The first version of migration 044 failed exactly this: it wrote its
   own copy of the sellable-rooms rule with `date < to_date` where
   app.sellable_rooms has always used `<=`, and came back 432. One
   night, on one blocked room, across the whole calibration.
   ══════════════════════════════════════════════════════════════════ */

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
    await db.query("delete from rate_restrictions");
  } finally {
    await db.end();
  }
  await closePool();
});

/* `init` is spread in rather than ignored. It was a GET-only helper, so a
   test that passed `{ method: "PUT" }` silently performed a GET — which
   answered 200 and wrote nothing, and every assertion downstream then failed
   for a reason that had nothing to do with what it was testing. */
const as = (path: string, init?: RequestInit) =>
  app.request(`/api/hotels${path}`, {
    ...init,
    headers: {
      "x-dev-staff-id": ownerStaffId,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

const post = (path: string, body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method: "POST",
    headers: {
      "x-dev-staff-id": ownerStaffId,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Cell = {
  roomTypeId: string; roomType: string; date: string;
  sellable: number; occupied: number; sold: number; available: number;
};

describe("the inventory grid", () => {
  it("agrees with the figures the demo is calibrated against", async () => {
    const res = await as("/5EL/inventory?from=2026-08-01&to=2026-08-25");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cells: Cell[] };

    const sellable = body.cells.reduce((a, c) => a + c.sellable, 0);
    const sold = body.cells.reduce((a, c) => a + c.sold, 0);

    /* PROGRESS.md, "Figures that must not move". If either of these
       changes, the query is wrong — not the number. */
    expect(sellable, "available room-nights 1–25 Aug").toBe(431);
    expect(sold, "room-nights sold").toBe(132);
  });

  it("counts a comped room as occupied but not sold", async () => {
    const res = await as("/5EL/inventory?from=2026-08-01&to=2026-08-25");
    const body = (await res.json()) as { cells: Cell[] };

    const occupied = body.cells.reduce((a, c) => a + c.occupied, 0);
    const sold = body.cells.reduce((a, c) => a + c.sold, 0);

    /* Both are right and they differ by the comps. A comped room cannot
       be sold to anybody else, so availability must subtract it; a free
       room would drag ADR to nothing, so the statistics must not. */
    expect(occupied).toBeGreaterThan(sold);
  });

  it("never reports more available than sellable", async () => {
    const res = await as("/5EL/inventory?from=2026-08-01&to=2026-09-10");
    const body = (await res.json()) as { cells: Cell[] };

    for (const c of body.cells) {
      expect(c.available, `${c.roomType} ${c.date}`)
        .toBeLessThanOrEqual(c.sellable);
      expect(c.available).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps a window nobody meant to ask for", async () => {
    const res = await as("/5EL/inventory?from=2026-01-01&to=2027-12-31");
    const body = (await res.json()) as { to: string; cells: Cell[] };
    /* Two years of cells is a request that arrived by accident. */
    expect(body.to <= "2026-04-01").toBe(true);
  });
});

describe("restrictions", () => {
  it("applies across a range in one call, and reads back", async () => {
    const inv = await as("/5EL/inventory?from=2026-09-01&to=2026-09-03");
    const first = ((await inv.json()) as { cells: Cell[] }).cells[0]!;

    const res = await post("/5EL/restrictions", {
      roomTypeId: first.roomTypeId,
      from: "2026-09-01", to: "2026-09-03",
      stopSell: true, minNights: 2,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { dates: number }).dates).toBe(3);

    const back = await as("/5EL/inventory?from=2026-09-01&to=2026-09-03");
    const body = (await back.json()) as {
      restrictions: { date: string; stopSell: boolean; minNights: number | null }[];
    };
    expect(body.restrictions).toHaveLength(3);
    expect(body.restrictions[0]!.stopSell).toBe(true);
    expect(body.restrictions[0]!.minNights).toBe(2);
  });

  it("refuses a minimum above the maximum, and says why", async () => {
    const inv = await as("/5EL/inventory?from=2026-09-01&to=2026-09-01");
    const first = ((await inv.json()) as { cells: Cell[] }).cells[0]!;

    const res = await post("/5EL/restrictions", {
      roomTypeId: first.roomTypeId, from: "2026-09-05",
      minNights: 5, maxNights: 2,
    });
    expect(res.status).toBe(409);
    /* Two innocent numbers that between them accept nothing at all is
       not something a person spots by reading the grid back. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/accepts no booking/i);
  });

  it("removes the row when every rule is cleared", async () => {
    const inv = await as("/5EL/inventory?from=2026-09-01&to=2026-09-01");
    const first = ((await inv.json()) as { cells: Cell[] }).cells[0]!;

    const res = await post("/5EL/restrictions", {
      roomTypeId: first.roomTypeId,
      from: "2026-09-01", to: "2026-09-03",
      stopSell: false, closedArrival: false, closedDeparture: false,
      minNights: null, maxNights: null,
    });
    expect(res.status).toBe(200);
    /* Absent already means unrestricted. Two representations of one
       state is how a grid shows a mark where there is none. */
    expect(((await res.json()) as { dates: number }).dates).toBe(0);
  });
});

describe("the rate grid", () => {
  const grid = async (from: string, to: string) => {
    const res = await as(`/5EL/rate-grid?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      plans: { roomType: string; mealPlan: string }[];
      cells: { roomTypeId: string; date: string; price: number | null;
               season: string | null; source: "rate" | "rack" | null }[];
    };
  };

  const put = (body: unknown) =>
    as("/5EL/rate-grid", { method: "PUT", body: JSON.stringify(body) });

  const cleanup = async () => {
    const db = await admin();
    try { await db.query("delete from rates where hotel_id = (select id from hotels where code='5EL')"); }
    finally { await db.end(); }
  };
  afterAll(cleanup);

  it("gives every cell a row even when NOTHING is priced", async () => {
    const body = await grid("2026-08-25", "2026-08-27");

    /* The demo ships NO PRICES — `rates` is empty, and seven assertions
       guard that it stays so. The cells must still be there, because the
       empty ones ARE the screen: a grid built only from rows that exist
       in `rates` has nowhere to type the first price, which is the state
       every new property is in. */
    expect(body.plans.length).toBeGreaterThan(0);
    expect(body.cells.length).toBe(body.plans.length * 3);

    /* Nothing is in `rates`, so no cell was priced FOR ITS DATE. */
    expect(body.cells.every((c) => c.source !== "rate")).toBe(true);

    /* What they do show is the room type's own rack rate, which is the
       price a booking would genuinely use today — 5EL's real rates, not
       an invented default (032 deleted those). The screen has to mark it
       as inherited: ₹4,099 because somebody priced this Saturday and
       ₹4,099 because nobody has looked at it are different facts. */
    expect(body.cells.some((c) => c.source === "rack")).toBe(true);
    /* And never a zero. A room nobody has priced is not a free room. */
    expect(body.cells.every((c) => c.price !== 0)).toBe(true);
  });

  it("expands a season into days, half-open", async () => {
    const plans = (await grid("2026-08-25", "2026-08-25")).plans;
    const type = plans[0]!;
    const typeId = (await grid("2026-08-25", "2026-08-25"))
      .cells[0]!.roomTypeId;

    const res = await put({
      roomTypeId: typeId, mealPlan: type.mealPlan,
      from: "2026-08-25", to: "2026-08-27", price: 3999, label: "GRIDTEST",
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const body = await grid("2026-08-24", "2026-08-28");
    const mine = body.cells.filter((c) => c.season === "GRIDTEST");
    /* 25th to 27th covers the 25th and 26th. Half-open, like room_blocks
       and reservations and every other range here — the API used to
       include the end date, so two contiguous seasons both claimed the
       boundary and the grid showed the outgoing price on the incoming
       day. */
    expect(mine).toHaveLength(2);
    expect(mine.map((c) => c.date)).toEqual(["2026-08-25", "2026-08-26"]);
    expect(mine[0]!.price).toBe(3999);
    expect(mine[0]!.source).toBe("rate");

    await cleanup();
  });

  it("shows an open-ended rack rate on every day it covers", async () => {
    const first = (await grid("2026-08-25", "2026-08-25")).cells[0]!;
    const plan = (await grid("2026-08-25", "2026-08-25")).plans[0]!;

    const res = await put({
      roomTypeId: first.roomTypeId, mealPlan: plan.mealPlan,
      from: "2026-08-01", to: null, price: 2500, label: "RACKTEST",
    });
    expect(res.status, await res.clone().text()).toBe(200);

    /* `valid_to` is NULL for a rack rate, which is the commonest rate a
       property has. The old query filtered on `valid_to >= from`, and
       against NULL that is NULL rather than true — so the row vanished
       and the grid read as "nothing has been priced yet". */
    const body = await grid("2026-12-24", "2026-12-26");
    const mine = body.cells.filter((c) => c.season === "RACKTEST");
    expect(mine).toHaveLength(3);
    expect(mine.every((c) => c.price === 2500)).toBe(true);

    await cleanup();
  });

  it("splits the rack rate around a weekend and puts the tail back", async () => {
    const first = (await grid("2026-08-25", "2026-08-25")).cells[0]!;
    const plan = (await grid("2026-08-25", "2026-08-25")).plans[0]!;
    const of = (c: { roomTypeId: string }) => c.roomTypeId === first.roomTypeId;

    await put({ roomTypeId: first.roomTypeId, mealPlan: plan.mealPlan,
                from: "2026-08-01", to: null, price: 2500 });
    await put({ roomTypeId: first.roomTypeId, mealPlan: plan.mealPlan,
                from: "2026-08-14", to: "2026-08-17", price: 4200 });

    const body = await grid("2026-08-13", "2026-08-18");
    const priceOn = (d: string) =>
      body.cells.find((c) => of(c) && c.date === d)!.price;

    expect(priceOn("2026-08-13")).toBe(2500);
    expect(priceOn("2026-08-14")).toBe(4200);
    expect(priceOn("2026-08-16")).toBe(4200);
    /* The half that gets forgotten. Trim the rack rate for the weekend
       and never re-create its tail, and the property has no price at all
       from the 17th onward — with nothing on screen saying so. */
    expect(priceOn("2026-08-17")).toBe(2500);

    await cleanup();
  });

  it("clears a cell to a dash rather than to zero", async () => {
    const first = (await grid("2026-08-25", "2026-08-25")).cells[0]!;
    const plan = (await grid("2026-08-25", "2026-08-25")).plans[0]!;

    await put({ roomTypeId: first.roomTypeId, mealPlan: plan.mealPlan,
                from: "2026-08-25", to: "2026-08-27", price: 3999 });
    const res = await put({ roomTypeId: first.roomTypeId, mealPlan: plan.mealPlan,
                            from: "2026-08-25", to: "2026-08-27", price: null });
    expect(res.status, await res.clone().text()).toBe(200);

    const body = await grid("2026-08-25", "2026-08-26");
    const mine = body.cells.filter((c) => c.roomTypeId === first.roomTypeId
      && c.date === "2026-08-25");
    /* Cleared, so nothing was priced for the date — it falls back to the
       room type again rather than to a zero somebody would have to
       explain later. */
    expect(mine[0]!.source).not.toBe("rate");

    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from rates where price = 0");
      expect(Number(rows[0]!.n), "clearing must not write a zero row").toBe(0);
    } finally { await db.end(); }

    await cleanup();
  });

  it("refuses a range that ends before it starts", async () => {
    const first = (await grid("2026-08-25", "2026-08-25")).cells[0]!;
    const plan = (await grid("2026-08-25", "2026-08-25")).plans[0]!;
    const res = await put({ roomTypeId: first.roomTypeId, mealPlan: plan.mealPlan,
                            from: "2026-09-10", to: "2026-09-01", price: 1000 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/after its start/i);
  });

  it("refuses a room type that belongs to another property", async () => {
    const db = await admin();
    let foreign: string;
    try {
      const { rows } = await db.query<{ id: string }>(
        `select rt.id::text from room_types rt
           join hotels h on h.id = rt.hotel_id
          where h.code <> '5EL' limit 1`);
      foreign = rows[0]!.id;
    } finally { await db.end(); }

    const res = await put({ roomTypeId: foreign, mealPlan: "EP",
                            from: "2026-08-25", to: "2026-08-27", price: 1000 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/no such room type/i);
  });
});
