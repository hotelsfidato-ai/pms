import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN'S STOCK (the owner's D27-373 and D27-374, 28 October)

   Recipes: what one of a dish takes from the kitchen store, in each Store
   item's unit; a size, a side and a numbered add-on take their own lines on
   top of the dish's (none: nothing extra). Every KOT takes them off the
   kitchen store (migration 253's trigger), and always goes - an item below
   zero is shown red. A dish with no recipe takes nothing and is listed. A
   dish struck before its KOT took nothing; struck after (or fewer of it),
   it stays used and counts as wastage with the strike's reason. The daily
   sheet adds up; the owner, an Admin, the GM and the Inventory Manager set
   recipes, mark the store and count; the kitchen reads. Bar stock's switch
   does not touch any of it.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "KITSTK";
let hotel = "";
let businessDate = "";
const who: Record<string, string> = {};
let store = "";
let barStore = "";
let tikka = "";
let dal = "";
const size: Record<string, string> = {};
let onions = "";
let kebab = "";
const item: Record<string, string> = {};
let orderId = "";
const line: Record<string, string> = {};

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (as: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method, headers: { "x-dev-staff-id": as, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;
const onHand = async (name: string) => Number((await sql<{ n: string }>(
  "select app.stock_on_hand($1, $2)::text as n", [item[name], store]))[0]!.n);

type SheetItem = { name: string; opening: number; received: number; movedIn: number; movedOut: number;
  used: number; wasted: number; corrected: number; closing: number; counted: number | null;
  countBook: number | null; onHand: number };
type Sheet = { store: { id: string } | null; mayKeep: boolean; mayCount: boolean; items: SheetItem[];
  wasted: { item: string; quantity: number; note: string | null }[] };

beforeAll(async () => {
  hotel = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
  businessDate = (await sql<{ d: string }>("select app.business_date($1)::text as d", [hotel]))[0]!.d;
  for (const role of ["gm", "stores", "kitchen_manager", "chef", "pos", "front_desk", "hotel_manager"]) {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`kitstk-${role}@fidato.in`, `${TAG} ${role}`]);
    await sql(`insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)
               on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, hotel, role]);
    who[role] = s!.id;
  }
  store = (await sql<{ id: string }>(
    `insert into locations (hotel_id, name, kind) values ($1, $2, 'store') returning id::text`,
    [hotel, `${TAG} Kitchen`]))[0]!.id;
  barStore = (await sql<{ id: string }>(
    "select id::text from locations where hotel_id = $1 and is_bar_store", [hotel]))[0]?.id ?? "";

  for (const [name, unit, category] of [["Paneer", "kg", "Dairy"], ["Butter", "kg", "Dairy"],
    ["Onion", "kg", "Vegetables"], ["Kebab meat", "kg", "Meat"], ["Rum", "bottle", "Bar"]] as const) {
    item[name] = (await sql<{ id: string }>(
      `insert into stock_items (hotel_id, name, unit, category) values ($1, $2, $3, $4) returning id::text`,
      [hotel, `${TAG} ${name}`, unit, category]))[0]!.id;
  }
  /* Today's deliveries into the kitchen store (no Kebab meat: it goes below zero). */
  for (const [name, qty] of [["Paneer", 5], ["Butter", 1], ["Onion", 2]] as const) {
    await sql(`insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost, moved_by)
               values ($1, $2, $3, $4::date, 'receipt', $5, 100, $6)`,
              [hotel, item[name], store, businessDate, qty, who["gm"]]);
  }

  const [cat] = await sql<{ id: string }>(
    "insert into pos_menu_categories (hotel_id, name, tax_kind) values ($1, $2, 'restaurant') returning id::text",
    [hotel, `${TAG} Mains`]);
  const dish = async (name: string) => (await sql<{ id: string }>(
    "insert into pos_menu_items (hotel_id, category_id, name, price) values ($1, $2, $3, 300) returning id::text",
    [hotel, cat!.id, name]))[0]!.id;
  tikka = await dish(`${TAG} Paneer Tikka`);
  dal = await dish(`${TAG} Dal`);
  for (const label of ["Half", "Full"]) {
    size[label] = (await sql<{ id: string }>(
      "insert into pos_item_variations (hotel_id, item_id, label, price) values ($1, $2, $3, 200) returning id::text",
      [hotel, tikka, label]))[0]!.id;
  }
  const [group] = await sql<{ id: string }>(
    "insert into pos_addon_groups (hotel_id, label) values ($1, $2) returning id::text", [hotel, `${TAG} Sides`]);
  onions = (await sql<{ id: string }>(
    "insert into pos_addons (hotel_id, group_id, label, price) values ($1, $2, $3, 25) returning id::text",
    [hotel, group!.id, `${TAG} Onions`]))[0]!.id;
  kebab = (await sql<{ id: string }>(
    "insert into pos_numbered_addons (hotel_id, number, name, price) values ($1, 987, $2, 120) returning id::text",
    [hotel, `${TAG} Kebab`]))[0]!.id;
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table stock_movements disable trigger stock_movements_append_only");
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("alter table stock_count_lines disable trigger stock_count_lines_append_only");
    const mine = "(select id from stock_items where name like $1)";
    await db.query(`delete from stock_count_lines where item_id in ${mine}`, [`${TAG}%`]);
    await db.query(`delete from stock_movements where item_id in ${mine}`, [`${TAG}%`]);
    await db.query(`delete from recipe_lines where stock_item_id in ${mine}`, [`${TAG}%`]);
    await db.query("delete from pos_order_lines where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from pos_numbered_addons where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_addon_groups where label like $1", [`${TAG}%`]);
    await db.query("delete from pos_menu_items where name like $1", [`${TAG}%`]);
    await db.query("delete from pos_menu_categories where name like $1", [`${TAG}%`]);
    await db.query("delete from stock_items where name like $1", [`${TAG}%`]);
    await db.query("delete from locations where name like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(who)]);
    await db.query("delete from hotel_modules where hotel_id = $1 and module = 'bar_stock'", [hotel]);
  } finally {
    await db.query("alter table stock_count_lines enable trigger stock_count_lines_append_only");
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table stock_movements enable trigger stock_movements_append_only");
    await db.end();
  }
  await closePool();
});

describe("the kitchen's stock and recipes (D27-373, D27-374)", () => {
  it("who: the kitchen reads; only the owner, an Admin, the GM and the Inventory Manager keep it", async () => {
    for (const role of ["pos", "front_desk"]) {
      expect((await call(who[role]!, "GET", "/kitchen-stock/sheet")).status, role).toBe(403);
      expect((await call(who[role]!, "GET", "/kitchen-stock/recipes")).status, role).toBe(403);
    }
    for (const role of ["chef", "kitchen_manager"]) {
      const res = await call(who[role]!, "GET", "/kitchen-stock/sheet");
      expect(res.status, role).toBe(200);
      expect(((await res.json()) as Sheet).mayKeep, role).toBe(false);
    }
    const recipe = { itemId: tikka, lines: [{ stockItemId: item["Paneer"], quantity: 0.1 }] };
    for (const role of ["chef", "kitchen_manager", "hotel_manager", "pos"]) {
      expect((await call(who[role]!, "PUT", "/kitchen-stock/store", { locationId: store })).status, role).toBe(403);
      expect((await call(who[role]!, "PUT", "/kitchen-stock/recipes", recipe)).status, role).toBe(403);
      expect((await call(who[role]!, "POST", "/kitchen-stock/count",
        { lines: [{ itemId: item["Paneer"], book: 5, counted: 1 }] })).status, role).toBe(403);
    }
    /* The refused left nothing behind. */
    const [left] = await sql<{ recipes: number; marked: boolean; counts: number }>(
      `select (select count(*)::int from recipe_lines where item_id = $1) as recipes,
              (select is_kitchen_store from locations where id = $2) as marked,
              (select count(*)::int from stock_count_lines where location_id = $2) as counts`, [tikka, store]);
    expect(left).toEqual({ recipes: 0, marked: false, counts: 0 });
  });

  it("no store marked yet: the sheet says so and a count is refused; the GM marks one - never the bar's", async () => {
    const sheet = (await (await call(who["gm"]!, "GET", "/kitchen-stock/sheet")).json()) as Sheet;
    expect([sheet.store, sheet.mayKeep]).toEqual([null, true]);
    expect(await reasonOf(await call(who["stores"]!, "POST", "/kitchen-stock/count",
      { lines: [{ itemId: item["Paneer"], book: 5, counted: 1 }] })))
      .toBe("No store is marked as the kitchen's yet. Pick it on Inventory, Restaurant.");
    if (barStore) {
      expect(await reasonOf(await call(who["gm"]!, "PUT", "/kitchen-stock/store", { locationId: barStore })))
        .toBe("That is not a store switched on at this property, or it is the bar's.");
    }
    const marked = await call(who["gm"]!, "PUT", "/kitchen-stock/store", { locationId: store });
    expect(marked.status, await marked.clone().text()).toBe(200);
  });

  it("recipes: a dish, a size on top, a side and an add-on - each in the item's unit; checked before saving", async () => {
    const put = (body: unknown) => call(who["stores"]!, "PUT", "/kitchen-stock/recipes", body);
    expect(await reasonOf(await put({ itemId: tikka, lines: [{ stockItemId: item["Paneer"], quantity: 0 }] })))
      .toBe("Each line: how much of the item one takes, more than none.");
    expect(await reasonOf(await put({ itemId: tikka, lines: [{ stockItemId: item["Rum"], quantity: 0.1 }] })))
      .toBe("An ingredient is not one of the Store's items here.");
    expect(await reasonOf(await put({ itemId: tikka, lines: [
      { stockItemId: item["Paneer"], quantity: 0.1 }, { stockItemId: item["Paneer"], quantity: 0.2 }] })))
      .toBe("An item is in the recipe twice - put it on one line.");
    expect(await reasonOf(await put({ itemId: tikka, addonId: onions, lines: [] })))
      .toBe("Whose recipe: a dish, one of its sizes, a side or an add-on?");

    for (const body of [
      { itemId: tikka, lines: [{ stockItemId: item["Paneer"], quantity: 0.1 }, { stockItemId: item["Butter"], quantity: 0.01 }] },
      { itemId: tikka, variationId: size["Full"], lines: [{ stockItemId: item["Paneer"], quantity: 0.1 }] },
      { addonId: onions, lines: [{ stockItemId: item["Onion"], quantity: 0.05 }] },
      { numberedAddonId: kebab, lines: [{ stockItemId: item["Kebab meat"], quantity: 0.08 }] },
    ]) {
      const res = await put(body);
      expect(res.status, await res.clone().text()).toBe(200);
    }

    const got = (await (await call(who["chef"]!, "GET", "/kitchen-stock/recipes")).json()) as {
      mayKeep: boolean; withoutRecipe: { name: string }[];
      owners: { kind: string; name: string; lines: { name: string; quantity: number; unit: string }[] }[] };
    expect(got.mayKeep).toBe(false);
    const names = got.withoutRecipe.map((d) => d.name);
    expect(names, "a dish with no recipe is listed").toContain(`${TAG} Dal`);
    expect(names).not.toContain(`${TAG} Paneer Tikka`);
    const owner = (name: string) => got.owners.find((o) => o.name === name)!;
    expect(owner(`${TAG} Paneer Tikka (Full)`).lines).toEqual([{ stockItemId: item["Paneer"], name: `${TAG} Paneer`, unit: "kg", quantity: 0.1 }]);
    expect(owner(`${TAG} Paneer Tikka (Half)`).lines, "none: nothing extra").toEqual([]);
    expect(owner(`${TAG} Onions`).kind).toBe("side");
    expect(owner(`987. ${TAG} Kebab`).kind).toBe("addon");
  });

  it("every KOT takes the recipe off the kitchen store - Bar stock switched off or not; below zero still goes", async () => {
    expect((await call("dev-owner", "POST", "/modules/bar_stock", { enabled: false })).status).toBe(200);
    const opened = await call(who["pos"]!, "POST", "/till/orders", { outlet: "REST", table: `${TAG} 1` });
    expect(opened.status, await opened.clone().text()).toBe(200);
    orderId = ((await opened.json()) as { id: string }).id;
    const put = async (key: string, cols: Record<string, unknown>) => {
      const names = Object.keys(cols);
      const [row] = await sql<{ id: string }>(
        `insert into pos_order_lines (order_id, hotel_id, unit_price, tax_rate, added_by, ${names.join(", ")})
         values ($1, $2, 200, 5, $3, ${names.map((_, i) => `$${i + 4}`).join(", ")}) returning id::text`,
        [orderId, hotel, who["pos"], ...Object.values(cols)]);
      line[key] = row!.id;
    };
    await put("full", { item_id: tikka, variation_id: size["Full"], name: "Tikka (Full)", qty: 2 });
    await put("half", { item_id: tikka, variation_id: size["Half"], name: "Tikka (Half)", qty: 1 });
    await put("side", { addon_id: onions, parent_line_id: line["half"], name: "Sides: Onions", qty: 1 });
    await put("kebab", { item_id: tikka, variation_id: size["Half"], name: "Tikka (Half) with Kebab", qty: 1,
      numbered_addons: JSON.stringify({ dish: "Tikka (Half)", base: 200,
        addons: [{ id: kebab, number: 987, name: "Kebab", price: 120, qty: 1 }] }) });
    await put("dal", { item_id: dal, name: "Dal", qty: 3 });
    await put("gone", { item_id: tikka, variation_id: size["Half"], name: "Tikka (Half)", qty: 4, note: "struck" });

    /* Struck before the kitchen had it: it took nothing, so nothing is owed back. */
    expect((await call(who["pos"]!, "POST", `/till/orders/${orderId}/lines/${line["gone"]}/void`, {})).status).toBe(200);
    const sent = await call(who["pos"]!, "POST", `/till/orders/${orderId}/kot`, {});
    expect(sent.status, await sent.clone().text()).toBe(200);

    /* Paneer: 2 Full x (0.1 + 0.1) + 1 Half x 0.1 + the Half with Kebab 0.1. */
    expect(await onHand("Paneer")).toBeCloseTo(4.4, 3);
    expect(await onHand("Butter")).toBeCloseTo(0.96, 3);
    expect(await onHand("Onion"), "the side's own line").toBeCloseTo(1.95, 3);
    expect(await onHand("Kebab meat"), "the add-on's own line, below zero, and the KOT went").toBeCloseTo(-0.08, 3);
    const took = await sql<{ line: string; n: number }>(
      `select pos_line_id::text as line, count(*)::int as n from stock_movements
        where pos_line_id in (select id from pos_order_lines where order_id = $1) group by 1`, [orderId]);
    const n = (key: string) => took.find((t) => t.line === line[key])?.n ?? 0;
    expect([n("full"), n("half"), n("side"), n("kebab"), n("dal"), n("gone")]).toEqual([2, 2, 1, 3, 0, 0]);
    const [issue] = await sql<{ kind: string; to_outlet: boolean; reference: string }>(
      `select kind, to_outlet is not null as to_outlet, reference from stock_movements
        where pos_line_id = $1 and item_id = $2`, [line["full"], item["Paneer"]]);
    expect(issue).toMatchObject({ kind: "issue", to_outlet: true });
    expect(issue!.reference).toMatch(/^Bill .+ KOT \d+$/);

    /* Moved along by the kitchen: nothing is taken twice. */
    await sql("update pos_order_lines set kot_status = 'ready' where id = $1", [line["full"]]);
    expect(await onHand("Paneer")).toBeCloseTo(4.4, 3);
    expect((await call("dev-owner", "POST", "/modules/bar_stock", { enabled: true })).status).toBe(200);
  });

  it("struck after the kitchen had it - or fewer of it - stays used, as wastage with the reason", async () => {
    const struck = await call(who["gm"]!, "POST", `/till/orders/${orderId}/lines/${line["kebab"]}/void`, { reason: "guest left" });
    expect(struck.status, await struck.clone().text()).toBe(200);
    const fewer = await call(who["gm"]!, "POST", `/till/orders/${orderId}/lines/${line["full"]}/qty`, { qty: 1, reason: "dropped" });
    expect(fewer.status, await fewer.clone().text()).toBe(200);
    expect(await onHand("Paneer"), "stock does not move").toBeCloseTo(4.4, 3);
    expect(await onHand("Kebab meat")).toBeCloseTo(-0.08, 3);

    const sheet = (await (await call(who["kitchen_manager"]!, "GET", "/kitchen-stock/sheet")).json()) as Sheet;
    const reasons = sheet.wasted.filter((w) => w.item.startsWith(TAG)).map((w) => `${w.item} ${w.quantity} ${w.note}`);
    expect(reasons.sort()).toEqual([
      `${TAG} Butter 0.01 Struck after the KOT: dropped`,
      `${TAG} Butter 0.01 Struck after the KOT: guest left`,
      `${TAG} Kebab meat 0.08 Struck after the KOT: guest left`,
      `${TAG} Paneer 0.1 Struck after the KOT: guest left`,
      `${TAG} Paneer 0.2 Struck after the KOT: dropped`,
    ]);
  });

  it("the daily sheet adds up, shows the moves and the count; a count puts it right", async () => {
    /* A move in from the Main store, and a hand issue out. */
    const [main] = await sql<{ id: string }>(
      "select id::text from locations where hotel_id = $1 and kind = 'store' and id <> $2 and not is_bar_store and not is_bar_counter and is_active order by name limit 1",
      [hotel, store]);
    await sql(`insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, moved_by)
               values ($1, $2, $3, $4::date, 'receipt', 1, $5)`, [hotel, item["Onion"], main!.id, businessDate, who["gm"]]);
    await sql("select app.transfer_stock($1, $2, $3, 1, $4, null)", [item["Onion"], main!.id, store, who["gm"]]);
    await sql(`insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, moved_by)
               values ($1, $2, $3, $4::date, 'issue', -0.5, $5)`, [hotel, item["Onion"], store, businessDate, who["gm"]]);

    const before = (await (await call(who["stores"]!, "GET", "/kitchen-stock/sheet")).json()) as Sheet;
    expect(before.mayCount).toBe(true);
    const row = (s: Sheet, name: string) => s.items.find((i) => i.name === `${TAG} ${name}`)!;
    expect(row(before, "Paneer")).toMatchObject({ opening: 0, received: 5, used: 0.3, wasted: 0.3, closing: 4.4 });
    expect(row(before, "Onion")).toMatchObject({ received: 2, movedIn: 1, movedOut: 0.5, used: 0.05, closing: 2.45 });
    expect(row(before, "Kebab meat"), "below zero: shown red on the screen").toMatchObject({ used: 0, wasted: 0.08, closing: -0.08 });
    for (const r of before.items) {
      const sum = r.opening + r.received + r.movedIn - r.movedOut - r.used - r.wasted + r.corrected;
      expect(Math.round(sum * 1000) / 1000, r.name).toBeCloseTo(r.closing, 3);
    }

    const counted = await call(who["stores"]!, "POST", "/kitchen-stock/count", { lines: [
      { itemId: item["Paneer"], book: 4.4, counted: 4.3 }, { itemId: item["Kebab meat"], book: -0.08, counted: 0 }] });
    expect(counted.status, await counted.clone().text()).toBe(200);
    const after = (await (await call(who["chef"]!, "GET", "/kitchen-stock/sheet")).json()) as Sheet;
    expect(after.mayCount).toBe(false);
    expect(row(after, "Paneer")).toMatchObject({ corrected: -0.1, closing: 4.3, counted: 4.3, countBook: 4.4 });
    expect(row(after, "Kebab meat"), "a count puts it right").toMatchObject({ corrected: 0.08, closing: 0 });
  });
});
