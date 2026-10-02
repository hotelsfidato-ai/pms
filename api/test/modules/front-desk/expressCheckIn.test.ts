import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   EXPRESS CHECK-IN (the owner's D27-236 3.4, D27-242; 2 October)

   An Indian guest whose ID the desk confirmed from THIS stay's online check-in
   just collects the key: nothing retyped, the document shown masked. A
   submission waiting, a document from an earlier visit, or a foreign guest
   (Form III) - the full desk check, as before. Decided by the server.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FEX";
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

async function booking(reference: string, from: string, to: string) {
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status, is_complimentary)
     values ($1, $2, (select id from guests where full_name = 'Express guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $4::date, 0, 'confirmed', true)
     returning id::text`, [hotelId, reference, from, to]))[0]!.id;
}

/* A guest of their own, so nationality and documents are this case's. */
async function guestStay(reference: string, nationality: string) {
  const [g] = await sql<{ id: string }>(
    "insert into guests (full_name, nationality) values ($1, $2) returning id::text",
    [`Express ${reference}`, nationality]);
  const id = await booking(reference, "2026-08-26", "2026-08-28");
  await sql("update reservations set guest_id = $2 where id = $1", [id, g!.id]);
  return { id, guest: g!.id };
}
/* The guest's online submission for THIS stay, waiting or confirmed. */
async function submitted(stay: { id: string; guest: string }, status: "waiting" | "confirmed", type = "aadhaar") {
  await sql(
    `insert into guest_detail_submissions (hotel_id, reservation_id, guest_id, id_type, id_number,
                                           status, handled_by, handled_at)
     values ($1, $2, $3, $4, '123456789012', $5,
             case when $5 = 'waiting' then null else (select id from staff where email = 'owner@fidato.in') end,
             case when $5 = 'waiting' then null else now() end)`,
    [hotelId, stay.id, stay.guest, type, status]);
}
const express = async (id: string) =>
  (await (await call(`/stays/${id}/express-check-in`)).json()) as
    { express: boolean; document?: { type: string; number: string } };
const checkIn = (id: string, room: string) =>
  call(`/stays/${id}/check-in`, "POST", { roomNumber: room, adults: 1 });

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Express Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '23:59'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,106)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Express guest')");
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
    await db.query("delete from guest_detail_submissions where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table night_audit_runs enable trigger user");
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("express check-in", () => {
  it("lets an Indian guest confirmed online for THIS stay just collect the key", async () => {
    const stay = await guestStay(`${CODE}-YES`, "IN");
    await submitted(stay, "confirmed");
    expect(await express(stay.id)).toEqual({
      express: true, document: { type: "aadhaar", number: "••••••••9012" } });
    const res = await checkIn(stay.id, "101");
    expect(res.status, await res.clone().text()).toBe(200);
    const [r] = await sql<{ status: string; notes: string | null }>(
      "select status, notes from reservations where id = $1", [stay.id]);
    expect(r).toEqual({ status: "checked_in", notes: null });
  });

  it("is not for a submission still waiting for the desk", async () => {
    const stay = await guestStay(`${CODE}-WAIT`, "IN");
    await submitted(stay, "waiting");
    expect(await express(stay.id)).toEqual({ express: false });
    expect((await checkIn(stay.id, "102")).status).toBe(409);
  });

  it("is not for a document kept from an earlier visit", async () => {
    const stay = await guestStay(`${CODE}-OLD`, "IN");
    await sql(
      `insert into guest_documents (guest_id, id_type, id_number)
       values ($1, 'aadhaar', '123456789012')`, [stay.guest]);
    expect(await express(stay.id)).toEqual({ express: false });
    expect((await checkIn(stay.id, "103")).status).toBe(409);
  });

  it("is never for a foreign guest: Form III is the desk's", async () => {
    const stay = await guestStay(`${CODE}-GB`, "GB");
    await submitted(stay, "confirmed", "passport");
    expect(await express(stay.id)).toEqual({ express: false });
    expect((await checkIn(stay.id, "104")).status).toBe(409);
  });
});
