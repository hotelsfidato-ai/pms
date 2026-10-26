import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S RESTAURANT ALLOWANCE (the owner's D27-355, D27-365 (1), D27-366)

   The owner or an Admin sets the free amount a month and the % off above it
   - nothing built in. The GM, the owner or an Admin settles a bill to it:
   what is left of the month pays first, as a tender of its own; the rest gets
   the % off (a discount, so the tax follows it) and is paid by cash, card or
   UPI. A refusal after the % off went on takes it off again (MEMORY 243). A
   void gives the allowance back and asks no refund reference for it.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "OWNALW";
let owner = "";
let gm = "";
let waiter = "";
let tikka = "";
let putAwayTillDay: () => Promise<void>;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
type Tender = { method: string; amount: number };
type Plan = { ok: boolean; reason?: string; left: number; before: number; free: number; rest: number; discountNet: number };

/** An open bill of `qty` Paneer Tikka, sent to the kitchen. */
async function openBill(table: string, qty: number): Promise<string> {
  const opened = await call(owner, "POST", "/till/orders", { outlet: "REST", table: `${TAG} ${table}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  expect((await call(owner, "POST", `/till/orders/${id}/lines`, { itemId: tikka, qty })).status).toBe(200);
  expect((await call(owner, "POST", `/till/orders/${id}/kot`, {})).status).toBe(200);
  return id;
}
const plan = async (id: string) => (await (await call(gm, "GET", `/till/orders/${id}/owner-allowance`)).json()) as Plan;
const settle = (who: string, id: string, rest: Record<string, unknown>) =>
  call(who, "POST", `/till/orders/${id}/settle`, { method: "allowance", rest });
const row = async (id: string) => (await sql<{ status: string; payment_method: string | null; on_owner_allowance: boolean;
  discount_amount: string | null; discount_reason: string | null }>(
  "select status, payment_method, on_owner_allowance, discount_amount::text, discount_reason from pos_orders where id = $1", [id]))[0]!;
const tenders = async (id: string) => (await sql<{ method: string; amount: string }>(
  "select method, amount::text from pos_order_tenders where order_id = $1 order by method", [id]))
  .map((t) => ({ method: t.method, amount: Number(t.amount) }) as Tender);

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const person = async (email: string, name: string, role: string) => {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`, [email, name]);
    await sql(`insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'
               on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, role]);
    return s!.id;
  };
  gm = await person("ownalw-gm@fidato.in", "OWNALW Manager", "gm");
  waiter = await person("ownalw-waiter@fidato.in", "OWNALW Waiter", "pos");
  const menu = (await (await call(owner, "GET", "/till/menu")).json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  await sql("update hotels set owner_allowance_monthly = null, owner_allowance_off_pct = null, pos_round_off = 'manual' where code = '5EL'");
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("update hotels set owner_allowance_monthly = null, owner_allowance_off_pct = null where code = '5EL'");
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query("delete from pos_order_tenders where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
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

describe("the owner's allowance (D27-355, D27-366)", () => {
  it("is nothing until the owner or an Admin types it; the GM may not set it", async () => {
    const id = await openBill("unset", 1);
    expect((await plan(id)).reason).toBe("The owner's allowance is not set. The owner or an Admin types it in Restaurant setup.");
    expect((await settle(gm, id, { method: "cash" })).status).toBe(409);
    expect((await row(id)).status, "nothing settled").toBe("open");
    expect((await call(gm, "PUT", "/till/owner-allowance", { monthly: 500, offPct: 20 })).status).toBe(403);
    expect((await call(owner, "PUT", "/till/owner-allowance", { monthly: -1, offPct: 20 })).status).toBe(409);
    expect((await call(owner, "PUT", "/till/owner-allowance", { monthly: 500, offPct: null })).status).toBe(200);
  });

  it("a bill within what is left is free: one allowance payment, the GM's to settle and not a waiter's", async () => {
    const id = await openBill("free", 1);   // 320 + 5% = 336
    expect(((await (await settle(waiter, id, { method: "cash" })).json()) as { reason: string }).reason)
      .toBe("Settling a bill to the owner's allowance is for the GM, the owner or an Admin.");
    expect(await plan(id)).toMatchObject({ ok: true, left: 500, before: 336, free: 336, rest: 0, discountNet: 0 });
    const res = await settle(gm, id, { method: "cash" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await tenders(id)).toEqual([{ method: "allowance", amount: 336 }]);
    expect(await row(id)).toMatchObject({ status: "settled", payment_method: "allowance", on_owner_allowance: true });
  });

  it("above what is left, with the % off not set, it is refused and nothing is changed", async () => {
    const id = await openBill("no pct", 2);   // 672 > 164 left
    expect((await plan(id)).reason).toMatch(/^This bill is more than the ₹164\.00 left of this month's allowance, and the % off above it is not set\./);
    expect((await settle(gm, id, { method: "upi" })).status).toBe(409);
    expect(await row(id)).toMatchObject({ status: "open", discount_amount: "0.00" });
    expect((await call(owner, "PUT", "/till/owner-allowance", { monthly: 500, offPct: 20 })).status).toBe(200);
  });

  it("above what is left: the rest gets the % off, paid by UPI, and the free part is what was left", async () => {
    const id = (await sql<{ id: string }>("select id::text from pos_orders where table_ref = $1", [`${TAG} no pct`]))[0]!.id;
    const p = await plan(id);
    expect(p).toMatchObject({ ok: true, left: 164, before: 672, free: 164 });
    const res = await settle(gm, id, { method: "upi" });
    expect(res.status, await res.clone().text()).toBe(200);
    const paid = await tenders(id);
    expect(paid.find((t) => t.method === "allowance")!.amount).toBe(164);
    /* (672 - 164) x 80% = 406.40, within the paisa the tax rounds to. */
    expect(paid.find((t) => t.method === "upi")!.amount).toBeCloseTo(406.4, 0);
    expect(await row(id)).toMatchObject({ status: "settled", payment_method: "split", on_owner_allowance: true });
    expect((await row(id)).discount_reason).toBe("Owner's allowance: 20% off above the ₹164.00 left of this month's ₹500.00");
  });

  it("the month used up: the whole bill gets the % off, paid by card, and is still the owner's", async () => {
    const id = await openBill("used up", 1);
    expect(await plan(id)).toMatchObject({ ok: true, left: 0, free: 0 });
    const res = await settle(gm, id, { method: "card" });
    expect(res.status, await res.clone().text()).toBe(200);
    const paid = await tenders(id);
    expect(paid.map((t) => t.method)).toEqual(["card"]);
    expect(paid[0]!.amount).toBeCloseTo(268.8, 0);
    expect(await row(id)).toMatchObject({ payment_method: "card", on_owner_allowance: true });
  });

  it("a refusal after the % off went on takes it off again: the bill is as it was (MEMORY 243)", async () => {
    const id = await openBill("too much cash", 800);   // 2,68,800; 80% of it is over the cash ceiling
    const res = await settle(gm, id, { method: "cash" });
    expect(res.status).toBe(409);
    expect(await row(id)).toMatchObject({ status: "open", discount_amount: "0.00", on_owner_allowance: false });
    expect(await tenders(id)).toEqual([]);
  });

  it("the month's use and its bills; a void gives the allowance back with no refund reference", async () => {
    const before = (await (await call(owner, "GET", "/till/owner-allowance")).json()) as {
      monthly: number; offPct: number; used: number; left: number; bills: { orderNo: string; free: number; paid: number }[] };
    expect(before).toMatchObject({ monthly: 500, offPct: 20, used: 500, left: 0 });
    expect(before.bills.length).toBeGreaterThanOrEqual(3);
    const free = (await sql<{ id: string }>("select id::text from pos_orders where table_ref = $1", [`${TAG} free`]))[0]!.id;
    const voided = await call(gm, "POST", `/till/orders/${free}/void`, { reason: "Wrong bill" });
    expect(voided.status, await voided.clone().text()).toBe(200);
    const after = (await (await call(owner, "GET", "/till/owner-allowance")).json()) as { used: number; left: number };
    expect(after).toMatchObject({ used: 164, left: 336 });
  });
});
