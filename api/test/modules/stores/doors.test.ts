import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";
import { outletSales } from "../../../src/modules/pos/index.ts";
import { awaitingDelivery } from "../../../src/modules/purchasing/index.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT THE STORE READS THROUGH OTHER SERVICES' DOORS (D27-238)

   Purchasing's: what is on order and not yet delivered ("Awaiting
   delivery"). The till's: what each outlet sold per day before GST, the
   figure the stock issued to it is set against. Each is read through the
   service's own door, never a second copy of its query in the Store.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "STDOORS";
const pool = new pg.Pool({ connectionString: SUPER });
const sql = async <T>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];

let owner = "";
let hotelId = "";
let putAwayTillDay: () => Promise<void> = async () => {};

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  hotelId = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
});

afterAll(async () => {
  await putAwayTillDay();
  await sql("delete from purchase_requests where reference like $1", [`${TAG}%`]);
  await sql("delete from stock_items where name like $1", [`${TAG}%`]);
  try {
    await sql("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await sql("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await sql("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
  } finally {
    await sql("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await sql("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
  }
  await pool.end();
  await closePool();
});

/** A door function, called the way a route calls it: with a client. */
async function through<T>(read: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await read(client); } finally { client.release(); }
}

describe("Purchasing's door: what is awaiting delivery", () => {
  it("lists each line of an order sent and not yet delivered, and nothing else", async () => {
    const [store] = await sql<{ id: string }>(
      "select id::text from locations where hotel_id = $1 and name = 'Main store'", [hotelId]);
    const [sup] = await sql<{ id: string }>(
      `insert into suppliers (hotel_id, name) values ($1, $2)
       on conflict (hotel_id, name) do update set is_active = true returning id::text`,
      [hotelId, `${TAG} supplier`]);
    const [rice] = await sql<{ id: string }>(
      "insert into stock_items (hotel_id, name, unit) values ($1, $2, 'kg') returning id::text",
      [hotelId, `${TAG} rice`]);
    const [oil] = await sql<{ id: string }>(
      "insert into stock_items (hotel_id, name, unit) values ($1, $2, 'litre') returning id::text",
      [hotelId, `${TAG} oil`]);

    const [sent] = await sql<{ id: string }>(
      `insert into purchase_requests
         (hotel_id, reference, store_id, supplier_id, reason, status, requested_by, ordered_at, ordered_by)
       values ($1, $2, $3, $4, 'For the doors test', 'ordered', $5, now(), $5) returning id::text`,
      [hotelId, `${TAG}-SENT`, store!.id, sup!.id, owner]);
    const [asked] = await sql<{ id: string }>(
      `insert into purchase_requests (hotel_id, reference, store_id, reason, requested_by)
       values ($1, $2, $3, 'Not sent yet', $4) returning id::text`,
      [hotelId, `${TAG}-ASKED`, store!.id, owner]);
    await sql(
      `insert into purchase_request_lines (hotel_id, request_id, line_no, item_id, quantity, unit_price)
       values ($1, $2, 1, $3, 40, 90), ($1, $4, 1, $5, 12, 150)`,
      [hotelId, sent!.id, rice!.id, asked!.id, oil!.id]);

    const mine = (await through((c) => awaitingDelivery(c, hotelId)))
      .filter((l) => l.reference.startsWith(TAG));
    expect(mine).toEqual([
      { itemId: rice!.id, storeId: store!.id, quantity: 40, reference: `${TAG}-SENT` },
    ]);
  });
});

describe("the till's door: what each outlet sold per day", () => {
  it("counts a settled bill at its outlet, before GST; an open one not at all", async () => {
    putAwayTillDay = await openTillDay("5EL");
    const post = (path: string, body: unknown) => app.request(`/api/hotels/5EL${path}`, {
      method: "POST",
      headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const menu = (await (await app.request("/api/hotels/5EL/till/menu", {
      headers: { "x-dev-staff-id": owner },
    })).json()) as { categories: { items: { id: string; name: string }[] }[] };
    const tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
    const [{ day, rest }] = await sql<{ day: string; rest: string }>(
      `select to_char(app.business_date(h.id), 'YYYY-MM-DD') as day,
              (select id::text from pos_outlets where hotel_id = h.id and code = 'REST') as rest
         from hotels h where h.id = $1`, [hotelId]) as [{ day: string; rest: string }];
    const soldAtRest = async () =>
      (await through((c) => outletSales(c, hotelId, day, day)))
        .find((s) => s.outletId === rest)?.net ?? 0;

    const before = await soldAtRest();
    const open = async (table: string) => {
      const res = await post("/till/orders", { outlet: "REST", table });
      expect(res.status, await res.clone().text()).toBe(200);
      const { id } = (await res.json()) as { id: string };
      expect((await post(`/till/orders/${id}/lines`, { itemId: tikka, qty: 2 })).status).toBe(200);
      return id;
    };
    const paid = await open(`${TAG} 1`);
    await open(`${TAG} 2`);                       // left open: sold nothing yet
    const settled = await post(`/till/orders/${paid}/settle`, { method: "card" });
    expect(settled.status, await settled.clone().text()).toBe(200);

    const [{ taxable }] = await sql<{ taxable: string }>(
      "select taxable::text from app.pos_order_total($1)", [paid]) as [{ taxable: string }];
    expect(Number(taxable)).toBeGreaterThan(0);
    expect(Math.round((await soldAtRest() - before) * 100) / 100).toBe(Number(taxable));
  });
});
