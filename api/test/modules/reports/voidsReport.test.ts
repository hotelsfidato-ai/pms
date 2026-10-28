import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   THE VOIDS REPORT (the owner's D27-370, 27 October)

   Every voided paid bill, order closed unpaid and struck dish, per outlet
   and day: what, how much, who, when and why. Each of the three is made
   through the till's own routes, and the report is read back: every row's
   what / how much / who / when / why, the totals by kind, and that a
   person without the `report` grant is refused (the screen's route and
   the file's).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "VOIDRPT";
let gm = "";
let waiter = "";
let tikka = "";
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

type Line = { id: string; qty: number; unitPrice: number };
type Order = { id: string; payable: number; lines: Line[] };
const order = async (id: string) => (await (await call(gm, `/till/orders/${id}`)).json()) as Order;

type Cells = Record<string, string | number | null>;
type Doc = { sections: { key: string; rows: { kind: string; cells: Cells }[] }[]; footnotes: string[] };
const report = async (who: string) => call(who, `/reports/voids?from=${day}&asOn=${day}`);
const readDoc = async (who = gm) => {
  const res = await report(who);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Doc;
};
/** The report's total for this outlet over the range: a count and an amount per kind. */
const totals = (doc: Doc) => {
  const t = doc.sections.find((s) => s.key === "voids-summary")!.rows
    .find((r) => r.kind === "total" && r.cells["outlet"] === `${outlet}, all days`)?.cells ?? {};
  const n = (k: string) => Number(t[k] ?? 0);
  return {
    bill: [n("billN"), n("billAmount")], unpaid: [n("unpaidN"), n("unpaidAmount")], dish: [n("dishN"), n("dishAmount")],
  };
};
const mine = (doc: Doc) => doc.sections.find((s) => s.key === "voids-detail")!.rows
  .filter((r) => r.kind === "row" && String(r.cells["table"] ?? "").startsWith(TAG)).map((r) => r.cells);
const at = (rows: Cells[], table: string) => rows.filter((r) => r["table"] === `${TAG} ${table}`);

async function openBill(table: string, qty: number, send: boolean, by = waiter): Promise<Order> {
  const res = await call(by, "/till/orders/batch", { outlet: "REST", table: `${TAG} ${table}`, lines: [{ itemId: tikka, qty }], send });
  expect(res.status, await res.clone().text()).toBe(200);
  return order(((await res.json()) as { id: string }).id);
}
const approve = async (summaryPart: string) => {
  const list = (await (await call(gm, "/approvals?status=all")).json()) as { rows: { id: string; kind: string; detail: string | null }[] };
  const a = list.rows.find((x) => x.kind === "pos_request" && (x.detail ?? "").includes(summaryPart))!;
  const ok = await call(gm, `/approvals/${a.id}/approved`, {});
  expect(ok.status, await ok.clone().text()).toBe(200);
};

let before: ReturnType<typeof totals>;
let bills: { card: Order; asked: Order };
let unpaid: Order;
let strikes: { unsent: Order; unsentBare: Order; sent: Order; asked: Order };

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
  gm = await person("voidrpt-gm@fidato.in", "VOIDRPT Manager", "gm");
  waiter = await person("voidrpt-waiter@fidato.in", "VOIDRPT Waiter", "pos");
  const [h] = await sql<{ bd: string; outlet: string }>(
    `select to_char(app.business_date(h.id), 'YYYY-MM-DD') as bd, o.name as outlet
       from hotels h join pos_outlets o on o.hotel_id = h.id where h.code = '5EL' and o.code = 'REST'`);
  day = h!.bd;
  outlet = h!.outlet;
  const menu = (await (await call(gm, "/till/menu")).json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  putAwayTillDay = await openTillDay("5EL");

  before = totals(await readDoc());

  /* A voided paid bill: a card bill the GM voids with the refund's reference... */
  const card = await openBill("card", 1, true);
  expect((await call(gm, `/till/orders/${card.id}/settle`, { method: "card" })).status).toBe(200);
  const v = await call(gm, `/till/orders/${card.id}/void`, { reason: `${TAG} wrong table`, reference: "UPI-REF-9" });
  expect(v.status, await v.clone().text()).toBe(200);
  /* ...and a cash one the waiter asked the GM to void, the GM approving. */
  const asked = await openBill("asked bill", 2, true);
  expect((await call(gm, `/till/orders/${asked.id}/settle`, { method: "cash" })).status).toBe(200);
  expect((await call(waiter, `/till/orders/${asked.id}/requests`, { kind: "void_bill", reason: `${TAG} charged twice` })).status).toBe(200);
  await approve(`${TAG} asked bill`);
  bills = { card, asked };

  /* An order closed unpaid. */
  unpaid = await openBill("unpaid", 3, false);
  const a = await call(waiter, `/till/orders/${unpaid.id}/abandon`, { reason: `${TAG} guest walked out` });
  expect(a.status, await a.clone().text()).toBe(200);

  /* Struck dishes: before the kitchen had them (with a reason, and none)... */
  const unsent = await openBill("unsent", 2, false);
  expect((await call(waiter, `/till/orders/${unsent.id}/lines/${unsent.lines[0]!.id}/void`, { reason: `${TAG} typed twice` })).status).toBe(200);
  const unsentBare = await openBill("unsent bare", 1, false);
  expect((await call(waiter, `/till/orders/${unsentBare.id}/lines/${unsentBare.lines[0]!.id}/void`, {})).status).toBe(200);
  /* ...after it, by the GM... */
  const sent = await openBill("sent", 1, true);
  const s = await call(gm, `/till/orders/${sent.id}/lines/${sent.lines[0]!.id}/void`, { reason: `${TAG} cooked wrong` });
  expect(s.status, await s.clone().text()).toBe(200);
  /* ...and one the waiter asked the GM for. */
  const askedDish = await openBill("asked dish", 2, true);
  expect((await call(waiter, `/till/orders/${askedDish.id}/requests`,
    { kind: "strike_line", lineId: askedDish.lines[0]!.id, reason: `${TAG} guest changed their mind` })).status).toBe(200);
  await approve(`${TAG} asked dish`);
  strikes = { unsent, unsentBare, sent, asked: askedDish };
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

describe("the voids report", () => {
  it("lists a voided bill: what, how much, who, when, why and the refund reference", async () => {
    const [row] = at(mine(await readDoc()), "card");
    expect(row).toMatchObject({
      kind: "Voided bill", bill: expect.any(String), amount: bills.card.payable,
      by: "VOIDRPT Manager", asked: null, reason: `${TAG} wrong table`, reference: "UPI-REF-9", dish: null, qty: null, sent: null,
    });
    expect(Math.abs(Date.now() - Date.parse(String(row!["at"])))).toBeLessThan(120_000);
  });

  it("a voided bill the waiter asked for names the waiter, and the GM who did it", async () => {
    const [row] = at(mine(await readDoc()), "asked bill");
    expect(row).toMatchObject({
      kind: "Voided bill", amount: bills.asked.payable, by: "VOIDRPT Manager", asked: "VOIDRPT Waiter", reference: null,
    });
    expect(String(row!["reason"])).toContain(`${TAG} charged twice`);
  });

  it("lists an order closed unpaid with its reason and amount; who and when are dashes (not recorded)", async () => {
    const [row] = at(mine(await readDoc()), "unpaid");
    expect(row).toMatchObject({
      kind: "Closed unpaid", amount: unpaid.payable, reason: `${TAG} guest walked out`, by: null, asked: null, at: null,
    });
  });

  it("lists a dish struck before the kitchen had it, with or without a reason", async () => {
    const rows = mine(await readDoc());
    const l = strikes.unsent.lines[0]!;
    expect(at(rows, "unsent")[0]).toMatchObject({
      kind: "Struck dish", dish: "Paneer Tikka", qty: "2", amount: l.qty * l.unitPrice,
      by: "VOIDRPT Waiter", reason: `${TAG} typed twice`, sent: "No", bill: expect.any(String), reference: null,
    });
    expect(at(rows, "unsent bare")[0]).toMatchObject({ kind: "Struck dish", reason: null, sent: "No" });
    expect(at(rows, "unsent")[0]!["at"]).toBeTruthy();
  });

  it("lists a dish struck after the kitchen had it, by the GM, and one the waiter asked for", async () => {
    const rows = mine(await readDoc());
    const l = strikes.sent.lines[0]!;
    expect(at(rows, "sent")[0]).toMatchObject({
      kind: "Struck dish", qty: "1", amount: l.qty * l.unitPrice, by: "VOIDRPT Manager", asked: null,
      reason: `${TAG} cooked wrong`, sent: "Yes",
    });
    const k = strikes.asked.lines[0]!;
    const asked = at(rows, "asked dish")[0]!;
    expect(asked).toMatchObject({ kind: "Struck dish", qty: "2", amount: k.qty * k.unitPrice, by: "VOIDRPT Manager", asked: "VOIDRPT Waiter", sent: "Yes" });
    expect(String(asked["reason"])).toContain(`${TAG} guest changed their mind`);
  });

  it("the outlet's totals for the range rise by exactly these, by kind", async () => {
    const after = totals(await readDoc());
    const round = (n: number) => Math.round(n * 100) / 100;
    const price = (o: Order) => o.lines[0]!.qty * o.lines[0]!.unitPrice;
    expect(after.bill[0]! - before.bill[0]!).toBe(2);
    expect(round(after.bill[1]! - before.bill[1]!)).toBe(round(bills.card.payable + bills.asked.payable));
    expect(after.unpaid[0]! - before.unpaid[0]!).toBe(1);
    expect(round(after.unpaid[1]! - before.unpaid[1]!)).toBe(round(unpaid.payable));
    expect(after.dish[0]! - before.dish[0]!).toBe(4);
    expect(round(after.dish[1]! - before.dish[1]!))
      .toBe(round(price(strikes.unsent) + price(strikes.unsentBare) + price(strikes.sent) + price(strikes.asked)));
  });

  it("says in its notes that an order closed unpaid does not record who or when", async () => {
    expect((await readDoc()).footnotes.join(" ")).toContain("does not record who closed it or when");
  });

  it("is refused to a waiter, on the screen's route and the file's", async () => {
    expect((await report(waiter)).status).toBe(403);
    expect((await call(waiter, `/reports/voids.pdf?from=${day}&asOn=${day}`)).status).toBe(403);
  });

  it("downloads as a PDF, Excel and CSV for the GM, from the same document", async () => {
    const pdf = await call(gm, `/reports/voids.pdf?from=${day}&asOn=${day}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((await call(gm, `/reports/voids.xlsx?from=${day}&asOn=${day}`)).status).toBe(200);
    const csv = await call(gm, `/reports/voids.csv?from=${day}&asOn=${day}`);
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain(`${TAG} guest walked out`);
  });

  it("a range with nothing in it still prints, and says so", async () => {
    const res = await call(gm, "/reports/voids?from=2020-01-01&asOn=2020-01-02");
    const doc = (await res.json()) as Doc;
    expect(doc.sections.map((s) => s.rows.length)).toEqual([0, 0]);
  });
});
