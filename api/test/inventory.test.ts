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

const as = (path: string) =>
  app.request(`/api/hotels${path}`, {
    headers: { "x-dev-staff-id": ownerStaffId },
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
  it("lists every plan even when NOTHING is priced", async () => {
    const res = await as("/5EL/rate-grid?from=2026-08-25&to=2026-08-27");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plans: { roomType: string; mealPlan: string }[];
      cells: { date: string; price: number; season: string | null }[];
    };

    /* The demo ships NO PRICES — `rates` is empty, and seven assertions
       guard that it stays so. The rows must still be there, or there is
       nowhere to type the first price and the screen is useless at
       exactly the moment it matters most. */
    expect(body.plans.length).toBeGreaterThan(0);
    expect(body.cells).toHaveLength(0);
  });

  it("expands a season into days once something IS priced", async () => {
    const db = await admin();
    let typeId: string;
    try {
      const { rows } = await db.query<{ id: string; hotel: string }>(
        `select rt.id::text, rt.hotel_id::text as hotel from room_types rt
           join hotels h on h.id = rt.hotel_id where h.code = '5EL' limit 1`);
      typeId = rows[0]!.id;
      await db.query(
        `insert into rates (hotel_id, room_type_id, meal_plan, price,
                            valid_from, valid_to, label, created_by)
         values ($1,$2,'EP',3999,'2026-08-25','2026-08-27','GRIDTEST',
                 (select id from staff where email='owner@fidato.in'))`,
        [rows[0]!.hotel, typeId]);
    } finally { await db.end(); }

    const res = await as("/5EL/rate-grid?from=2026-08-25&to=2026-08-27");
    const body = (await res.json()) as {
      cells: { date: string; price: number; season: string | null }[];
    };
    const mine = body.cells.filter((c) => c.season === "GRIDTEST");
    /* A rate is stored as a RANGE and the grid is per day. Three days
       in, three cells out. */
    expect(mine).toHaveLength(3);
    expect(mine[0]!.price).toBe(3999);

    const clean = await admin();
    try { await clean.query("delete from rates where label = 'GRIDTEST'"); }
    finally { await clean.end(); }
  });
});
