import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   NC BILLS AND ITEM SALES (the owner, 16 November)

   NC bills: every bill given free over a range of days, with its reason,
   the waiter who asked, the GM who said yes and the comment on the yes.
   Item sales: each item sold, how many and for how much, whose category
   totals are the Manager report's. Each is made through the till's own
   routes and read back; a waiter is refused both. Everything this file
   adds to 5EL is removed afterwards (MEMORY 476).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "NCITEM";
let gm = "";
let waiter = "";
let tikka = "";
let tikkaCategory = "";
let day = "";
let outlet = "";
let putAwayTillDay: () => Promise<void>;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, body === undefined
    ? { headers: { "x-dev-staff-id": who } }
    : { method: "POST", headers: { "x-dev-staff-id": who, "content-type": "application/json" }, body: JSON.stringify(body) });

type Order = { id: string; payable: number; lines: { id: string; qty: number; unitPrice: number }[] };
type Cells = Record<string, string | number | null>;
type Doc = { sections: { key: string; rows: { kind: string; cells: Cells }[] }[] };
const readDoc = async (key: string, who = gm) => {
  const res = await call(who, `/reports/${key}?from=${day}&asOn=${day}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Doc;
};
async function openBill(table: string, qty: number): Promise<Order> {
  const res = await call(waiter, "/till/orders/batch",
    { outlet: "REST", table: `${TAG} ${table}`, lines: [{ itemId: tikka, qty }], send: true });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await (await call(gm, `/till/orders/${((await res.json()) as { id: string }).id}`)).json()) as Order;
}

/** The Paneer Tikka line under this outlet's category, as the report has it. */
const tikkaRow = (doc: Doc) => {
  let band = "";
  for (const r of doc.sections.find((s) => s.key === "item-sales-items")!.rows) {
    if (r.kind === "band") band = String(r.cells["item"]);
    else if (band === `${outlet}, ${tikkaCategory}` && r.cells["item"] === "Paneer Tikka") return r.cells;
  }
  return { qty: 0, amount: 0 };
};

let before: Cells;
let asked: Order;
let given: Order;
let sold: Order[];

beforeAll(async () => {
  const person = async (email: string, name: string, role: string) => {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`, [email, name]);
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'
       on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, role]);
    return s!.id;
  };
  gm = await person("ncitem-gm@fidato.in", "NCITEM Manager", "gm");
  waiter = await person("ncitem-waiter@fidato.in", "NCITEM Waiter", "pos");
  const [h] = await sql<{ bd: string; outlet: string }>(
    `select to_char(app.business_date(h.id), 'YYYY-MM-DD') as bd, o.name as outlet
       from hotels h join pos_outlets o on o.hotel_id = h.id where h.code = '5EL' and o.code = 'REST'`);
  day = h!.bd;
  outlet = h!.outlet;
  const menu = (await (await call(gm, "/till/menu")).json()) as
    { categories: { name: string; items: { id: string; name: string }[] }[] };
  const cat = menu.categories.find((c) => c.items.some((i) => i.name === "Paneer Tikka"))!;
  tikkaCategory = cat.name;
  tikka = cat.items.find((i) => i.name === "Paneer Tikka")!.id;
  putAwayTillDay = await openTillDay("5EL");
  before = tikkaRow(await readDoc("item-sales"));

  /* NC asked for by the waiter, the GM saying yes with a comment... */
  asked = await openBill("asked", 2);
  expect((await call(waiter, `/till/orders/${asked.id}/requests`,
    { kind: "no_charge", reason: `${TAG} staff meal` })).status).toBe(200);
  const list = (await (await call(gm, "/approvals?status=all")).json()) as
    { rows: { id: string; kind: string; detail: string | null }[] };
  const a = list.rows.find((x) => x.kind === "pos_request" && (x.detail ?? "").includes(`${TAG} asked`))!;
  const ok = await call(gm, `/approvals/${a.id}/approved`, { note: `${TAG} fine, once` });
  expect(ok.status, await ok.clone().text()).toBe(200);
  /* ...and one the GM gives at the till, asked by nobody. */
  given = await openBill("given", 1);
  const nc = await call(gm, `/till/orders/${given.id}/no-charge`, { reason: `${TAG} owner's guest` });
  expect(nc.status, await nc.clone().text()).toBe(200);

  /* Two paid bills of Paneer Tikka: 2, then 1. */
  sold = [await openBill("paid one", 2), await openBill("paid two", 1)];
  for (const o of sold) expect((await call(gm, `/till/orders/${o.id}/settle`, { method: "cash" })).status).toBe(200);
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    const mineOrders = "select id from pos_orders where table_ref like $1";
    await db.query(`delete from pos_requests where order_id in (${mineOrders})`, [`${TAG}%`]);
    await db.query("delete from approvals where requested_by = any($1::uuid[])", [[waiter, gm]]);
    await db.query(`delete from pos_kot_prints where order_id in (${mineOrders})`, [`${TAG}%`]);
    await db.query(`delete from pos_order_tenders where order_id in (${mineOrders})`, [`${TAG}%`]);
    await db.query(`delete from vat_bills where pos_order_id in (${mineOrders})`, [`${TAG}%`]);
    await db.query(`delete from pos_order_lines where order_id in (${mineOrders})`, [`${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from cashier_shifts where staff_id = any($1::uuid[])", [[gm, waiter]]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter]]);
  } finally {
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await closePool();
});

describe("NC bills", () => {
  const mine = async () => (await readDoc("nc-bills")).sections.find((s) => s.key === "nc-detail")!.rows
    .filter((r) => r.kind === "row" && String(r.cells["table"] ?? "").startsWith(TAG)).map((r) => r.cells);

  it("lists a bill the waiter asked for: its value, reason, who asked, who approved and the comment", async () => {
    const row = (await mine()).find((r) => r["table"] === `${TAG} asked`)!;
    const l = asked.lines[0]!;
    expect(row).toMatchObject({
      value: l.qty * l.unitPrice, asked: "NCITEM Waiter", given: "NCITEM Manager", note: `${TAG} fine, once`,
    });
    expect(String(row["reason"])).toContain(`${TAG} staff meal`);
  });

  it("lists one the GM gave at the till, with nobody asking and no comment", async () => {
    const row = (await mine()).find((r) => r["table"] === `${TAG} given`)!;
    expect(row).toMatchObject({ reason: `${TAG} owner's guest`, asked: null, given: "NCITEM Manager", note: null });
  });

  it("is refused to a waiter, on the screen's route and the file's", async () => {
    expect((await call(waiter, `/reports/nc-bills?from=${day}&asOn=${day}`)).status).toBe(403);
    expect((await call(waiter, `/reports/nc-bills.pdf?from=${day}&asOn=${day}`)).status).toBe(403);
  });
});

describe("Item sales", () => {
  it("counts each paid bill's item, and not the NC bills", async () => {
    const after = tikkaRow(await readDoc("item-sales"));
    const price = sold[0]!.lines[0]!.unitPrice;
    expect(Number(after["qty"]) - Number(before["qty"])).toBe(3);
    expect(Math.round((Number(after["amount"]) - Number(before["amount"])) * 100) / 100)
      .toBe(Math.round(3 * price * 100) / 100);
  });

  it("adds up, per category, to the Manager report's category for the day", async () => {
    const items = (await readDoc("item-sales")).sections.find((s) => s.key === "item-sales-summary")!.rows
      .find((r) => r.cells["outlet"] === outlet && r.cells["category"] === tikkaCategory)!.cells;
    const res = await call(gm, `/reports/manager?asOn=${day}`);
    const manager = (await res.json()) as { sections: { rows: { kind: string; cells: Cells }[] }[] };
    let band = "";
    let today: number | null = null;
    for (const r of manager.sections.flatMap((s) => s.rows)) {
      if (r.kind === "band") band = String(Object.values(r.cells)[0]);
      else if (band === outlet && r.cells["label"] === `Category - ${tikkaCategory}`) { today = Number(r.cells["today"]); break; }
    }
    expect(today).not.toBeNull();
    expect(Number(items["amount"])).toBe(today);
  });

  it("is refused to a waiter", async () => {
    expect((await call(waiter, `/reports/item-sales?from=${day}&asOn=${day}`)).status).toBe(403);
  });
});
