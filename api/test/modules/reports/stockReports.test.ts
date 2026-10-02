import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import type { ReportDoc } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE STORE AND EQUIPMENT REPORTS (phase 3A; the owner's D27-238, D27-240)

   One property of its own (STK), so no other test's stock moves these
   figures. The ledger below is worked out by hand:

     Rice (kg), Main store   in 100 @ 50 on 2 Sep, in 50 @ 56 on 20 Sep
                             (Annapurna Traders); issued 30 to the
                             restaurant on 25 Sep; 2 wasted on 26 Sep
                             ("Rats"); counted 3 short on 28 Sep.
                             On hand 115; average cost 52.00; value 5,980.
     Oil (litre), Main       in 20 on 5 Sep with NO price; 4 issued on 29 Sep
                             to no outlet. On hand 16; value a dash.
     Salt (kg), Main         in 10 @ 20 on 1 Jun; never used: dead 90+.
     Sugar (kg), Kitchen     in 10 @ 40 on 15 Jul; 2 issued on 20 Aug:
                             idle 41 days on 30 Sep, dead 30-59.

   Costs are as recorded (D27-240 R-2); a movement with no recorded cost is
   a dash and is left out of a total, which says so.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const CODE = "STK";
const TAG = "STK3A";
let hotelId: string;
let ownerId: string;
const staff = new Map<string, string>();

const get = (who: string, key: string, query: string) =>
  app.request(`/api/hotels/${CODE}/reports/${key}?${query}`, {
    headers: { "x-dev-staff-id": who },
  });
const doc = async (key: string, query = "asOn=2026-09-30&from=2026-09-01") => {
  const res = await get(ownerId, key, query);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ReportDoc;
};
const section = (d: ReportDoc, key: string) => d.sections.find((s) => s.key === key)!;
const cells = (d: ReportDoc, key: string): Record<string, unknown>[] =>
  section(d, key).rows.map((r) => ({ kind: r.kind, ...r.cells }));

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  const pg = new (await import("pg")).default.Client({ connectionString: SUPER });
  await pg.connect();
  try {
    await pg.query("select set_config('app.user_id', $1, false)", [ownerId]);
    hotelId = (await pg.query(
      "select app.provision_property_unchecked($1, 'Stock Reports Test', 'Nowhere')::text as id",
      [CODE])).rows[0].id;
    for (const role of ["stores", "kitchen_manager", "revenue_manager", "hotel_manager"]) {
      const id = (await pg.query(
        `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
         on conflict (email) do update set is_active = true returning id::text`,
        [`stk3a-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-stk3a-${role}`])).rows[0].id as string;
      await pg.query("delete from staff_hotels where staff_id = $1", [id]);
      await pg.query("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
      staff.set(role, id);
    }
    const keeper = staff.get("stores")!;
    const place = async (name: string) => (await pg.query(
      "select id::text from locations where hotel_id = $1 and name = $2", [hotelId, name])).rows[0].id as string;
    const main = await place("Main store");
    const kitchen = await place("Kitchen store");
    const outlet = (await pg.query(
      `insert into pos_outlets (hotel_id, code, name, staff_id) values ($1, 'stk-rest', 'STK Restaurant', $2)
       returning id::text`, [hotelId, keeper])).rows[0].id as string;
    const item = async (name: string, unit: string) => (await pg.query(
      "insert into stock_items (hotel_id, name, unit, category) values ($1, $2, $3, 'Kitchen') returning id::text",
      [hotelId, name, unit])).rows[0].id as string;
    const move = (itemId: string, store: string, day: string, kind: string, qty: number,
      extra: { cost?: number; supplier?: string; note?: string; outlet?: string } = {}) => pg.query(
      `insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity,
                                    unit_cost, supplier, note, to_outlet, moved_by)
       values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11)`,
      [hotelId, itemId, store, day, kind, qty, extra.cost ?? null, extra.supplier ?? null,
       extra.note ?? null, extra.outlet ?? null, keeper]);

    const rice = await item("Rice", "kg");
    await move(rice, main, "2026-09-02", "receipt", 100, { cost: 50, supplier: "Annapurna Traders" });
    await move(rice, main, "2026-09-20", "receipt", 50, { cost: 56, supplier: "Annapurna Traders" });
    await move(rice, main, "2026-09-25", "issue", -30, { outlet });
    await move(rice, main, "2026-09-26", "wastage", -2, { note: "Rats" });
    await move(rice, main, "2026-09-28", "adjustment", -3, { note: "Count of Main store - spilt" });
    const oil = await item("Oil", "litre");
    await move(oil, main, "2026-09-05", "receipt", 20);
    await move(oil, main, "2026-09-29", "issue", -4);
    const salt = await item("Salt", "kg");
    await move(salt, main, "2026-06-01", "receipt", 10, { cost: 20, supplier: "Annapurna Traders" });
    const sugar = await item("Sugar", "kg");
    await move(sugar, kitchen, "2026-07-15", "receipt", 10, { cost: 40, supplier: "Sweet Co" });
    await move(sugar, kitchen, "2026-08-20", "issue", -2);

    /* Equipment: a fridge in the Main store (not out), a TV in the restaurant
       (out), an AC under repair with its repair open. Each item and its first
       place in one transaction: "every item is somewhere" is checked at commit. */
    const restaurant = (await pg.query(
      `select id::text from locations where hotel_id = $1 and kind = 'restaurant' limit 1`, [hotelId])).rows[0]?.id
      ?? (await pg.query(
        `insert into locations (hotel_id, name, kind) values ($1, 'STK Dining', 'restaurant') returning id::text`,
        [hotelId])).rows[0].id;
    const equip = async (name: string, tag: string, at: string, extra: Record<string, unknown>) => {
      await pg.query("begin");
      const id = (await pg.query(
        `insert into equipment_items (hotel_id, name, held_as, tag, quantity, status, warranty_ends, amc_ends, created_by)
         values ($1, $2, 'tagged', $3, 1, $4, $5, $6, $7) returning id::text`,
        [hotelId, name, tag, extra["status"] ?? "in_use", extra["warranty"] ?? null, extra["amc"] ?? null, keeper],
      )).rows[0].id as string;
      await pg.query(
        `insert into equipment_moves (hotel_id, item_id, kind, to_location_id, moved_by, moved_at)
         values ($1, $2, 'placed', $3, $4, '2026-09-10T10:00:00+05:30')`, [hotelId, id, at, keeper]);
      await pg.query("commit");
      return id;
    };
    await equip("Fridge", "STK-1", main, { warranty: "2026-10-15", amc: "2027-01-01" });
    await equip("TV", "STK-2", restaurant, { warranty: "2026-09-01" });
    const ac = await equip("AC", "STK-3", main, { status: "under_repair" });
    await pg.query(
      `insert into work_orders (hotel_id, title, status, raised_by, raised_at, equipment_item_id)
       values ($1, 'Compressor', 'open', $2, '2026-09-27T09:00:00+05:30', $3)`, [hotelId, keeper, ac]);
  } finally {
    await pg.end();
  }
});

afterAll(async () => {
  /* The property and its ledger stay in this run's scratch database (the
     ledger is append-only); its people are let go. */
  const ids = [...staff.values()];
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [ids]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [ids]);
  await closePool();
});

describe("closing stock and value (stock-on-hand)", () => {
  it("per store, as on a date, at the average cost as recorded; no cost is a dash, left out of the total", async () => {
    const d = await doc("stock-on-hand", "asOn=2026-09-30");
    expect(d.sections.map((s) => s.title)).toEqual(["Main store", "Kitchen store", "All stores"]);
    expect(cells(d, "store-Main store")).toEqual([
      { kind: "row", item: "Oil", unit: "litre", category: "Kitchen", onHand: 16, unitCost: null, value: null },
      { kind: "row", item: "Rice", unit: "kg", category: "Kitchen", onHand: 115, unitCost: 52, value: 5980 },
      { kind: "row", item: "Salt", unit: "kg", category: "Kitchen", onHand: 10, unitCost: 20, value: 200 },
      { kind: "total", item: "Total", unit: null, category: null, onHand: null, unitCost: null, value: 6180 },
    ]);
    expect(section(d, "store-Main store").note).toBe("1 item has no recorded cost and is left out of the total.");
    expect(cells(d, "all").at(-1)).toMatchObject({ kind: "total", value: 6500 });
    expect(d.footnotes.join(" ")).toContain("whether they include GST is the CA's to settle");

    const before = await doc("stock-on-hand", "asOn=2026-09-21");
    expect(cells(before, "store-Main store").find((r) => r.item === "Rice")).toMatchObject({ onHand: 150 });
  });
});

describe("movement by day and kind (stock-movements)", () => {
  it("one row a day in the window, valued as recorded; a day whose only movement has no cost is a dash", async () => {
    const d = await doc("stock-movements");
    const rows = cells(d, "days");
    expect(rows.find((r) => r.day === "2026-09-02")).toMatchObject({ received: 5000, issued: 0, movements: 1 });
    expect(rows.find((r) => r.day === "2026-09-05")).toMatchObject({ received: null, movements: 1 });
    expect(rows.find((r) => r.day === "2026-09-28")).toMatchObject({ corrections: -156 });
    expect(rows.at(-1)).toEqual({
      kind: "total", day: "Total", received: 7800, issued: 1560, wasted: 104,
      corrections: -156, returned: 0, movements: 7,
    });
  });
});

describe("consumption, wastage and the count (stock-consumption, stock-wastage, stock-count-differences)", () => {
  it("consumption per item and per outlet", async () => {
    const d = await doc("stock-consumption");
    expect(cells(d, "items")).toEqual([
      { kind: "row", item: "Oil", unit: "litre", issued: 4, value: null },
      { kind: "row", item: "Rice", unit: "kg", issued: 30, value: 1560 },
      { kind: "total", item: "Total", unit: null, issued: null, value: 1560 },
    ]);
    expect(cells(d, "outlets")).toEqual([
      { kind: "row", outlet: "STK Restaurant", items: 1, value: 1560 },
      { kind: "row", outlet: "No outlet", items: 1, value: null },
      { kind: "total", outlet: "Total", items: null, value: 1560 },
    ]);
  });

  it("every wastage, and every count correction, with who and why", async () => {
    const w = await doc("stock-wastage");
    expect(cells(w, "wastage")[0]).toEqual({
      kind: "row", day: "2026-09-26", store: "Main store", item: "Rice", quantity: 2, unit: "kg",
      value: 104, reason: "Rats", by: `${TAG} stores`,
    });
    const c = await doc("stock-count-differences");
    expect(cells(c, "corrections")[0]).toEqual({
      kind: "row", day: "2026-09-28", store: "Main store", item: "Rice", difference: -3, unit: "kg",
      value: -156, reason: "Count of Main store - spilt", by: `${TAG} stores`,
    });
  });
});

describe("dead stock and days of cover (stock-dead, stock-cover)", () => {
  it("nothing went out for 30, 60 or 90+ days (D27-240 R-3)", async () => {
    const d = await doc("stock-dead", "asOn=2026-09-30");
    expect(cells(d, "dead")).toEqual([
      { kind: "band", item: "Nothing out for 90 days or more" },
      { kind: "row", item: "Salt", store: "Main store", onHand: 10, unit: "kg", value: 200, lastOut: null, idle: 121 },
      { kind: "band", item: "Nothing out for 30 to 59 days" },
      { kind: "row", item: "Sugar", store: "Kitchen store", onHand: 8, unit: "kg", value: 320, lastOut: "2026-08-20", idle: 41 },
    ]);
  });

  it("on hand over the average issued a day in the last 7 days; a dash when nothing was issued (D27-240 R-4)", async () => {
    const d = await doc("stock-cover", "asOn=2026-09-30");
    expect(section(d, "cover").columns.map((c) => c.label)).toEqual([
      "Item", "Unit", "On hand", "Issued in the last 7 days", "Average issued a day (last 7 days)",
      "Days of cover (at the last 7 days' use)",
    ]);
    expect(cells(d, "cover")).toEqual([
      { kind: "row", item: "Oil", unit: "litre", onHand: 16, issued: 4, perDay: 0.57, days: 28 },
      { kind: "row", item: "Rice", unit: "kg", onHand: 115, issued: 30, perDay: 4.29, days: 26.8 },
      { kind: "row", item: "Salt", unit: "kg", onHand: 10, issued: 0, perDay: null, days: null },
      { kind: "row", item: "Sugar", unit: "kg", onHand: 8, issued: 0, perDay: null, days: null },
    ]);
  });
});

describe("supplier spend and price trend (supplier-spend)", () => {
  it("every delivery in the window by supplier, and each item's first and last price", async () => {
    const d = await doc("supplier-spend");
    expect(cells(d, "suppliers")).toEqual([
      { kind: "row", supplier: "Annapurna Traders", deliveries: 2, value: 7800 },
      { kind: "row", supplier: "Not named", deliveries: 1, value: null },
      { kind: "total", supplier: "Total", deliveries: 3, value: 7800 },
    ]);
    expect(cells(d, "prices")).toEqual([
      { kind: "row", item: "Rice", unit: "kg", first: 50, last: 56, change: 12 },
    ]);
  });
});

describe("equipment (equipment)", () => {
  it("out of the store, under repair, and warranty and AMC days left", async () => {
    const d = await doc("equipment", "asOn=2026-09-30");
    expect(cells(d, "out")).toEqual([
      { kind: "row", item: "TV", tag: "STK-2", where: expect.any(String), since: "2026-09-10" },
    ]);
    expect(cells(d, "repair")).toEqual([
      { kind: "row", item: "AC", tag: "STK-3", repair: "Compressor", since: "2026-09-27", cost: null },
    ]);
    expect(cells(d, "warranty")).toEqual([
      { kind: "row", item: "TV", tag: "STK-2", warranty: "2026-09-01", amc: null, warrantyLeft: -29, amcLeft: null },
      { kind: "row", item: "Fridge", tag: "STK-1", warranty: "2026-10-15", amc: "2027-01-01", warrantyLeft: 15, amcLeft: 93 },
    ]);
  });
});

describe("who reads them (D27-240 R-1)", () => {
  it("the Inventory Manager and the hotel manager read; the kitchen manager and the revenue manager do not", async () => {
    for (const role of ["stores", "hotel_manager"]) {
      const res = await get(staff.get(role)!, "stock-on-hand", "asOn=2026-09-30");
      expect(res.status, role).toBe(200);
    }
    for (const role of ["kitchen_manager", "revenue_manager"]) {
      const res = await get(staff.get(role)!, "stock-on-hand", "asOn=2026-09-30");
      expect(res.status, role).toBe(403);
    }
  });
});
