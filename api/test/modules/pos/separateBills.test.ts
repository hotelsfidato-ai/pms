import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   FOOD AND LIQUOR ON SEPARATE BILLS (the owner, 25 November 2026)

   One order, one payment; ticked on an open bill, it prints as two. The
   server's part: the tick (open bills only, the till's people only) and each
   scheme's own figures from app.pos_order_by_tax, which must add up to what
   the guest pays - the Food bill takes the round off, the Liquor bill is
   exactly its VAT bill.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "SBTEST";
let hotel = "";
let owner = "";
const who: Record<"waiter" | "housekeeper", string> = { waiter: "", housekeeper: "" };
let tikka = "";
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

type Scheme = { scheme: "gst" | "vat"; net: number; discount: number; service: number; taxable: number; tax: number };
interface Order {
  id: string; status: string; payable: number; roundOff: number; discount: number;
  separateBills: boolean; schemes: Scheme[]; vatBill: string | null;
}
const read = async (id: string) => (await (await call(owner, "GET", `/till/orders/${id}`)).json()) as Order;
const paise = (v: number) => Math.round(v * 100);

beforeAll(async () => {
  hotel = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  for (const [key, role] of [["waiter", "pos"], ["housekeeper", "housekeeping"]] as const) {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`sbtest-${key}@fidato.in`, `${TAG} ${key}`]);
    await sql(`insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)
               on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, hotel, role]);
    who[key] = s!.id;
  }
  const menu = (await (await call(owner, "GET", "/till/menu")).json()) as
    { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  const mine = "select id from pos_orders where table_ref like $1";
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table vat_bills disable trigger vat_bills_immutable");
    await db.query("alter table stock_movements disable trigger stock_movements_append_only");
    await db.query(`delete from stock_movements where pos_line_id in
                      (select id from pos_order_lines where order_id in (${mine}))`, [`${TAG}%`]);
    await db.query(`delete from pos_order_lines where order_id in (${mine})`, [`${TAG}%`]);
    await db.query(`delete from pos_order_tenders where order_id in (${mine})`, [`${TAG}%`]);
    await db.query(`delete from vat_bills where pos_order_id in (${mine})`, [`${TAG}%`]);
    await db.query(`delete from pos_orders where id in (${mine})`, [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[who.waiter, who.housekeeper]]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table vat_bills enable trigger vat_bills_immutable");
    await db.query("alter table stock_movements enable trigger stock_movements_append_only");
    await db.end();
  }
  await closePool();
});

/** An open bill with a GST dish and a drink at 10% VAT, 10% off. */
async function mixedBill(name: string): Promise<string> {
  const opened = await post(owner, "/till/orders", { outlet: "REST", table: `${TAG} ${name}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  expect((await post(owner, `/till/orders/${id}/lines`, { itemId: tikka, qty: 3 })).status).toBe(200);
  /* The drink as the till writes one under alcohol (scheme and rate copied
     onto the line); how a line becomes VAT is alcoholVat.test.ts's. */
  await sql(
    `insert into pos_order_lines (hotel_id, order_id, name, qty, unit_price, tax_rate, tax_scheme, kot_status, added_by)
     select hotel_id, order_id, $2, 2, 333.33, 10, 'vat', kot_status, added_by
       from pos_order_lines where order_id = $1 limit 1`, [id, `${TAG} Whisky 30 ml`]);
  const off = await post(owner, `/till/orders/${id}/discount`, { type: "percent", value: 10, reason: "Regular" });
  expect(off.status, await off.clone().text()).toBe(200);
  return id;
}

describe("food and liquor on separate bills", () => {
  it("is ticked on an open bill by the till's people, and the two parts add up to the bill", async () => {
    const id = await mixedBill("T1");
    expect((await read(id)).separateBills).toBe(false);

    const on = await post(who.waiter, `/till/orders/${id}/separate-bills`, { on: true });
    expect(on.status, await on.clone().text()).toBe(200);
    const o = (await on.json()) as Order;
    expect(o.separateBills).toBe(true);
    expect(o.schemes.map((s) => s.scheme)).toEqual(["gst", "vat"]);

    const vat = o.schemes.find((s) => s.scheme === "vat")!;
    const gst = o.schemes.find((s) => s.scheme === "gst")!;
    /* The discount is shared, never lost or doubled. */
    expect(paise(gst.discount + vat.discount)).toBe(paise(o.discount));
    expect(vat.discount).toBeGreaterThan(0);
    /* What the two papers print: Liquor exact, Food with the bill's round off. */
    const liquor = paise(vat.taxable + vat.tax);
    const food = paise(o.payable) - liquor;
    expect(food - paise(gst.taxable + gst.tax)).toBe(paise(o.roundOff));

    const off = await post(who.waiter, `/till/orders/${id}/separate-bills`, { on: false });
    expect(((await off.json()) as Order).separateBills).toBe(false);
  });

  it("refuses a vague answer, a housekeeper, and a paid bill - which keeps what was chosen", async () => {
    const id = await mixedBill("T2");
    const vague = await post(who.waiter, `/till/orders/${id}/separate-bills`, { on: "yes" });
    expect(vague.status).toBe(409);
    expect(((await vague.json()) as { reason: string }).reason).toBe("On or off?");
    expect((await post(who.housekeeper, `/till/orders/${id}/separate-bills`, { on: true })).status).toBe(403);

    expect((await post(who.waiter, `/till/orders/${id}/separate-bills`, { on: true })).status).toBe(200);
    const paid = await post(who.waiter, `/till/orders/${id}/settle`, { method: "card" });
    expect(paid.status, await paid.clone().text()).toBe(200);

    const late = await post(who.waiter, `/till/orders/${id}/separate-bills`, { on: false });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { reason: string }).reason).toMatch(/settled/);

    const o = await read(id);
    expect(o.separateBills).toBe(true);
    /* The Liquor bill's total is its VAT bill's, to the paisa. */
    const vat = o.schemes.find((s) => s.scheme === "vat")!;
    const [vb] = await sql<{ total: string }>("select total::text from vat_bills where number = $1", [o.vatBill]);
    expect(paise(Number(vb!.total))).toBe(paise(vat.taxable + vat.tax));
  });
});
