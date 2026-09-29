import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   FIX ROUND C - the restaurant and the kitchen (QA of 28 September)

   POS-1   a dish paid before it is cooked stays on the Kitchen screen
   POS-3   a typed table is the floor's table, one bill on it
   D27-119 a dish the kitchen has comes off only for a manager, with a reason
           (and the same for fewer of it, and for closing the bill unpaid)
   NA-2    a bill paid wholly in cash is whole rupees
   D27-118 a closed restaurant day takes no new bill or payment
   X-2     an order's phone number is a phone number
   and the owner's sixth answer: more of a dish the kitchen has is a new line
   for the next docket.

   Everything runs on an outlet, a table and a waiter of its own (RCFIX) and
   is removed afterwards, so a closed day here closes nobody else's.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const OUTLET = "RCFIX";

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

let owner = "";
let waiter = "";
let tikka = "";
let tikkaPrice = 0;
let papad = "";   // ₹90 at 5%: ₹94.50, a bill with paise

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const post = (who: string, path: string, body: unknown = {}) => call(who, "POST", path, body);

type Line = { id: string; qty: number; voided: boolean; kotStatus?: string };
type Order = { id: string; lines: Line[]; payable: number; roundOff: number };

async function open(table?: string): Promise<Order> {
  const res = await post(owner, "/till/orders", { outlet: OUTLET, ...(table ? { table } : {}) });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Order;
}
async function add(id: string, qty = 1, itemId = tikka) {
  const res = await post(owner, `/till/orders/${id}/lines`, { itemId, qty });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Order;
}
async function send(id: string) {
  const res = await post(owner, `/till/orders/${id}/kot`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Order & { kotNo: number; sent: number };
}
const lines = (orderId: string) => sql<{
  id: string; qty: string; kot_status: string; voided: boolean; void_reason: string | null;
}>(`select id::text, qty::text, kot_status, voided, void_reason from pos_order_lines
     where order_id = $1 order by id`, [orderId]);

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  waiter = (await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid)
     values ('rcfix-waiter@fidato.in', 'RCFIX waiter', 'test-uid-rcfix-waiter')
     on conflict (email) do update set is_active = true returning id::text`))[0]!.id;
  await sql("delete from staff_hotels where staff_id = $1", [waiter]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             select $1, id, 'pos' from hotels where code = '5EL'`, [waiter]);

  const [o] = await sql<{ id: string }>(
    `insert into pos_outlets (hotel_id, code, name, category, staff_id)
     select id, $1, 'Round C test', 'food', $2 from hotels where code = '5EL'
     returning id::text`, [OUTLET, owner]);
  const [s] = await sql<{ id: string }>(
    `insert into pos_sections (hotel_id, outlet_id, name)
     select hotel_id, id, 'RC' from pos_outlets where id = $1 returning id::text`, [o!.id]);
  await sql(`insert into pos_tables (hotel_id, section_id, label)
             select hotel_id, id, 'RC1' from pos_sections where id = $1`, [s!.id]);

  const res = await app.request("/api/hotels/5EL/till/menu", { headers: { "x-dev-staff-id": owner } });
  const menu = (await res.json()) as { categories: { items: { id: string; name: string; price: number }[] }[] };
  const items = menu.categories.flatMap((c) => c.items);
  const item = items.find((i) => i.name === "Paneer Tikka")!;
  tikka = item.id;
  tikkaPrice = item.price;
  papad = items.find((i) => i.name === "Papad Masala")!.id;
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query(`delete from pos_orders where outlet_id in
                      (select id from pos_outlets where code = $1)`, [OUTLET]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.end();
  }
  await sql("delete from pos_day_ends where outlet_id in (select id from pos_outlets where code = $1)", [OUTLET]);
  await sql("delete from pos_outlets where code = $1", [OUTLET]);
  await sql("delete from staff_hotels where staff_id = $1", [waiter]);
  await sql("update staff set is_active = false where id = $1", [waiter]);
  await closePool();
});

describe("POS-1: the kitchen keeps food that is already paid for", () => {
  it("a dish sent, then paid in cash, stays on the pass until it is served", async () => {
    const o = await open();
    await add(o.id);
    await send(o.id);
    const settled = await post(owner, `/till/orders/${o.id}/settle`, { method: "card" });
    expect(settled.status, await settled.clone().text()).toBe(200);

    const pass = async () => ((await (await call(owner, "GET", "/kitchen")).json()) as {
      lines: { id: string; orderNo: string }[] }).lines;
    const [line] = await lines(o.id);
    expect((await pass()).map((l) => l.id), "a paid dish vanished from the pass").toContain(line!.id);

    const moved = await post(owner, `/kitchen/lines/${line!.id}/served`);
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect((await pass()).map((l) => l.id)).not.toContain(line!.id);
  });
});

describe("the owner's sixth answer: more of a dish the kitchen has goes to the kitchen", () => {
  it("tapping it again after the docket starts a new line for the next one", async () => {
    const o = await open();
    await add(o.id);
    await send(o.id);
    await add(o.id);
    const rows = await lines(o.id);
    expect(rows.map((r) => [Number(r.qty), r.kot_status]),
      "the second plate went onto the sent line").toEqual([[1, "sent"], [1, "pending"]]);
    const again = await send(o.id);
    expect(again.sent).toBe(1);
  });

  it("and + on a sent dish does the same", async () => {
    const o = await open();
    await add(o.id);
    await send(o.id);
    const [line] = await lines(o.id);
    const res = await post(owner, `/till/orders/${o.id}/lines/${line!.id}/qty`, { qty: 3 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await lines(o.id)).map((r) => [Number(r.qty), r.kot_status]))
      .toEqual([[1, "sent"], [2, "pending"]]);
  });
});

describe("D27-119: a dish the kitchen has comes off only for a manager, with a reason", () => {
  it("before the docket, a waiter strikes it freely", async () => {
    const o = await open();
    await add(o.id);
    const [line] = await lines(o.id);
    const res = await post(waiter, `/till/orders/${o.id}/lines/${line!.id}/void`);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("after it, a waiter is refused and nothing is struck", async () => {
    const o = await open();
    await add(o.id);
    await send(o.id);
    const [line] = await lines(o.id);
    const res = await post(waiter, `/till/orders/${o.id}/lines/${line!.id}/void`,
      { reason: "guest changed their mind" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toContain("the hotel manager or the kitchen manager");
    expect((await lines(o.id))[0]!.voided).toBe(false);
  });

  it("a manager needs a reason, and the reason reaches the docket and the day's list", async () => {
    const o = await open();
    await add(o.id);
    const { kotNo } = await send(o.id);
    const [line] = await lines(o.id);

    const bare = await post(owner, `/till/orders/${o.id}/lines/${line!.id}/void`);
    expect(bare.status).toBe(409);
    expect((await lines(o.id))[0]!.voided).toBe(false);

    const ok = await post(owner, `/till/orders/${o.id}/lines/${line!.id}/void`,
      { reason: "RCFIX dropped at the pass" });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await lines(o.id))[0]!.void_reason).toBe("RCFIX dropped at the pass");

    const docket = (await (await call(owner, "GET", `/till/orders/${o.id}/kot/${kotNo}`)).json()) as {
      struck: { name: string; reason: string }[] };
    expect(docket.struck).toEqual([{ name: "Paneer Tikka", qty: 1, reason: "RCFIX dropped at the pass" }]);

    const day = (await (await call(owner, "GET", `/till/day-end?outlet=${OUTLET}`)).json()) as {
      struck: { reason: string; value: number }[] };
    expect(day.struck.find((s) => s.reason === "RCFIX dropped at the pass")?.value).toBe(tikkaPrice);
  });

  it("fewer of a sent dish: a waiter is refused; a manager's leaves a struck line with the reason", async () => {
    const o = await open();
    await add(o.id, 3);
    await send(o.id);
    const [line] = await lines(o.id);

    const refused = await post(waiter, `/till/orders/${o.id}/lines/${line!.id}/qty`, { qty: 2 });
    expect(refused.status).toBe(409);

    const ok = await post(owner, `/till/orders/${o.id}/lines/${line!.id}/qty`,
      { qty: 2, reason: "RCFIX one too many" });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await lines(o.id)).map((r) => [Number(r.qty), r.voided, r.void_reason]))
      .toEqual([[2, false, null], [1, true, "RCFIX one too many"]]);
    expect(((await ok.json()) as Order).lines.filter((l) => !l.voided).map((l) => l.qty)).toEqual([2]);
  });

  it("closing unpaid a bill the kitchen cooked for: a waiter is refused, a manager is not", async () => {
    const o = await open();
    await add(o.id);
    await send(o.id);
    const refused = await post(waiter, `/till/orders/${o.id}/abandon`, { reason: "walked out" });
    expect(refused.status).toBe(409);
    const ok = await post(owner, `/till/orders/${o.id}/abandon`, { reason: "walked out" });
    expect(ok.status, await ok.clone().text()).toBe(200);
  });
});

describe("NA-2: a bill paid wholly in cash is whole rupees", () => {
  /* Cash only once the day is open, its float counted (D27-190). */
  let putAway: () => Promise<void>;
  beforeAll(async () => { putAway = await openTillDay("5EL", OUTLET); });
  afterAll(async () => { await putAway(); });

  it("rounds the cash, with a Round off line; card stays exact", async () => {
    const cash = await open();
    const exact = (await add(cash.id, 1, papad)).payable;
    expect(exact % 1, "the test needs a bill with paise").not.toBe(0);
    const res = await post(owner, `/till/orders/${cash.id}/settle`, { method: "cash" });
    expect(res.status, await res.clone().text()).toBe(200);
    const [t] = await sql<{ amount: string }>(
      "select amount::text from pos_order_tenders where order_id = $1", [cash.id]);
    expect(Number(t!.amount)).toBe(Math.round(exact));
    const [o] = await sql<{ round_off: string }>("select round_off::text from pos_orders where id = $1", [cash.id]);
    expect(Number(o!.round_off)).toBeCloseTo(Math.round(exact) - exact, 2);

    const card = await open();
    await add(card.id, 1, papad);
    const settled = await post(owner, `/till/orders/${card.id}/settle`, { method: "card" });
    const [c] = await sql<{ amount: string }>(
      "select amount::text from pos_order_tenders where order_id = $1", [card.id]);
    expect(Number(c!.amount)).toBe(((await settled.json()) as Order).payable);
    expect(Number(c!.amount)).toBe(exact);
  });
});

describe("POS-3: a typed table is the floor's table", () => {
  it("opens on table RC1, and a second bill on it is refused", async () => {
    const o = await open("rc1");
    const [row] = await sql<{ table_id: string | null; table_ref: string }>(
      "select table_id::text, table_ref from pos_orders where id = $1", [o.id]);
    expect(row!.table_id, "typed 'rc1' left the floor's RC1 showing Free").not.toBeNull();
    expect(row!.table_ref).toBe("RC1");

    const second = await post(owner, "/till/orders", { outlet: OUTLET, table: "RC1" });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { reason: string }).reason).toContain("already has");
    await post(owner, `/till/orders/${o.id}/abandon`, { reason: "test done" });
  });
});

describe("X-2: an order's phone number", () => {
  it("refuses one that is not a phone", async () => {
    const o = await open();
    const res = await call(owner, "PATCH", `/till/orders/${o.id}`, { customerPhone: "abc" });
    expect(res.status).toBe(409);
    const [row] = await sql<{ p: string | null }>("select customer_phone as p from pos_orders where id = $1", [o.id]);
    expect(row!.p).toBeNull();
  });
});

describe("D27-118: a closed restaurant day takes no new bill or payment", () => {
  it("refuses opening a bill once the day's drawer is closed", async () => {
    const [bd] = await sql<{ d: string }>("select business_date::text as d from hotels where code = '5EL'");
    // Everything above is settled or closed; what is left open is closed unpaid first.
    await sql(`update pos_orders set status = 'abandoned', abandoned_reason = 'RCFIX'
                where status = 'open' and outlet_id = (select id from pos_outlets where code = $1)`, [OUTLET]);
    await sql(`insert into pos_day_ends (hotel_id, outlet_id, business_date, counted_cash, closed_by, closed_at)
               select hotel_id, id, $2::date, 0, $3, now() from pos_outlets where code = $1`,
      [OUTLET, bd!.d, owner]);
    const res = await post(owner, "/till/orders", { outlet: OUTLET });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain("closed");
    const batch = await post(owner, "/till/orders/batch",
      { outlet: OUTLET, lines: [{ itemId: tikka, qty: 1 }] });
    expect(batch.status).toBe(409);
  });
});
