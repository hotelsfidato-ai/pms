import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE FRONT DESK'S RULES, PER HOTEL (the owner's D27-243, D27-246; 187)

   3.1-3.6 are set on Settings › Operations through PATCH /:code/front-desk
   and read by every screen from GET /api/hotels. 3.2: a hotel may take the
   desk's overbooking away. 3.3: an advance before check-in - none, the
   first night or the whole stay - refused at check-in with the amount owed;
   never asked of a booking-site booking prepaid there, nor of a company's.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FRL";
const TODAY = "2026-08-26";
let hotelId = "";
let companyId = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const rules = (body: object) => call("/front-desk", "PATCH", body);

async function booking(reference: string, to: string, more: { source?: string; company?: boolean } = {}) {
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status, source, company_id)
     values ($1, $2, (select id from guests where full_name = 'Rules guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $4::date, 2000, 'confirmed', $5, $6)
     returning id::text`,
    [hotelId, reference, TODAY, to, more.source ?? "direct", more.company ? companyId : null]))[0]!.id;
}

const checkIn = (id: string, room: string, more: object = {}) =>
  call(`/stays/${id}/check-in`, "POST", { roomNumber: room, adults: 1, idSkipReason: "Test", ...more });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Rules Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '23:59'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,106)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Rules guest')");
    companyId = (await db.query<{ id: string }>(
      "insert into companies (name) values ('FRL Travels') returning id::text")).rows[0]!.id;
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
    await db.query("delete from payments where posting_id in (select id from folio_postings where hotel_id = $1)", [hotelId]);
    await db.query("delete from folio_postings where hotel_id = $1", [hotelId]);
    await db.query("delete from folios where hotel_id = $1", [hotelId]);
    /* The group the 3.2 case booked leads from this hotel: let go of it first. */
    const groups = (await db.query<{ id: string }>(
      "update reservation_groups set lead_hotel_id = null where lead_hotel_id = $1 returning id", [hotelId])).rows.map((g) => g.id);
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("delete from reservation_groups where id = any($1::uuid[])", [groups]);
    await db.query("delete from companies where id = $1", [companyId]);
    await db.query("alter table night_audit_runs enable trigger user");
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("the rules are set on Settings and read by every screen", () => {
  it("refuses a value that is not one of the choices, in a sentence", async () => {
    const res = await rules({ defaultPaymentMethod: "Bill to company" });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("The default way of paying is Cash, UPI, Credit Card or Debit Card.");
    expect((await rules({ weekendDays: [5, 7] })).status).toBe(409);
  });

  it("saves them, and GET /api/hotels gives them to the screens", async () => {
    const res = await rules({
      defaultPaymentMethod: "UPI", weekendDays: [5, 6], defaultIdType: "aadhaar",
      defaultNationality: "in", defaultTitle: "Ms",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const list = (await (await app.request("/api/hotels", { headers: { "x-dev-staff-id": "dev-owner" } }))
      .json()) as { hotels: Array<{ code: string; deskRules: unknown }> };
    expect(list.hotels.find((h) => h.code === CODE)?.deskRules).toMatchObject({
      defaultPaymentMethod: "UPI", deskMayOverbook: true, advanceBeforeCheckIn: "none",
      weekendDays: [5, 6], defaultIdType: "aadhaar", defaultNationality: "IN", defaultTitle: "Ms",
      /* The hotel's ways of paying that are On, in order (191, D27-259). */
      paymentMethods: [
        { label: "Cash", kind: "cash" }, { label: "UPI", kind: "upi" },
        { label: "Credit Card", kind: "card" }, { label: "Debit Card", kind: "card" },
        { label: "Bill to company", kind: "city_ledger" }],
    });
  });
});

describe("3.2 · the desk may overbook, until the hotel says not", () => {
  const book = async () => {
    const [d] = await sql<{ source: string; type: string }>(
      `select app.walk_in_source()::text as source,
              (select id::text from room_types where hotel_id = $1 and code = 'STD') as type`,
      [hotelId]);
    return call("/bookings", "POST", {
      guestName: "Big party", checkIn: "2026-09-10", checkOut: "2026-09-11",
      bookingSourceId: d!.source,
      lines: [{ roomTypeId: d!.type, mealPlan: "EP", adults: 1, rooms: 7, agreedRate: 2000 }],
    });
  };

  it("refuses the desk's booking past a full house when switched off", async () => {
    expect((await rules({ deskMayOverbook: false })).status).toBe(200);
    const res = await book();
    expect(res.status).toBe(409);
  });

  it("takes it, as before, when switched on", async () => {
    expect((await rules({ deskMayOverbook: true })).status).toBe(200);
    const res = await book();
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

describe("3.3 · an advance before check-in", () => {
  it("refuses the first night owed, with the amount, and the screen reads the same figure", async () => {
    expect((await rules({ advanceBeforeCheckIn: "first_night" })).status).toBe(200);
    const id = await booking(`${CODE}-ONE`, "2026-08-28");
    const res = await checkIn(id, "101");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(
      "An advance of ₹2,100 is owed before check-in (the first night ₹2,100, paid ₹0). Take it on the Bill tab.");
    const read = (await (await call(`/stays/${id}/express-check-in`)).json()) as { advance: { owed: number } };
    expect(read.advance.owed).toBe(2100);

    /* Paid on the stay's own bill, it checks in. */
    const paid = await call(`/stays/${id}/payments`, "POST", { method: "UPI", amount: 2100, heldAsCredit: true });
    expect(paid.status, await paid.clone().text()).toBe(200);
    const again = await checkIn(id, "101");
    expect(again.status, await again.clone().text()).toBe(200);
  });

  it("asks every night's for the whole stay", async () => {
    expect((await rules({ advanceBeforeCheckIn: "whole_stay" })).status).toBe(200);
    const id = await booking(`${CODE}-ALL`, "2026-08-28");
    expect(await reason(await checkIn(id, "102"))).toBe(
      "An advance of ₹4,200 is owed before check-in (the whole stay ₹4,200, paid ₹0). Take it on the Bill tab.");
  });

  it("never asks a booking-site booking prepaid there - only once the desk unticks it", async () => {
    const prepaid = await booking(`${CODE}-OTA1`, "2026-08-28", { source: "ota" });
    expect((await checkIn(prepaid, "103")).status).toBe(200);
    const atHotel = await booking(`${CODE}-OTA2`, "2026-08-28", { source: "ota" });
    const res = await checkIn(atHotel, "104", { prepaidOnSite: false });
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/^An advance of ₹4,200 is owed/);
  });

  it("never asks a booking billed to a company", async () => {
    const id = await booking(`${CODE}-CO`, "2026-08-28", { company: true });
    const res = await checkIn(id, "105");
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
