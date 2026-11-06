import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   THE RESTAURANT'S FOUR (D27-383 item 9, built under D27-396)

   1. A table booked for somebody not staying (263): taken by a person,
      confirmed as it is made; on the night arrived, seated (which opens the
      table's bill), a no-show once its time has come, or cancelled.
   2. A voluntary service charge (264): off unless the GM sets a rate; on a
      bill only when ticked with the guest's agreement; taxed with the food;
      a paid bill keeps it. A tip, with the payment: no sale, not taxed, in
      the tin when it is cash.
   3. Coupons (265): a promotion with a code, dates, a use limit and a least
      bill - each refused in a sentence, and by the database behind it.
   4. Profit per dish: the recipe at the Store's average cost; a dash
      (null) for a dish with no recipe or an unpriced ingredient.

   Every refusal is seen here. Everything is tagged and removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "RXTEST";
const who: Record<"owner" | "gm" | "waiter" | "housekeeper", string> = { owner: "", gm: "", waiter: "", housekeeper: "" };
let hotel = "";
let today = "";
/** The hotel's business date: what a bill, a coupon and a sale belong to. */
let bd = "";
let tikka = "";
let manchurian = "";
let section = "";
const table: Record<string, string> = {};
let putAwayTillDay: () => Promise<void>;

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (as: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method, headers: { "x-dev-staff-id": as, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const post = (as: string, path: string, body: unknown = {}) => call(as, "POST", path, body);
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

interface Order {
  id: string; status: string; net: number; discount: number; taxable: number; tax: number;
  payable: number; serviceChargePct: number | null; serviceCharge: number;
  tip: number | null; tipMethod: string | null; couponCode: string | null;
  covers: number | null; customerName: string | null;
  lines: { id: string; name: string; taxRate: number }[];
  taxes: { rate: number; tax: number }[];
}

/** An open bill with these dishes on it, not sent. */
async function bill(name: string, dishes: string[] = [tikka]): Promise<Order> {
  const opened = await post(who.owner, "/till/orders", { outlet: "REST", table: `${TAG} ${name}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  for (const itemId of dishes) {
    const res = await post(who.owner, `/till/orders/${id}/lines`, { itemId, qty: 1 });
    expect(res.status, await res.clone().text()).toBe(200);
  }
  return (await (await call(who.owner, "GET", `/till/orders/${id}`)).json()) as Order;
}

const dayEnd = async () => (await (await call(who.gm, "GET", "/till/day-end")).json()) as {
  cash: { expected: number }; tips: { cash: number; card: number; upi: number; total: number };
  serviceCharge: { bills: number; amount: number };
};

beforeAll(async () => {
  hotel = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
  today = (await sql<{ d: string }>("select to_char(now() at time zone timezone, 'YYYY-MM-DD') as d from hotels where id = $1", [hotel]))[0]!.d;
  who.owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  bd = (await sql<{ d: string }>("select app.business_date($1)::text as d", [hotel]))[0]!.d;
  for (const [key, role] of [["gm", "gm"], ["waiter", "pos"], ["housekeeper", "housekeeping"]] as const) {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`rxtest-${key}@fidato.in`, `${TAG} ${key}`]);
    await sql(`insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)
               on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, hotel, role]);
    who[key] = s!.id;
  }
  const menu = (await (await call(who.owner, "GET", "/till/menu")).json()) as
    { categories: { items: { id: string; name: string }[] }[] };
  const dish = (n: string) => menu.categories.flatMap((c) => c.items).find((i) => i.name === n)!.id;
  tikka = dish("Paneer Tikka");
  manchurian = dish("Veg Manchurian");
  section = (await sql<{ id: string }>(
    `insert into pos_sections (hotel_id, outlet_id, name)
     select hotel_id, id, $1 from pos_outlets where hotel_id = $2 and code = 'REST' returning id::text`,
    [`${TAG} Garden`, hotel]))[0]!.id;
  for (const label of ["T1", "T2"]) {
    table[label] = (await sql<{ id: string }>(
      "insert into pos_tables (hotel_id, section_id, label) values ($1, $2, $3) returning id::text",
      [hotel, section, `${TAG}${label}`]))[0]!.id;
  }
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("update pos_outlets set service_charge_pct = null where hotel_id = $1 and code = 'REST'", [hotel]);
    await db.query("delete from table_bookings where hotel_id = $1 and (diner_name like $2 or table_id = any($3::uuid[]))",
      [hotel, `${TAG}%`, Object.values(table)]);
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table stock_movements disable trigger stock_movements_append_only");
    const mine = "select id from pos_orders where table_ref like $1 or table_id = any($2::uuid[])";
    await db.query(`delete from stock_movements where pos_line_id in
                      (select id from pos_order_lines where order_id in (${mine}))`, [`${TAG}%`, Object.values(table)]);
    await db.query(`delete from pos_order_lines where order_id in (${mine})`, [`${TAG}%`, Object.values(table)]);
    await db.query(`delete from pos_order_tenders where order_id in (${mine})`, [`${TAG}%`, Object.values(table)]);
    await db.query(`delete from vat_bills where pos_order_id in (${mine})`, [`${TAG}%`, Object.values(table)]);
    await db.query(`delete from pos_orders where id in (${mine})`, [`${TAG}%`, Object.values(table)]);
    await db.query("delete from pos_promotions where code like 'RX%'");
    await db.query("delete from recipe_lines where stock_item_id in (select id from stock_items where name like $1)", [`${TAG}%`]);
    await db.query("delete from stock_movements where item_id in (select id from stock_items where name like $1)", [`${TAG}%`]);
    await db.query("delete from stock_items where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_menu_items where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_menu_categories where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_tables where id = any($1::uuid[])", [Object.values(table)]);
    await db.query("delete from pos_sections where id = $1", [section]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[who.gm, who.waiter, who.housekeeper]]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table stock_movements enable trigger stock_movements_append_only");
    await db.end();
  }
  await closePool();
});

/* ── 1 · Outside diners ──────────────────────────────────────────────── */

describe("a table booked for somebody not staying", () => {
  const book = (as: string, over: Record<string, unknown> = {}) => post(as, "/table-bookings", {
    name: `${TAG} Mehta`, phone: "98765 43210", party: 4, date: today, time: "23:30",
    note: "Window, please", ...over,
  });

  it("refuses what is missing or wrong, in a sentence, and the housekeeper", async () => {
    expect(await reason(await book(who.waiter, { name: " " }))).toBe("Whose booking is it? Type the name.");
    expect(await reason(await book(who.waiter, { phone: "" }))).toBe("A phone number, so the restaurant can call them.");
    expect(await reason(await book(who.waiter, { phone: "12345" }))).toMatch(/is not a phone number/);
    expect(await reason(await book(who.waiter, { party: 0 }))).toMatch(/^How many people: 1 to 20/);
    expect(await reason(await book(who.waiter, { date: "2020-01-01" }))).toBe("That day has gone. Book today or a day to come.");
    expect(await reason(await book(who.waiter, { time: "25:00" }))).toBe("Which day, and what time?");
    expect(await reason(await book(who.waiter, { tableId: "00000000-0000-0000-0000-000000000000" })))
      .toBe("That table is not one of this restaurant's.");
    expect((await book(who.housekeeper)).status).toBe(403);
  });

  it("is confirmed as it is taken, listed on its day with its phone and area, and marked arrived once", async () => {
    const made = await book(who.waiter, { sectionId: section });
    expect(made.status, await made.clone().text()).toBe(200);
    const { id } = (await made.json()) as { id: string };
    const list = (await (await call(who.waiter, "GET", `/table-bookings?date=${today}`)).json()) as {
      bookings: { id: string; status: string; outside: boolean; phone: string; guest: string;
        section: { name: string } | null; answeredBy: string; party: number }[];
    };
    const b = list.bookings.find((x) => x.id === id)!;
    expect(b).toMatchObject({ status: "confirmed", outside: true, phone: "98765 43210", guest: `${TAG} Mehta`,
      section: { name: `${TAG} Garden` }, answeredBy: `${TAG} waiter`, party: 4 });

    expect((await post(who.waiter, `/table-bookings/${id}/arrive`)).status).toBe(200);
    expect(await reason(await post(who.waiter, `/table-bookings/${id}/arrive`))).toBe("This booking is arrived already.");
    /* Arrived is not a no-show. */
    expect(await reason(await post(who.waiter, `/table-bookings/${id}/no-show`))).toBe("This booking is arrived already.");
  });

  it("seated opens the table's bill with the party and the name - never on a busy table", async () => {
    const { id } = (await (await book(who.waiter, { tableId: table["T1"] })).json()) as { id: string };
    const busy = await post(who.owner, "/till/orders", { outlet: "REST", tableId: table["T2"] });
    expect(busy.status).toBe(200);
    expect(await reason(await post(who.waiter, `/table-bookings/${id}/seat`, { tableId: table["T2"] })))
      .toMatch(/already has .* running on it\.$/);
    expect(await reason(await post(who.waiter, `/table-bookings/${id}/seat`, {}))).toBe("Which table are they seated at?");

    const seated = await post(who.waiter, `/table-bookings/${id}/seat`, { tableId: table["T1"] });
    expect(seated.status, await seated.clone().text()).toBe(200);
    const { orderId } = (await seated.json()) as { orderId: string };
    const order = (await (await call(who.waiter, "GET", `/till/orders/${orderId}`)).json()) as Order & { table: string };
    expect([order.status, order.covers, order.customerName, order.table]).toEqual(["open", 4, `${TAG} Mehta`, `${TAG}T1`]);
    const [row] = await sql<{ status: string; order_id: string }>(
      "select status, order_id::text from table_bookings where id = $1", [id]);
    expect(row).toEqual({ status: "seated", order_id: orderId });
    expect(await reason(await post(who.waiter, `/table-bookings/${id}/cancel`))).toBe("This booking is seated already.");
  });

  it("a no-show only once its time has come; cancelled with a reason", async () => {
    const later = (await (await book(who.waiter, { date: "2099-01-01" })).json()) as { id: string };
    expect(await reason(await post(who.waiter, `/table-bookings/${later.id}/no-show`)))
      .toBe("They are booked for 23:30: a no-show is marked once that time has come.");
    const [past] = await sql<{ id: string }>(
      `insert into table_bookings (hotel_id, outlet_id, diner_name, diner_phone, party, at, status)
       select hotel_id, id, $2, '9876543210', 2, now() - interval '1 hour', 'confirmed'
         from pos_outlets where hotel_id = $1 and code = 'REST' returning id::text`, [hotel, `${TAG} Late`]);
    expect((await post(who.waiter, `/table-bookings/${past!.id}/no-show`)).status).toBe(200);
    expect((await post(who.waiter, `/table-bookings/${later.id}/cancel`, { reason: "Called to cancel" })).status).toBe(200);
    const rows = await sql<{ status: string; answer: string | null }>(
      "select status, answer from table_bookings where id = any($1::uuid[]) order by status", [[past!.id, later.id]]);
    expect(rows).toEqual([{ status: "cancelled", answer: "Called to cancel" }, { status: "no_show", answer: null }]);
  });

  it("a hotel guest's request still waits for an answer before it is seated", async () => {
    const [stay] = await sql<{ id: string }>(
      `select r.id::text from reservations r where r.hotel_id = $1 and r.status in ('confirmed', 'checked_in') limit 1`, [hotel]);
    const [asked] = await sql<{ id: string }>(
      `insert into table_bookings (hotel_id, outlet_id, reservation_id, party, at)
       select hotel_id, id, $2, 2, now() + interval '1 hour' from pos_outlets where hotel_id = $1 and code = 'REST'
       returning id::text`, [hotel, stay!.id]);
    expect(await reason(await post(who.waiter, `/table-bookings/${asked!.id}/seat`, { tableId: table["T2"] })))
      .toBe("This booking is still waiting for an answer: confirm it first, or decline it.");
    await sql("delete from table_bookings where id = $1", [asked!.id]);
  });
});

/* ── 2 · Service charge and tips ─────────────────────────────────────── */

describe("a voluntary service charge", () => {
  it("is off until the GM sets a rate, and a rate is 0 to 20%", async () => {
    const b = await bill("sc off");
    expect(await reason(await post(who.waiter, `/till/orders/${b.id}/service-charge`, { on: true, agreed: true })))
      .toBe("This restaurant has no service charge. The GM sets one on Restaurant setup.");
    expect(await reason(await post(who.gm, "/till/setup/service-charge", { percent: 25 })))
      .toBe("A service charge is a percentage above 0 and at most 20, or left blank for none.");
    expect((await post(who.waiter, "/till/setup/service-charge", { percent: 5 })).status).toBe(403);
    expect((await post(who.gm, "/till/setup/service-charge", { percent: 5 })).status).toBe(200);
  });

  it("goes on a bill only with the guest's agreement, after the discount, and is taxed with the food", async () => {
    const b = await bill("sc on");
    expect(await reason(await post(who.waiter, `/till/orders/${b.id}/service-charge`, { on: true })))
      .toBe("A service charge is added only when the guest agrees to pay it: it is voluntary.");
    expect((await post(who.gm, `/till/orders/${b.id}/discount`, { type: "percent", value: 10, reason: "Regular" })).status).toBe(200);
    const res = await post(who.waiter, `/till/orders/${b.id}/service-charge`, { on: true, agreed: true });
    expect(res.status, await res.clone().text()).toBe(200);
    const o = (await res.json()) as Order;
    const rate = o.lines[0]!.taxRate;
    expect(o.serviceChargePct).toBe(5);
    expect(o.serviceCharge).toBe(Math.round((o.net - o.discount) * 5) / 100);
    expect(o.taxable).toBeCloseTo(o.net - o.discount + o.serviceCharge, 2);
    expect(o.tax).toBeCloseTo(Math.round(o.taxable * rate) / 100, 2);
    expect(o.payable).toBeCloseTo(o.taxable + o.tax, 2);
    /* A rate that is not the restaurant's is refused by the database. */
    await expect(sql("update pos_orders set service_charge_pct = 7 where id = $1", [b.id]))
      .rejects.toThrow(/not this restaurant's service charge/);

    const off = (await (await post(who.waiter, `/till/orders/${b.id}/service-charge`, { on: false })).json()) as Order;
    expect([off.serviceChargePct, off.serviceCharge]).toEqual([null, 0]);
  });

  it("stays on a paid bill as it was paid, and shows on Close restaurant day", async () => {
    const before = await dayEnd();
    const b = await bill("sc paid");
    await post(who.waiter, `/till/orders/${b.id}/service-charge`, { on: true, agreed: true });
    const paid = await post(who.waiter, `/till/orders/${b.id}/settle`, { method: "card" });
    expect(paid.status, await paid.clone().text()).toBe(200);
    const o = (await paid.json()) as Order;
    expect(await reason(await post(who.waiter, `/till/orders/${b.id}/service-charge`, { on: false })))
      .toBe("This order is settled and cannot be changed.");
    await expect(sql("update pos_orders set service_charge_pct = null where id = $1", [b.id]))
      .rejects.toThrow(/service charge and tip stay as they were/);
    const after = await dayEnd();
    expect(after.serviceCharge.bills).toBe(before.serviceCharge.bills + 1);
    expect(after.serviceCharge.amount).toBeCloseTo(before.serviceCharge.amount + o.serviceCharge, 2);
  });
});

describe("a tip", () => {
  it("is refused with a room, a split, as nothing, or more than the bill", async () => {
    const b = await bill("tip no");
    expect(await reason(await post(who.waiter, `/till/orders/${b.id}/settle`, { method: "room", room: "101", tip: 50 })))
      .toMatch(/^A tip is taken with a bill paid one way/);
    expect(await reason(await post(who.waiter, `/till/orders/${b.id}/settle`,
      { tenders: [{ method: "cash", amount: 1 }, { method: "card", amount: 1 }], tip: 50 })))
      .toMatch(/^A tip is taken with a bill paid one way/);
    expect(await reason(await post(who.waiter, `/till/orders/${b.id}/settle`, { method: "cash", tip: 0 })))
      .toBe("A tip is an amount above zero, in rupees and paise.");
    expect(await reason(await post(who.waiter, `/till/orders/${b.id}/settle`, { method: "cash", tip: 100000 })))
      .toBe("A tip of ₹1,00,000 is more than the bill. Check the amount.");
    const [o] = await sql<{ status: string }>("select status from pos_orders where id = $1", [b.id]);
    expect(o!.status).toBe("open");
  });

  it("is taken with the payment, outside the bill, and a cash tip is in the tin", async () => {
    const before = await dayEnd();
    const b = await bill("tip cash");
    const res = await post(who.waiter, `/till/orders/${b.id}/settle`, { method: "cash", tip: 50 });
    expect(res.status, await res.clone().text()).toBe(200);
    const o = (await res.json()) as Order;
    expect([o.tip, o.tipMethod]).toEqual([50, "cash"]);
    const [t] = await sql<{ sum: string }>("select sum(amount)::text as sum from pos_order_tenders where order_id = $1", [b.id]);
    expect(Number(t!.sum), "the payment is the bill alone").toBe(o.payable);
    const after = await dayEnd();
    expect(after.tips.cash).toBe(before.tips.cash + 50);
    expect(after.cash.expected).toBeCloseTo(before.cash.expected + o.payable + 50, 2);
    /* Not changed once paid. */
    await expect(sql("update pos_orders set tip = 10 where id = $1", [b.id]))
      .rejects.toThrow(/service charge and tip stay as they were/);
    const [day] = await sql<{ d: string }>("select business_date::text as d from pos_orders where id = $1", [b.id]);
    const list = (await (await call(who.gm, "GET", `/till/bills?date=${day!.d}`)).json()) as
      { bills: { id: string; tip: number | null; tipMethod: string | null }[] };
    expect(list.bills.find((x) => x.id === b.id)).toMatchObject({ tip: 50, tipMethod: "cash" });
  });
});

/* ── 3 · Coupons ─────────────────────────────────────────────────────── */

describe("a coupon", () => {
  const make = (code: string, coupon: Record<string, unknown>, kind = "percent", value = 10) =>
    post(who.gm, "/till/promotions", { code, name: `${TAG} ${code}`, kind, value, coupon });
  const apply = (as: string, id: string, code: string) => post(as, `/till/orders/${id}/promotion`, { code });

  it("is made with its dates, and refused when they make no sense", async () => {
    expect(await reason(await make("RXBAD", { from: bd }))).toBe("From which day, and until which day, is the coupon good?");
    expect(await reason(await make("RXBAD", { from: "2026-12-02", to: "2026-12-01" }))).toBe("The coupon ends before it starts.");
    expect(await reason(await make("RXBAD", { from: bd, to: bd, maxUses: 0 }))).toMatch(/^How many bills may use it/);
    expect(await reason(await make("RXBAD", { from: bd, to: bd, minBill: 100 }, "fixed", 500)))
      .toBe("A coupon cannot take off more than its least bill.");
    for (const [code, coupon] of [
      ["RXONE", { from: bd, to: bd, maxUses: 1, minBill: 100 }],
      ["RXSOON", { from: "2099-01-01", to: "2099-01-31" }],
      ["RXOLD", { from: "2020-01-01", to: "2020-01-31" }],
      ["RXBIG", { from: bd, to: bd, minBill: 600 }],
    ] as const) {
      const res = await make(code, coupon);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    const list = (await (await call(who.gm, "GET", "/till/promotions")).json()) as
      { promotions: { code: string; coupon: { from: string; to: string; maxUses: number | null; minBill: number | null } | null }[] };
    expect(list.promotions.find((p) => p.code === "RXONE")!.coupon).toEqual({ from: bd, to: bd, maxUses: 1, minBill: 100 });
  });

  it("goes on a bill once its limit allows, recorded with the bill; a waiter does not apply it", async () => {
    const first = await bill("coupon 1");
    expect((await apply(who.waiter, first.id, "RXONE")).status).toBe(403);
    const res = await apply(who.gm, first.id, "rxone");
    expect(res.status, await res.clone().text()).toBe(200);
    const o = (await res.json()) as Order;
    expect([o.couponCode, o.discount]).toEqual(["RXONE", Math.round(o.net * 10) / 100]);

    const second = await bill("coupon 2");
    expect(await reason(await apply(who.gm, second.id, "RXONE"))).toBe(`${TAG} RXONE has been used on 1 bill, its limit.`);
    /* The database refuses it behind the till. */
    await expect(sql(`update pos_orders set promotion_id = (select id from pos_promotions where code = 'RXONE') where id = $1`,
      [second.id])).rejects.toThrow(/has been used 1 times, its limit/);
    /* A bill closed unpaid gives its use back. */
    expect((await post(who.owner, `/till/orders/${first.id}/abandon`, { reason: "Walked out" })).status).toBe(200);
    expect((await apply(who.gm, second.id, "RXONE")).status).toBe(200);
  });

  it("is refused before its dates, after them, and under its least bill - at the settle too", async () => {
    const b = await bill("coupon dates", [tikka, manchurian]);
    expect(await reason(await apply(who.gm, b.id, "RXSOON"))).toBe(`${TAG} RXSOON starts on 1 Jan 2099.`);
    expect(await reason(await apply(who.gm, b.id, "RXOLD"))).toBe(`${TAG} RXOLD ended on 31 Jan 2020.`);
    expect(await reason(await apply(who.gm, b.id, "RXNONE"))).toBe("There is no promotion or coupon with the code RXNONE.");
    const small = await bill("coupon small");
    expect(await reason(await apply(who.gm, small.id, "RXBIG")))
      .toBe(`${TAG} RXBIG is for a bill of at least ₹600; this one is ₹320.`);

    expect((await apply(who.gm, b.id, "RXBIG")).status).toBe(200);
    const struck = b.lines.find((l) => l.name === "Veg Manchurian")!;
    expect((await post(who.owner, `/till/orders/${b.id}/lines/${struck.id}/void`, {})).status).toBe(200);
    expect(await reason(await post(who.waiter, `/till/orders/${b.id}/settle`, { method: "card" })))
      .toBe(`${TAG} RXBIG is for a bill of at least ₹600; this one is now ₹320. Take the coupon off, or add to the bill.`);
  });
});

/* ── 4 · Profit per dish ─────────────────────────────────────────────── */

describe("profit per dish", () => {
  let costed = "";
  let bare = "";
  let unpriced = "";

  beforeAll(async () => {
    const [cat] = await sql<{ id: string }>(
      "insert into pos_menu_categories (hotel_id, name, tax_kind) values ($1, $2, 'restaurant') returning id::text",
      [hotel, `${TAG} Mains`]);
    const dish = async (name: string) => (await sql<{ id: string }>(
      "insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate) values ($1, $2, $3, 300, 5) returning id::text",
      [hotel, cat!.id, `${TAG} ${name}`]))[0]!.id;
    [costed, bare, unpriced] = [await dish("Kofta"), await dish("Salad"), await dish("Soup")];
    const stock = async (name: string, cost: number | null) => {
      const [i] = await sql<{ id: string }>(
        "insert into stock_items (hotel_id, name, unit, category) values ($1, $2, 'kg', 'Dairy') returning id::text",
        [hotel, `${TAG} ${name}`]);
      if (cost !== null) {
        await sql(`insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost, moved_by)
                   select $1, $2, l.id, app.business_date($1), 'receipt', 10, $3, $4
                     from locations l where l.hotel_id = $1 and l.kind = 'store' limit 1`, [hotel, i!.id, cost, who.owner]);
      }
      return i!.id;
    };
    const paneer = await stock("Paneer", 100);
    const saffron = await stock("Saffron", null);
    await sql("insert into recipe_lines (hotel_id, item_id, stock_item_id, quantity) values ($1, $2, $3, 0.2)", [hotel, costed, paneer]);
    await sql("insert into recipe_lines (hotel_id, item_id, stock_item_id, quantity) values ($1, $2, $3, 0.1)", [hotel, unpriced, paneer]);
    await sql("insert into recipe_lines (hotel_id, item_id, stock_item_id, quantity) values ($1, $2, $3, 0.01)", [hotel, unpriced, saffron]);
  });

  type Profit = {
    dishes: { itemId: string; price: number; cost: number | null; margin: number | null; marginPct: number | null; noCost: string | null }[];
    sold: { itemId: string; qty: number; sales: number; cost: number | null; margin: number | null }[];
    totals: { sales: number; costedSales: number; cost: number; margin: number; uncostedSales: number };
  };
  const read = async (as: string) => call(as, "GET", `/till/dish-profit?from=${bd}&to=${bd}`);

  it("is the owner's, an Admin's and the GM's, and asks for real dates", async () => {
    expect((await read(who.waiter)).status).toBe(403);
    expect(await reason(await call(who.gm, "GET", "/till/dish-profit?from=bd&to=2026-11-01"))).toBe("Dates are written 2026-11-06.");
    expect(await reason(await call(who.gm, "GET", "/till/dish-profit?from=2026-11-02&to=2026-11-01"))).toBe("The first date is after the last.");
  });

  it("costs a dish from its recipe, and leaves a dash where there is no recipe or no price", async () => {
    const p = (await (await read(who.gm)).json()) as Profit;
    const of = (id: string) => p.dishes.find((d) => d.itemId === id)!;
    expect(of(costed)).toMatchObject({ price: 300, cost: 20, margin: 280, marginPct: 93.3, noCost: null });
    expect(of(bare)).toMatchObject({ cost: null, margin: null, marginPct: null, noCost: "no recipe" });
    expect(of(unpriced)).toMatchObject({ cost: null, margin: null, noCost: "an ingredient has no cost" });
  });

  it("adds up a period's paid sales of each dish at that cost", async () => {
    const b = await bill("profit", [costed, costed, bare]);
    expect((await post(who.waiter, `/till/orders/${b.id}/settle`, { method: "card" })).status).toBe(200);
    const p = (await (await read(who.owner)).json()) as Profit;
    expect(p.sold.find((s) => s.itemId === costed)).toMatchObject({ qty: 2, sales: 600, cost: 40, margin: 560 });
    expect(p.sold.find((s) => s.itemId === bare)).toMatchObject({ qty: 1, sales: 300, cost: null, margin: null });
    expect(p.totals.uncostedSales).toBeGreaterThanOrEqual(300);
  });
});
