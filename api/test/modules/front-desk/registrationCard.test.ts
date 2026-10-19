import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST REGISTRATION CARD (the owner's D27-344, D27-345; 19 October)

   Its number is given at check-in: 1, 2, 3 per hotel, once, never shared by
   two check-ins at once; a stay checked in before the numbers has none. The
   card prints Aadhaar as its last four only, and the hotel's house policies.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FGR";
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

/* A booking for today with a guest of its own, as the desk would take it. */
async function booking(reference: string) {
  const [g] = await sql<{ id: string }>(
    "insert into guests (full_name, nationality) values ($1, 'IN') returning id::text", [`Card ${reference}`]);
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status, is_complimentary)
     values ($1, $2, $3, (select id from room_types where hotel_id = $1 and code = 'STD'),
             date '2026-08-25', date '2026-08-27', 0, 'confirmed', true)
     returning id::text`, [hotelId, reference, g!.id]))[0]!.id;
}
const checkIn = (id: string, room: string) =>
  call(`/stays/${id}/check-in`, "POST", {
    roomNumber: room, adults: 1,
    identity: { idType: "aadhaar", idNumber: "789012345674", nationality: "IN" },
  });
const number = async (id: string) =>
  (await sql<{ n: number | null }>("select gr_card_no as n from reservations where id = $1", [id]))[0]!.n;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Card Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '23:59',
                         house_policies = array['Photo ID at check-in.', 'No smoking in the rooms.']
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,106)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
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

describe("the registration card's number", () => {
  it("is given at check-in, 1 then 2, and two check-ins at once never share one", async () => {
    const first = await booking(`${CODE}-1`);
    expect(await number(first), "none before check-in").toBeNull();
    const res = await checkIn(first, "101");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await number(first)).toBe(1);

    const [a, b] = [await booking(`${CODE}-2`), await booking(`${CODE}-3`)];
    const both = await Promise.all([checkIn(a, "102"), checkIn(b, "103")]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect([await number(a), await number(b)].sort()).toEqual([2, 3]);
  });

  it("is kept by a stay checked in again, and never given to one checked in before the numbers", async () => {
    const again = await booking(`${CODE}-4`);
    await checkIn(again, "104");
    const given = await number(again);
    await sql("update reservations set status = 'confirmed' where id = $1", [again]);
    await sql("update reservations set status = 'checked_in' where id = $1", [again]);
    expect(await number(again)).toBe(given);

    /* Checked in before 230: in the house with no number. Another change to
       it gives it none (D27-345: only a check-in from now on). */
    const before = await booking(`${CODE}-5`);
    await checkIn(before, "105");
    await sql("update reservations set gr_card_no = null where id = $1", [before]);
    await sql("update reservations set status = 'checked_in', notes = 'x' where id = $1", [before]);
    expect(await number(before)).toBeNull();
  });
});

describe("the registration card", () => {
  it("prints Aadhaar as its last four, the number, and the house policies", async () => {
    const id = await booking(`${CODE}-6`);
    await checkIn(id, "106");
    const res = await call(`/stays/${id}/registration-card`);
    expect(res.status, await res.clone().text()).toBe(200);
    const card = await res.json() as {
      grCardNo: number | null; housePolicies: string[];
      guest: { idType: string; idNumber: string }; stay: { room: string };
    };
    expect(card.guest).toMatchObject({ idType: "aadhaar", idNumber: "XXXX XXXX 5674" });
    expect(JSON.stringify(card), "the full number never leaves the API").not.toContain("789012345674");
    expect(card.grCardNo).toBeGreaterThan(0);
    expect(card.stay.room).toBe("106");
    expect(card.housePolicies).toEqual(["Photo ID at check-in.", "No smoking in the rooms."]);
  });

  it("is refused to a role that may not read guests' IDs", async () => {
    const id = await booking(`${CODE}-7`);
    const [hk] = await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid)
       values ('fgr-housekeeping@fidato.in', 'FGR Housekeeping', 'test-uid-fgr-hk')
       on conflict (email) do update set is_active = true returning id::text`);
    await sql("delete from staff_hotels where staff_id = $1", [hk!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'housekeeping')", [hk!.id, hotelId]);
    const res = await app.request(`/api/hotels/${CODE}/stays/${id}/registration-card`, {
      headers: { "x-dev-staff-id": hk!.id },
    });
    expect(res.status).toBe(403);
  });
});
