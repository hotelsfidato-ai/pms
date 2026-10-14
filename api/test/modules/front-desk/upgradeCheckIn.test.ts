import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   AN UPGRADE AT CHECK-IN (the owner's D27-328 (1), 15 October)

   Assign room gives a room of another type ("Another type is allowed - it
   will be noted on the assignment") and answers typeChanged. The check-in
   then refused that very room: "That room is a different type from the one
   booked." - a dead end at the desk, proved by the verifier.

   Now the check-in takes a room of another type and notes it as Assign room
   does (typeChanged and the room's type, said to the clerk). The booking's
   type and its rate do not move: the guest keeps the booked rate. The stay
   read says the room's own type, so the panel stops calling a Deluxe room
   "Standard".
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "UPG";
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

/** A Standard booking at ₹2,000 a night, arriving on the hotel's day. */
async function booking(reference: string) {
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                               check_in, check_out, agreed_rate, status)
     values ($1, $2, (select id from guests where full_name = 'Upgrade guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             date '2026-08-26', date '2026-08-28', 2000, 'confirmed')
     returning id::text`, [hotelId, reference]))[0]!.id;
}

const checkIn = (id: string, roomNumber: string) =>
  call(`/stays/${id}/check-in`, "POST", { roomNumber, adults: 1, idSkipReason: "Test" });

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Upgrade Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    /* Rooms ready from midnight: never "early by the hour" whenever this runs. */
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,102)", [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'DLX',2::smallint,201,203)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Upgrade guest')");
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
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table night_audit_runs enable trigger user");
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("D27-328 (1) · check-in takes the upgrade Assign room gave", () => {
  it("checks a Standard booking into the Deluxe room Assign room gave it, and notes it", async () => {
    const id = await booking(`${CODE}-ASSIGNED`);
    const assigned = await call(`/stays/${id}/assign`, "POST", { roomNumber: "201" });
    expect(await assigned.json()).toMatchObject({ ok: true, typeChanged: true, typeName: "Deluxe" });

    const res = await checkIn(id, "201");
    expect(res.status, await res.clone().text()).toBe(200);
    /* Noted as Assign room notes it: said to the clerk, by the same two fields. */
    expect(await res.json()).toEqual({ ok: true, typeChanged: true, typeName: "Deluxe" });

    /* The booking keeps its type and its rate: the first night is the booked ₹2,000. */
    const [r] = await sql<{ status: string; type: string; rate: string; night: string; room: string }>(
      `select r.status, rt.code as type, r.agreed_rate::text as rate,
              (select fp.amount::text from folio_postings fp join folios f on f.id = fp.folio_id
                where f.reservation_id = r.id and fp.category = 'room') as night,
              (select rm.number from room_assignments ra join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id and ra.released_at is null) as room
         from reservations r join room_types rt on rt.id = r.room_type_id
        where r.id = $1`, [id]);
    expect(r).toEqual({ status: "checked_in", type: "STD", rate: "2000.00", night: "2000.00", room: "201" });
  });

  it("the stay read says the room's own type beside the type booked", async () => {
    const id = (await sql<{ id: string }>(
      "select id::text from reservations where reference = $1", [`${CODE}-ASSIGNED`]))[0]!.id;
    const stay = (await (await call(`/stays/${id}`)).json()) as { roomNumber: string; roomType: string; givenRoomType?: string };
    expect(stay).toMatchObject({ roomNumber: "201", roomType: "Standard", givenRoomType: "Deluxe" });
  });

  it("takes another type picked at the desk too, and says nothing extra for the type booked", async () => {
    const other = await booking(`${CODE}-DESK`);
    const up = await checkIn(other, "202");
    expect(up.status, await up.clone().text()).toBe(200);
    expect(await up.json()).toEqual({ ok: true, typeChanged: true, typeName: "Deluxe" });

    const same = await booking(`${CODE}-SAME`);
    const res = await checkIn(same, "101");
    expect(await res.json()).toEqual({ ok: true, typeChanged: false, typeName: "Standard" });
    const stay = (await (await call(`/stays/${same}`)).json()) as Record<string, unknown>;
    expect(stay["roomType"]).toBe("Standard");
    expect("givenRoomType" in stay).toBe(false);
  });
});
