import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S ALLERGY ON THE KOT AND THE KITCHEN SCREEN (D27-396)

   The order screen shows a room-service order's in-house guest's allergy
   in red (D27-383 item 10). The kitchen's docket and its board carry the
   same words - read by a chef, who may not read guests' preferences - and
   a dine-in order, which has no room, carries none.

   On one of the demo's checked-in stays at 5EL; its guest's preferences
   are put back afterwards, and the orders and the chef removed.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

let owner = "";
let chef = "";
let roti = "";
let room = "";
let guestId = "";
let was: unknown = {};
const orders: string[] = [];

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A Butter Roti sent to the kitchen; the order's id and KOT number. */
async function sent(table: string, orderType: string): Promise<{ id: string; kotNo: number }> {
  const res = await call(owner, "POST", "/till/orders/batch",
    { outlet: "REST", table, orderType, lines: [{ itemId: roti, qty: 1 }], send: true });
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.json()) as { id: string; kotNo: number };
  orders.push(body.id);
  return body;
}
const docket = async (o: { id: string; kotNo: number }) => {
  const res = await call(chef, "GET", `/till/orders/${o.id}/kot/${o.kotNo}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { allergy?: string | null };
};
const board = async () => {
  const res = await call(chef, "GET", "/kitchen");
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { lines: { orderNo: string; table: string | null; allergy?: string | null }[] }).lines;
};

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  chef = (await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid)
     values ('kot-allergy-chef@fidato.in', 'KOT allergy chef', 'test-uid-kot-allergy-chef')
     on conflict (email) do update set is_active = true returning id::text`))[0]!.id;
  await sql("delete from staff_hotels where staff_id = $1", [chef]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             select $1, id, 'chef' from hotels where code = '5EL'`, [chef]);

  const [stay] = await sql<{ guest: string; room: string; prefs: unknown }>(
    `select g.id::text as guest, rm.number as room, g.preferences as prefs from reservations r
       join hotels h on h.id = r.hotel_id and h.code = '5EL'
       join guests g on g.id = r.guest_id
       join room_assignments ra on ra.reservation_id = r.id and ra.released_at is null
       join rooms rm on rm.id = ra.room_id
      where r.status = 'checked_in' order by r.reference limit 1`);
  guestId = stay!.guest; room = stay!.room; was = stay!.prefs;
  await sql(`update guests set preferences = preferences || '{"allergies": "Peanuts, shellfish"}' where id = $1`,
    [guestId]);

  const res = await call(owner, "GET", "/till/menu");
  const items = ((await res.json()) as { categories: { items: { id: string; name: string }[] }[] })
    .categories.flatMap((c) => c.items);
  roti = items.find((i) => i.name === "Butter Roti")!.id;
});

afterAll(async () => {
  /* Everything this file added to 5EL goes (MEMORY 476): its orders with
     their lines and KOT claims, the chef, and the guest's preferences as
     they were. */
  await sql("delete from pos_kot_prints where order_id = any($1::uuid[])", [orders]);
  await sql("delete from pos_order_lines where order_id = any($1::uuid[])", [orders]);
  await sql("delete from pos_orders where id = any($1::uuid[])", [orders]);
  await sql("update guests set preferences = $2::jsonb where id = $1", [guestId, JSON.stringify(was)]);
  await sql("delete from staff_hotels where staff_id = $1", [chef]);
  await sql("delete from staff where id = $1", [chef]);
  await closePool();
});

describe("the in-house guest's allergy goes to the kitchen (D27-396)", () => {
  it("the chef may not read guests' preferences, and still gets the allergy on the KOT and the board", async () => {
    expect((await call(chef, "GET", "/guest-preferences")).status).toBe(403);
    const o = await sent(`Room ${room}`, "room_service");
    expect((await docket(o)).allergy).toBe("Peanuts, shellfish");
    const mine = (await board()).filter((l) => l.table === `Room ${room}`);
    expect(mine.length).toBeGreaterThan(0);
    for (const l of mine) expect(l.allergy).toBe("Peanuts, shellfish");
  });

  it("a dine-in order has no room, so no allergy; a guest with none has none", async () => {
    const dine = await sent("KA1", "dine_in");
    expect((await docket(dine)).allergy ?? null).toBeNull();
    await sql("update guests set preferences = preferences - 'allergies' where id = $1", [guestId]);
    try {
      const o = await sent(`Room ${room}`, "room_service");
      expect((await docket(o)).allergy ?? null).toBeNull();
    } finally {
      await sql(`update guests set preferences = preferences || '{"allergies": "Peanuts, shellfish"}' where id = $1`,
        [guestId]);
    }
  });
});
