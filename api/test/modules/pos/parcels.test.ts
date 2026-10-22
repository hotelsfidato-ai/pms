import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   PARCELS (the owner's D27-359, 22 October)

   A parcel is a takeaway order named by its customer - required - with a
   phone if given; it reads "Parcel · <name>" on every list, the KOT and the
   bill. The GM's packing charge (once per parcel, taxed as the food) goes on
   the bill with the parcel's first KOT, never on a KOT; struck by a manager
   it is not put back. Tables lists the open parcels. Migration 236.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "PARCELT";
let gm = "";
let waiter = "";
let tikka = "";
let before: string | null = null;
let putAwayTillDay: () => Promise<void>;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, body === undefined
    ? { headers: { "x-dev-staff-id": who } }
    : { method: "POST", headers: { "x-dev-staff-id": who, "content-type": "application/json" },
        body: JSON.stringify(body) });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

interface Line { id: string; name: string; qty: number; unitPrice: number; taxRate: number;
  kotStatus: string; kotNo: number | null; packing?: boolean; voided: boolean;
  kotKind: { id: string } | null }
interface Order { id: string; table: string | null; orderType: string; lines: Line[] }

async function parcel(name: string): Promise<Order> {
  const res = await call(waiter, "/till/orders", { outlet: "REST", parcel: { name: `${TAG} ${name}`, phone: "9876543210" } });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Order;
}
const send = async (id: string, qty = 1) => {
  const res = await call(waiter, "/till/orders/batch", { orderId: id, lines: [{ itemId: tikka, qty }], send: true });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Order;
};
const packings = (o: Order) => o.lines.filter((l) => l.packing);

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
  gm = await person("parcel-gm@fidato.in", "PARCELT Manager", "gm");
  waiter = await person("parcel-waiter@fidato.in", "PARCELT Waiter", "pos");
  const menu = (await (await call(gm, "/till/menu")).json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  before = (await sql<{ p: string | null }>(
    "select o.packing_charge::text as p from pos_outlets o join hotels h on h.id = o.hotel_id where h.code = '5EL' and o.code = 'REST'"))[0]!.p;
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("update pos_outlets set packing_charge = $1 where code = 'REST' and hotel_id = (select id from hotels where code = '5EL')", [before]);
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("delete from pos_order_lines where order_id in (select id from pos_orders where table_ref like $1)", [`Parcel · ${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`Parcel · ${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter]]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await closePool();
});

describe("parcels (D27-359)", () => {
  it("a parcel needs the customer's name, and opens as Parcel · name, with the phone", async () => {
    const none = await call(waiter, "/till/orders", { outlet: "REST", parcel: { name: "  " } });
    expect(await reason(none)).toBe("Whose parcel is it? Type the customer's name.");
    const p = await parcel("Rahul");
    expect([p.table, p.orderType]).toEqual([`Parcel · ${TAG} Rahul`, "takeaway"]);
    const [row] = await sql<{ name: string; phone: string; table_id: string | null }>(
      "select customer_name as name, customer_phone as phone, table_id::text from pos_orders where id = $1", [p.id]);
    expect([row!.name, row!.phone, row!.table_id]).toEqual([`${TAG} Rahul`, "9876543210", null]);
  });

  it("the packing charge is the GM's setting: not a waiter's, never zero, blank for none", async () => {
    expect((await call(waiter, "/till/setup/packing", { amount: 25 })).status).toBe(403);
    expect(await reason(await call(gm, "/till/setup/packing", { amount: 0 })))
      .toBe("A packing charge is more than zero, or left blank for none.");
    expect((await call(gm, "/till/setup/packing", { amount: null })).status).toBe(200);
    const setup = (await (await call(gm, "/till/setup")).json()) as { restaurant: { packingCharge: number | null } };
    expect(setup.restaurant.packingCharge).toBeNull();
    /* None set: a parcel's KOT adds nothing. */
    const p = await send((await parcel("No charge")).id);
    expect(packings(p)).toEqual([]);
    expect((await call(gm, "/till/setup/packing", { amount: 25 })).status).toBe(200);
  });

  it("the first KOT puts the packing charge on the bill once, taxed as the food, and on no KOT", async () => {
    const p = await parcel("Asha");
    const first = await send(p.id, 2);
    const dish = first.lines.find((l) => l.name === "Paneer Tikka")!;
    const [pack] = packings(first);
    expect([pack!.name, pack!.qty, pack!.unitPrice, pack!.taxRate, pack!.kotStatus, pack!.kotKind])
      .toEqual(["Packing charge", 1, 25, dish.taxRate, "served", null]);
    /* The KOT the kitchen gets has the dish, not the charge. */
    const kot = (await (await call(waiter, `/till/orders/${p.id}/kot/${dish.kotNo}`)).json()) as {
      table: string; lines: { name: string }[] };
    expect(kot.table).toBe(`Parcel · ${TAG} Asha`);
    expect(kot.lines.map((l) => l.name)).toEqual(["Paneer Tikka"]);
    /* A second round adds none. */
    expect(packings(await send(p.id))).toHaveLength(1);
    /* Tables lists it, by the customer. */
    const floor = (await (await call(waiter, "/till/floor")).json()) as { parcels: { orderId: string; name: string }[] };
    expect(floor.parcels.find((x) => x.orderId === p.id)?.name).toBe(`${TAG} Asha`);
  });

  it("struck by the GM, the packing charge is not put back by the next KOT", async () => {
    const p = await parcel("Struck");
    const [pack] = packings(await send(p.id));
    const struck = await call(gm, `/till/orders/${p.id}/lines/${pack!.id}/void`, { reason: "Own container" });
    expect(struck.status, await struck.clone().text()).toBe(200);
    const after = await send(p.id);
    expect(packings(after).map((l) => l.voided)).toEqual([true]);
  });
});
