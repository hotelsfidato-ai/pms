import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   OUT OF SERVICE IS THE DATED BLOCK — INV-6, the owner's D17-11

   The property's room count and the admin list read
   `rooms.housekeeping_status`, while availability, occupancy and the bell
   read `room_blocks`. Room 308 was "clean" with a block holding it out, and
   the screens disagreed. Now every count asks app.sellable_rooms.

   Two rooms at Pune are changed and put back: one given a block covering
   the business date with its status left clean, one given the status
   out_of_service with no block.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const asOwner = (path: string) =>
  app.request(`/api${path}`, { headers: { "x-dev-staff-id": "dev-owner" } });

let hotelId: string;
let blocked: { id: string; status: string };
let flagged: { id: string; status: string };
let blockId: string | null = null;

const roomCount = async () =>
  ((await (await asOwner("/hotels/PUN")).json()) as { rooms: number }).rooms;

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = 'PUN'")).rows[0].id;
  const { rows } = await sql(
    `select r.id::text, r.housekeeping_status as status from rooms r
      where r.hotel_id = $1 and r.is_active
        and not exists (select 1 from room_blocks b where b.room_id = r.id
                         and app.business_date($1) >= b.from_date
                         and (b.to_date is null or app.business_date($1) <= b.to_date))
      order by r.number limit 2`, [hotelId]);
  expect(rows.length, "Pune has two rooms free of blocks today").toBe(2);
  [blocked, flagged] = [rows[0], rows[1]];
});

afterAll(async () => {
  if (blockId) await sql("delete from room_blocks where id = $1", [blockId]);
  await sql("update rooms set housekeeping_status = $2 where id = $1", [flagged.id, flagged.status]);
  await closePool();
});

describe("the property's sellable rooms", () => {
  it("drop by one for a dated block, even while the room's status says clean", async () => {
    const before = await roomCount();
    const { rows } = await sql(
      `insert into room_blocks (hotel_id, room_id, from_date, to_date, reason)
       values ($1, $2, app.business_date($1), app.business_date($1), 'out_of_service')
       returning id::text`, [hotelId, blocked.id]);
    blockId = rows[0].id;
    expect(await roomCount()).toBe(before - 1);
  });

  it("do not drop for a status alone, with no block", async () => {
    const before = await roomCount();
    await sql("update rooms set housekeeping_status = 'out_of_service' where id = $1", [flagged.id]);
    expect(await roomCount()).toBe(before);
  });
});
