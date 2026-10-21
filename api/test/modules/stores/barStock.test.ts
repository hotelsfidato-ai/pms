import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import type { ReportDoc } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   BAR STOCK (the owner's D27-354, 21 October)

   What each bar dish takes is set once - proposed from the names, saved
   by whoever may edit the Store. When a line is SENT, migration 235's
   trigger takes it off the bar's store: 60 ml of a 750 ml bottle is 0.08
   of it, a NIP one 180 ml bottle, a beer one bottle. A drink struck after
   the bar had it stays off, as poured; a dish with nothing set takes
   nothing and the Bar stock report says so. The waiter who sends it needs
   no stock rights. The report: opened, bought, sold, closing. The daily
   sheet (the bar register, 21 October evening): the sells split NIP / 30 /
   60 / 90 ml, the rate and the amount billed; the bar manager counts from
   it; its look is the GM's setting.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "BARSTK";
let gm = "";
let waiter = "";
let barman = "";
let hotel = "";
let blue = "";
let lager = "";
const size: Record<string, string> = {};
let orderId = "";
let businessDate = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Dish = { itemId: string; item: string; variationId: string | null; size: string | null;
  pour: { stockItemId: string; ml: number | null; units: number | null } | null;
  proposed: { stockItemId: string; ml: number | null; units: number | null } | null };
const onHand = async (name: string) => Number((await sql<{ n: string }>(
  `select app.stock_on_hand(i.id, l.id)::text as n from stock_items i, locations l
    where i.name = $1 and l.hotel_id = i.hotel_id and l.is_bar_store`, [name]))[0]!.n);

beforeAll(async () => {
  hotel = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
  businessDate = (await sql<{ d: string }>("select app.business_date($1)::text as d", [hotel]))[0]!.d;
  const person = async (email: string, name: string, role: string) => {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`, [email, name]);
    await sql(`insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)
               on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, hotel, role]);
    return s!.id;
  };
  gm = await person("barstk-gm@fidato.in", "BARSTK Manager", "gm");
  waiter = await person("barstk-waiter@fidato.in", "BARSTK Waiter", "pos");
  barman = await person("barstk-bar@fidato.in", "BARSTK Bar Manager", "bar");

  /* A whisky with three sizes, and a beer with none, in a bar section. */
  const [cat] = await sql<{ id: string }>(
    `insert into pos_menu_categories (hotel_id, name, tax_kind) values ($1, $2, 'bar') returning id::text`,
    [hotel, `${TAG} Whisky`]);
  blue = (await sql<{ id: string }>(
    `insert into pos_menu_items (hotel_id, category_id, name, price) values ($1, $2, $3, 300) returning id::text`,
    [hotel, cat!.id, `${TAG} Blue`]))[0]!.id;
  for (const label of ["30 ml", "60 ml", "NIP"]) {
    size[label] = (await sql<{ id: string }>(
      `insert into pos_item_variations (hotel_id, item_id, label, price) values ($1, $2, $3, 100) returning id::text`,
      [hotel, blue, label]))[0]!.id;
  }
  lager = (await sql<{ id: string }>(
    `insert into pos_menu_items (hotel_id, category_id, name, price) values ($1, $2, $3, 270) returning id::text`,
    [hotel, cat!.id, `${TAG} Lager`]))[0]!.id;

  /* The drinks, into the bar's store through a bar bill, as printed. */
  const bill = await call(gm, "POST", "/bar/purchases", {
    supplier: `${TAG} Wines`, billNo: "S-1", billDate: businessDate, total: 6560,
    lines: [
      { newDrink: { name: `${TAG} Blue 750 ml`, unit: "bottle", sizeMl: 750 }, perCase: 12, cases: 0, bottles: 6, ratePerCase: 6240 },
      { newDrink: { name: `${TAG} Blue 180 ml`, unit: "bottle", sizeMl: 180 }, perCase: 48, cases: 0, bottles: 4, ratePerCase: 6720 },
      { newDrink: { name: `${TAG} Lager`, unit: "bottle", sizeMl: 650 }, perCase: 12, cases: 2, bottles: 0, ratePerCase: 1440 },
    ],
  });
  expect(bill.status, await bill.clone().text()).toBe(200);
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table stock_movements disable trigger stock_movements_append_only");
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("alter table stock_count_lines disable trigger stock_count_lines_append_only");
    await db.query("delete from stock_count_lines where item_id in (select id from stock_items where name like $1)", [`${TAG}%`]);
    await db.query("delete from bar_purchase_lines where item_id in (select id from stock_items where name like $1)", [`${TAG}%`]);
    await db.query(`delete from stock_movements where item_id in (select id from stock_items where name like $1)`, [`${TAG}%`]);
    await db.query("delete from bar_pours where item_id in (select id from pos_menu_items where name like $1)", [`${TAG}%`]);
    await db.query("delete from pos_order_lines where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from bar_purchases where supplier like $1", [`${TAG}%`]);
    await db.query("delete from stock_items where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_menu_items where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_menu_categories where name like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter, barman]]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table stock_count_lines enable trigger stock_count_lines_append_only");
    await db.query("alter table stock_movements enable trigger stock_movements_append_only");
    await db.end();
  }
  await closePool();
});

describe("bar stock (D27-354)", () => {
  it("proposes what each dish takes from the names, and saves what is chosen - not a waiter", async () => {
    const res = await call(gm, "GET", "/bar/pours");
    expect(res.status, await res.clone().text()).toBe(200);
    const { dishes, drinks } = (await res.json()) as { dishes: Dish[]; drinks: { id: string; name: string }[] };
    const drink = (name: string) => drinks.find((d) => d.name === name)!.id;
    const mine = (item: string, s: string | null) => dishes.find((d) => d.item === item && d.size === s)!;
    expect(mine(`${TAG} Blue`, "60 ml").proposed).toEqual({ stockItemId: drink(`${TAG} Blue 750 ml`), ml: 60, units: null });
    expect(mine(`${TAG} Blue`, "NIP").proposed).toEqual({ stockItemId: drink(`${TAG} Blue 180 ml`), ml: null, units: 1 });
    expect(mine(`${TAG} Lager`, null).proposed).toEqual({ stockItemId: drink(`${TAG} Lager`), ml: null, units: 1 });

    type Chosen = { itemId: string; variationId: string | null; stockItemId: string; ml: number | null; units: number | null };
    const chosen: Chosen[] = [
      ...["60 ml", "NIP"].map((s) => ({ itemId: blue, variationId: size[s]!, ...mine(`${TAG} Blue`, s).proposed! })),
      { itemId: lager, variationId: null, ...mine(`${TAG} Lager`, null).proposed! },
    ];
    expect((await call(waiter, "PUT", "/bar/pours", { pours: chosen })).status).toBe(403);
    const saved = await call(gm, "PUT", "/bar/pours", { pours: chosen });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const after = (await (await call(gm, "GET", "/bar/pours")).json()) as { dishes: Dish[] };
    expect(after.dishes.find((d) => d.item === `${TAG} Blue` && d.size === "60 ml")!.pour)
      .toEqual({ stockItemId: drink(`${TAG} Blue 750 ml`), ml: 60, units: null });
  });

  it("the waiter sends the round: each drink comes off the bar's store, and the 30 ml with nothing set takes nothing", async () => {
    const opened = await call(waiter, "POST", "/till/orders", { outlet: "REST", table: `${TAG} 1` });
    expect(opened.status, await opened.clone().text()).toBe(200);
    orderId = ((await opened.json()) as { id: string }).id;
    const put = (name: string, item: string, variation: string | null, qty: number) => sql(
      `insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price, tax_rate, added_by)
       values ($1, $2, $3, $4, $5, $6, 100, 18, $7)`, [orderId, hotel, item, variation, name, qty, waiter]);
    await put(`${TAG} Blue (60 ml)`, blue, size["60 ml"]!, 2);
    await put(`${TAG} Blue (NIP)`, blue, size["NIP"]!, 1);
    await put(`${TAG} Lager`, lager, null, 3);
    await put(`${TAG} Blue (30 ml)`, blue, size["30 ml"]!, 1);

    const sent = await call(waiter, "POST", `/till/orders/${orderId}/kot`, {});
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(await onHand(`${TAG} Blue 750 ml`), "two 60 ml pegs: 0.16 of a 750 ml bottle").toBeCloseTo(5.84, 3);
    expect(await onHand(`${TAG} Blue 180 ml`)).toBeCloseTo(3, 3);
    expect(await onHand(`${TAG} Lager`)).toBeCloseTo(21, 3);
    const [n] = await sql<{ n: number }>(
      "select count(*)::int as n from stock_movements where pos_line_id in (select id from pos_order_lines where order_id = $1)",
      [orderId]);
    expect(n!.n, "one issue per dish set up, none for the 30 ml").toBe(3);

    /* Sent again (a KOT reprint, the next round): nothing taken twice. */
    expect((await call(waiter, "POST", `/till/orders/${orderId}/kot`, {})).status).toBeLessThan(500);
    expect(await onHand(`${TAG} Lager`)).toBeCloseTo(21, 3);
  });

  it("struck after the bar had them, the pegs stay off the stock, as poured", async () => {
    const [peg] = await sql<{ id: string }>(
      "select id::text from pos_order_lines where order_id = $1 and name = $2", [orderId, `${TAG} Blue (60 ml)`]);
    const struck = await call(gm, "POST", `/till/orders/${orderId}/lines/${peg!.id}/void`, { reason: "spilt" });
    expect(struck.status, await struck.clone().text()).toBe(200);
    expect(await onHand(`${TAG} Blue 750 ml`)).toBeCloseTo(5.84, 3);
  });

  it("the Bar stock report: opened, bought, sold, closing, by dish, not set up, struck, and the bill", async () => {
    const res = await call(gm, "GET", `/reports/bar-stock?asOn=${businessDate}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const doc = (await res.json()) as ReportDoc;
    const section = (key: string) => doc.sections.find((s) => s.key === key)!;
    const line = (key: string, first: string) => section(key).rows.find((r) => Object.values(r.cells)[0] === first)!.cells;
    expect(line("bar-stock", `${TAG} Blue 750 ml`)).toMatchObject({
      opening: "0", purchased: "6", sold: "0 + 120 ml", closing: "5 + 630 ml" });
    expect(line("bar-stock", `${TAG} Lager`)).toMatchObject({ purchased: "24", sold: "3", closing: "21" });
    expect(line("bar-sold", `${TAG} Blue (NIP)`)).toMatchObject({ qty: 1, drink: `${TAG} Blue 180 ml`, took: "1" });
    expect(line("bar-not-set", `${TAG} Blue (30 ml)`)).toMatchObject({ qty: 1 });
    expect(line("bar-struck", `${TAG} Blue (60 ml)`)).toMatchObject({ reason: "spilt" });
    expect(line("bar-bills", `${TAG} Wines`)).toMatchObject({ bill: "S-1", drinks: 3 });
  });

  it("the daily sheet: grouped by section, the sells split by size, the rate and what was billed - not for a waiter", async () => {
    expect((await call(waiter, "GET", "/bar/sheet")).status).toBe(403);
    const res = await call(barman, "GET", "/bar/sheet");
    expect(res.status, await res.clone().text()).toBe(200);
    type Drink = { name: string; poured: boolean; received: number; sold: number; closing: number;
      sell: { nip: number; p30: number; p60: number; p90: number; ml: number }; rate: number | null; amount: number | null };
    const sheet = (await res.json()) as { date: string; businessDate: string; format: string; mayCount: boolean;
      maySetFormat: boolean; groups: { section: string; drinks: Drink[] }[] };
    expect([sheet.date, sheet.format, sheet.mayCount, sheet.maySetFormat]).toEqual([businessDate, "paper", true, false]);
    const mine = sheet.groups.find((g) => g.section === `${TAG} Whisky`)!.drinks;
    const at = (name: string) => mine.find((d) => d.name === name)!;
    /* Two 60 ml pegs: 120 ml of the 750, struck after - off the stock, not billed. */
    expect(at(`${TAG} Blue 750 ml`)).toMatchObject({
      poured: true, received: 6, sold: 0.16, closing: 5.84, sell: { nip: 0, p30: 0, p60: 2, p90: 0, ml: 120 }, amount: null });
    /* The NIP: one whole bottle, at the NIP's price. */
    expect(at(`${TAG} Blue 180 ml`)).toMatchObject({ sell: { nip: 1, p30: 0, p60: 0, p90: 0, ml: 0 }, rate: 100, amount: 100 });
    expect(at(`${TAG} Lager`)).toMatchObject({ poured: false, received: 24, sold: 3, closing: 21, rate: 270, amount: 300 });
  });

  it("the bar manager counts the bar from the sheet; a book that moved is refused", async () => {
    const [beer] = await sql<{ id: string }>("select id::text from stock_items where name = $1", [`${TAG} Lager`]);
    const stale = await call(barman, "POST", "/bar/count", { lines: [{ itemId: beer!.id, book: 25, counted: 20 }] });
    expect(((await stale.json()) as { reason: string }).reason)
      .toBe(`${TAG} Lager moved in Bar store since the count was opened - count it again. Nothing was saved.`);
    const counted = await call(barman, "POST", "/bar/count", { lines: [{ itemId: beer!.id, book: 21, counted: 20 }] });
    expect(counted.status, await counted.clone().text()).toBe(200);
    expect(await onHand(`${TAG} Lager`)).toBeCloseTo(20, 3);
    const sheet = (await (await call(barman, "GET", "/bar/sheet")).json()) as {
      groups: { drinks: { name: string; counted: number | null; countBook: number | null }[] }[] };
    expect(sheet.groups.flatMap((g) => g.drinks).find((d) => d.name === `${TAG} Lager`))
      .toMatchObject({ counted: 20, countBook: 21 });
  });

  it("how the sheet looks is the GM's setting, not the bar manager's", async () => {
    expect((await call(barman, "PUT", "/bar/sheet-format", { format: "simple" })).status).toBe(403);
    expect((await call(gm, "PUT", "/bar/sheet-format", { format: "simple" })).status).toBe(200);
    expect(((await (await call(barman, "GET", "/bar/sheet")).json()) as { format: string }).format).toBe("simple");
    expect((await call(gm, "PUT", "/bar/sheet-format", { format: "paper" })).status).toBe(200);
  });
});
