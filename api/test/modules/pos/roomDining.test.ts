import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { hashForTests } from "../../../src/routes/guestDoor.ts";

/* ══════════════════════════════════════════════════════════════════
   IN-ROOM DINING (D27-224, D27-225; the in-stay plan, A)

   The guest orders from their own page, behind the code; whoever rings
   the till accepts it on the Terminal - the batch route with guestOrderId,
   a room-service order for the stay's room, sent - or declines it with a
   reason the guest reads. Never more than the guest saw (Q1).
   The database side, door rules and alcohol included, is pos.sql's
   "room dining". On two of the demo's checked-in stays at 5EL.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

let owner = "";
let stay = "";
let room = "";
const links: string[] = [];
const ids: Record<string, string> = {};

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
/** A link and an unlock for a stay, as the door would make them. */
async function doorFor(reservation: string, token: string, unlock: string) {
  const [l] = await sql<{ id: string }>(
    `insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
     select hotel_id, id, $2, now() + interval '1 day' from reservations where id = $1
     returning id::text`, [reservation, hashForTests(token)]);
  links.push(l!.id);
  await sql(`insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
             values ($1, $2, $3, now() + interval '1 hour')`, [l!.id, reservation, hashForTests(unlock)]);
}
const guest = (path: string, unlock: string | null, body?: unknown) =>
  app.request(`/api/guest/rd-token${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(unlock ? { authorization: `Guest ${unlock}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const till = (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL/till${path}`, {
    method,
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason?: string }).reason ?? "";
async function order(lines: unknown[], note = ""): Promise<string> {
  const res = await guest("/orders", "rd-unlock", { lines, note });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { id: string }).id;
}
const accept = (guestOrderId: string) => till("POST", "/orders/batch", { guestOrderId });
const ordersOnRoom = async () => Number((await sql<{ n: string }>(
  "select count(*)::text as n from pos_orders where table_ref = $1 and order_type = 'room_service'",
  [`Room ${room}`]))[0]!.n);

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const stays = await sql<{ id: string; room: string }>(
    `select r.id::text, rm.number as room from reservations r
       join hotels h on h.id = r.hotel_id and h.code = '5EL'
       join room_assignments ra on ra.reservation_id = r.id and ra.released_at is null
       join rooms rm on rm.id = ra.room_id
      where r.status = 'checked_in' order by r.reference limit 2`);
  stay = stays[0]!.id;
  room = stays[0]!.room;
  await doorFor(stay, "rd-token", "rd-unlock");
  await doorFor(stays[1]!.id, "rd-token-2", "rd-unlock-2");
  const res = await till("GET", "/menu");
  type Item = { id: string; name: string; variations: { id: string; label: string }[];
    addonGroups: { addons: { id: string; label: string }[] }[] };
  const items = ((await res.json()) as { categories: { items: Item[] }[] }).categories.flatMap((c) => c.items);
  for (const n of ["Butter Roti", "Dal Tadka", "Jeera Rice"]) ids[n] = items.find((i) => i.name === n)!.id;
  const pau = items.find((i) => i.name === "Bhaaji Pau")!;
  ids["Bhaaji Pau"] = pau.id;
  ids["Butter"] = pau.variations.find((v) => v.label === "Butter")!.id;
  ids["Onions"] = pau.addonGroups.flatMap((g) => g.addons).find((a) => a.label === "Onions")!.id;
});

afterAll(async () => {
  await sql("delete from guest_food_orders where reservation_id = $1", [stay]);
  await sql("delete from guest_unlocks where link_id = any($1::uuid[])", [links]);
  await sql("delete from guest_links where id = any($1::uuid[])", [links]);
  await closePool();
});

describe("the door (online-checkin's rules)", () => {
  it("shows the menu only behind this phone's code, and not to another stay's unlock", async () => {
    expect((await guest("/menu", null)).status, "the link alone").toBe(404);
    expect((await guest("/menu", "rd-unlock-2")).status, "another stay's unlock").toBe(404);
    const res = await guest("/menu", "rd-unlock");
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { sections: { items: { name: string }[] }[] })
      .sections.flatMap((s) => s.items.map((i) => i.name));
    expect(names).toContain("Butter Roti");
  });
});

describe("accepted on the Terminal (D27-224)", () => {
  it("becomes a room-service order for the stay's room, sent, the note on the first dish", async () => {
    const id = await order([
      { itemId: ids["Butter Roti"], qty: 2 },
      { itemId: ids["Bhaaji Pau"], qty: 1, variationId: ids["Butter"], addonIds: [ids["Onions"]] },
    ], "No chilli please");
    const waiting = ((await (await till("GET", "/guest-orders")).json()) as {
      orders: { id: string; room: string; lines: { name: string; qty: number }[] }[] }).orders;
    expect(waiting.find((o) => o.id === id)).toMatchObject({ room,
      lines: [{ name: "Butter Roti", qty: 2 }, { name: "Bhaaji Pau (Butter)", qty: 1 }] });

    const res = await accept(id);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { table: string; kotNo: number;
      lines: { name: string; qty: number; note: string | null; kotStatus: string }[] };
    expect(body.table).toBe(`Room ${room}`);
    expect(body.kotNo).toBeGreaterThan(0);
    expect(body.lines.map((l) => [l.name, l.qty, l.note, l.kotStatus])).toEqual([
      ["Butter Roti", 2, "No chilli please", "sent"],
      ["Bhaaji Pau (Butter)", 1, null, "sent"],
      ["Sides: Onions", 1, null, "sent"],
    ]);
    const mine = ((await (await guest("/orders", "rd-unlock")).json()) as {
      orders: { id: string; status: string }[] }).orders;
    expect(mine.find((o) => o.id === id)?.status).toBe("accepted");
  });

  it("a second Accept is refused and writes nothing", async () => {
    const id = await order([{ itemId: ids["Butter Roti"], qty: 1 }]);
    expect((await accept(id)).status).toBe(200);
    const before = await ordersOnRoom();
    const again = await accept(id);
    expect(again.status, "accepted twice").toBe(409);
    expect(await ordersOnRoom(), "a second room-service order was made").toBe(before);
  });
});

describe("never more than the guest saw (Q1), and nothing that went off", () => {
  it("a price changed since the order refuses Accept, naming the dish; Decline tells the guest why", async () => {
    const id = await order([{ itemId: ids["Dal Tadka"], qty: 1 }]);
    await sql("update pos_menu_items set price = price + 10 where id = $1", [ids["Dal Tadka"]]);
    try {
      const before = await ordersOnRoom();
      const res = await accept(id);
      expect(res.status).toBe(409);
      expect(await reason(res)).toMatch(/The price of Dal Tadka has changed/);
      expect(await ordersOnRoom(), "an order was written anyway").toBe(before);

      const no = await till("POST", `/guest-orders/${id}/decline`, { reason: "The dal's price has changed - please order again." });
      expect(no.status, await no.clone().text()).toBe(200);
      const mine = ((await (await guest("/orders", "rd-unlock")).json()) as {
        orders: { id: string; status: string; reason: string | null }[] }).orders;
      expect(mine.find((o) => o.id === id)).toMatchObject(
        { status: "declined", reason: "The dal's price has changed - please order again." });
    } finally {
      await sql("update pos_menu_items set price = price - 10 where id = $1", [ids["Dal Tadka"]]);
    }
  });

  it("a dish taken off before Accept is refused, naming it", async () => {
    const id = await order([{ itemId: ids["Jeera Rice"], qty: 1 }]);
    await sql("update pos_menu_items set off_until = now() + interval '1 hour' where id = $1", [ids["Jeera Rice"]]);
    try {
      const res = await accept(id);
      expect(res.status).toBe(409);
      expect(await reason(res)).toMatch(/Jeera Rice is not on the menu now/);
    } finally {
      await sql("update pos_menu_items set off_until = null where id = $1", [ids["Jeera Rice"]]);
      await till("POST", `/guest-orders/${id}/decline`, { reason: "Out of rice tonight." });
    }
  });

  it("an order the guest took back cannot be accepted", async () => {
    const id = await order([{ itemId: ids["Butter Roti"], qty: 1 }]);
    expect((await guest(`/orders/${id}/cancel`, "rd-unlock", {})).status).toBe(200);
    const res = await accept(id);
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/already cancelled/);
  });
});
