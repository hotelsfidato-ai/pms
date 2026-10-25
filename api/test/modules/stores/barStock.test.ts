import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import type { ReportDoc } from "../../../src/modules/reports/index.ts";
import { blockersFor } from "../../../src/modules/night-audit/nightAudit.ts";

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

   TWO PLACES (D27-361): bills go into the Bar store; the counter asks the
   store and the GM or the Inventory Manager approves (never their own ask),
   which moves it; every KOT takes from the counter. A drink is counted as
   it is kept (poured, whole, packet); the closing count of both places
   holds the night audit, unless the GM marks the bar closed; the morning
   count shows a difference. The excise registers FLR-1A/2A/3A and FLR-3 in
   whole bottles, store and counter together.
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
const onHand = async (name: string, place: "store" | "counter" = "counter") => Number((await sql<{ n: string }>(
  `select app.stock_on_hand(i.id, l.id)::text as n from stock_items i, locations l
    where i.name = $1 and l.hotel_id = i.hotel_id and (case when $2 = 'store' then l.is_bar_store else l.is_bar_counter end)`,
  [name, place]))[0]!.n);
const itemId = async (name: string) => (await sql<{ id: string }>("select id::text from stock_items where name = $1", [name]))[0]!.id;
let inventory = "";

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
  inventory = await person("barstk-stores@fidato.in", "BARSTK Inventory", "stores");

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
    await db.query("delete from bar_requests where id in (select request_id from bar_request_lines where item_id in (select id from stock_items where name like $1))", [`${TAG}%`]);
    await db.query("delete from bar_requests where requested_by = any($1::uuid[])", [[gm, barman, inventory]]);
    await db.query("delete from bar_closed_days where hotel_id = $1 and closed_by = any($2::uuid[])", [hotel, [gm]]);
    await db.query("delete from bar_purchase_lines where item_id in (select id from stock_items where name like $1)", [`${TAG}%`]);
    await db.query(`delete from stock_movements where item_id in (select id from stock_items where name like $1)`, [`${TAG}%`]);
    await db.query("delete from bar_pours where item_id in (select id from pos_menu_items where name like $1)", [`${TAG}%`]);
    await db.query("delete from pos_order_lines where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from bar_purchases where supplier like $1", [`${TAG}%`]);
    await db.query("delete from stock_items where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_menu_items where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_menu_categories where name like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter, barman, inventory]]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table stock_count_lines enable trigger stock_count_lines_append_only");
    await db.query("alter table stock_movements enable trigger stock_movements_append_only");
    await db.end();
  }
  await closePool();
});

describe("bar stock (D27-354)", () => {
  it("the counter asks the store; the GM or the Inventory Manager approves - never one's own ask - and it moves", async () => {
    const [b750, b180, beer] = [await itemId(`${TAG} Blue 750 ml`), await itemId(`${TAG} Blue 180 ml`), await itemId(`${TAG} Lager`)];
    expect((await call(waiter, "POST", "/bar/requests", { lines: [{ itemId: beer, quantity: 1 }] })).status).toBe(403);
    expect(((await (await call(barman, "POST", "/bar/requests", { lines: [{ itemId: beer, quantity: 1.5 }] })).json()) as { reason: string }).reason)
      .toBe("Each drink asked for in whole NIPs, bottles or packets, more than none.");
    const asked = await call(barman, "POST", "/bar/requests",
      { lines: [{ itemId: b750, quantity: 3 }, { itemId: b180, quantity: 2 }, { itemId: beer, quantity: 12 }], note: "Friday" });
    expect(asked.status, await asked.clone().text()).toBe(200);
    const ask = ((await asked.json()) as { id: string }).id;
    expect((await call(barman, "POST", `/bar/requests/${ask}/approve`, {})).status, "the bar manager does not approve").toBe(403);

    /* The GM's own ask is somebody else's to approve; a store short of a drink moves nothing. */
    const own = ((await (await call(gm, "POST", "/bar/requests", { lines: [{ itemId: beer, quantity: 100 }] })).json()) as { id: string }).id;
    expect(((await (await call(gm, "POST", `/bar/requests/${own}/approve`, {})).json()) as { reason: string }).reason)
      .toBe("Somebody else approves your own ask.");
    expect(((await (await call(inventory, "POST", `/bar/requests/${own}/approve`, {})).json()) as { reason: string }).reason)
      .toBe(`The store is short: ${TAG} Lager (the store has 24, 100 asked). Nothing was moved.`);
    expect((await call(inventory, "POST", `/bar/requests/${own}/reject`, {})).status, "a rejection says why").toBe(409);
    expect((await call(inventory, "POST", `/bar/requests/${own}/reject`, { note: "Too many" })).status).toBe(200);

    const approved = await call(gm, "POST", `/bar/requests/${ask}/approve`, {});
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect([await onHand(`${TAG} Blue 750 ml`, "store"), await onHand(`${TAG} Blue 750 ml`)]).toEqual([3, 3]);
    expect([await onHand(`${TAG} Lager`, "store"), await onHand(`${TAG} Lager`)]).toEqual([12, 12]);
    expect(((await (await call(gm, "POST", `/bar/requests/${ask}/approve`, {})).json()) as { reason: string }).reason)
      .toBe("This ask was approved already.");

    const list = (await (await call(barman, "GET", "/bar/requests")).json()) as {
      mayApprove: boolean; requests: { id: string; status: string; mine: boolean; lines: { name: string; quantity: number }[] }[] };
    expect(list.mayApprove).toBe(false);
    expect(list.requests.find((r) => r.id === ask)).toMatchObject({ status: "approved", mine: true });
  });

  it("Set up: a drink added and changed by the GM - counted as NIPs, bottles or packets - not by the bar manager", async () => {
    const beer = await itemId(`${TAG} Lager`);
    const lager = { name: `${TAG} Lager`, sizeMl: 650, countAs: "whole", liquor: "beer_strong" };
    expect((await call(barman, "PUT", `/bar/drinks/${beer}`, lager)).status).toBe(403);
    expect((await call(gm, "PUT", `/bar/drinks/${beer}`, lager)).status).toBe(200);
    for (const [name, brand] of [[`${TAG} Blue 750 ml`, `${TAG} Blue`], [`${TAG} Blue 180 ml`, `${TAG} Blue`]] as const) {
      const size = name.includes("750") ? 750 : 180;
      expect((await call(gm, "PUT", `/bar/drinks/${await itemId(name)}`,
        { name, sizeMl: size, countAs: "poured", liquor: "whisky", brand })).status).toBe(200);
    }
    expect(((await (await call(gm, "POST", "/bar/drinks", { name: `${TAG} Gold Flake`, sizeMl: null, countAs: "packet" })).json()) as { reason: string }).reason)
      .toBe(`${TAG} Gold Flake: how many in a packet.`);
    const added = await call(gm, "POST", "/bar/drinks", { name: `${TAG} Gold Flake`, sizeMl: null, countAs: "packet", packSize: 20 });
    expect(added.status, await added.clone().text()).toBe(200);
    const [row] = await sql<{ count_as: string; pack_size: number; unit: string }>(
      "select count_as, pack_size, unit from stock_items where name = $1", [`${TAG} Gold Flake`]);
    expect(row).toEqual({ count_as: "packet", pack_size: 20, unit: "packet" });
  });

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

  it("the waiter sends the round: each drink comes off the counter, and the 30 ml with nothing set takes nothing", async () => {
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
    expect(await onHand(`${TAG} Blue 750 ml`), "two 60 ml pegs: 0.16 of a 750 ml bottle").toBeCloseTo(2.84, 3);
    expect(await onHand(`${TAG} Blue 180 ml`)).toBeCloseTo(1, 3);
    expect(await onHand(`${TAG} Lager`)).toBeCloseTo(9, 3);
    expect(await onHand(`${TAG} Lager`, "store"), "the store is not touched by a sale").toBeCloseTo(12, 3);
    const [n] = await sql<{ n: number }>(
      "select count(*)::int as n from stock_movements where pos_line_id in (select id from pos_order_lines where order_id = $1)",
      [orderId]);
    expect(n!.n, "one issue per dish set up, none for the 30 ml").toBe(3);

    /* Sent again (a KOT reprint, the next round): nothing taken twice. */
    expect((await call(waiter, "POST", `/till/orders/${orderId}/kot`, {})).status).toBeLessThan(500);
    expect(await onHand(`${TAG} Lager`)).toBeCloseTo(9, 3);
  });

  it("struck after the bar had them, the pegs stay off the stock, as poured", async () => {
    const [peg] = await sql<{ id: string }>(
      "select id::text from pos_order_lines where order_id = $1 and name = $2", [orderId, `${TAG} Blue (60 ml)`]);
    const struck = await call(gm, "POST", `/till/orders/${orderId}/lines/${peg!.id}/void`, { reason: "spilt" });
    expect(struck.status, await struck.clone().text()).toBe(200);
    expect(await onHand(`${TAG} Blue 750 ml`)).toBeCloseTo(2.84, 3);
  });

  it("the Bar stock report: the counter and the store, by dish, not set up, struck, the asks and the bill", async () => {
    const res = await call(gm, "GET", `/reports/bar-stock?asOn=${businessDate}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const doc = (await res.json()) as ReportDoc;
    const section = (key: string) => doc.sections.find((s) => s.key === key)!;
    const line = (key: string, first: string) => section(key).rows.find((r) => Object.values(r.cells)[0] === first)!.cells;
    expect(line("bar-counter", `${TAG} Blue 750 ml`)).toMatchObject({
      opening: "0", received: "3", sold: "120 ml", closing: "2 + 630 ml" });
    expect(line("bar-stock", `${TAG} Blue 750 ml`)).toMatchObject({ received: "6", moved: "3", closing: "3" });
    expect(line("bar-counter", `${TAG} Lager`)).toMatchObject({ received: "12", sold: "3", closing: "9" });
    expect(line("bar-asks", `${TAG} Lager`)).toBeTruthy();
    expect(line("bar-sold", `${TAG} Blue (NIP)`)).toMatchObject({ qty: 1, drink: `${TAG} Blue 180 ml`, took: "1" });
    expect(line("bar-not-set", `${TAG} Blue (30 ml)`)).toMatchObject({ qty: 1 });
    expect(line("bar-struck", `${TAG} Blue (60 ml)`)).toMatchObject({ reason: "spilt" });
    expect(line("bar-bills", `${TAG} Wines`)).toMatchObject({ bill: "S-1", drinks: 3 });
  });

  it("the counter's sheet: grouped by section, the sells split by size, the rate and what was billed - not for a waiter", async () => {
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
      poured: true, received: 3, sold: 0.16, closing: 2.84, sell: { nip: 0, p30: 0, p60: 2, p90: 0, ml: 120 }, amount: null });
    /* The NIP: one whole bottle, at the NIP's price. */
    expect(at(`${TAG} Blue 180 ml`)).toMatchObject({ sell: { nip: 1, p30: 0, p60: 0, p90: 0, ml: 0 }, rate: 100, amount: 100 });
    expect(at(`${TAG} Lager`)).toMatchObject({ poured: false, countAs: "whole", received: 12, sold: 3, closing: 9, rate: 270, amount: 300 });

    const store = (await (await call(barman, "GET", "/bar/sheet?place=store")).json()) as {
      place: string; groups: { drinks: { name: string; received: number; moved: number; closing: number }[] }[] };
    expect(store.place).toBe("store");
    expect(store.groups.flatMap((g) => g.drinks).find((d) => d.name === `${TAG} Lager`))
      .toMatchObject({ received: 24, moved: 12, closing: 12 });
  });

  it("the night audit waits for the bar's closing count, counter and store; the count clears it", async () => {
    const pg = new (await import("pg")).default.Client({ connectionString: SUPER });
    await pg.connect();
    const named = async () => {
      const b = (await blockersFor(pg as never, hotel, businessDate)).find((x) => x.id === "bar-not-counted");
      return (b?.rooms ?? []).join(" | ");
    };
    try {
      expect(await named()).toContain(`${TAG} Lager`);
      const beer = await itemId(`${TAG} Lager`);
      const stale = await call(barman, "POST", "/bar/count", { lines: [{ itemId: beer, book: 25, counted: 20 }] });
      expect(((await stale.json()) as { reason: string }).reason)
        .toBe(`${TAG} Lager moved in Bar counter since the count was opened - count it again. Nothing was saved.`);
      const mine = await sql<{ id: string; name: string }>("select id::text, name from stock_items where name like $1", [`${TAG}%`]);
      for (const place of ["counter", "store"] as const) {
        const lines = [];
        for (const d of mine) {
          const book = await onHand(d.name, place);
          if (book === 0) continue;
          lines.push({ itemId: d.id, book, counted: d.name === `${TAG} Lager` && place === "counter" ? 8 : book });
        }
        const counted = await call(barman, "POST", "/bar/count", { place, lines });
        expect(counted.status, await counted.clone().text()).toBe(200);
      }
      expect(await onHand(`${TAG} Lager`)).toBeCloseTo(8, 3);
      expect(await named()).not.toContain(TAG);

      /* The bar closed: the GM's reason, and the audit does not wait at all. */
      expect((await call(barman, "POST", "/bar/closed", { reason: "Dry day" })).status).toBe(403);
      expect((await call(gm, "POST", "/bar/closed", { reason: "" })).status).toBe(409);
      expect((await call(gm, "POST", "/bar/closed", { reason: "Dry day" })).status).toBe(200);
      expect((await blockersFor(pg as never, hotel, businessDate)).some((x) => x.id === "bar-not-counted")).toBe(false);
      expect((await call(gm, "POST", "/bar/closed/undo", {})).status).toBe(200);
    } finally {
      await pg.end();
    }
  });

  it("the morning count: a difference from last night's count shows on the sheet", async () => {
    const beer = await itemId(`${TAG} Lager`);
    const morning = await call(barman, "POST", "/bar/count",
      { place: "counter", moment: "morning", lines: [{ itemId: beer, book: 8, counted: 7 }] });
    expect(morning.status, await morning.clone().text()).toBe(200);
    const sheet = (await (await call(barman, "GET", "/bar/sheet")).json()) as {
      groups: { drinks: { name: string; counted: number | null; countBook: number | null; morning: number | null; morningBook: number | null }[] }[] };
    expect(sheet.groups.flatMap((g) => g.drinks).find((d) => d.name === `${TAG} Lager`))
      .toMatchObject({ counted: 8, countBook: 9, morning: 7, morningBook: 8 });
  });

  it("FORM F.L.R.-1A/2A/3A and F.L.R.-3: whole bottles, store and counter together, an opened NIP sold", async () => {
    const daily = (await (await call(gm, "GET", `/reports/flr-daily?asOn=${businessDate}`)).json()) as ReportDoc;
    const whisky = daily.sections.find((x) => x.key === "flr-whisky")!;
    expect(whisky.rows.find((r) => r.cells["brand"] === `${TAG} Blue`)!.cells).toMatchObject({
      opening_750: 0, receipts_750: 6, sales_750: 1, closing_750: 5,
      opening_180: 0, receipts_180: 4, sales_180: 1, closing_180: 3, closing_1000: null });
    const beer = daily.sections.find((x) => x.key === "flr-beer_strong")!;
    /* 24 came; 3 sold, one short at the closing count, one at the morning count: 19 left. */
    expect(beer.rows.find((r) => r.cells["brand"] === `${TAG} Lager`)!.cells)
      .toMatchObject({ receipts_650: 24, sales_650: 5, closing_650: 19 });

    const monthly = (await (await call(gm, "GET", `/reports/flr-monthly?month=${businessDate.slice(0, 7)}&asOn=${businessDate}`)).json()) as ReportDoc;
    const foot = (key: string, label: string) => monthly.sections.find((x) => x.key === key)!
      .rows.find((r) => r.cells["day"] === label)!.cells;
    expect(foot("flr3-received", "Total")).toMatchObject({ spirits_indian_750: 6, spirits_indian_180: 4, fermented_650: 24 });
    expect(foot("flr3-closing", "Closing Balance")).toMatchObject({ spirits_indian_750: 5, fermented_650: 19 });
  });

  it("how the sheet looks is the GM's setting, not the bar manager's", async () => {
    expect((await call(barman, "PUT", "/bar/sheet-format", { format: "simple" })).status).toBe(403);
    expect((await call(gm, "PUT", "/bar/sheet-format", { format: "simple" })).status).toBe(200);
    expect(((await (await call(barman, "GET", "/bar/sheet")).json()) as { format: string }).format).toBe("simple");
    expect((await call(gm, "PUT", "/bar/sheet-format", { format: "paper" })).status).toBe(200);
  });
});
