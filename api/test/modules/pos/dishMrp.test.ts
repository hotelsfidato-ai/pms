import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import type { ReportDoc } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   A DISH'S MRP, AND A BILL GIVEN FREE (NC) VALUED AT IT IN THE STOCK
   (the owner's D27-351 and D27-373; migration 254)

   The MRP is typed on the Menu by whoever may change the menu (`menu:
   edit`: the owner, an Admin, the GM, the kitchen manager); empty is a
   dash - never a zero, never the price. A dish sold by variation carries
   it on its first-type choices. An NC bill's dishes are valued at
   quantity x MRP in the Consumption report, and nowhere in sales, tax or
   the Day book.

   The report's fixture is its own property (NCM), worked out by hand:
     NC bill, 15 Sep:  Lassi x2 (MRP 60) = 120; Kulfi x1 (no MRP) = -;
                       Biryani Half x1 (MRP 150) = 150; Biryani Full x1 (its
                       choice has none - the dish's own 999 is NOT used) = -;
                       a struck Lassi and an extra under a Lassi: not dishes.
                       Total 270; two dishes lack an MRP.
     Paid bill, 15 Sep: Lassi x1 at 50 + 5% GST, cash - the day's only sale.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "DISHMRP";
const DAY = "2026-09-15";
let owner = "";
let gm = "";
let waiter = "";
let categoryId = "";
let ncmId = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown, code = "5EL") =>
  app.request(`/api/hotels/${code}${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason?: string }).reason ?? "";

type Choice = { label: string; typeNo: number; mrp: number | null };
type Dish = { id: string; price: number; mrp: number | null; variations: Choice[] };
async function dishOf(id: string): Promise<Dish> {
  const body = (await (await call(owner, "GET", "/till/menu")).json()) as {
    categories: { items: Dish[] }[] };
  return body.categories.flatMap((c) => c.items).find((i) => i.id === id)!;
}
async function newDish(name: string): Promise<string> {
  const res = await call(owner, "POST", "/till/menu/items",
    { categoryId, name: `${TAG} ${name}`, price: "320", taxRate: 5 });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { id: string }).id;
}
const setMrp = (who: string, id: string, mrp: unknown) =>
  call(who, "POST", `/till/menu/items/${id}/mrp`, { mrp });

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const person = async (email: string, name: string, role: string) => {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`, [email, name]);
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = '5EL'
       on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, role]);
    return s!.id;
  };
  gm = await person("dishmrp-gm@fidato.in", `${TAG} Manager`, "gm");
  waiter = await person("dishmrp-waiter@fidato.in", `${TAG} Waiter`, "pos");
  const res = await call(owner, "POST", "/till/menu/categories", { name: `${TAG} section` });
  categoryId = ((await res.json()) as { id: string }).id;

  /* The report's property, and its two bills, written as the till leaves them. */
  const pg = new (await import("pg")).default.Client({ connectionString: SUPER });
  await pg.connect();
  try {
    await pg.query("select set_config('app.user_id', $1, false)", [owner]);
    ncmId = (await pg.query(
      "select app.provision_property_unchecked('NCM', 'NC at MRP Test', 'Nowhere')::text as id")).rows[0].id;
    const one = async (q: string, v: unknown[]) => (await pg.query(q, v)).rows[0].id as string;
    const outlet = await one(
      `insert into pos_outlets (hotel_id, code, name, staff_id) values ($1, 'NCM-R', 'NCM Restaurant', $2)
       returning id::text`, [ncmId, owner]);
    const cat = await one(
      "insert into pos_menu_categories (hotel_id, name) values ($1, 'Mains') returning id::text", [ncmId]);
    const item = (name: string, price: number, mrp: number | null) => one(
      `insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate, mrp)
       values ($1, $2, $3, $4, 5, $5) returning id::text`, [ncmId, cat, name, price, mrp]);
    const lassi = await item("Lassi", 50, 60);
    const kulfi = await item("Kulfi", 80, null);
    const biryani = await item("Biryani", 1, 999);
    const choice = (label: string, price: number, mrp: number | null) => one(
      `insert into pos_item_variations (hotel_id, item_id, label, price, kind, mrp)
       values ($1, $2, $3, $4, 'quantity', $5) returning id::text`, [ncmId, biryani, label, price, mrp]);
    const half = await choice("Half", 180, 150);
    const full = await choice("Full", 320, null);

    const order = (no: string) => one(
      `insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by, status)
       values ($1, $2, $3, $4::date, $5, 'open') returning id::text`, [ncmId, outlet, no, DAY, owner]);
    const line = (o: string, name: string, qty: number, price: number,
                  x: { item?: string; variation?: string; voided?: boolean; parent?: string; extra?: string } = {}) => one(
      `insert into pos_order_lines (hotel_id, order_id, name, qty, unit_price, tax_rate, added_by,
                                    item_id, variation_id, parent_line_id, extra_kind)
       values ($1, $2, $3, $4, $5, 5, $6, $7, $8, $9::bigint, $10) returning id::text`,
      [ncmId, o, name, qty, price, owner, x.item ?? null, x.variation ?? null, x.parent ?? null, x.extra ?? null]);

    const nc = await order("NCM-1");
    const glass = await line(nc, "Lassi", 2, 50, { item: lassi });
    await line(nc, "Extra ice", 1, 20, { parent: glass, extra: "custom" });
    const struck = await line(nc, "Lassi", 3, 50, { item: lassi });
    await pg.query(
      "update pos_order_lines set voided = true, voided_by = $2, voided_at = now() where id = $1",
      [struck, owner]);
    await line(nc, "Kulfi", 1, 80, { item: kulfi });
    await line(nc, "Biryani (Half)", 1, 180, { item: biryani, variation: half });
    await line(nc, "Biryani (Full)", 1, 320, { item: biryani, variation: full });
    await pg.query(
      `update pos_orders set status = 'no_charge', nc_by = $2, nc_at = now(), nc_reason = $3 where id = $1`,
      [nc, owner, "Owner's guests"]);

    const paid = await order("NCM-2");
    await line(paid, "Lassi", 1, 50, { item: lassi });
    await pg.query(
      `update pos_orders set status = 'settled', settled_by = $2, settled_at = now(), payment_method = 'cash'
        where id = $1`, [paid, owner]);
  } finally {
    await pg.end();
  }
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("delete from pos_menu_items where category_id = $1", [categoryId]);
    await db.query("delete from pos_menu_categories where id = $1", [categoryId]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter]]);
    /* NCM's bills and menu go; the property stays in this run's scratch
       database, as the Store reports' STK does. */
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    try {
      await db.query("delete from pos_order_lines where hotel_id = $1", [ncmId]);
    } finally {
      await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    }
    await db.query("delete from pos_orders where hotel_id = $1", [ncmId]);
    await db.query("delete from pos_menu_items where hotel_id = $1", [ncmId]);
    await db.query("delete from pos_menu_categories where hotel_id = $1 and name = 'Mains'", [ncmId]);
    await db.query("delete from pos_outlets where hotel_id = $1 and code = 'NCM-R'", [ncmId]);
  } finally { await db.end(); }
  await closePool();
});

describe("a dish's MRP on the Menu", () => {
  it("starts as none - never the price filled in - and the GM sets and clears it", async () => {
    const id = await newDish("Tikka");
    expect((await dishOf(id)).mrp, "a new dish has no MRP, whatever its price").toBeNull();

    const set = await setMrp(gm, id, "180");
    expect(set.status, await set.clone().text()).toBe(200);
    expect((await dishOf(id)).mrp).toBe(180);

    expect((await setMrp(gm, id, "")).status).toBe(200);
    expect((await dishOf(id)).mrp, "empty clears it to a dash").toBeNull();
    expect((await setMrp(owner, id, 75.5)).status).toBe(200);
    expect((await setMrp(owner, id, null)).status).toBe(200);
    expect((await dishOf(id)).mrp).toBeNull();
  });

  it("is refused to a waiter, by the server", async () => {
    const id = await newDish("Kebab");
    expect((await setMrp(owner, id, 90)).status).toBe(200);
    expect((await setMrp(waiter, id, 10)).status).toBe(403);
    expect((await dishOf(id)).mrp).toBe(90);
  });

  it("is a figure above 0, or empty", async () => {
    const id = await newDish("Soup");
    for (const bad of [0, "0", -5, "abc"]) {
      const res = await setMrp(owner, id, bad);
      expect(res.status, String(bad)).toBe(409);
      expect(await reason(res)).toBe("An MRP is a figure above 0, or left empty for none.");
    }
    expect((await dishOf(id)).mrp).toBeNull();
  });

  it("a dish sold by variation: the first type's choices carry it; a later type has none", async () => {
    const id = await newDish("Biryani");
    const put = (types: unknown) => call(owner, "PUT", `/till/menu/items/${id}/variations`, { types });
    const spice = { kind: "option", heading: "Spice", choices: [{ label: "Hot", free: true, mrp: 40 }] };
    const res = await put([
      { kind: "quantity", choices: [{ label: "Half", price: 150, mrp: "90" }, { label: "Full", price: 280 }] },
      spice]);
    expect(res.status, await res.clone().text()).toBe(200);
    const mrps = async () => (await dishOf(id)).variations.map((v) => [v.typeNo, v.label, v.mrp]);
    expect(await mrps()).toEqual([[1, "Half", 90], [1, "Full", null], [2, "Hot", null]]);

    const bad = await put([{ kind: "quantity", choices: [{ label: "Half", price: 150, mrp: 0 }] }]);
    expect(bad.status).toBe(409);
    expect(await reason(bad)).toBe("Half: An MRP is a figure above 0, or left empty for none.");

    expect((await put([{ kind: "quantity", choices: [{ label: "Half", price: 150, mrp: "" },
                                                       { label: "Full", price: 280 }] }, spice])).status).toBe(200);
    expect(await mrps(), "emptied, it is cleared").toEqual([[1, "Half", null], [1, "Full", null], [2, "Hot", null]]);
  });
});

describe("a bill given free (NC), valued at MRP in the stock only", () => {
  it("the Consumption report: each dish at quantity x MRP; no MRP is a dash, left out and counted", async () => {
    const res = await call(owner, "GET", `/reports/stock-consumption?asOn=${DAY}&from=${DAY}`, undefined, "NCM");
    expect(res.status, await res.clone().text()).toBe(200);
    const nc = ((await res.json()) as ReportDoc).sections.find((s) => s.key === "nc")!;
    expect(nc.title).toBe("Given free (NC), at MRP");
    expect(nc.rows.map((r) => ({ kind: r.kind, ...r.cells }))).toEqual([
      { kind: "row", outlet: "NCM Restaurant", dish: "Biryani (Full)", quantity: 1, mrp: null, value: null },
      { kind: "row", outlet: "NCM Restaurant", dish: "Biryani (Half)", quantity: 1, mrp: 150, value: 150 },
      { kind: "row", outlet: "NCM Restaurant", dish: "Kulfi", quantity: 1, mrp: null, value: null },
      { kind: "row", outlet: "NCM Restaurant", dish: "Lassi", quantity: 2, mrp: 60, value: 120 },
      { kind: "total", outlet: "Total", dish: null, quantity: null, mrp: null, value: 270 },
    ]);
    expect(nc.note).toContain("2 dishes have no MRP and are left out of the total.");
  });

  it("and nowhere in sales, tax or the Day book: the day's only sale is the paid Lassi", async () => {
    const res = await call(owner, "GET", `/accounting/day-book?from=${DAY}&to=${DAY}`, undefined, "NCM");
    expect(res.status, await res.clone().text()).toBe(200);
    const book = (await res.json()) as { days: { date: string; pos: number; posTax: number }[] };
    expect(book.days.find((d) => d.date === DAY)).toMatchObject({ pos: 50, posTax: 2.5 });

    const [day] = await sql<{ n: number; v: string }>(
      `select settled_orders as n, settled_value::text as v
         from app.pos_day_summary((select id from pos_outlets where hotel_id = $1), $2::date)`, [ncmId, DAY]);
    expect([day!.n, Number(day!.v)], "one bill sold, at 52.50 with its GST").toEqual([1, 52.5]);
  });
});
