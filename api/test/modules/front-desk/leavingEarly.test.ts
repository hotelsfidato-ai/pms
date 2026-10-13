import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S D27-315, PART A (13 October) · LEAVING EARLY

   Check-out before the booked departure moved nothing: the departure stayed
   where it was booked, so the room type stayed sold for nights nobody slept,
   and the reports counted them. Now the check-out asks why, and the departure
   becomes the later of today and the day after the last night a room line
   pays for - the night audit's own rule, so the group's master bill and a
   line covering several nights count. A same-day leave keeps its first night
   (D27-204). Nothing posted is removed; the room hold is trimmed with it.

   No night audit has run here, so the business date is hotels.business_date
   and each test sets it. Every stay arrives on 25 August; check-in posts its
   first night (D27-204).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FLE";
let hotelId = "";
let groupId = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const businessDate = (d: string) =>
  sql("update hotels set business_date = $2::date where id = $1", [hotelId, d]);

/** Arrived on the 25th, booked to leave on `to`, in `roomNumber`. */
async function stay(reference: string, to: string, roomNumber: string,
                    more: { ota?: boolean; group?: boolean } = {}) {
  await businessDate("2026-08-25");
  const id = (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status, source, group_id, route_room_to_group)
     values ($1, $2, (select id from guests where full_name = 'Early leaver' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             date '2026-08-25', $3::date, 2000, 'confirmed', $4, $5, $6)
     returning id::text`,
    [hotelId, reference, to, more.ota ? "ota" : "direct",
     more.group ? groupId : null, more.group === true]))[0]!.id;
  const res = await call(`/stays/${id}/check-in`, "POST",
    { roomNumber, adults: 1, idSkipReason: "Test" });
  expect(res.status, await res.clone().text()).toBe(200);
  return id;
}

/** A room line on `folio` for the stay, dated `on`, as the audit or a walk-in writes it. */
const roomLine = (id: string, folio: string, on: string, words: string, amount: number) =>
  sql(`insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category,
                                   description, amount, tax_rate, tax_amount, source_type)
       values ($1, $2::uuid, $3, $4::date, 'room', $5, $6, 5, round($6 * 0.05, 2), 'night_audit')`,
      [hotelId, folio, id, on, words, amount]);

const ownFolio = async (id: string) => (await sql<{ id: string }>(
  "select id::text from folios where reservation_id = $1 and status = 'open' limit 1", [id]))[0]!.id;

/** Whatever the stay's own bill owes, paid. */
async function payAll(id: string) {
  const owed = Number((await sql<{ owed: string }>(
    `select coalesce(sum(fp.amount + fp.tax_amount), 0)::text as owed
       from folio_postings fp join folios f on f.id = fp.folio_id
      where f.reservation_id = $1`, [id]))[0]!.owed);
  if (owed <= 0) return;
  const paid = await call(`/stays/${id}/payments`, "POST", { method: "UPI", amount: owed });
  expect(paid.status, await paid.clone().text()).toBe(200);
}

const checkOut = async (id: string, body: object = {}) => {
  const res = await call(`/stays/${id}/check-out`, "POST", body);
  return { status: res.status, ...((await res.json()) as { reason?: string; needs?: string }) };
};

const booking = async (id: string) => (await sql<{
  status: string; departure: string; notes: string | null; held_to: string | null;
}>(
  `select r.status, r.check_out::text as departure, r.notes,
          (select max(ra.to_date)::text from room_assignments ra where ra.reservation_id = r.id) as held_to
     from reservations r where r.id = $1`, [id]))[0]!;

const roomLines = async (id: string) => (await sql<{ n: number }>(
  "select count(*)::int as n from folio_postings where reservation_id = $1 and category = 'room'",
  [id]))[0]!.n;

/** Rooms of the test's type sold per night, 25 to 31 August. */
const sold = async () => Object.fromEntries((await sql<{ d: string; sold: number }>(
  `select to_char(g.for_date, 'MM-DD') as d, g.sold
     from app.inventory_grid($1, date '2026-08-25', date '2026-08-31') g
     join room_types rt on rt.id = g.room_type_id and rt.code = 'STD'
    order by g.for_date`,
  [hotelId])).map((r) => [r.d, r.sold]));

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Leaving Early Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    /* Out by midnight: every hour is past check-out time, so only the date
       decides whether a departure is late (D27-314). */
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '00:00', late_checkout_charge = 400,
                         advance_before_check_in = 'none'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,106)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Early leaver')");
    groupId = (await db.query<{ id: string }>(
      "insert into reservation_groups (name) values ('FLE group') returning id::text")).rows[0]!.id;
    await db.query("insert into folios (hotel_id, group_id) values ($1, $2)", [hotelId, groupId]);
  } finally { await db.end(); }
});

/* As lateDeparture.test.ts: the app's pool first, the invoices before the hotel. */
const TRIGGERS = ["folio_postings folio_postings_append_only", "invoices invoices_immutable",
                  "hotels hotels_no_delete"];
afterAll(async () => {
  await closePool();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    for (const t of TRIGGERS) await db.query(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
    await db.query("delete from invoices where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("delete from reservation_groups where id = $1", [groupId]);
  } finally {
    for (const t of TRIGGERS) await db.query(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
    await db.end();
  }
}, 120_000);

describe("D27-315 · leaving before the booked departure", () => {
  it("asks why first, and moves nothing until it is given", async () => {
    const id = await stay(`${CODE}-WHY`, "2026-08-28", "101");
    await payAll(id);
    await businessDate("2026-08-26");

    const asked = await call(`/stays/${id}/leaving-early`);
    expect(await asked.json()).toEqual({ leavingEarly: {
      departure: "2026-08-28", today: "2026-08-26", newDeparture: "2026-08-26",
      nightsFreed: 2, bookingSite: false } });

    const res = await checkOut(id, { earlyReason: "  " });
    expect(res.status).toBe(409);
    expect(res.needs, res.reason).toBe("leaving-early");
    expect(await booking(id)).toMatchObject({ status: "checked_in", departure: "2026-08-28" });

    expect((await checkOut(id, { earlyReason: "Family emergency" })).status).toBe(200);
  });

  it("the departure becomes today, the hold is trimmed, the reason kept, the nights back on sale", async () => {
    const id = await stay(`${CODE}-DATES`, "2026-08-30", "102");
    await payAll(id);
    await businessDate("2026-08-27");
    /* The audit's two nights, 25 (check-in's) and 26. */
    await roomLine(id, await ownFolio(id), "2026-08-26", "Room 102 · 1 night", 2000);
    await payAll(id);
    const before = await sold();

    const res = await checkOut(id, { earlyReason: "Meeting cancelled" });
    expect(res.status, res.reason).toBe(200);

    const after = await booking(id);
    expect(after).toMatchObject({ status: "checked_out", departure: "2026-08-27", held_to: "2026-08-27" });
    expect(after.notes).toContain("Left early on 2026-08-27, booked to 2026-08-30: Meeting cancelled");
    expect(await roomLines(id)).toBe(2);

    const now = await sold();
    for (const d of ["08-25", "08-26"]) expect(now[d], d).toBe(before[d]);
    for (const d of ["08-27", "08-28", "08-29"]) expect(now[d], d).toBe(before[d]! - 1);
  });

  it("a same-day leave keeps its first night", async () => {
    const id = await stay(`${CODE}-SAME`, "2026-08-28", "103");
    await payAll(id);
    expect((await checkOut(id, { earlyReason: "Plans changed" })).status).toBe(200);
    expect(await booking(id)).toMatchObject({ departure: "2026-08-26" });
    expect(await roomLines(id)).toBe(1);
  });

  it("a line covering several nights keeps them in the stay", async () => {
    const id = await stay(`${CODE}-MULTI`, "2026-08-31", "104");
    /* A walk-in's whole stay on arrival, "Room 104 · 2 nights" (D17-33), for the 26th and 27th. */
    await roomLine(id, await ownFolio(id), "2026-08-26", "Room 104 · 2 nights", 4000);
    await payAll(id);
    await businessDate("2026-08-26");
    expect((await checkOut(id, { earlyReason: "Work" })).status).toBe(200);
    expect(await booking(id)).toMatchObject({ departure: "2026-08-28" });
  });

  it("a night on the group's master bill keeps it in the stay", async () => {
    const id = await stay(`${CODE}-GROUP`, "2026-08-31", "105", { group: true });
    const master = (await sql<{ id: string }>(
      "select id::text from folios where group_id = $1", [groupId]))[0]!.id;
    expect((await sql<{ n: number }>(
      "select count(*)::int as n from folio_postings where folio_id = $1 and reservation_id = $2",
      [master, id]))[0]!.n, "check-in charged the master").toBe(1);
    await roomLine(id, master, "2026-08-26", "Room 105 · 1 night", 2000);
    await businessDate("2026-08-26");
    expect((await checkOut(id, { earlyReason: "Conference ended" })).status).toBe(200);
    expect(await booking(id)).toMatchObject({ departure: "2026-08-27" });
  });

  it("decides lateness before the move: an early leaver is not charged a late fee", async () => {
    const id = await stay(`${CODE}-LATE`, "2026-08-28", "106", { ota: true });
    await payAll(id);
    await businessDate("2026-08-26");
    expect(((await (await call(`/stays/${id}/leaving-early`)).json()) as {
      leavingEarly: { bookingSite: boolean } }).leavingEarly.bookingSite).toBe(true);

    const res = await checkOut(id, { earlyReason: "Flight moved" });
    expect(res.needs, res.reason).toBeUndefined();
    expect(res.status, res.reason).toBe(200);
    /* Now "on the date" (26th) at an hour past check-out: still no late charge. */
    expect(await booking(id)).toMatchObject({ status: "checked_out", departure: "2026-08-26" });
    expect((await sql(
      "select 1 from folio_postings where reservation_id = $1 and description = 'Late check-out'",
      [id])).length).toBe(0);
    expect((await sql<{ at: string | null }>(
      "select late_checkout_at::text as at from reservations where id = $1", [id]))[0]!.at).toBeNull();
  });
});
