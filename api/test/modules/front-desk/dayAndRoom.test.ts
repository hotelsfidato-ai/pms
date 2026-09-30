import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   FD-16 · THE HOTEL'S DAY, NOT A COLUMN THAT STOPPED MOVING
   FD-17 · A BOOKING TAKEN OUT OF ITS ROOM HOLDS NO ROOM

   FD-16: the check-in, the swap and the groups list fell back to
   `hotels.business_date`, which nothing moves once a night audit has run;
   the day is app.business_date, the day after the last closed one. So at
   FDP, with 25 August closed, the column says the 25th and the hotel is on
   the 26th.

   FD-17: `stays.ts` takes a released assignment too (a departed stay keeps
   its room on folios), so a confirmed booking taken out of the room it was
   given ahead still showed it - tile 204 named Lata Bhosale.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FDP";
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

async function booking(reference: string, from: string, to: string, status = "confirmed", groupId: string | null = null) {
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                               check_in, check_out, agreed_rate, status, group_id)
     values ($1, $2, (select id from guests where full_name = 'Day and room guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $4::date, 2000, $5, $6)
     returning id::text`, [hotelId, reference, from, to, status, groupId]))[0]!.id;
}

const checkIn = (id: string, roomNumber: string, businessDate?: string) =>
  call(`/stays/${id}/check-in`, "POST", {
    roomNumber, adults: 1, idSkipReason: "Test", ...(businessDate ? { businessDate } : {}),
  });

const heldFrom = async (id: string) => (await sql<{ d: string }>(
  `select from_date::text as d from room_assignments
    where reservation_id = $1 and released_at is null`, [id]))[0]?.d;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Day and Room Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    /* Rooms ready from midnight, so the wall clock never makes a check-in
       "early by the hour" whenever this runs. */
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,107)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Day and room guest')");
    /* The 25th is closed: the hotel is on the 26th, the column still says the 25th. */
    await db.query(
      `insert into night_audit_runs (hotel_id, business_date, status, completed_at)
       values ($1, date '2026-08-25', 'completed', now())`, [hotelId]);
  } finally { await db.end(); }
  const [d] = await sql<{ col: string; day: string }>(
    `select business_date::text as col, app.business_date(id)::text as day
       from hotels where id = $1`, [hotelId]);
  expect(d).toEqual({ col: "2026-08-25", day: "2026-08-26" });
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
    await db.query("delete from reservation_groups where name = 'FDP departed group'");
  } finally { await db.end(); }
  await closePool();
});

describe("FD-16 · a date left out is the hotel's day", () => {
  it("checks in a booking arriving today, not one 'arriving tomorrow'", async () => {
    const id = await booking(`${CODE}-TODAY`, "2026-08-26", "2026-08-28");
    const res = await checkIn(id, "101");
    expect(res.status, await res.clone().text()).toBe(200);
    const [r] = await sql<{ status: string; check_in: string }>(
      "select status, check_in::text from reservations where id = $1", [id]);
    expect(r).toEqual({ status: "checked_in", check_in: "2026-08-26" });
  });

  it("dates a swap from the hotel's day", async () => {
    const a = await booking(`${CODE}-SWAP-A`, "2026-08-26", "2026-08-29");
    const b = await booking(`${CODE}-SWAP-B`, "2026-08-26", "2026-08-29");
    expect((await checkIn(a, "102", "2026-08-26")).status).toBe(200);
    expect((await checkIn(b, "103", "2026-08-26")).status).toBe(200);

    const res = await call(`/stays/${a}/exchange`, "POST", { withStayId: b, reason: "Test swap" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await heldFrom(a)).toBe("2026-08-26");
    expect(await heldFrom(b)).toBe("2026-08-26");
  });

  it("leaves a group whose last guest left on the closed day out of the current groups", async () => {
    const [g] = await sql<{ id: string }>(
      "insert into reservation_groups (name) values ('FDP departed group') returning id::text");
    await booking(`${CODE}-GONE`, "2026-08-23", "2026-08-25", "checked_out", g!.id);
    const res = await call("/groups");
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("FDP departed group");
    expect(JSON.stringify(await (await call("/groups?scope=all")).json()))
      .toContain("FDP departed group");
  });
});

describe("D27-193 · a check-in that moves the arrival more than a day", () => {
  const early = (id: string, room: string, confirmMove?: boolean) =>
    call(`/stays/${id}/check-in`, "POST", {
      roomNumber: room, adults: 1, idSkipReason: "Test", earlyReason: "Came early",
      ...(confirmMove === undefined ? {} : { confirmMove }),
    });

  it("is refused until the move is confirmed, and nothing moves", async () => {
    const id = await booking(`${CODE}-MOVE`, "2026-08-31", "2026-09-02");
    const res = await early(id, "104");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toBe("Checking in now moves the arrival from 2026-08-31 to 2026-08-26: 7 nights. Confirm the move first.");
    const [r] = await sql<{ status: string; check_in: string }>(
      "select status, check_in::text from reservations where id = $1", [id]);
    expect(r).toEqual({ status: "confirmed", check_in: "2026-08-31" });

    expect((await early(id, "104", true)).status).toBe(200);
    const [after] = await sql<{ status: string; check_in: string }>(
      "select status, check_in::text from reservations where id = $1", [id]);
    expect(after).toEqual({ status: "checked_in", check_in: "2026-08-26" });
  });

  it("needs no confirming for a booking that arrives tomorrow", async () => {
    const id = await booking(`${CODE}-TOMORROW`, "2026-08-27", "2026-08-28");
    const res = await early(id, "105");
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

describe("the rack a stay shows is today's price in the new model (162, D27-188)", () => {
  it("is the base where a room type has a base and no old rack rate, not a dash", async () => {
    expect((await sql<{ r: string | null }>(
      "select base_rate::text as r from room_types where hotel_id = $1 and code = 'STD'", [hotelId]))[0]!.r,
      "no old rack rate on this room type").toBeNull();
    const [std] = await sql<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 and code = 'STD'", [hotelId]);
    const set = await call("/pricing/base", "PUT",
      { roomTypeId: std!.id, from: "2026-08-01", to: "2026-09-30", price: 2500 });
    expect(set.status, await set.clone().text()).toBe(200);

    const id = await booking(`${CODE}-RACK`, "2026-08-27", "2026-08-28");
    const stay = (await (await call(`/stays/${id}`)).json()) as { rackTariff: number | null };
    expect(stay.rackTariff).toBe(2500);
  });

  /* The walk-in route read the old rack too, and refused this hotel "no rate
     set". It went on 30 September: a walk-in is the booking on the Walk-in
     channel (D27-158), which prices an untyped rate the same way. */
  it("prices a walk-in with no typed tariff at that base, not a refusal", async () => {
    const [d] = await sql<{ source: string; type: string }>(
      `select app.walk_in_source()::text as source,
              (select id::text from room_types where hotel_id = $1 and code = 'STD') as type`,
      [hotelId]);
    const res = await call("/bookings", "POST", {
      guestName: "Day and room walk-in", checkIn: "2026-08-26", checkOut: "2026-08-27",
      bookingSourceId: d!.source,
      lines: [{ roomTypeId: d!.type, mealPlan: "EP", adults: 1, rooms: 1 }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const [r] = await sql<{ rate: string }>(
      `select r.agreed_rate::text as rate from reservations r join guests g on g.id = r.guest_id
        where r.hotel_id = $1 and g.full_name = 'Day and room walk-in'`, [hotelId]);
    expect(r?.rate).toBe("2500.00");
  });
});

describe("FD-17 · taken out of the room it was given ahead", () => {
  it("holds no room any more, in the stay and in the list", async () => {
    const id = await booking(`${CODE}-OUT`, "2026-08-27", "2026-08-29");
    expect((await call(`/stays/${id}/assign`, "POST", { roomNumber: "104" })).status).toBe(200);
    expect(((await (await call(`/stays/${id}`)).json()) as { roomNumber: string }).roomNumber)
      .toBe("104");

    const out = await call(`/stays/${id}/unassign`, "POST", {});
    expect(out.status, await out.clone().text()).toBe(200);
    expect(((await (await call(`/stays/${id}`)).json()) as { roomNumber: string }).roomNumber)
      .toBe("");
    const list = (await (await call("/stays")).json()) as { id: string; roomNumber: string }[];
    expect(list.find((s) => s.id === id)?.roomNumber).toBe("");
  });

  /* FD-5 (QA, 28 September): booked in 204, checked in to 208, checked out -
     and every list said 204. Both assignments released, both from the same
     date: the old order was a tie. The room left last is the one slept in. */
  it("after check-out, shows the room slept in, not the one given ahead", async () => {
    const id = await booking(`${CODE}-SLEPT`, "2026-08-26", "2026-08-27");
    expect((await call(`/stays/${id}/assign`, "POST", { roomNumber: "105" })).status).toBe(200);
    const res = await checkIn(id, "106");
    expect(res.status, await res.clone().text()).toBe(200);
    /* The leaving, as check-out writes it - the money is not what this tests. */
    await sql(`update room_assignments set released_at = now() + interval '1 minute'
                where reservation_id = $1 and released_at is null`, [id]);
    await sql("update reservations set status = 'checked_out' where id = $1", [id]);

    expect((await sql<{ room: string }>("select app.stay_room($1) as room", [id]))[0]!.room)
      .toBe("106");
    expect(((await (await call(`/stays/${id}`)).json()) as { roomNumber: string }).roomNumber)
      .toBe("106");
  });

  it("keeps a departed guest's room, for the bills that print it", async () => {
    const list = (await (await app.request("/api/hotels/5EL/stays", {
      headers: { "x-dev-staff-id": "dev-owner" },
    })).json()) as { status: string; roomNumber: string }[];
    const departed = list.filter((s) => s.status === "checked-out");
    expect(departed.length).toBeGreaterThan(0);
    expect(departed.filter((s) => !s.roomNumber)).toEqual([]);
  });
});
