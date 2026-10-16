import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A BLOCKED ROOM IS NOT GIVEN (the owner's D27-339)

   Shown on 16 October: a room blocked out of order three days ahead was
   taken by Assign room for a booking on exactly those days, although the
   inventory already counted 0 rooms sellable. Now Assign room, Check-in
   and Move room refuse a room with a block on any night of the stay -
   entered ahead or today - and say which block. A room free of blocks is
   still given. Its own property (BLK), deleted afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const CODE = "BLK";
let hotelId = ""; let owner = ""; let bd = "";
const stays: Record<string, string> = {};

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};
const call = (path: string, body: unknown) => app.request(`/api/hotels/${CODE}${path}`, {
  method: "POST",
  headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
  body: JSON.stringify(body),
});
const day = async (n: number) => (await sql("select ($1::date + $2::int)::text as d", [bd, n]))[0].d as string;
const reason = async (res: Response) => ((await res.json()) as { reason?: string }).reason;

beforeAll(async () => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try {
    owner = (await db.query("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query("select app.provision_property_unchecked($1, 'Blocked Room', 'Nowhere')::text as id",
      [CODE])).rows[0].id;
    await db.query(
      `insert into rooms (hotel_id, room_type_id, number)
       select $1, (select id from room_types where hotel_id = $1 order by code limit 1), n
         from unnest(array['101', '102', '103']) as n`, [hotelId]);
    /* A rate for rooms, so check-in can post its first night. */
    await db.query("insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'room', 0, 0)", [hotelId]);
    bd = (await db.query("select app.business_date($1)::text as d", [hotelId])).rows[0].d;
    for (const [key, from, to, status] of [
      ["ahead", 3, 5, "confirmed"],     // arrives in 3 days, two nights
      ["today", 0, 5, "confirmed"],     // arrives today, five nights - days 3 and 4 blocked
      ["inHouse", 0, 4, "checked_in"],  // already here, in room 103
    ] as const) {
      const guest = (await db.query("insert into guests (full_name) values ($1) returning id::text",
        [`BLK ${key}`])).rows[0].id;
      stays[key] = (await db.query(
        `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
         values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 order by code limit 1),
                 $3::date + $4::int, $3::date + $5::int, 3000, $6) returning id::text`,
        [hotelId, guest, bd, from, to, status])).rows[0].id;
    }
    await db.query(
      `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
       select $1, $2, r.id, $3::date, $3::date + 4, 'arrival' from rooms r where r.hotel_id = $1 and r.number = '103'`,
      [hotelId, stays["inHouse"], bd]);
  } finally { await db.end(); }
  /* Room 101 out of order on the 3rd and 4th day ahead - entered today, so
     its status stays clean (the shape that slipped through). */
  const blocked = await call("/rooms/101/block", { reason: "out_of_order", from: await day(3), to: await day(4) });
  expect(blocked.status, await blocked.clone().text()).toBe(200);
});

afterAll(async () => {
  await closePool();
  const triggers = ["folio_postings folio_postings_append_only", "hotels hotels_no_delete"];
  for (const t of triggers) await sql(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
  try { await sql("delete from hotels where id = $1", [hotelId]); }
  finally {
    for (const t of triggers) await sql(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
  }
});

describe("a room blocked on the stay's nights (D27-339)", () => {
  it("is still clean today, and already counted out of the inventory on its days", async () => {
    expect((await sql("select housekeeping_status from rooms where hotel_id = $1 and number = '101'", [hotelId]))[0])
      .toEqual({ housekeeping_status: "clean" });
    expect((await sql("select app.sellable_rooms($1, $2::date) as n", [hotelId, await day(3)]))[0].n).toBe(2);
  });

  it("is refused by Assign room, saying which block - and a free room is given", async () => {
    const res = await call(`/stays/${stays["ahead"]}/assign`, { roomNumber: "101" });
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/^Room 101 is out of order from .+ to .+, so it cannot take this stay\. Choose another room, or end the block first\.$/);
    expect((await call(`/stays/${stays["ahead"]}/assign`, { roomNumber: "102" })).status).toBe(200);
  });

  it("is refused at check-in when the block falls on a later night of the stay", async () => {
    const res = await call(`/stays/${stays["today"]}/check-in`, { roomNumber: "101", adults: 1, idSkipReason: "Test" });
    expect(res.status).toBe(409);
    expect(await reason(res)).toContain("Room 101 is out of order");
  });

  it("is refused by Move room from a night before the block", async () => {
    const res = await call(`/stays/${stays["inHouse"]}/move`, { roomNumber: "101", from: bd, reason: "move" });
    expect(res.status).toBe(409);
    expect(await reason(res)).toContain("Room 101 is out of order");
  });
});
