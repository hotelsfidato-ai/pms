import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A BAR BILL RECORDED (the owner's D27-354, 21 October)

   The owner, an administrator, the GM, the Inventory Manager or the bar
   manager (the Bar role) records a bar bill AS PRINTED: supplier, number,
   date, T.P. number; each drink's MRP, cases and loose bottles, bottles to
   a case and rate per case; handling, TCS and the printed total, which the
   lines must make (within the bill's round-off). The bottles go into the
   bar's store at once, as receipts pointing at the bill; a drink the bar
   lacks is added on the way; the same bill twice is refused; a photo
   attaches through the bill's own door. Migration 234 is the database's
   half (db/tests/modules/purchasing.sql, "bar bill").
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "BARBILL";
let gm = "";
let waiter = "";
let keeper = "";
let barman = "";
let amit = "";

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
  barman = await person("barbill-bar@fidato.in", "BARBILL Bar Manager", "bar");
  /* The bill's supplier is picked from the list (D27-372). */
  const [s] = await sql<{ id: string }>(
    `insert into suppliers (hotel_id, name) select id, $1 from hotels where code = '5EL'
     on conflict (hotel_id, name) do update set is_active = true returning id::text`, [`${TAG} Amit Traders`]);
  amit = s!.id;
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("delete from attachments where subject_table = 'bar_purchases' and subject_id in (select id from bar_purchases where supplier like $1)", [`${TAG}%`]);
    /* The ledger is append-only (forbid_mutation): off for this clean-up only. */
    await db.query("alter table stock_movements disable trigger stock_movements_append_only");
    await db.query("delete from bar_purchase_lines where purchase_id in (select id from bar_purchases where supplier like $1)", [`${TAG}%`]);
    await db.query("delete from stock_movements where bar_purchase_id in (select id from bar_purchases where supplier like $1)", [`${TAG}%`]);
    await db.query("delete from bar_purchases where supplier like $1", [`${TAG}%`]);
    await db.query("delete from suppliers where name like $1", [`${TAG}%`]);
    await db.query("delete from stock_items where name like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter, keeper, barman]]);
  } finally {
    await db.query("alter table stock_movements enable trigger stock_movements_append_only");
    await db.end();
  }
  await closePool();
});

/* A line as printed: the NIP case of 48 at a rate per case. */
const nip = (extra: object) => ({ perCase: 48, cases: 0, bottles: 0, ratePerCase: 8000, mrp: 190, ...extra });

describe("a bar bill recorded as printed (D27-354)", () => {
  it("a waiter is refused, by the server", async () => {
    const res = await call(waiter, "POST", "/bar/purchases", {
      supplierId: amit, billNo: "A-1", billDate: today, total: 8000,
      lines: [nip({ newDrink: { name: `${TAG} Romanov Vodka 180 ml`, unit: "bottle", sizeMl: 180 }, cases: 1 })],
    });
    expect(res.status).toBe(403);
    expect(await reason(res)).toBe(
      "Recording a bar bill is for the owner, an administrator, the general manager, the Inventory Manager or the bar manager.");
  });

  it("the Inventory Manager and the bar manager record bills: cases and loose bottles in, at the line's amount over its bottles", async () => {
    /* 1 case of 48 at Rs 8,000; printed 8,000.40 - inside the bill's round-off. */
    const first = await call(keeper, "POST", "/bar/purchases", {
      supplierId: amit, billNo: "A-2", billDate: today, total: 8000.4,
      lines: [nip({ newDrink: { name: `${TAG} Romanov Vodka 180 ml`, unit: "bottle", sizeMl: 180 }, cases: 1 })],
    });
    expect(first.status, await first.clone().text()).toBe(200);
    const drinks = (await (await call(barman, "GET", "/bar/drinks")).json()) as {
      store: { name: string }; drinks: { id: string; name: string; sizeMl: number | null; onHand: number; perCase: number | null }[] };
    expect(drinks.store.name).toBe("Bar store");
    const vodka = drinks.drinks.find((d) => d.name === `${TAG} Romanov Vodka 180 ml`)!;
    expect([vodka.sizeMl, vodka.onHand, vodka.perCase]).toEqual([180, 48, 48]);

    /* 24 loose NIPs at Rs 8,000 a case of 48 = 4,000; a case of 12 water at
       180; handling 100, TCS 40.40: 4,320.40. */
    const second = await call(barman, "POST", "/bar/purchases", {
      supplierId: amit, billNo: "A-3", billDate: today, tpNo: "TP 4471",
      handling: 100, tcs: 40.4, total: 4320.4,
      lines: [nip({ itemId: vodka.id, bottles: 24 }),
              { newDrink: { name: `${TAG} Bisleri 1 L`, unit: "bottle", sizeMl: null },
                perCase: 12, cases: 1, bottles: 0, ratePerCase: 180, mrp: null }],
    });
    expect(second.status, await second.clone().text()).toBe(200);
    const { id } = (await second.json()) as { id: string };
    const moved = await sql<{ name: string; quantity: string; unit_cost: string; store: string }>(
      `select i.name, m.quantity::text, m.unit_cost::text, l.name as store
         from stock_movements m join stock_items i on i.id = m.item_id join locations l on l.id = m.location_id
        where m.bar_purchase_id = $1 and m.kind = 'receipt' order by i.name`, [id]);
    expect(moved.map((l) => [l.name, Number(l.quantity), Number(l.unit_cost), l.store])).toEqual([
      [`${TAG} Bisleri 1 L`, 12, 15, "Bar store"],
      [`${TAG} Romanov Vodka 180 ml`, 24, 166.67, "Bar store"],
    ]);

    const list = (await (await call(gm, "GET", "/bar/purchases")).json()) as {
      purchases: { id: string; tpNo: string | null; handling: number | null; tcs: number | null; total: number | null;
                   lines: { item: string; mrp: number | null; perCase: number; cases: number; bottles: number;
                            ratePerCase: number; amount: number }[] }[] };
    const bill = list.purchases.find((p) => p.id === id)!;
    expect([bill.tpNo, bill.handling, bill.tcs, bill.total]).toEqual(["TP 4471", 100, 40.4, 4320.4]);
    expect(bill.lines.map((l) => [l.item, l.mrp, l.perCase, l.cases, l.bottles, l.ratePerCase, l.amount])).toEqual([
      [`${TAG} Romanov Vodka 180 ml`, 190, 48, 0, 24, 8000, 4000],
      [`${TAG} Bisleri 1 L`, null, 12, 1, 0, 180, 180],
    ]);
  });

  it("a total the lines do not make, the same bill twice, a known drink, a future date and no rate are refused", async () => {
    const drink = nip({ newDrink: { name: `${TAG} Old Monk 180 ml`, unit: "bottle", sizeMl: 180 }, cases: 1 });
    const off = await call(gm, "POST", "/bar/purchases", {
      supplierId: amit, billNo: "A-8", billDate: today, total: 9000, lines: [drink] });
    expect(await reason(off)).toBe(
      "The lines, handling and TCS make ₹8,000.00; the bill says ₹9,000.00. Check the cases, the rates and the charges against the bill.");
    const again = await call(gm, "POST", "/bar/purchases", {
      supplierId: amit, billNo: "a-2", billDate: today, total: 8000, lines: [drink] });
    expect(await reason(again)).toBe(`Bill a-2 from ${TAG} Amit Traders is already recorded.`);
    const known = await call(gm, "POST", "/bar/purchases", {
      supplierId: amit, billNo: "A-9", billDate: today, total: 8000,
      lines: [{ ...drink, newDrink: { name: `${TAG} romanov vodka 180 ml`, unit: "bottle", sizeMl: 180 } }] });
    expect(await reason(known)).toBe(`"${TAG} Romanov Vodka 180 ml" is already on the store's list. Pick it instead.`);
    const later = await call(gm, "POST", "/bar/purchases", {
      supplierId: amit, billNo: "A-10", billDate: "2999-01-01", total: 8000, lines: [drink] });
    expect(await reason(later)).toBe("A bill is not dated in the future.");
    const free = await call(gm, "POST", "/bar/purchases", {
      supplierId: amit, billNo: "A-11", billDate: today, total: 8000, lines: [{ ...drink, ratePerCase: undefined }] });
    expect(await reason(free)).toBe("Type each line's rate per case as on the bill: zero or more.");
    /* The supplier is picked from the list, not typed (D27-372); another hotel's is not on it. */
    const typed = await call(gm, "POST", "/bar/purchases", {
      supplier: `${TAG} Amit Traderss`, billNo: "A-12", billDate: today, total: 8000, lines: [drink] });
    expect(await reason(typed)).toBe("Who is the bill from? Pick the supplier.");
    const [elsewhere] = await sql<{ id: string }>(
      `insert into suppliers (hotel_id, name) select id, $1 from hotels where code <> '5EL' limit 1
       on conflict (hotel_id, name) do update set is_active = true returning id::text`, [`${TAG} Elsewhere`]);
    const foreign = await call(gm, "POST", "/bar/purchases", {
      supplierId: elsewhere!.id, billNo: "A-13", billDate: today, total: 8000, lines: [drink] });
    expect(await reason(foreign)).toBe(
      "That supplier is not on this hotel's list. Pick one, or add it in Places and suppliers.");
    const offered = (await (await call(barman, "GET", "/bar/drinks")).json()) as { suppliers: { id: string; name: string }[] };
    expect(offered.suppliers).toContainEqual({ id: amit, name: `${TAG} Amit Traders` });
    expect(offered.suppliers.some((s) => s.id === elsewhere!.id)).toBe(false);
    const [n] = await sql<{ n: number }>(
      "select count(*)::int as n from bar_purchases where supplier like $1", [`${TAG}%`]);
    expect(n!.n, "nothing more was recorded").toBe(2);
  });

  it("the bar manager takes a photo of the bill and opens it; a waiter cannot", async () => {
    const [bill] = await sql<{ id: string }>(
      "select id::text from bar_purchases where supplier like $1 and bill_no = 'A-3'", [`${TAG}%`]);
    const form = new FormData();
    /* The smallest PNG there is: a 1x1 pixel. */
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    form.set("file", new File([png], "bill.png", { type: "image/png" }));
    const res = await app.request(`/api/hotels/5EL/bar/purchases/${bill!.id}/photo`, {
      method: "POST", headers: { "x-dev-staff-id": barman }, body: form });
    expect(res.status, await res.clone().text()).toBe(200);
    const list = (await (await call(barman, "GET", "/bar/purchases")).json()) as {
      purchases: { id: string; photoId: string | null }[] };
    expect(list.purchases.find((p) => p.id === bill!.id)?.photoId).toBeTruthy();
    const back = await app.request(`/api/hotels/5EL/bar/purchases/${bill!.id}/photo`, { headers: { "x-dev-staff-id": barman } });
    expect([back.status, back.headers.get("content-type")]).toEqual([200, "image/png"]);
    const refused = await app.request(`/api/hotels/5EL/bar/purchases/${bill!.id}/photo`, { headers: { "x-dev-staff-id": waiter } });
    expect(refused.status).toBe(404);
  });
});
