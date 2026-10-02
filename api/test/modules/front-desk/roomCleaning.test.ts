import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   FD-10, FD-12 (the owner's D27-239, 2 October; migration 182)

   FD-10: a room given ahead to a booking that never arrived was sent to
   cleaning when it was let go - unassigned, or the guest checked into
   another room. Nobody was ever in it.

   FD-12: a room checked out of stayed "clean" when a LATER booking held it.
   A room is dirtied by a guest who was in it, and left alone only while
   somebody else is in it now.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FCL";
let hotelId = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/* Complimentary, so nothing is charged and a check-out needs no payment. */
async function booking(reference: string, from: string, to: string) {
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status, is_complimentary)
     values ($1, $2, (select id from guests where full_name = 'Cleaning guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $4::date, 0, 'confirmed', true)
     returning id::text`, [hotelId, reference, from, to]))[0]!.id;
}

const state = async (room: string) => (await sql<{ s: string }>(
  "select housekeeping_status as s from rooms where hotel_id = $1 and number = $2",
  [hotelId, room]))[0]!.s;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Cleaning Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '23:59'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,106)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Cleaning guest')");
    await db.query(
      `insert into night_audit_runs (hotel_id, business_date, status, completed_at)
       values ($1, date '2026-08-25', 'completed', now())`, [hotelId]);
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("alter table night_audit_runs disable trigger user");
    await db.query("delete from folio_postings where hotel_id = $1", [hotelId]);
    await db.query("delete from folios where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table night_audit_runs enable trigger user");
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("FD-10 · a room nobody entered stays as it was", () => {
  it("when a booking given it ahead lets it go", async () => {
    const id = await booking(`${CODE}-AHEAD`, "2026-08-28", "2026-08-30");
    expect((await call(`/stays/${id}/assign`, "POST", { roomNumber: "101" })).status).toBe(200);
    expect(await state("101")).toBe("clean");
    const res = await call(`/stays/${id}/unassign`, "POST", {});
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await state("101")).toBe("clean");
  });

  it("when the guest is checked into another room", async () => {
    const id = await booking(`${CODE}-OTHER`, "2026-08-26", "2026-08-28");
    expect((await call(`/stays/${id}/assign`, "POST", { roomNumber: "102" })).status).toBe(200);
    const res = await call(`/stays/${id}/check-in`, "POST",
      { roomNumber: "103", adults: 1, idSkipReason: "Test" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await state("102")).toBe("clean");
  });
});

describe("FD-12 · a room a guest left is dirty, even while a later booking holds it", () => {
  it("is sent to cleaning at check-out", async () => {
    const now = await booking(`${CODE}-NOW`, "2026-08-26", "2026-08-28");
    expect((await call(`/stays/${now}/check-in`, "POST",
      { roomNumber: "104", adults: 1, idSkipReason: "Test" })).status).toBe(200);
    const later = await booking(`${CODE}-LATER`, "2026-09-02", "2026-09-04");
    expect((await call(`/stays/${later}/assign`, "POST", { roomNumber: "104" })).status).toBe(200);

    const out = await call(`/stays/${now}/check-out`, "POST", {});
    expect(out.status, await out.clone().text()).toBe(200);
    expect(await state("104")).toBe("dirty");
  });
});
