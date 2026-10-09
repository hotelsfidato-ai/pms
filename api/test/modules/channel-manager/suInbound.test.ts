import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { useTransportForTests } from "../../../src/modules/channel-manager/su/runtime.ts";
import { inbound, resetDoorLimitForTests, PUSHES_A_MINUTE } from "../../../src/modules/channel-manager/inbound/door.ts";
import { TOKEN_SANDBOX, ARI_SUCCESS, ok200 } from "./suExamples.ts";

/* ══════════════════════════════════════════════════════════════════
   PART 4 — THE DOOR SU PUSHES BOOKINGS THROUGH (D17-79)

   What must hold:
   1. No key on the server: the door is shut. A wrong key: 401, nothing
      stored, no detail given.
   2. A card number, CVC or token in SU's message is NEVER written anywhere
      (D17-83) - not in the row, not in the payload it keeps.
   3. The message is stored BEFORE it is worked out, and SU is told we have
      it, so SU stops resending and does not drop it after an hour.
   4. The same message twice is one row, answered the same way, and SU is not
      told twice.
   5. A booking for a room that is no longer free makes NO booking, and those
      dates go back to SU as 0 rooms left at once (D17-80).
   6. A hotel that is not connected, or not switched on, is refused - SU keeps
      the booking and tells the property, rather than it vanishing here.
   7. A flood is refused.
   8. (D27-183) A new booking becomes a booking through reservations' door,
      once however often SU sends it; a cancellation cancels it; a change, a
      site with no SU code, unequal night prices and another currency wait
      for a person with the reason; a failure is said on the list; the GM
      reads the list.

   The door is mounted here the way the master mounts it in server.ts
   (`/api/channel`, outside the staff sign-in), because this copy's server.ts
   is the master's file.
   ══════════════════════════════════════════════════════════════════ */

const KEY = "test-push-key-DO-NOT-SHOW";
const SU_HOTEL = "FIDATO-5EL";

let hotelId: string;
let superiorId: string;
let deluxeId: string;
let serviceId: string;
let first: string;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/* SU's own booking message, from its "Response of Reservation Information",
   carrying the card fields SU sends so the test can prove they are dropped. */
const message = (over: Record<string, unknown> = {}, room: Record<string, unknown> = {}) => ({
  reservations: [{
    booked_at: "2026-09-18 06:18:41",
    commissionamount: "450.00",
    currencycode: "INR",
    paymenttype: "Hotel Collect",
    hotel_id: SU_HOTEL,
    hotel_name: "5 Elements",
    customer: {
      first_name: "Asha", last_name: "Rao",
      email: "asha@example.com", telephone: "+919800000000",
      remarks: "late arrival",
      cc_number: "4111111111111111", cc_cvc: "737", cc_name: "ASHA RAO",
      cc_expiration_date: "0929", cc_type: "Visa",
      cc_token: "tok_live_SHOULD_NEVER_BE_STORED",
      cc_vault_token: "vault_SHOULD_NEVER_BE_STORED",
    },
    rooms: [{
      arrival_date: addDays(first, 30), departure_date: addDays(first, 32),
      id: "DLX", roomreservation_id: "177424661", roomstaystatus: "new",
      guest_name: "Asha Rao", numberofadults: "2", numberofchildren: "0",
      totalprice: "9000.00",
      price: [
        { date: addDays(first, 30), rate_id: "EP", mealplan: "Room only", pricebeforetax: "4500.00", tax: "540.00" },
        { date: addDays(first, 31), rate_id: "EP", mealplan: "Room only", pricebeforetax: "4500.00", tax: "540.00" },
      ],
      ...room,
    }],
    affiliation: { pos: "booking.com", source: "Booking.com", OTA_Code: "19" },
    channel_booking_id: "6026344507",
    id: "6026344507_" + SU_HOTEL,
    reservation_notif_id: "175325153100890355556",
    status: "new",
    totalprice: "10080.00",
    totaltax: "1080.00",
    su_payments: { action: "charge", tokenid: "tok_SHOULD_NEVER_BE_STORED", pgid: "pg1" },
    pgtransactionid: "pg-txn-SHOULD-NEVER-BE-STORED",
    ...over,
  }],
});

const push = (body: unknown, key: string | null = KEY) =>
  inbound.request("/su/reservations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key === null ? {} : { "x-su-key": key }),
    },
    body: JSON.stringify(body),
  });

const su = () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  useTransportForTests(async (req) => {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/auth/generate-access-token")) return ok200(TOKEN_SANDBOX);
    calls.push({ path, body: JSON.parse(req.body ?? "{}") });
    return ok200(path.endsWith("/availability") ? ARI_SUCCESS : { Status: "Success" });
  });
  return calls;
};

const rows = async (sql: string, params: unknown[] = []) => {
  const db = await admin();
  try { return (await db.query(sql, params)).rows as Record<string, unknown>[]; }
  finally { await db.end(); }
};

/* The Deluxe room at `offset` days out, two nights, at these prices: each
   test its own nights, so a booking one makes does not fill another's. */
const stay = (offset: number, prices = ["4500.00", "4500.00"]) => ({
  arrival_date: addDays(first, offset), departure_date: addDays(first, offset + prices.length),
  price: prices.map((p, i) => ({
    date: addDays(first, offset + i), rate_id: "EP", mealplan: "Room only", pricebeforetax: p, tax: "540.00",
  })),
});

/* Q1 (D27-183): a person picks SU's code for Booking.com on Booking sources.
   The seeded code is not SU's, so a test that books sets it, and it is put back. */
let bookingComCode: string | null = null;
const bookingComIsSu19 = () =>
  rows("update booking_sources set channel_code = '19' where lower(name) = 'booking.com'");

const bookedHere = (suId: string) => rows(
  `select r.reference, r.status, r.agreed_rate::text as rate, r.meal_plan, r.adults,
          r.commission_amount::text as commission, r.notes, r.cancel_reason, bs.name as source
     from reservations r join booking_sources bs on bs.id = r.booking_source_id
    where r.hotel_id = $1 and r.ota_reference = $2 order by r.ota_line`, [hotelId, suId]);

const outcomeOf = async (suId: string) => (await rows(
  `select outcome, outcome_reason as reason, cardinality(reservation_ids) as made
     from channel_bookings where hotel_id = $1 and su_booking_id = $2
    order by received_at desc, id desc limit 1`, [hotelId, suId]))[0]!;

beforeAll(async () => {
  const db = await admin();
  try {
    hotelId = (await db.query<{ id: string }>("select id::text from hotels where code = '5EL'")).rows[0]!.id;
    first = (await db.query<{ d: string }>(
      "select greatest(business_date, (now() at time zone timezone)::date)::text as d from hotels where id = $1",
      [hotelId])).rows[0]!.d;
    const types = (await db.query<{ id: string; code: string }>(
      "select id::text, code from room_types where hotel_id = $1", [hotelId])).rows;
    superiorId = types.find((t) => t.code === "SUP")!.id;
    deluxeId = types.find((t) => t.code === "DLX")!.id;

    serviceId = (await db.query<{ id: string }>(
      `insert into staff (email, full_name) values ('cm4-service@fidato.in', 'CMTEST4 service')
       on conflict (email) do update set is_active = true returning id::text`)).rows[0]!.id;
    await db.query(
      `insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'read_only')
       on conflict (staff_id, hotel_id) do update set role = 'read_only'`, [serviceId, hotelId]);
    bookingComCode = (await db.query<{ c: string | null }>(
      "select channel_code as c from booking_sources where lower(name) = 'booking.com'")).rows[0]!.c;
  } finally { await db.end(); }
});

/* On SU, switched on for the channel manager (the master's 108), with a
   service account: everything the door needs before it will take anything. */
const connected = async (switchedOn = true) => {
  const db = await admin();
  try {
    await db.query(
      `insert into channel_hotels (hotel_id, su_hotel_id, on_su, run_as) values ($1, $2, true, $3)`,
      [hotelId, SU_HOTEL, serviceId]);
    await db.query(
      `insert into channel_room_types (room_type_id, hotel_id, su_room_id, su_room_type, max_children, is_connected, on_su)
       values ($1, $3, 'SUP', 9, 1, true, 'active'), ($2, $3, 'DLX', 7, 2, true, 'active')`,
      [superiorId, deluxeId, hotelId]);
    await db.query(
      `insert into channel_rate_plans (hotel_id, meal_plan, su_rate_plan_id, su_meal_plan, is_connected, on_su)
       values ($1, 'EP', 'EP', 15, true, 'active')`, [hotelId]);
    if (switchedOn) {
      await db.query(
        `insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'channel_manager', true)
         on conflict (hotel_id, module) do update set is_enabled = true`, [hotelId]);
    }
  } finally { await db.end(); }
};

beforeEach(() => {
  resetDoorLimitForTests();
  process.env["SU_PUSH_KEY"] = KEY;
  process.env["SU_ENVIRONMENT"] = "sandbox";
  process.env["SU_CLIENT_ID"] = "test-client";
  process.env["SU_CLIENT_SECRET"] = "test-secret";
});

afterEach(async () => {
  for (const n of ["SU_PUSH_KEY", "SU_ENVIRONMENT", "SU_CLIENT_ID", "SU_CLIENT_SECRET"]) delete process.env[n];
  useTransportForTests(null);
  const db = await admin();
  try {
    /* What the door booked: its folios, rooms and guests. */
    const made = (await db.query<{ id: string; guest_id: string }>(
      `select id::text, guest_id::text from reservations
        where hotel_id = $1 and ota_reference like '%\\_' || $2`, [hotelId, SU_HOTEL])).rows;
    await db.query("delete from folios where reservation_id = any($1::uuid[])", [made.map((r) => r.id)]);
    await db.query("delete from reservations where id = any($1::uuid[])", [made.map((r) => r.id)]);
    await db.query("alter table guests disable trigger guests_no_delete");
    try {
      await db.query("delete from guests where id = any($1::uuid[])", [made.map((r) => r.guest_id)]);
    } finally {
      await db.query("alter table guests enable trigger guests_no_delete");
    }
    await db.query("update booking_sources set channel_code = $1 where lower(name) = 'booking.com'",
      [bookingComCode]);
    for (const t of ["channel_bookings", "channel_ari_sent", "channel_ari_pushes",
                     "channel_room_types", "channel_rate_plans", "channel_hotels"]) {
      await db.query(`delete from ${t} where hotel_id = $1`, [hotelId]);
    }
    await db.query("delete from hotel_modules where hotel_id = $1 and module = 'channel_manager'", [hotelId]);
    await db.query("delete from room_blocks where hotel_id = $1 and note = 'CMTEST4'", [hotelId]);
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("delete from staff_hotels where staff_id = $1", [serviceId]);
    await db.query("update staff set is_active = false where id = $1", [serviceId]);
  } finally { await db.end(); }
  await closePool();
});

describe("the key", () => {
  it("shuts the door when the server has no key, and refuses a wrong one without saying why", async () => {
    await connected();
    delete process.env["SU_PUSH_KEY"];
    expect((await push(message())).status).toBe(503);

    process.env["SU_PUSH_KEY"] = KEY;
    const wrong = await push(message(), "not-the-key");
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(await wrong.json())).not.toContain(KEY);
    expect((await push(message(), null)).status).toBe(401);
    expect(await rows("select id from channel_bookings where hotel_id = $1", [hotelId])).toHaveLength(0);
  });

  it("refuses a flood", async () => {
    /* The limit counts by the clock's minute, and 121 pushes take about a
       second: one run in fifty crossed a minute, the count started again and
       the last push got 409 (MEMORY 395). So the clock - Date alone, never the
       timers - is held at the start of a minute. */
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00.000Z"));
    try {
      /* The cheap path: a hotel SU does not know. Every one still counts. */
      const none = { reservations: [{ hotel_id: "NOT-CONNECTED", id: "x_1", reservation_notif_id: "n1", status: "new", rooms: [] }] };
      for (let i = 0; i < PUSHES_A_MINUTE; i += 1) {
        expect((await push(none)).status).toBe(409);
      }
      expect((await push(none)).status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a booking SU pushes", () => {
  it("is stored whole, without one card field, and acknowledged to SU", async () => {
    await connected();
    const calls = su();
    const res = await push(message());
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await res.json()).toEqual({ Status: "Success" });

    const [row] = await rows(
      `select guest_name, arrival::text, departure::text, rooms, status, channel_code,
              channel_name, total::text, commission::text, acknowledged_at, outcome,
              payload::text as payload, (payload->>'cardFieldsRemoved')::int as removed
         from channel_bookings where hotel_id = $1`, [hotelId]);
    expect(row).toMatchObject({
      guest_name: "Asha Rao", arrival: addDays(first, 30), departure: addDays(first, 32),
      rooms: 1, status: "new", channel_code: "19", channel_name: "Booking.com",
      total: "10080.00", commission: "450.00",
    });
    expect(row!["acknowledged_at"]).not.toBeNull();

    /* Not one card field, anywhere in what was kept. */
    const kept = row!["payload"] as string;
    for (const secret of ["4111111111111111", "737", "tok_live_SHOULD_NEVER_BE_STORED",
                          "vault_SHOULD_NEVER_BE_STORED", "tok_SHOULD_NEVER_BE_STORED",
                          "pg-txn-SHOULD-NEVER-BE-STORED", "cc_number", "cc_cvc", "su_payments"]) {
      expect(kept, secret).not.toContain(secret);
    }
    /* What was kept is still the booking. */
    expect(kept).toContain("Asha");
    expect(kept).toContain("4500.00");
    expect(Number(row!["removed"])).toBeGreaterThan(0);

    /* SU was told we have it, by its own endpoint and its own shape. */
    const ack = calls.find((x) => x.path.endsWith("/Reservation_notif"));
    expect(ack?.body).toEqual({
      hotelid: SU_HOTEL,
      reservation_notif: { reservation_notif_id: ["175325153100890355556"] },
    });
  });

  it("becomes a booking through reservations' door, once, however often SU sends it (D27-183)", async () => {
    await connected();
    await bookingComIsSu19();
    su();
    const id = "6026344507_" + SU_HOTEL;
    expect((await push(message({}, stay(40)))).status).toBe(200);

    expect(await outcomeOf(id)).toMatchObject({ outcome: "created", made: 1 });
    expect(String((await outcomeOf(id))["reason"])).toMatch(/^Booked as FH-/);
    const booked = await bookedHere(id);
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({
      status: "confirmed", rate: "4500.00", meal_plan: "EP", adults: 2,
      commission: "450.00", source: "Booking.com",
    });
    expect(String(booked[0]!["notes"])).toContain("late arrival");

    /* The same booking under a new notification: the first booking, not a second. */
    await push(message({ reservation_notif_id: "n-again" }, stay(40)));
    expect(await outcomeOf(id)).toMatchObject({ outcome: "ignored", made: 0 });
    expect(await bookedHere(id)).toHaveLength(1);
  });

  it("waits for a person, with the reason, for what it cannot book by itself (Q1, Q2, Q7)", async () => {
    await connected();
    su();
    /* Q1: Booking.com still carries the seeded code, not SU's 19. */
    await push(message({ id: "q1_" + SU_HOTEL, reservation_notif_id: "n-q1" }, stay(44)));
    await bookingComIsSu19();
    /* Q2: two nights at two prices, each listed. */
    await push(message({ id: "q2_" + SU_HOTEL, reservation_notif_id: "n-q2" },
      stay(48, ["4500.00", "5200.00"])));
    /* Q7: not in rupees, never converted. */
    await push(message({ id: "q7_" + SU_HOTEL, reservation_notif_id: "n-q7", currencycode: "USD" }, stay(52)));

    const q1 = await outcomeOf("q1_" + SU_HOTEL);
    expect(q1["outcome"]).toBe("needs_attention");
    expect(String(q1["reason"])).toContain("SU's code 19");
    expect(String(q1["reason"])).toContain("Booking sources");
    const q2 = String((await outcomeOf("q2_" + SU_HOTEL))["reason"]);
    expect(q2).toContain(`${addDays(first, 48)} 4500.00, ${addDays(first, 49)} 5200.00`);
    expect(String((await outcomeOf("q7_" + SU_HOTEL))["reason"])).toContain("USD");
    for (const q of ["q1", "q2", "q7"]) expect(await bookedHere(`${q}_${SU_HOTEL}`), q).toHaveLength(0);
  });

  it("cancels the booking here when the site cancels it, under the site's policy (Q4)", async () => {
    await connected();
    await bookingComIsSu19();
    su();
    const id = "cancel_" + SU_HOTEL;
    await push(message({ id, reservation_notif_id: "n-new" }, stay(56)));
    expect(await bookedHere(id)).toHaveLength(1);

    await push(message({ id, reservation_notif_id: "n-cancel", status: "cancelled",
                         cancelreason: "Guest changed plans" }, stay(56)));
    expect(await outcomeOf(id)).toMatchObject({ outcome: "cancelled" });
    const [room] = await bookedHere(id);
    expect(room).toMatchObject({ status: "cancelled" });
    expect(String(room!["cancel_reason"])).toContain("Guest changed plans");
  });

  it("keeps a change for a person, the booking here and SU's side by side (Q3)", async () => {
    await connected();
    await bookingComIsSu19();
    su();
    const id = "change_" + SU_HOTEL;
    await push(message({ id, reservation_notif_id: "n-new" }, stay(60)));
    await push(message({ id, reservation_notif_id: "n-mod", status: "modified" },
      stay(60, ["4500.00", "4500.00", "4500.00"])));

    const changed = await outcomeOf(id);
    expect(changed["outcome"]).toBe("needs_attention");
    expect(String(changed["reason"])).toContain(`to ${addDays(first, 62)}`);
    expect(String(changed["reason"])).toContain(`Now: 1 room, ${addDays(first, 60)} to ${addDays(first, 63)}`);
    /* Nothing changed by itself. */
    expect((await rows("select check_out::text as d from reservations where hotel_id = $1 and ota_reference = $2",
      [hotelId, id]))[0]!["d"]).toBe(addDays(first, 62));
  });

  it("says on the list when working a booking out fails, instead of leaving it 'Just arrived'", async () => {
    await connected();
    await bookingComIsSu19();
    su();
    /* A price no booking can hold (numeric(12,2)): the database throws. */
    const res = await push(message({ id: "bad_" + SU_HOTEL, reservation_notif_id: "n-bad" },
      stay(64, ["100000000000.00", "100000000000.00"])));
    expect(res.status).toBe(200);
    const bad = await outcomeOf("bad_" + SU_HOTEL);
    expect(bad["outcome"]).toBe("needs_attention");
    expect(String(bad["reason"])).toContain("Working this booking out failed");
  });

  it("is one row and one acknowledgement however often SU sends it again", async () => {
    await connected();
    const calls = su();
    expect((await push(message())).status).toBe(200);
    expect((await push(message())).status).toBe(200);
    expect((await push(message())).status).toBe(200);

    expect(await rows("select id from channel_bookings where hotel_id = $1", [hotelId])).toHaveLength(1);
    expect(calls.filter((x) => x.path.endsWith("/Reservation_notif"))).toHaveLength(1);
  });

  it("refuses a room that is no longer free, and tells SU there is nothing left (D17-80)", async () => {
    await connected();
    /* Every Deluxe out of service for those nights: nothing is free. */
    const db = await admin();
    try {
      await db.query(
        `insert into room_blocks (hotel_id, room_id, from_date, to_date, reason, note)
         select $1, r.id, $2::date, $3::date, 'out_of_order', 'CMTEST4'
           from rooms r where r.room_type_id = $4 and r.is_active`,
        [hotelId, addDays(first, 30), addDays(first, 31), deluxeId]);
    } finally { await db.end(); }

    const calls = su();
    expect((await push(message())).status).toBe(200);

    const [row] = await rows(
      "select outcome, outcome_reason from channel_bookings where hotel_id = $1", [hotelId]);
    expect(row!["outcome"]).toBe("refused_no_room");
    expect(String(row!["outcome_reason"])).toContain("Deluxe");
    expect(await rows("select id from reservations where hotel_id = $1 and ota_reference is not null and ota_reference like '6026344507%'", [hotelId])).toHaveLength(0);

    /* SU heard at once: 0 rooms left on those dates, for that room. */
    const ari = calls.filter((x) => x.path.endsWith("/availability"));
    expect(ari.length).toBeGreaterThan(0);
    const sent = JSON.stringify(ari.map((x) => x.body));
    expect(sent).toContain("DLX");
    expect(sent).toContain("\"roomstosell\":\"0\"");
  });

  it("keeps a message whose date does not exist, and says so, rather than failing (CM-6)", async () => {
    await connected();
    su();
    const res = await push(message({ id: "day_" + SU_HOTEL, reservation_notif_id: "n-day" },
      { arrival_date: "2031-02-30", departure_date: "2031-03-02" }));
    expect(res.status, "stored, not a 500 that loses it").toBe(200);
    const kept = await outcomeOf("day_" + SU_HOTEL);
    expect(kept["outcome"]).toBe("needs_attention");
    expect(String(kept["reason"])).toContain("real arrival and departure");
  });

  it("keeps a room SU has not mapped for a person", async () => {
    await connected();
    su();
    await push(message({ id: "unmapped_1", reservation_notif_id: "n-unmapped" }, { id: "SUITE" }));
    const found = await outcomeOf("unmapped_1");
    expect(found["outcome"]).toBe("needs_attention");
    expect(String(found["reason"])).toContain("SUITE");
  });

  it("refuses a hotel it does not know, or one not switched on, and keeps nothing", async () => {
    su();
    const unknown = await push(message());
    expect(unknown.status).toBe(409);
    expect(JSON.stringify(await unknown.json())).toContain("not switched on");

    await connected(false);
    const off = await push(message());
    expect(off.status).toBe(409);
    expect(await rows("select id from channel_bookings where hotel_id = $1", [hotelId])).toHaveLength(0);
  });
});

describe("the list a person reads", () => {
  it("is the GM's as well as the owner's (Q6), refused to the desk, without a card field", async () => {
    await connected();
    su();
    await push(message());

    const db = await admin();
    let gmId = "";
    try {
      gmId = (await db.query<{ id: string }>(
        `insert into staff (email, full_name, firebase_uid) values ('cm4-gm@fidato.in', 'CMTEST4 gm', 'test-uid-cm4gm')
         on conflict (email) do update set is_active = true returning id::text`)).rows[0]!.id;
      await db.query(
        `insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'front_desk')
         on conflict (staff_id, hotel_id) do update set role = 'front_desk'`, [gmId, hotelId]);
    } finally { await db.end(); }

    const ownerId = (await rows("select id::text as id from staff where email = 'owner@fidato.in'"))[0]!["id"] as string;
    const get = (who: string) =>
      app.request("/api/hotels/5EL/channel-manager/bookings", { headers: { "x-dev-staff-id": who } });

    expect((await get(gmId)).status, "the desk").toBe(403);
    await rows("update staff_hotels set role = 'gm' where staff_id = $1 and hotel_id = $2", [gmId, hotelId]);
    const gm = await get(gmId);
    expect(gm.status, "the GM settles a refused booking (D17-80)").toBe(200);
    expect(await gm.text()).toContain("Asha Rao");
    const res = await get(ownerId);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Asha Rao");
    expect(text).toContain("Booking.com");
    expect(text).not.toContain("4111111111111111");
    expect(JSON.parse(text).bookings[0]).toMatchObject({ outcome: "needs_attention", acknowledged: true });

    const cleanup = await admin();
    try {
      await cleanup.query("delete from staff_hotels where staff_id = $1", [gmId]);
      await cleanup.query("update staff set is_active = false where id = $1", [gmId]);
    } finally { await cleanup.end(); }
  });
});
