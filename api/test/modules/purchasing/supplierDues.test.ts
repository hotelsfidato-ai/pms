import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { ROLES, can } from "../../../src/permissions.ts";
import { DUES_ROLES } from "../../../src/modules/purchasing/purchasingGrants.ts";

/* ══════════════════════════════════════════════════════════════════
   SUPPLIER DUES (the owner's D27-370, 27 October; D27-372, 28 October)

   Goods on credit: the delivery, or the bar bill (its supplier picked from
   the list), records the supplier's bill - number, date, amount, due date.
   The accountant, the GM, the owner or an administrator sees what is owed
   and records part payments (a non-cash one with its reference; who handed
   over the money; any TDS), credit notes against a bill or the supplier, and
   reversals with a reason. The Inventory Manager records the bill but neither
   sees the dues nor pays. Three reports: Supplier dues, TDS deducted and a
   supplier's statement. Migrations 246 and 249 are the database's half
   (db/tests/modules/purchasing.sql, "supplier dues").
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "DUESTEST";
const HOTEL = "5EL";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const inDays = (n: number) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);

let keeper = "", gm = "", accountant = "", manager = "";
let supplierId = "", wineId = "", storeId = "", itemId = "";

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
const supplier = async (name: string) => (await sql<{ id: string }>(
  `insert into suppliers (hotel_id, name) select id, $2 from hotels where code = $1
   on conflict (hotel_id, name) do update set is_active = true returning id::text`, [HOTEL, name]))[0]!.id;

/** An order raised by the Inventory Manager, approved by the GM and sent: one line, priced,
    and with the GST rate agreed when one is given (D27-383 item 11). */
async function sentOrder(gstRate?: number): Promise<{ id: string; lineId: string }> {
  const raised = await call(keeper, "POST", "/purchasing/requests", {
    storeId, reason: `${TAG} dal for the week`, lines: [{ itemId, quantity: 20, unitPrice: 110 }] });
  expect(raised.status, await raised.clone().text()).toBe(200);
  const { request } = (await raised.json()) as { request: { id: string } };
  if (gstRate !== undefined) {
    const [line] = await sql<{ id: string }>("select id::text from purchase_request_lines where request_id = $1", [request.id]);
    const set = await call(keeper, "PUT", `/purchasing/requests/${request.id}/lines/${line!.id}`, { gstRate });
    expect(set.status, await set.clone().text()).toBe(200);
  }
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

type Bill = { id: string; supplierId: string | null; supplier: string; billNo: string; billDate: string;
  amount: string; owed: string; paid: string; tds: string; credited: string; status: string; dueOn: string;
  replaces: string | null; from: { kind: string; reference?: string };
  payments: { id: string; amount: string; method: string; reference: string | null; handedOverBy: string | null;
              tds: { section: string; rate: string; amount: string } | null; reversed: { reason: string } | null;
              differencesSeenBy?: string | null }[];
  creditNotes: { id: string; amount: string; reversed: { reason: string } | null }[] };
type Dues = { today: string; suppliers: { id: string; name: string }[]; bills: Bill[];
  credits: { id: string; supplierId: string; amount: string; noteNo: string }[] };
const dues = async (who = accountant, all = false) =>
  (await (await call(who, "GET", `/purchasing/dues${all ? "?all=1" : ""}`)).json()) as Dues;
const billNamed = async (no: string, all = true) => (await dues(accountant, all)).bills.find((b) => b.billNo === no
  && b.supplier.startsWith(TAG));

type Doc = { title: string; sections: { key: string; rows: { kind: string; cells: Record<string, unknown> }[] }[] };

beforeAll(async () => {
  keeper = await person("keeper", "stores");
  gm = await person("gm", "gm");
  accountant = await person("accountant", "finance");
  manager = await person("manager", "hotel_manager");
  const [st] = await sql<{ id: string }>(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.kind = 'store' and l.name = 'Main store'`, [HOTEL]);
  storeId = st!.id;
  supplierId = await supplier(`${TAG} Grain Co`);
  wineId = await supplier(`${TAG} Wine Traders`);
  const [it] = await sql<{ id: string }>(
    `insert into stock_items (hotel_id, name, unit) select id, $2, 'kg' from hotels where code = $1
     on conflict (hotel_id, name) do update set is_active = true returning id::text`, [HOTEL, `${TAG} dal`]);
  itemId = it!.id;
});

afterAll(async () => {
  const mine = "select id from supplier_bills where supplier like $1";
  await sql(`delete from supplier_reversals where bill_id in (${mine})
               or payment_id in (select id from supplier_payments where bill_id in (${mine}))
               or credit_note_id in (select id from supplier_credit_notes where supplier_id in
                                     (select id from suppliers where name like $1))`, [`${TAG}%`]);
  await sql(`delete from supplier_payments where bill_id in (${mine})`, [`${TAG}%`]);
  await sql("delete from supplier_credit_notes where supplier_id in (select id from suppliers where name like $1)", [`${TAG}%`]);
  await sql("delete from supplier_bills where supplier like $1 and replaces_id is not null", [`${TAG}%`]);
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

describe("goods on credit, owed, paid in parts, credited and reversed (D27-370, D27-372)", () => {
  it("the four who see the dues are exactly who hold approve on invoice (the reports' read)", () => {
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
    const noDue = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 20 }],
      credit: { billNo: "G-1", billDate: today, amount: 2200 } });
    expect(await reason(noDue), "a due date is required").toBe("Pick the date the bill is due.");
    const future = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 20, billedQuantity: 20 }],
      credit: { billNo: "G-1", billDate: inDays(3), amount: 2200, dueOn: inDays(30) } });
    expect(await reason(future)).toBe("A bill is not dated in the future.");
    expect((await sql("select 1 from supplier_bills where purchase_request_id = $1", [order.id])).length).toBe(0);
  });

  it("the Inventory Manager records a delivery on credit, and a bar bill on credit with its supplier picked", async () => {
    const order = await sentOrder();
    const res = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 20, receivedUnitCost: 110, billedQuantity: 20 }],
      credit: { billNo: "G-2", billDate: "2025-01-10", amount: 2310, dueOn: "2025-02-09" } });
    expect(res.status, await res.clone().text()).toBe(200);
    const detail = (await (await call(keeper, "GET", `/purchasing/requests/${order.id}`)).json()) as { credit: unknown };
    expect(detail.credit).toEqual({ billNo: "G-2", billDate: "2025-01-10", amount: "2310.00", dueOn: "2025-02-09", owed: "2310.00" });

    const bar = await call(keeper, "POST", "/bar/purchases", {
      supplierId: wineId, billNo: "W-7", billDate: today, total: 8000, dueOn: inDays(15),
      lines: [{ newDrink: { name: `${TAG} Rum 180 ml`, unit: "bottle", sizeMl: 180 },
                perCase: 48, cases: 1, bottles: 0, ratePerCase: 8000, mrp: null }] });
    expect(bar.status, await bar.clone().text()).toBe(200);
    const list = (await (await call(keeper, "GET", "/bar/purchases")).json()) as {
      purchases: { supplier: string; credit: unknown }[] };
    expect(list.purchases.find((p) => p.supplier === `${TAG} Wine Traders`)?.credit)
      .toEqual({ dueOn: inDays(15), owed: "8000.00" });
    const [row] = await sql<{ supplier_id: string }>(
      "select supplier_id::text from supplier_bills where bill_no = 'W-7' and supplier like $1", [`${TAG}%`]);
    expect(row!.supplier_id, "the bar bill's supplier is the one picked").toBe(wineId);
  });

  it("the accountant sees what is owed; the Inventory Manager and the hotel manager do not", async () => {
    for (const who of [keeper, manager]) {
      const res = await call(who, "GET", "/purchasing/dues");
      expect(res.status).toBe(403);
      expect(await reason(res)).toBe(
        "What is owed to suppliers is for the owner, an administrator, the general manager or the accountant.");
    }
    const all = await dues();
    const mine = all.bills.filter((b) => b.supplier.startsWith(TAG));
    expect(mine.map((b) => [b.supplier, b.billNo, b.amount, b.owed, b.status, b.dueOn, b.from.kind, b.supplierId])).toEqual([
      [`${TAG} Grain Co`, "G-2", "2310.00", "2310.00", "unpaid", "2025-02-09", "order", supplierId],
      [`${TAG} Wine Traders`, "W-7", "8000.00", "8000.00", "unpaid", inDays(15), "bar", wineId],
    ]);
    expect(all.suppliers).toContainEqual({ id: wineId, name: `${TAG} Wine Traders` });
  });

  it("payments: each refusal in a sentence, before anything is written; the Inventory Manager may not pay", async () => {
    const grain = (await billNamed("G-2"))!;
    const pay = (who: string, body: object) => call(who, "POST", `/purchasing/dues/${grain.id}/payment`,
      { amount: 1000, method: "cash", paidOn: today, handedOverBy: "Ravi", ...body });
    const refused = await pay(keeper, {});
    expect(refused.status).toBe(403);
    expect(await reason(refused)).toBe(
      "Recording a payment to a supplier is for the owner, an administrator, the general manager or the accountant.");
    expect(await reason(await pay(accountant, { method: "card" }))).toBe("How was it paid? Cash, cheque, bank or UPI.");
    for (const method of ["cheque", "bank", "upi"]) {
      expect(await reason(await pay(accountant, { method, reference: " " })), method).toBe(
        "A cheque, bank or UPI payment needs its reference: the cheque or transaction number.");
    }
    expect(await reason(await pay(accountant, { amount: 0 }))).toBe("Type the amount paid to the supplier: more than zero.");
    expect(await reason(await pay(accountant, { handedOverBy: "" }))).toBe("Who handed over the money? Type their name.");
    expect(await reason(await pay(accountant, { paidOn: inDays(2) }))).toBe("A payment is not dated in the future.");
    expect(await reason(await pay(accountant, { paidOn: "2025-01-01" }))).toBe("A payment is not dated before the bill it pays.");
    expect(await reason(await pay(accountant, { amount: 2311 }))).toBe(
      "That is more than is left on the bill: ₹2,310.00, the TDS included.");
    expect(await reason(await pay(accountant, { tds: { section: "194A", rate: 2, amount: 20 } }))).toBe(
      "Pick the TDS section: 194C, 194Q, 194J or 194I.");
    expect(await reason(await pay(accountant, { amount: 2300, tds: { section: "194C", rate: 2, amount: 20 } }))).toBe(
      "That is more than is left on the bill: ₹2,310.00, the TDS included.");
    expect((await sql("select 1 from supplier_payments where bill_id = $1", [grain.id])).length, "nothing written").toBe(0);
  });

  it("a part payment with TDS leaves the rest owed; a cash payment of the rest takes the bill off the dues", async () => {
    const grain = (await billNamed("G-2"))!;
    const first = await call(accountant, "POST", `/purchasing/dues/${grain.id}/payment`, {
      amount: 1000, method: "cheque", reference: "CHQ 004512", paidOn: today, handedOverBy: "Ravi Kumar",
      tds: { section: "194C", rate: 2, amount: 20 } });
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await first.json()).toEqual({ ok: true, owed: "1290.00" });
    const part = (await billNamed("G-2", false))!;
    expect([part.status, part.paid, part.tds, part.owed]).toEqual(["part-paid", "1000.00", "20.00", "1290.00"]);
    expect(part.payments.map((p) => [p.amount, p.method, p.reference, p.handedOverBy, p.tds])).toEqual([
      ["1000.00", "cheque", "CHQ 004512", "Ravi Kumar", { section: "194C", rate: "2.00", amount: "20.00" }]]);

    const rest = await call(gm, "POST", `/purchasing/dues/${grain.id}/payment`, {
      amount: 1290, method: "cash", paidOn: today, handedOverBy: "Suresh" });
    expect(rest.status, await rest.clone().text()).toBe(200);
    expect(await billNamed("G-2", false), "it leaves the dues").toBeUndefined();
    const settled = (await billNamed("G-2", true))!;
    expect([settled.status, settled.owed]).toEqual(["paid", "0.00"]);
    expect(await reason(await call(gm, "POST", `/purchasing/dues/${grain.id}/payment`,
      { amount: 1, method: "cash", paidOn: today, handedOverBy: "Suresh" }))).toBe("Nothing is left to pay on this bill.");
  });

  it("credit notes: against a bill and against the supplier, each lowering what is owed, never past it", async () => {
    const wine = (await billNamed("W-7"))!;
    const note = (who: string, body: object) => call(who, "POST", "/purchasing/dues/credit-notes",
      { billId: wine.id, issuedBy: "supplier", noteNo: "CN-11", noteDate: today, amount: 500, reason: "Two cases broken", ...body });
    expect((await note(keeper, {})).status).toBe(403);
    expect(await reason(await note(accountant, { reason: "" }))).toBe("Say what the credit note is for.");
    expect(await reason(await note(accountant, { issuedBy: "someone" }))).toBe("Whose credit note is it: the supplier's, or ours?");
    expect(await reason(await note(accountant, { amount: 8000.01 }))).toBe("That is more than is left on the bill: ₹8,000.00.");
    expect((await note(accountant, {})).status).toBe(200);
    expect([(await billNamed("W-7"))!.owed, (await billNamed("W-7"))!.credited]).toEqual(["7500.00", "500.00"]);

    const onSupplier = (body: object) => call(accountant, "POST", "/purchasing/dues/credit-notes",
      { supplierId: wineId, issuedBy: "hotel", noteNo: "OUR-1", noteDate: today, amount: 300, reason: "Rate difference", ...body });
    expect(await reason(await onSupplier({ amount: 7500.01 }))).toBe("That is more than is owed to this supplier: ₹7,500.00.");
    expect((await onSupplier({})).status).toBe(200);
    const after = await dues();
    expect(after.credits.filter((n) => n.supplierId === wineId).map((n) => [n.noteNo, n.amount])).toEqual([["OUR-1", "300.00"]]);
  });

  it("reversals: with a reason, by the four only; a bill only once its payments are; a wrong bill corrected", async () => {
    const grain = (await billNamed("G-2"))!;
    const reverse = (who: string, body: object) => call(who, "POST", "/purchasing/dues/reverse", body);
    expect((await reverse(keeper, { kind: "bill", id: grain.id, reason: "Wrong" })).status).toBe(403);
    expect(await reason(await reverse(accountant, { kind: "bill", id: grain.id, reason: " " }))).toBe("Say why it is reversed.");
    expect(await reason(await reverse(accountant, { kind: "toString", id: grain.id, reason: "x" }))).toBe("What is being reversed?");
    expect(await reason(await reverse(accountant, { kind: "bill", id: grain.id, reason: "Wrong" }))).toBe(
      "Reverse the payments and credit notes on this bill first.");

    const cash = grain.payments.find((p) => p.method === "cash")!;
    expect((await reverse(gm, { kind: "payment", id: cash.id, reason: "Paid twice by mistake" })).status).toBe(200);
    expect(await reason(await reverse(gm, { kind: "payment", id: cash.id, reason: "again" }))).toBe("This was already reversed.");
    const back = (await billNamed("G-2", false))!;
    expect([back.owed, back.status], "the bill is owed again").toEqual(["1290.00", "part-paid"]);
    expect(back.payments.find((p) => p.id === cash.id)!.reversed, "both stay on the record")
      .toEqual({ on: today, reason: "Paid twice by mistake" });

    /* A wrong bar bill: its credit note first, then the bill, corrected to 7,800. */
    const wine = (await billNamed("W-7"))!;
    expect((await reverse(accountant, { kind: "credit-note", id: wine.creditNotes[0]!.id, reason: "Not agreed" })).status).toBe(200);
    expect(await reason(await reverse(accountant, { kind: "bill", id: wine.id, reason: "Wrong total",
      correct: { billNo: "W-7", billDate: today, amount: 7800 } }))).toBe("Pick the date the bill is due.");
    const fixed = await reverse(accountant, { kind: "bill", id: wine.id, reason: "Wrong total",
      correct: { billNo: "W-7", billDate: today, amount: 7800, dueOn: inDays(30) } });
    expect(fixed.status, await fixed.clone().text()).toBe(200);
    const now = (await dues()).bills.filter((b) => b.billNo === "W-7" && b.supplier.startsWith(TAG));
    expect(now.map((b) => [b.amount, b.owed, b.replaces, b.from.kind])).toEqual([["7800.00", "7800.00", "W-7", "bar"]]);
    expect((await sql("select 1 from supplier_bills where bill_no = 'W-7' and supplier like $1", [`${TAG}%`])).length,
      "the wrong bill stays on the record").toBe(2);
  });
});

describe("the three reports: Supplier dues, TDS deducted, a supplier's statement", () => {
  it("Supplier dues: owed on a date by supplier, part payments with TDS and who handed over, the Inventory Manager refused", async () => {
    const res = await call(gm, "GET", `/reports/supplier-dues?from=2025-01-01&asOn=${today}`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Doc;
    const owed = doc.sections.find((s) => s.key === "owed")!.rows;
    const at = owed.findIndex((r) => r.kind === "band" && r.cells["supplier"] === `${TAG} Grain Co`);
    expect(owed.slice(at, at + 3).map((r) => [r.kind, r.cells["supplier"], r.cells["amount"] ?? null, r.cells["owed"] ?? null]))
      .toEqual([["band", `${TAG} Grain Co`, null, null], ["row", "Bill G-2", 2310, 1290], ["total", `${TAG} Grain Co, owed`, null, 1290]]);
    const wine = owed.findIndex((r) => r.kind === "band" && r.cells["supplier"] === `${TAG} Wine Traders`);
    expect(owed.slice(wine + 1, wine + 4).map((r) => [r.cells["supplier"], r.cells["owed"]])).toEqual([
      ["Bill W-7", 7800], ["Credit note OUR-1", -300], [`${TAG} Wine Traders, owed`, 7500]]);

    /* As on a day before any payment, the whole of G-2 was owed, and overdue. */
    const before = (await (await call(gm, "GET", "/reports/supplier-dues?from=2025-01-01&asOn=2025-03-01")).json()) as Doc;
    const g2 = before.sections.find((s) => s.key === "owed")!.rows.find((r) => r.cells["supplier"] === "Bill G-2")!;
    expect([g2.cells["late"], g2.cells["owed"]]).toEqual([20, 2310]);

    const paid = doc.sections.find((s) => s.key === "paid")!.rows.filter((r) => r.cells["supplier"] === `${TAG} Grain Co`);
    expect(paid.map((p) => [p.cells["method"], p.cells["reference"], p.cells["handedOverBy"], p.cells["tds"], p.cells["amount"]]),
      "the reversed cash payment is left out").toEqual([["Cheque", "CHQ 004512", "Ravi Kumar", 20, 1000]]);

    expect((await call(manager, "GET", "/reports/supplier-dues")).status).toBe(403);
    expect((await call(keeper, "GET", "/reports/supplier-dues")).status).toBe(403);
    expect((await call(accountant, "GET", `/reports/supplier-dues.csv?asOn=${today}`)).status).toBe(200);
    expect((await call(keeper, "GET", `/reports/supplier-dues.csv?asOn=${today}`)).status).toBe(403);
  });

  it("TDS deducted: by section and supplier, the amount credited being paid plus TDS; refused to the Inventory Manager", async () => {
    const res = await call(accountant, "GET", `/reports/tds?from=${today}&asOn=${today}`);
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as Doc).sections[0]!.rows;
    const at = rows.findIndex((r) => r.kind === "band" && r.cells["supplier"] === "Section 194C");
    const grain = rows.slice(at).filter((r) => String(r.cells["supplier"]).startsWith(`${TAG} Grain Co`));
    expect(grain.map((r) => [r.kind, r.cells["bill"] ?? null, r.cells["gross"], r.cells["rate"] ?? null, r.cells["tds"], r.cells["amount"]]))
      .toEqual([["row", "G-2", 1020, 2, 20, 1000], ["total", null, 1020, null, 20, 1000]]);
    for (const path of [`/reports/tds?asOn=${today}`, `/reports/tds.xlsx?asOn=${today}`]) {
      expect((await call(keeper, "GET", path)).status, path).toBe(403);
    }
    expect((await call(gm, "GET", `/reports/tds.pdf?from=${today}&asOn=${today}`)).status).toBe(200);
  });

  it("a supplier's statement: opening balance, every entry with a running balance, closing; a supplier is required", async () => {
    const res = await call(accountant, "GET", `/reports/supplier-statement?supplier=${supplierId}&from=${today}&asOn=${today}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const rows = ((await res.json()) as Doc).sections[0]!.rows;
    expect(rows.map((r) => [r.cells["what"], r.cells["billed"] ?? null, r.cells["settled"] ?? null, r.cells["balance"]])).toEqual([
      ["Opening balance", null, null, 2310],
      ["Payment on bill G-2", null, 1000, 1310],
      ["TDS 194C at 2% on bill G-2", null, 20, 1290],
      ["Payment on bill G-2", null, 1290, 0],
      ["Reversed: payment on bill G-2", 1290, null, 1290],
      ["Closing balance", null, null, 1290],
    ]);
    const wine = ((await (await call(gm, "GET", `/reports/supplier-statement?supplier=${wineId}&from=${today}&asOn=${today}`))
      .json()) as Doc).sections[0]!.rows;
    expect(wine.map((r) => [r.cells["what"], r.cells["balance"]])).toEqual([
      ["Opening balance", 0], ["Bill W-7", 8000], ["Credit note CN-11 on bill W-7", 7500], ["Credit note OUR-1", 7200],
      ["Reversed: credit note CN-11", 7700], ["Reversed: bill W-7", -300], ["Bill W-7", 7500], ["Closing balance", 7500],
    ]);

    const none = await call(accountant, "GET", "/reports/supplier-statement");
    expect([none.status, ((await none.json()) as { error: string }).error]).toEqual([400, "Pick a supplier for the statement."]);
    expect((await call(accountant, "GET", `/reports/supplier-statement.xlsx?supplier=${supplierId}&asOn=${today}`)).status).toBe(200);
    expect((await call(keeper, "GET", `/reports/supplier-statement?supplier=${supplierId}`)).status).toBe(403);
    expect((await call(manager, "GET", `/reports/supplier-statement.pdf?supplier=${supplierId}`)).status).toBe(403);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE SUPPLIER'S BILL MATCHED TO THE ORDER (the owner's D27-383, item 11)

   Per line, the bill against the order: more billed than came, a price
   above the agreed one, a GST rate other than the order's. Each flagged on
   the order and on Supplier dues; nothing refused automatically; paying a
   flagged bill asks whoever pays to confirm, and keeps their name. A
   missing figure is never a difference. The database's half is in
   db/tests/modules/purchasing.sql, "bill matched to the order".
   ══════════════════════════════════════════════════════════════════ */
describe("the supplier's bill held against its order (D27-383 item 11)", () => {
  type Diff = { item: string; unit: string; kind: string; billed: string; against: string };
  type Detail = { differences: Diff[];
    lines: { agreedGstRate: string | null; billedQuantity: string | null; billGstRate: string | null }[] };
  const detail = async (id: string) => (await (await call(keeper, "GET", `/purchasing/requests/${id}`)).json()) as Detail;
  let flagged = { id: "", lineId: "" };

  it("the order's GST rate is typed with the price, 0 to 100, and fixed once the order is sent", async () => {
    const raised = await call(keeper, "POST", "/purchasing/requests", {
      storeId, reason: `${TAG} gst on the order`, lines: [{ itemId, quantity: 5, unitPrice: 100 }] });
    const { request } = (await raised.json()) as { request: { id: string } };
    const [line] = await sql<{ id: string }>("select id::text from purchase_request_lines where request_id = $1", [request.id]);
    const put = (body: object) => call(keeper, "PUT", `/purchasing/requests/${request.id}/lines/${line!.id}`, body);
    for (const gstRate of [101, -1, 5.555, "5"]) {
      expect(await reason(await put({ gstRate })), String(gstRate)).toBe("A GST rate is from 0 to 100 per cent, or nothing at all.");
    }
    expect((await put({ gstRate: 5 })).status).toBe(200);
    expect((await detail(request.id)).lines[0]!.agreedGstRate).toBe("5.00");
    const [row] = await sql<{ price: string }>("select unit_price::text as price from purchase_request_lines where id = $1", [line!.id]);
    expect(row!.price, "the price is untouched").toBe("100.00");
    expect((await put({ gstRate: null })).status).toBe(200);
    expect((await detail(request.id)).lines[0]!.agreedGstRate, "blank is none agreed").toBeNull();

    const sent = await sentOrder(5);
    expect(await reason(await call(keeper, "PUT", `/purchasing/requests/${sent.id}/lines/${sent.lineId}`, { gstRate: 18 })))
      .toBe("This order has already gone to the supplier. What they were told they would be paid does not change afterwards.");
  });

  it("on credit, every line says what the bill charges for; without it nothing is received", async () => {
    const order = await sentOrder(5);
    const res = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 18, receivedUnitCost: 115 }],
      credit: { billNo: "G-31", billDate: today, amount: 2400, dueOn: inDays(30) } });
    expect(await reason(res)).toBe(
      "On credit, type how much the supplier's bill charges for on every line, as printed. Not on the bill is 0.");
    const negative = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 18, billedQuantity: -1 }] });
    expect(await reason(negative)).toBe("What the bill charges for is zero or more.");
    const [r] = await sql<{ status: string }>("select status from purchase_requests where id = $1", [order.id]);
    expect(r!.status, "nothing received").toBe("ordered");
    flagged = order;
  });

  it("flags more billed than came, a price above the agreed one and another GST rate - and records the delivery", async () => {
    const res = await call(keeper, "POST", `/purchasing/requests/${flagged.id}/delivery`, {
      lines: [{ lineId: flagged.lineId, receivedQuantity: 18, receivedUnitCost: 115, billedQuantity: 20,
                gstRate: 18, gstAmount: 414, gstClaimable: true }],
      credit: { billNo: "G-31", billDate: today, amount: 2714, dueOn: inDays(30) } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { differences: number }).differences).toBe(3);
    const d = await detail(flagged.id);
    expect(d.differences.map((x) => [x.kind, x.billed, x.against])).toEqual([
      ["quantity", "20.000", "18.000"], ["price", "115.00", "110.00"], ["gst", "18.00", "5.00"]]);
    expect([d.lines[0]!.billedQuantity, d.lines[0]!.billGstRate, d.lines[0]!.agreedGstRate]).toEqual(["20.000", "18.00", "5.00"]);
    const bills = await sql("select 1 from supplier_bills where purchase_request_id = $1", [flagged.id]);
    expect(bills.length, "the bill is on the dues as printed: nothing refused").toBe(1);
  });

  it("a missing figure is never a difference: no agreed GST, no cost each", async () => {
    const order = await sentOrder();
    const res = await call(keeper, "POST", `/purchasing/requests/${order.id}/delivery`, {
      lines: [{ lineId: order.lineId, receivedQuantity: 20, billedQuantity: 20, gstRate: 18, gstAmount: 0, gstClaimable: false }],
      credit: { billNo: "G-32", billDate: today, amount: 2200, dueOn: inDays(30) } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { differences: number }).differences).toBe(0);
    expect((await detail(order.id)).differences).toEqual([]);
  });

  it("Supplier dues shows the differences; paying asks the payer to confirm, and keeps their name", async () => {
    type Due = Bill & { differences: Diff[] };
    const due = async (no: string) => (await dues(accountant, true)).bills.find((b) => b.billNo === no) as Due;
    expect((await due("G-31")).differences.map((x) => x.kind)).toEqual(["quantity", "price", "gst"]);
    expect((await due("G-32")).differences).toEqual([]);

    const pay = (id: string, body: object = {}) => call(accountant, "POST", `/purchasing/dues/${id}/payment`,
      { amount: 1000, method: "cash", paidOn: today, handedOverBy: "Ravi", ...body });
    const g31 = await due("G-31");
    for (const seen of [undefined, false]) {
      expect(await reason(await pay(g31.id, seen === undefined ? {} : { differencesSeen: seen })), String(seen)).toBe(
        "This bill differs from its order in 3 places. Confirm you have seen the differences, then record the payment.");
    }
    expect((await sql("select 1 from supplier_payments where bill_id = $1", [g31.id])).length, "nothing written").toBe(0);
    expect((await pay(g31.id, { differencesSeen: true })).status).toBe(200);
    expect((await due("G-31")).payments.map((p) => [p.amount, p.differencesSeenBy])).toEqual([["1000.00", `${TAG} accountant`]]);

    const g32 = await due("G-32");
    expect((await pay(g32.id)).status, "a bill like its order is paid as before").toBe(200);
    expect((await due("G-32")).payments.map((p) => p.differencesSeenBy)).toEqual([null]);
  });
});
