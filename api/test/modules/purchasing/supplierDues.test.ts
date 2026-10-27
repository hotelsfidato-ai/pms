import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { ROLES, can } from "../../../src/permissions.ts";
import { DUES_ROLES } from "../../../src/modules/purchasing/purchasingGrants.ts";

/* ══════════════════════════════════════════════════════════════════
   SUPPLIER DUES (the owner's D27-370, 27 October)

   Goods on credit: the delivery, or the bar bill, records the supplier's
   bill - number, date, amount, due date. The Supplier dues list shows what
   is owed; the accountant, the GM, the owner or an administrator records a
   payment (cash, cheque, bank, UPI) and the bill leaves the list. The
   Inventory Manager records the bill but neither sees the dues nor pays.
   The Supplier dues report: owed on a date, paid in a window. Migration 246
   is the database's half (db/tests/modules/purchasing.sql, "supplier dues").
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "DUESTEST";
const HOTEL = "5EL";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const inDays = (n: number) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);

let keeper = "", gm = "", accountant = "", manager = "";
let supplierId = "", storeId = "", itemId = "";

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

const person = async (key: string, role: string) => {
  const [s] = await sql<{ id: string }>(
    `insert into staff (email, full_name) values ($1, $2)
     on conflict (email) do update set is_active = true returning id::text`,
    [`dues-${key}@fidato.in`, `${TAG} ${key}`]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = $3
     on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, role, HOTEL]);
  return s!.id;
};

/** An order raised by the Inventory Manager, approved by the GM and sent: one line, priced. */
async function sentOrder(): Promise<{ id: string; lineId: string }> {
  const raised = await call(keeper, "POST", "/purchasing/requests", {
    storeId, reason: `${TAG} dal for the week`, lines: [{ itemId, quantity: 20, unitPrice: 110 }] });
  expect(raised.status, await raised.clone().text()).toBe(200);
  const { request } = (await raised.json()) as { request: { id: string } };
  const [ap] = await sql<{ id: string | null }>(
    "select approval_id::text as id from purchase_requests where id = $1", [request.id]);
  if (ap!.id) {
    const ok = await app.request(`/api/hotels/${HOTEL}/approvals/${ap!.id}/approved`, {
      method: "POST", headers: { "x-dev-staff-id": gm, "content-type": "application/json" }, body: "{}" });
    expect(ok.status).toBe(200);
  }
  const sent = await call(keeper, "POST", `/purchasing/requests/${request.id}/order`, { supplierId });
  expect(sent.status, await sent.clone().text()).toBe(200);
  const detail = (await (await call(keeper, "GET", `/purchasing/requests/${request.id}`)).json()) as {
    lines: { id: string }[] };
  return { id: request.id, lineId: detail.lines[0]!.id };
}

type Dues = { today: string; bills: { id: string; supplier: string; billNo: string; billDate: string;
  amount: string; dueOn: string; from: { kind: string; reference?: string } }[] };

beforeAll(async () => {
  keeper = await person("keeper", "stores");
  gm = await person("gm", "gm");
  accountant = await person("accountant", "finance");
  manager = await person("manager", "hotel_manager");
  const [st] = await sql<{ id: string }>(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.kind = 'store' and l.name = 'Main store'`, [HOTEL]);
  storeId = st!.id;
  const [sup] = await sql<{ id: string }>(
    `insert into suppliers (hotel_id, name) select id, $2 from hotels where code = $1
     on conflict (hotel_id, name) do update set is_active = true returning id::text`, [HOTEL, `${TAG} Grain Co`]);
  supplierId = sup!.id;
  const [it] = await sql<{ id: string }>(
    `insert into stock_items (hotel_id, name, unit) select id, $2, 'kg' from hotels where code = $1
     on conflict (hotel_id, name) do update set is_active = true returning id::text`, [HOTEL, `${TAG} dal`]);
  itemId = it!.id;
});

afterAll(async () => {
  await sql("delete from supplier_bills where supplier like $1", [`${TAG}%`]);
  await sql("alter table stock_movements disable trigger stock_movements_append_only");
  try {
    await sql("delete from bar_purchase_lines where purchase_id in (select id from bar_purchases where supplier like $1)", [`${TAG}%`]);
    await sql("delete from stock_movements where bar_purchase_id in (select id from bar_purchases where supplier like $1) or item_id = $2", [`${TAG}%`, itemId]);
  } finally {
    await sql("alter table stock_movements enable trigger stock_movements_append_only");
  }
  await sql("delete from bar_purchases where supplier like $1", [`${TAG}%`]);
  await sql("delete from purchase_request_lines where request_id in (select id from purchase_requests where reason like $1)", [`${TAG}%`]);
  const gone = await sql<{ id: string }>(
    "select approval_id::text as id from purchase_requests where reason like $1 and approval_id is not null", [`${TAG}%`]);
  await sql("delete from purchase_requests where reason like $1", [`${TAG}%`]);
  for (const g of gone) await sql("delete from approvals where id = $1", [g.id]);
  await sql("delete from stock_items where name like $1", [`${TAG}%`]);
  await sql("delete from suppliers where name like $1", [`${TAG}%`]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [[keeper, gm, accountant, manager]]);
  await closePool();
});

describe("goods on credit, owed and paid (D27-370)", () => {
  it("the four who see the dues are exactly who hold approve on invoice (the report's read)", () => {
    expect([...DUES_ROLES].sort()).toEqual(ROLES.filter((r) => can(r, "approve", "invoice")).sort());
  });

  it("a delivery's bill with a due date before its own date is refused, and nothing is received", async () => {
    const order = await sentOrder();
    const res = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 20, receivedUnitCost: 110 }],
      credit: { billNo: "G-1", billDate: today, amount: 2200, dueOn: inDays(-1) } });
    expect(await reason(res)).toBe("A bill is due on its own date or later, not before it.");
    const [r] = await sql<{ status: string }>("select status from purchase_requests where id = $1", [order.id]);
    expect(r!.status).toBe("ordered");
    const noAmount = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 20 }],
      credit: { billNo: "G-1", billDate: today, amount: 0, dueOn: today } });
    expect(await reason(noAmount)).toBe("Type the bill's amount, as printed on it: more than zero.");
    const future = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 20 }],
      credit: { billNo: "G-1", billDate: inDays(3), amount: 2200, dueOn: inDays(30) } });
    expect(await reason(future)).toBe("A bill is not dated in the future.");
    expect((await sql("select 1 from supplier_bills where purchase_request_id = $1", [order.id])).length).toBe(0);
  });

  it("the Inventory Manager records a delivery on credit, and a bar bill on credit", async () => {
    const order = await sentOrder();
    const res = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 20, receivedUnitCost: 110 }],
      credit: { billNo: "G-2", billDate: "2025-01-10", amount: 2310, dueOn: "2025-02-09" } });
    expect(res.status, await res.clone().text()).toBe(200);
    const detail = (await (await call(keeper, "GET", `/purchasing/requests/${order.id}`)).json()) as {
      credit: { billNo: string; amount: string; dueOn: string; paidOn: string | null } | null };
    expect(detail.credit).toEqual({ billNo: "G-2", billDate: "2025-01-10", amount: "2310.00", dueOn: "2025-02-09", paidOn: null });

    const bar = await call(keeper, "POST", "/bar/purchases", {
      supplier: `${TAG} Wine Traders`, billNo: "W-7", billDate: today, total: 8000, dueOn: inDays(15),
      lines: [{ newDrink: { name: `${TAG} Rum 180 ml`, unit: "bottle", sizeMl: 180 },
                perCase: 48, cases: 1, bottles: 0, ratePerCase: 8000, mrp: null }] });
    expect(bar.status, await bar.clone().text()).toBe(200);
    const list = (await (await call(keeper, "GET", "/bar/purchases")).json()) as {
      purchases: { billNo: string; supplier: string; credit: { dueOn: string; paidOn: string | null } | null }[] };
    expect(list.purchases.find((p) => p.supplier === `${TAG} Wine Traders`)?.credit)
      .toEqual({ dueOn: inDays(15), paidOn: null });

    const badDue = await call(keeper, "POST", "/bar/purchases", {
      supplier: `${TAG} Wine Traders`, billNo: "W-8", billDate: today, total: 8000, dueOn: "soon",
      lines: [{ newDrink: { name: `${TAG} Gin 180 ml`, unit: "bottle", sizeMl: 180 },
                perCase: 48, cases: 1, bottles: 0, ratePerCase: 8000, mrp: null }] });
    expect(await reason(badDue)).toBe("Pick the date the bill is due.");
  });

  it("the accountant sees what is owed; the Inventory Manager and the hotel manager do not", async () => {
    for (const who of [keeper, manager]) {
      const res = await call(who, "GET", "/purchasing/dues");
      expect(res.status).toBe(403);
      expect(await reason(res)).toBe(
        "What is owed to suppliers is for the owner, an administrator, the general manager or the accountant.");
    }
    const res = await call(accountant, "GET", "/purchasing/dues");
    expect(res.status).toBe(200);
    const mine = ((await res.json()) as Dues).bills.filter((b) => b.supplier.startsWith(TAG));
    expect(mine.map((b) => [b.supplier, b.billNo, b.amount, b.dueOn, b.from.kind])).toEqual([
      [`${TAG} Grain Co`, "G-2", "2310.00", "2025-02-09", "order"],
      [`${TAG} Wine Traders`, "W-7", "8000.00", inDays(15), "bar"],
    ]);
  });

  it("a payment by the accountant marks the bill paid; the Inventory Manager may not; never twice", async () => {
    const dues = (await (await call(gm, "GET", "/purchasing/dues")).json()) as Dues;
    const grain = dues.bills.find((b) => b.supplier === `${TAG} Grain Co`)!;
    const refused = await call(keeper, "POST", `/purchasing/dues/${grain.id}/payment`,
      { method: "cash", paidOn: today });
    expect(refused.status).toBe(403);
    expect(await reason(refused)).toBe(
      "Recording a payment to a supplier is for the owner, an administrator, the general manager or the accountant.");
    expect(await reason(await call(accountant, "POST", `/purchasing/dues/${grain.id}/payment`,
      { method: "card", paidOn: today }))).toBe("How was it paid? Cash, cheque, bank or UPI.");
    expect(await reason(await call(accountant, "POST", `/purchasing/dues/${grain.id}/payment`,
      { method: "upi", paidOn: inDays(2) }))).toBe("A payment is not dated in the future.");
    expect(await reason(await call(accountant, "POST", `/purchasing/dues/${grain.id}/payment`,
      { method: "upi", paidOn: "2025-01-01" }))).toBe("A payment is not dated before the bill it pays.");

    const paid = await call(accountant, "POST", `/purchasing/dues/${grain.id}/payment`,
      { method: "cheque", reference: "CHQ 004512", paidOn: today });
    expect(paid.status, await paid.clone().text()).toBe(200);
    const [row] = await sql<{ paid_method: string; paid_reference: string; paid_by: string }>(
      "select paid_method, paid_reference, paid_by::text from supplier_bills where id = $1", [grain.id]);
    expect([row!.paid_method, row!.paid_reference, row!.paid_by]).toEqual(["cheque", "CHQ 004512", accountant]);

    const after = (await (await call(accountant, "GET", "/purchasing/dues")).json()) as Dues;
    expect(after.bills.some((b) => b.id === grain.id), "it leaves the dues").toBe(false);
    expect(await reason(await call(gm, "POST", `/purchasing/dues/${grain.id}/payment`,
      { method: "cash", paidOn: today }))).toBe("This bill is already marked paid.");
  });

  it("the Supplier dues report: owed on a date by supplier, paid in the window; the Inventory Manager is refused", async () => {
    const res = await call(gm, "GET", `/reports/supplier-dues?from=2025-01-01&asOn=${today}`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { sections: { key: string; rows: { kind: string; cells: Record<string, unknown> }[] }[] };
    const owed = doc.sections.find((s) => s.key === "owed")!.rows;
    const at = owed.findIndex((r) => r.kind === "band" && r.cells["supplier"] === `${TAG} Wine Traders`);
    expect(owed.slice(at, at + 3).map((r) => [r.kind, r.cells["supplier"], r.cells["amount"] ?? null])).toEqual([
      ["band", `${TAG} Wine Traders`, null],
      ["row", "Bill W-7", 8000],
      ["total", `${TAG} Wine Traders, owed`, 8000],
    ]);
    expect(owed.some((r) => r.cells["supplier"] === `${TAG} Grain Co`), "paid today, so not owed today").toBe(false);

    /* As on a day before the payment, the Grain Co bill was owed, and overdue. */
    const before = (await (await call(gm, "GET", "/reports/supplier-dues?from=2025-01-01&asOn=2025-03-01")).json()) as typeof doc;
    const grain = before.sections.find((s) => s.key === "owed")!.rows.find((r) => r.cells["supplier"] === "Bill G-2")!;
    expect([grain.cells["late"], grain.cells["amount"]]).toEqual([20, 2310]);

    const paid = doc.sections.find((s) => s.key === "paid")!.rows.find((r) => r.cells["supplier"] === `${TAG} Grain Co`)!;
    expect([paid.cells["bill"], paid.cells["method"], paid.cells["reference"], paid.cells["paidBy"], paid.cells["amount"]])
      .toEqual(["G-2", "Cheque", "CHQ 004512", `${TAG} accountant`, 2310]);

    /* The hotel manager reads other reports; not this one. */
    expect((await call(manager, "GET", "/reports/supplier-dues")).status).toBe(403);
    expect((await call(keeper, "GET", "/reports/supplier-dues")).status).toBe(403);
    expect((await call(accountant, "GET", `/reports/supplier-dues.csv?asOn=${today}`)).status).toBe(200);
    expect((await call(keeper, "GET", `/reports/supplier-dues.csv?asOn=${today}`)).status).toBe(403);
    expect((await call(manager, "GET", `/reports/supplier-dues.pdf?asOn=${today}`)).status).toBe(403);
  });
});
