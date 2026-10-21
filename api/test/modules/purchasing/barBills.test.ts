import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A BAR BILL RECORDED (the owner's D27-354, 21 October)

   The owner, an administrator, the GM or the Inventory Manager records a
   bar bill as it came: supplier, number, date, its drinks with the bottles
   and the cost per bottle. The drinks go into the bar's store at once, as
   receipts pointing at the bill; a drink the bar lacks is added on the
   way; the same bill twice is refused; a photo attaches to it. Migration
   234 is the database's half (db/tests/modules/purchasing.sql, "bar bill").
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "BARBILL";
let gm = "";
let waiter = "";
let keeper = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

beforeAll(async () => {
  const person = async (email: string, name: string, role: string) => {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`, [email, name]);
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = '5EL'
       on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, role]);
    return s!.id;
  };
  gm = await person("barbill-gm@fidato.in", "BARBILL Manager", "gm");
  waiter = await person("barbill-waiter@fidato.in", "BARBILL Waiter", "pos");
  keeper = await person("barbill-keeper@fidato.in", "BARBILL Keeper", "stores");
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("delete from attachments where subject_table = 'bar_purchases' and subject_id in (select id from bar_purchases where supplier like $1)", [`${TAG}%`]);
    /* The ledger is append-only (forbid_mutation): off for this clean-up only. */
    await db.query("alter table stock_movements disable trigger stock_movements_append_only");
    await db.query("delete from stock_movements where bar_purchase_id in (select id from bar_purchases where supplier like $1)", [`${TAG}%`]);
    await db.query("delete from bar_purchases where supplier like $1", [`${TAG}%`]);
    await db.query("delete from stock_items where name like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter, keeper]]);
  } finally {
    await db.query("alter table stock_movements enable trigger stock_movements_append_only");
    await db.end();
  }
  await closePool();
});

describe("a bar bill recorded (D27-354)", () => {
  it("a waiter is refused, by the server", async () => {
    const res = await call(waiter, "POST", "/bar/purchases", {
      supplier: `${TAG} Shah Wines`, billNo: "W-1", billDate: today,
      lines: [{ newDrink: { name: `${TAG} Kingfisher Strong 650 ml`, unit: "bottle", sizeMl: 650 }, bottles: 24, costPerBottle: 140 }],
    });
    expect(res.status).toBe(403);
    expect(await reason(res)).toBe(
      "Recording a bar bill is for the owner, an administrator, the general manager or the Inventory Manager.");
  });

  it("the Inventory Manager records one: a new drink added, both lines into the bar's store, pointing at the bill", async () => {
    const first = await call(keeper, "POST", "/bar/purchases", {
      supplier: `${TAG} Shah Wines`, billNo: "W-2", billDate: today,
      lines: [{ newDrink: { name: `${TAG} Imperial Blue 750 ml`, unit: "bottle", sizeMl: 750 }, bottles: 6, costPerBottle: 520 }],
    });
    expect(first.status, await first.clone().text()).toBe(200);
    const drinks = (await (await call(keeper, "GET", "/bar/drinks")).json()) as {
      store: { name: string }; drinks: { id: string; name: string; sizeMl: number | null; onHand: number }[] };
    expect(drinks.store.name).toBe("Bar store");
    const blue = drinks.drinks.find((d) => d.name === `${TAG} Imperial Blue 750 ml`)!;
    expect([blue.sizeMl, blue.onHand]).toEqual([750, 6]);

    const second = await call(keeper, "POST", "/bar/purchases", {
      supplier: `${TAG} Shah Wines`, billNo: "W-3", billDate: today,
      lines: [{ itemId: blue.id, bottles: 4, costPerBottle: 520 },
              { newDrink: { name: `${TAG} Bisleri 1 L`, unit: "bottle", sizeMl: null }, bottles: 12, costPerBottle: 15 }],
    });
    expect(second.status, await second.clone().text()).toBe(200);
    const { id } = (await second.json()) as { id: string };
    const lines = await sql<{ name: string; quantity: string; unit_cost: string; store: string }>(
      `select i.name, m.quantity::text, m.unit_cost::text, l.name as store
         from stock_movements m join stock_items i on i.id = m.item_id join locations l on l.id = m.location_id
        where m.bar_purchase_id = $1 and m.kind = 'receipt' order by i.name`, [id]);
    expect(lines.map((l) => [l.name, Number(l.quantity), Number(l.unit_cost), l.store])).toEqual([
      [`${TAG} Bisleri 1 L`, 12, 15, "Bar store"],
      [`${TAG} Imperial Blue 750 ml`, 4, 520, "Bar store"],
    ]);

    const list = (await (await call(gm, "GET", "/bar/purchases")).json()) as {
      purchases: { id: string; billNo: string; lines: { item: string; quantity: number }[] }[] };
    expect(list.purchases.find((p) => p.id === id)?.lines).toHaveLength(2);
  });

  it("the same bill twice, a drink already on the list, a future date and no cost are refused", async () => {
    const drink = { newDrink: { name: `${TAG} Old Monk 750 ml`, unit: "bottle", sizeMl: 750 }, bottles: 1, costPerBottle: 300 };
    expect((await call(gm, "POST", "/bar/purchases", {
      supplier: `${TAG} Shah Wines`, billNo: "W-2", billDate: today, lines: [drink] })).status).toBe(409);
    const again = await call(gm, "POST", "/bar/purchases", {
      supplier: `${TAG} Shah Wines`, billNo: "w-2", billDate: today, lines: [drink] });
    expect(await reason(again)).toBe(`Bill w-2 from ${TAG} Shah Wines is already recorded.`);
    const known = await call(gm, "POST", "/bar/purchases", {
      supplier: `${TAG} Shah Wines`, billNo: "W-9", billDate: today,
      lines: [{ ...drink, newDrink: { ...drink.newDrink, name: `${TAG} imperial blue 750 ml` } }] });
    expect(await reason(known)).toBe(`"${TAG} Imperial Blue 750 ml" is already on the store's list. Pick it instead.`);
    const later = await call(gm, "POST", "/bar/purchases", {
      supplier: `${TAG} Shah Wines`, billNo: "W-10", billDate: "2999-01-01", lines: [drink] });
    expect(await reason(later)).toBe("A bill is not dated in the future.");
    const free = await call(gm, "POST", "/bar/purchases", {
      supplier: `${TAG} Shah Wines`, billNo: "W-11", billDate: today, lines: [{ ...drink, costPerBottle: undefined }] });
    expect(await reason(free)).toBe("Type the cost of each drink as on the bill: zero or more.");
    const [n] = await sql<{ n: number }>(
      "select count(*)::int as n from bar_purchases where supplier like $1", [`${TAG}%`]);
    expect(n!.n, "nothing more was recorded").toBe(2);
  });

  it("takes a photo of the bill", async () => {
    const [bill] = await sql<{ id: string }>(
      "select id::text from bar_purchases where supplier like $1 and bill_no = 'W-3'", [`${TAG}%`]);
    const form = new FormData();
    form.set("table", "bar_purchases");
    form.set("id", bill!.id);
    /* The smallest PNG there is: a 1x1 pixel. */
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    form.set("file", new File([png], "bill.png", { type: "image/png" }));
    const res = await app.request("/api/hotels/5EL/attachments", {
      method: "POST", headers: { "x-dev-staff-id": keeper }, body: form });
    expect(res.status, await res.clone().text()).toBe(200);
    const list = (await (await call(keeper, "GET", "/bar/purchases")).json()) as {
      purchases: { id: string; photoId: string | null }[] };
    expect(list.purchases.find((p) => p.id === bill!.id)?.photoId).toBeTruthy();
  });
});
