import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   SENT TO THE GM, AND A PAID BILL'S PAYMENT MODE (the owner's D27-363)

   A waiter SENDS the GM what they may not do - strike a dish the kitchen
   has, a discount, NC, void a paid bill - with a reason; it waits in the
   GM's inbox and bell; the GM, the owner or an Admin approves and that does
   it, with the till's own checks, or rejects it and the waiter reads why.
   And a paid bill's cash, card or UPI is changed before the night audit by
   the GM, the owner or an Admin, with a reason, kept and listed on the day
   end. Migration 237.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "SENTGM";
let gm = "";
let waiter = "";
let tikka = "";
let putAwayTillDay: () => Promise<void>;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, body === undefined
    ? { headers: { "x-dev-staff-id": who } }
    : { method: "POST", headers: { "x-dev-staff-id": who, "content-type": "application/json" }, body: JSON.stringify(body) });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

type Order = {
  id: string; status: string; paymentMethod: string | null; discount: number;
  lines: { id: string; name: string; voided: boolean; kotStatus: string }[];
  tenders: { id: string; method: string; amount: number }[];
  requests: { kind: string; status: string; note: string | null; summary: string }[];
  modeChanges: { from: string; to: string; reason: string }[];
};

async function sentBill(label: string): Promise<Order> {
  const res = await call(waiter, "/till/orders/batch", { outlet: "REST", table: `${TAG} ${label}`, lines: [{ itemId: tikka, qty: 2 }], send: true });
  expect(res.status, await res.clone().text()).toBe(200);
  const { id } = (await res.json()) as { id: string };
  return order(id);
}
const order = async (id: string) => (await (await call(gm, `/till/orders/${id}`)).json()) as Order;
const ask = (orderId: string, body: Record<string, unknown>) => call(waiter, `/till/orders/${orderId}/requests`, body);
type Approval = { id: string; kind: string; detail: string | null; mayDecide: boolean; status: string };
const approvalFor = async (summaryPart: string) => {
  const list = (await (await call(gm, "/approvals?status=all")).json()) as { rows: Approval[] };
  return list.rows.find((a) => a.kind === "pos_request" && (a.detail ?? "").includes(summaryPart))!;
};

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
  gm = await person("sentgm-gm@fidato.in", "SENTGM Manager", "gm");
  waiter = await person("sentgm-waiter@fidato.in", "SENTGM Waiter", "pos");
  const menu = (await (await call(gm, "/till/menu")).json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query("delete from pos_requests where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from approvals where requested_by = any($1::uuid[])", [[waiter, gm]]);
    await db.query("delete from pos_tender_changes where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from pos_order_tenders where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from vat_bills where pos_order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from pos_order_lines where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter]]);
  } finally {
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await closePool();
});

describe("a waiter sends the GM what they may not do (D27-363)", () => {
  it("NC: sent with a reason, in the GM's inbox and bell, approved - and it is done", async () => {
    const o = await sentBill("nc");
    expect((await call(waiter, `/till/orders/${o.id}/no-charge`, { reason: "Owner's guest" })).status, "the waiter may not do it").toBe(403);
    expect(await reason(await ask(o.id, { kind: "no_charge", reason: "" }))).toBe("Say why, for the GM.");
    const sent = await ask(o.id, { kind: "no_charge", reason: "Owner's guest" });
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(await reason(await ask(o.id, { kind: "no_charge", reason: "Again" }))).toBe("This is already with the GM.");
    expect((await order(o.id)).requests[0]).toMatchObject({ kind: "no_charge", status: "pending" });

    const bell = (await (await call(gm, "/notifications")).json()) as { id: string; link: string }[] | { items: { id: string; link: string }[] };
    const items = Array.isArray(bell) ? bell : bell.items;
    expect(items.find((n) => n.id === "approvals-waiting")?.link).toBe("/h/5EL/approvals");

    const a = await approvalFor(`${TAG} nc`);
    expect(a).toMatchObject({ mayDecide: true, status: "pending" });
    expect(a.detail).toContain("NC, the bill free");
    const ok = await call(gm, `/approvals/${a.id}/approved`, {});
    expect(ok.status, await ok.clone().text()).toBe(200);
    const after = await order(o.id);
    expect(after.status).toBe("no_charge");
    expect(after.requests[0]).toMatchObject({ status: "approved" });
  });

  it("a strike of a dish the kitchen has: rejected with a reason the waiter reads; the dish stays", async () => {
    const o = await sentBill("strike");
    const line = o.lines[0]!;
    expect((await ask(o.id, { kind: "strike_line", lineId: line.id, reason: "Guest changed their mind" })).status).toBe(200);
    const a = await approvalFor(`${TAG} strike`);
    expect(a.detail).toContain("Strike 2 x Paneer Tikka");
    expect((await call(gm, `/approvals/${a.id}/rejected`, {})).status, "a rejection says why").toBe(409);
    expect((await call(gm, `/approvals/${a.id}/rejected`, { note: "It was cooked" })).status).toBe(200);
    const after = await order(o.id);
    expect(after.lines[0]!.voided).toBe(false);
    expect(after.requests[0]).toMatchObject({ kind: "strike_line", status: "rejected", note: "It was cooked" });
  });

  it("a discount, approved, goes on the bill - and the till's own checks are asked again then", async () => {
    const o = await sentBill("discount");
    expect(await reason(await ask(o.id, { kind: "discount", type: "percent", value: 0, reason: "Regular" })))
      .toBe("How much is the discount?");
    expect((await ask(o.id, { kind: "discount", type: "percent", value: 10, reason: "Regular" })).status).toBe(200);
    const a = await approvalFor(`${TAG} discount`);
    expect((await call(gm, `/approvals/${a.id}/approved`, {})).status).toBe(200);
    expect((await order(o.id)).discount).toBeGreaterThan(0);

    /* A strike asked, then the dish struck at the till before the GM decides:
       approving says so, and both stay waiting. */
    const p = await sentBill("gone");
    expect((await ask(p.id, { kind: "strike_line", lineId: p.lines[0]!.id, reason: "Wrong table" })).status).toBe(200);
    expect((await call(gm, `/till/orders/${p.id}/lines/${p.lines[0]!.id}/void`, { reason: "Wrong table" })).status).toBe(200);
    const b = await approvalFor(`${TAG} gone`);
    expect(await reason(await call(gm, `/approvals/${b.id}/approved`, {}))).toBe("That line is already struck, or is not here.");
    expect((await approvalFor(`${TAG} gone`)).status).toBe("pending");
  });

  it("a paid bill voided: a card bill needs the refund's reference when sent", async () => {
    const o = await sentBill("void");
    expect((await call(gm, `/till/orders/${o.id}/settle`, { method: "card" })).status).toBe(200);
    expect(await reason(await ask(o.id, { kind: "void_bill", reason: "Charged twice" })))
      .toBe("Give the refund's reference: the UPI reference or the card approval.");
    expect((await ask(o.id, { kind: "void_bill", reason: "Charged twice", reference: "APPR-1" })).status).toBe(200);
    const a = await approvalFor(`${TAG} void`);
    expect((await call(gm, `/approvals/${a.id}/approved`, {})).status).toBe(200);
    expect((await order(o.id)).status).toBe("void");
  });
});

describe("a paid bill's payment mode, changed before the night audit (D27-363)", () => {
  it("cash to card by the GM with a reason; kept on the bill and the day end - not by a waiter", async () => {
    const o = await sentBill("mode");
    expect((await call(gm, `/till/orders/${o.id}/settle`, { method: "cash" })).status).toBe(200);
    const settled = await order(o.id);
    const tender = settled.tenders[0]!;
    const change = (who: string, body: unknown) => call(who, `/till/orders/${o.id}/tenders/change`, body);
    expect((await change(waiter, { changes: [{ tenderId: tender.id, method: "card" }], reason: "Paid by card" })).status).toBe(403);
    expect(await reason(await change(gm, { changes: [{ tenderId: tender.id, method: "card" }], reason: "" })))
      .toBe("Say why the payment mode is changed. The reason stays on the bill.");
    expect(await reason(await change(gm, { changes: [{ tenderId: tender.id, method: "room" }], reason: "x" })))
      .toBe("A payment becomes cash, card or UPI.");
    expect(await reason(await change(gm, { changes: [{ tenderId: tender.id, method: "cash" }], reason: "x" })))
      .toBe("Nothing changes: pick a different mode.");
    const done = await change(gm, { changes: [{ tenderId: tender.id, method: "card" }], reason: "Paid by card, keyed as cash" });
    expect(done.status, await done.clone().text()).toBe(200);
    const after = await order(o.id);
    expect([after.paymentMethod, after.tenders[0]!.method]).toEqual(["card", "card"]);
    expect(after.modeChanges).toEqual([expect.objectContaining({ from: "cash", to: "card", reason: "Paid by card, keyed as cash" })]);
    const day = (await (await call(gm, "/till/day-end?outlet=REST")).json()) as { modeChanges?: { orderNo: string; from: string; to: string }[] };
    expect(day.modeChanges?.some((m) => m.from === "Cash" && m.to === "Card")).toBe(true);
  });

  it("an open bill, or one of an earlier day, is refused", async () => {
    const o = await sentBill("open");
    const t = (await order(o.id)).tenders[0];
    expect(await reason(await call(gm, `/till/orders/${o.id}/tenders/change`, { changes: [{ tenderId: t?.id ?? "1", method: "card" }], reason: "x" })))
      .toBe("Only a paid bill's payment mode is changed.");
  });
});
