import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   REMOVE A ROOM NOTHING HAS USED (the owner's D27-336, 15 October)

   A mistake at creation is removed then. A room anything has used - a
   booking or stay, housekeeping, a key card, a block, a work order, a lost
   item, a wake-up call, equipment, a guest link - is refused with what,
   and is only switched off. A CASCADE table (a block here) must refuse
   too: left to the foreign key it would be deleted with the room.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": "dev-owner", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;
const exists = async (number: string) => (await sql(
  "select 1 from rooms r join hotels h on h.id = r.hotel_id where h.code = '5EL' and r.number = $1", [number])).length > 0;

let typeId = "";
const MINE = ["RM1", "RM2", "RM3", "RM4"];

beforeAll(async () => {
  typeId = (await sql<{ id: string }>(
    `select rt.id::text from room_types rt join hotels h on h.id = rt.hotel_id
      where h.code = '5EL' and rt.is_active order by rt.code limit 1`))[0]!.id;
});

afterAll(async () => {
  const hotel = "(select id from hotels where code = '5EL')";
  await sql(`delete from room_blocks where room_id in (select id from rooms where hotel_id = ${hotel} and number = any($1))`, [MINE]);
  await sql(`delete from rooms where hotel_id = ${hotel} and number = any($1)`, [MINE]);
  await sql(`delete from room_types where hotel_id = ${hotel} and code = 'RMT'`);
  await closePool();
});

describe("Remove a room (D27-336)", () => {
  it("removes a room nothing has used", async () => {
    expect((await call("POST", "/rooms", { number: "RM1", roomTypeId: typeId })).status).toBe(200);
    const res = await call("DELETE", "/rooms/RM1");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await exists("RM1")).toBe(false);
    expect((await call("DELETE", "/rooms/RM1")).status).toBe(404);
  });

  it("refuses a room a booking or stay has used, and keeps it", async () => {
    const [used] = await sql<{ number: string }>(
      `select r.number from rooms r join hotels h on h.id = r.hotel_id
        where h.code = '5EL' and exists (select 1 from room_assignments a where a.room_id = r.id)
          and r.occupancy_status = 'vacant' limit 1`);
    const res = await call("DELETE", `/rooms/${used!.number}`);
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe(`Room ${used!.number} has been used (a booking or stay), so it cannot be `
      + "removed. Switch Sellable off instead.");
    expect(await exists(used!.number)).toBe(true);
  });

  it("refuses a room with only a block (a CASCADE table), and an occupied room - the block is kept", async () => {
    expect((await call("POST", "/rooms", { number: "RM2", roomTypeId: typeId })).status).toBe(200);
    await sql(
      `insert into room_blocks (hotel_id, room_id, from_date, reason)
       select hotel_id, id, current_date, 'house_use' from rooms
        where number = 'RM2' and hotel_id = (select id from hotels where code = '5EL')`);
    const res = await call("DELETE", "/rooms/RM2");
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/^Room RM2 has been used \(a block\)/);
    expect(await exists("RM2")).toBe(true);
    expect(await sql("select 1 from room_blocks b join rooms r on r.id = b.room_id where r.number = 'RM2'"))
      .toHaveLength(1);

    expect((await call("POST", "/rooms", { number: "RM3", roomTypeId: typeId })).status).toBe(200);
    await sql("update rooms set occupancy_status = 'occupied' where number = 'RM3'");
    const busy = await call("DELETE", "/rooms/RM3");
    expect(busy.status).toBe(409);
    expect(await reasonOf(busy)).toMatch(/^Room RM3 has been used \(somebody is in it\)/);
  });

  it("removes a type once its only room is removed", async () => {
    const made = await call("POST", "/room-types", { code: "RMT", name: "Remove Test", baseOccupancy: 2, maxOccupancy: 3 });
    const id = ((await made.json()) as { id: string }).id;
    expect((await call("POST", "/rooms", { number: "RM4", roomTypeId: id })).status).toBe(200);
    expect((await call("DELETE", `/room-types/${id}`)).status).toBe(409);
    expect((await call("DELETE", "/rooms/RM4")).status).toBe(200);
    expect((await call("DELETE", `/room-types/${id}`)).status).toBe(200);
    expect(await sql("select 1 from room_types where id = $1", [id])).toEqual([]);
  });
});
