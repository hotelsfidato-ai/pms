import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   RESTAURANT SETUP (D22-6, the owner's answers of 25 September)

   A property with no restaurant, set up through the screen's routes - its
   name, a section, its tables - and then a first order rung on one of them,
   which is what "before the second hotel" means. The owner, an
   administrator and the GM may; a waiter may not. Nothing is deleted: a
   table or section taken away is switched off, and refused while a bill
   sits on it.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async <R = Record<string, unknown>>(text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try { return (await db.query(text, params)).rows as R[]; } finally { await db.end(); }
};

const CODE = "TSETUP";
let hotelId: string;
let gm: string;
let waiter: string;

const send = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const as = async (who: string, method: string, path: string, body?: unknown) => {
  const res = await send(who, method, path, body);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

type Setup = {
  restaurant: { name: string } | null;
  sections: { id: string; name: string;
              tables: { id: string; label: string; seats: number | null; busy: boolean }[] }[];
  waiters: number;
};
const setup = async () => (await as(gm, "GET", "/till/setup")).body as Setup;
const section = async (name: string) => (await setup()).sections.find((s) => s.name === name)!;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Till Setup Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    const person = async (email: string, name: string, role: string) => {
      const id = (await db.query<{ id: string }>(
        `insert into staff (email, full_name, is_group_admin) values ($1, $2, false)
         returning id::text`, [email, name])).rows[0]!.id;
      await db.query(
        "insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
        [id, hotelId, role]);
      return id;
    };
    gm = await person("tsetup-gm@example.test", "Setup GM", "gm");
    waiter = await person("tsetup-waiter@example.test", "Setup Waiter", "pos");
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table hotels disable trigger hotels_no_delete");
    /* The one order stays open, so its lines may go (028's freeze is for a
       settled bill). */
    await db.query("delete from pos_order_lines where hotel_id = $1", [hotelId]);
    await db.query("delete from pos_orders where hotel_id = $1", [hotelId]);
    await db.query("delete from pos_menu_items where hotel_id = $1", [hotelId]);
    await db.query("delete from pos_outlets where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("delete from staff where email like 'tsetup-%@example.test'");
  } finally { await db.end(); }
  await closePool();
});

describe("a property with no restaurant", () => {
  it("has none, no sections and one waiter", async () => {
    expect(await setup()).toEqual({ restaurant: null, sections: [], waiters: 1 });
  });

  it("refuses a section before the restaurant has a name, and writes nothing", async () => {
    const res = await as(gm, "POST", "/till/setup/sections", { name: "A/C" });
    expect(res.status).toBe(409);
    expect(res.body.reason).toMatch(/Name the restaurant first/);
    expect((await sql("select 1 from pos_sections where hotel_id = $1", [hotelId])).length).toBe(0);
  });

  it("refuses a waiter: only the owner, an administrator and the GM set it up", async () => {
    const res = await as(waiter, "POST", "/till/setup/restaurant", { name: "Waiter's Cafe" });
    expect(res.status).toBe(403);
    expect((await sql("select 1 from pos_outlets where hotel_id = $1", [hotelId])).length).toBe(0);
  });
});

describe("setting it up", () => {
  it("names the restaurant: the REST outlet the till opens, with no key, made by the GM", async () => {
    expect((await as(gm, "POST", "/till/setup/restaurant", { name: "  " })).status).toBe(409);
    expect((await as(gm, "POST", "/till/setup/restaurant", { name: "Sattva" })).status).toBe(200);
    expect((await as(gm, "POST", "/till/setup/restaurant", { name: "Sattva Restaurant" })).status)
      .toBe(200);
    const rows = await sql<{ code: string; name: string; api_key_hash: string | null; staff_id: string }>(
      "select code, name, api_key_hash, staff_id::text from pos_outlets where hotel_id = $1",
      [hotelId]);
    expect(rows).toEqual([
      { code: "REST", name: "Sattva Restaurant", api_key_hash: null, staff_id: gm }]);
    expect((await setup()).restaurant).toEqual({ name: "Sattva Restaurant" });
  });

  it("adds a section, refuses a second of the same name, and shows it while it is empty", async () => {
    expect((await as(gm, "POST", "/till/setup/sections", { name: "A/C" })).status).toBe(200);
    const again = await as(gm, "POST", "/till/setup/sections", { name: "A/C" });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe("There is already a section called A/C.");
    expect((await as(gm, "POST", "/till/setup/sections", { name: "Bar" })).status).toBe(200);
    expect((await setup()).sections.map((s) => [s.name, s.tables.length]))
      .toEqual([["A/C", 0], ["Bar", 0]]);
  });

  it("renames a section, and refuses a name another section has", async () => {
    const bar = await section("Bar");
    expect((await as(gm, "PATCH", `/till/setup/sections/${bar.id}`, { name: "A/C" })).status)
      .toBe(409);
    expect((await as(gm, "PATCH", `/till/setup/sections/${bar.id}`, { name: "Rooftop" })).status)
      .toBe(200);
    expect((await setup()).sections.map((s) => s.name)).toEqual(["A/C", "Rooftop"]);
  });

  it("adds a numbered run - AC from 1 to 5 - four across, seats a dash when left blank", async () => {
    const ac = await section("A/C");
    const res = await as(gm, "POST", `/till/setup/sections/${ac.id}/tables`,
      { prefix: "AC", from: "1", to: "5", seats: "" });
    expect(res.status, res.body.reason).toBe(200);
    expect(res.body.added).toBe(5);
    const rows = await sql<{ label: string; seats: number | null; row_no: number; col_no: number }>(
      `select label, seats, row_no, col_no from pos_tables where section_id = $1
        order by row_no, col_no`, [ac.id]);
    expect(rows.map((r) => [r.label, r.seats, r.row_no, r.col_no])).toEqual([
      ["AC1", null, 0, 0], ["AC2", null, 0, 1], ["AC3", null, 0, 2], ["AC4", null, 0, 3],
      ["AC5", null, 1, 0]]);
  });

  it("adds one table with its seats", async () => {
    const top = await section("Rooftop");
    const res = await as(gm, "POST", `/till/setup/sections/${top.id}/tables`,
      { label: "R1", seats: "4" });
    expect(res.status, res.body.reason).toBe(200);
    expect((await section("Rooftop")).tables)
      .toEqual([{ id: expect.any(String), label: "R1", seats: 4, busy: false }]);
  });

  it("refuses what is not a table, and writes nothing", async () => {
    const ac = await section("A/C");
    const path = `/till/setup/sections/${ac.id}/tables`;
    const tries: [unknown, RegExp][] = [
      [{ prefix: "AC", from: "", to: "3" }, /Type a table, or a run/],
      [{ prefix: "AC", from: "4", to: "2" }, /Type a table, or a run/],
      [{ prefix: "X", from: "1", to: "101" }, /at most 100 tables/],
      [{ label: "AC9", seats: "0" }, /Seats is a whole number/],
      [{ label: "AC9", seats: "two" }, /Seats is a whole number/],
      [{ prefix: "AC", from: "4", to: "6" }, /^AC4, AC5 are already in A\/C\.$/],
    ];
    for (const [body, reason] of tries) {
      const res = await as(gm, "POST", path, body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body.reason).toMatch(reason);
    }
    expect((await section("A/C")).tables.map((t) => t.label))
      .toEqual(["AC1", "AC2", "AC3", "AC4", "AC5"]);
  });

  it("changes a table's name and seats, and refuses a name its section already has", async () => {
    const t = (await section("A/C")).tables.find((x) => x.label === "AC5")!;
    expect((await as(gm, "PATCH", `/till/setup/tables/${t.id}`, { label: "AC1", seats: "" }))
      .status).toBe(409);
    expect((await as(gm, "PATCH", `/till/setup/tables/${t.id}`, { label: "AC6", seats: "2" }))
      .status).toBe(200);
    expect((await section("A/C")).tables.at(-1)).toMatchObject({ label: "AC6", seats: 2 });
  });

  it("puts the tables on the Tables screen", async () => {
    const res = await as(gm, "GET", "/till/floor");
    expect(res.body.outlet.name).toBe("Sattva Restaurant");
    expect(res.body.sections.map((s: { name: string; tables: unknown[] }) =>
      [s.name, s.tables.length])).toEqual([["A/C", 5], ["Rooftop", 1]]);
  });
});

describe("the first order, and taking a table away", () => {
  let ac1: string;
  let orderId: string;

  it("rings a first order on a table the screen made", async () => {
    const cat = await as(gm, "POST", "/till/menu/categories", { name: "Mains" });
    expect(cat.status, cat.body.reason).toBe(200);
    const dish = await as(gm, "POST", "/till/menu/items",
      { categoryId: cat.body.id, name: "Dal Tadka", price: "180" });
    expect(dish.status, dish.body.reason).toBe(200);
    await sql(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'other', 0, 5, 'Test')`, [hotelId]);

    ac1 = (await section("A/C")).tables.find((t) => t.label === "AC1")!.id;
    const order = await as(waiter, "POST", "/till/orders", { outlet: "REST", tableId: ac1 });
    expect(order.status, order.body.reason).toBe(200);
    orderId = order.body.id;
    const line = await as(waiter, "POST", `/till/orders/${orderId}/lines`,
      { itemId: dish.body.id, qty: 1 });
    expect(line.status, line.body.reason).toBe(200);
    expect(await sql("select name, tax_rate::text from pos_order_lines where order_id = $1",
      [orderId])).toEqual([{ name: "Dal Tadka", tax_rate: "5.00" }]);
  });

  it("refuses to take away a table, or its section, while a bill sits on it", async () => {
    expect((await section("A/C")).tables.find((t) => t.id === ac1)!.busy).toBe(true);
    const table = await as(gm, "POST", `/till/setup/tables/${ac1}/off`);
    expect(table.status).toBe(409);
    expect(table.body.reason).toBe("AC1 has a bill on it. Settle or clear the table first.");
    const ac = await section("A/C");
    const whole = await as(gm, "POST", `/till/setup/sections/${ac.id}/off`);
    expect(whole.status).toBe(409);
    expect(whole.body.reason).toBe("A/C still has a bill on AC1. Settle or clear those tables first.");
  });

  it("switches off a free table - off Tables, kept in the database - and adding it back restores it", async () => {
    const ac2 = (await section("A/C")).tables.find((t) => t.label === "AC2")!.id;
    expect((await as(gm, "POST", `/till/setup/tables/${ac2}/off`)).status).toBe(200);
    expect((await section("A/C")).tables.map((t) => t.label)).not.toContain("AC2");
    expect(await sql("select is_active from pos_tables where id = $1", [ac2]))
      .toEqual([{ is_active: false }]);

    const ac = await section("A/C");
    expect((await as(gm, "POST", `/till/setup/sections/${ac.id}/tables`, { label: "AC2" })).status)
      .toBe(200);
    expect(await sql("select is_active from pos_tables where id = $1", [ac2]))
      .toEqual([{ is_active: true }]);
  });

  it("switches off an empty section, and a waiter may not", async () => {
    const top = await section("Rooftop");
    expect((await as(waiter, "POST", `/till/setup/sections/${top.id}/off`)).status).toBe(403);
    const r1 = top.tables[0]!.id;
    expect((await as(gm, "POST", `/till/setup/tables/${r1}/off`)).status).toBe(200);
    expect((await as(gm, "POST", `/till/setup/sections/${top.id}/off`)).status).toBe(200);
    expect((await setup()).sections.map((s) => s.name)).toEqual(["A/C"]);
  });

  it("sits behind the restaurant's switch, like every till route", async () => {
    await sql(
      `insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'pos', false)
       on conflict (hotel_id, module) do update set is_enabled = false`, [hotelId]);
    try {
      expect((await as(gm, "GET", "/till/setup")).status).toBe(403);
    } finally {
      await sql("delete from hotel_modules where hotel_id = $1 and module = 'pos'", [hotelId]);
    }
  });
});
