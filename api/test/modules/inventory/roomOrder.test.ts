import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ROOMS IN NUMBER ORDER (the owner's D27-338)

   A plain text sort listed Mathura's rooms 10A, 10B, 11A, 11B, 1A, 1B, 2A
   ... and any hotel's room 10 before room 9. The lists order by
   `number collate app.room_order` (228): 1A, 2A, 9, 10, 10A, 11B.
   Its own property (ROR), deleted afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const CODE = "ROR";
let hotelId = "";
let owner = "";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};

beforeAll(async () => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try {
    owner = (await db.query("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query("select app.provision_property_unchecked($1, 'Room Order', 'Nowhere')::text as id",
      [CODE])).rows[0].id;
    await db.query(
      `insert into rooms (hotel_id, room_type_id, number)
       select $1, (select id from room_types where hotel_id = $1 order by code limit 1), n
         from unnest(array['10A', '1A', '11B', '9', '2A', '10']) as n`, [hotelId]);
  } finally { await db.end(); }
});

afterAll(async () => {
  await closePool();
  await sql("alter table hotels disable trigger hotels_no_delete");
  try { await sql("delete from hotels where id = $1", [hotelId]); }
  finally { await sql("alter table hotels enable trigger hotels_no_delete"); }
});

describe("rooms in number order (D27-338)", () => {
  it("lists 1A, 2A, 9, 10, 10A, 11B - never 10 before 9 or 10A before 1A", async () => {
    const res = await app.request(`/api/hotels/${CODE}/rooms`, { headers: { "x-dev-staff-id": owner } });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { rooms?: { number: string }[] } | { number: string }[];
    const rooms = Array.isArray(body) ? body : body.rooms ?? [];
    expect(rooms.map((r) => r.number)).toEqual(["1A", "2A", "9", "10", "10A", "11B"]);
  });
});
