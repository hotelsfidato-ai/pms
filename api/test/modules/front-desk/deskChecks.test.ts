import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ROUND D AT THE DESK - what the QA of 28 September saw saved

     FD-1  the walk-in checked an Indian guest in with no ID and no reason
     FD-2  an Aadhaar "12ab" was taken
     FD-4  children -1 was saved by Change dates or guests
     FD-6  -2 nights became 1; 400 nights were taken
     FD-7  a phone "abc", an email "not-an-email"
     FD-8  adults 0 came back "Something went wrong"
     FD-9  a cleared arrival reached the database as NaN nights
     GU-2  a birth date in the future
     and (the master, 28 September) a check-in into an occupied room is
     refused for the ROOM, whatever the form holds.

   Each refusal writes nothing. Its own hotel (RDK): rooms ready from
   midnight, so the wall clock never makes a check-in early.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "RDK";
const TAG = `RDK-${process.pid}`;
let hotelId = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: { "x-dev-staff-id": "dev-owner", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;

const guests = async (name: string) => Number((await sql<{ n: string }>(
  "select count(*)::text as n from guests where full_name = $1", [`${TAG} ${name}`]))[0]!.n);

/* A WALK-IN IS THE ONE-PAGE BOOKING (D27-158): the booking on the Walk-in
   channel, then front desk's check-in. POST /walk-ins went on 30 September;
   each check it made is asked here of the call that now makes it. */
let walkInSource = "";
let stdType = "";

const book = (name: string, over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) =>
  call("/bookings", "POST", {
    guestName: `${TAG} ${name}`, checkIn: "2026-08-26", checkOut: "2026-08-27",
    bookingSourceId: walkInSource,
    lines: [{ roomTypeId: stdType, mealPlan: "EP", adults: 1, rooms: 1, agreedRate: 2000, ...line }],
    ...over,
  });

async function walkIn(name: string, room: string, checkIn: Record<string, unknown> = {}) {
  const made = await book(name);
  expect(made.status, await made.clone().text()).toBe(200);
  const id = ((await made.json()) as { bookings: { id: string }[] }).bookings[0]!.id;
  return { id, res: await call(`/stays/${id}/check-in`, "POST", { roomNumber: room, ...checkIn }) };
}

const statusOf = async (id: string) => (await sql<{ status: string }>(
  "select status from reservations where id = $1", [id]))[0]!.status;

async function booking(ref: string) {
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                               check_in, check_out, agreed_rate, status)
     values ($1, $2, (select id from guests where full_name = $3 limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             date '2026-08-26', date '2026-08-28', 2000, 'confirmed')
     returning id::text`, [hotelId, ref, `${TAG} booked`]))[0]!.id;
}

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Round D Desk Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set business_date = date '2026-08-26', check_in_time = '00:00'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,108)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ($1)", [`${TAG} booked`]);
    walkInSource = (await db.query<{ id: string }>(
      "select app.walk_in_source()::text as id")).rows[0]!.id;
    stdType = (await db.query<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 and code = 'STD'", [hotelId])).rows[0]!.id;
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("the walk-in (FD-1, FD-2, FD-6, FD-7)", () => {
  it("asks an Indian guest for an ID or a reason, as check-in does, and leaves a booking", async () => {
    const { id, res } = await walkIn("No ID", "101");
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/Record the guest's ID document/);
    /* The booking stands and nobody is checked in (D27-158). */
    expect(await statusOf(id)).toBe("confirmed");
  });

  it("refuses an Aadhaar that is not one at the check-in, and nobody is checked in", async () => {
    const { id, res } = await walkIn("Aadhaar", "102",
      { identity: { idType: "aadhaar", idNumber: "12ab" } });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/12 digits/);
    expect(await statusOf(id)).toBe("confirmed");
  });

  it.each([
    ["Nights 400", { checkOut: "2027-09-30" }, {}, /Nights is a whole number from 1 to 90/],
    ["Nights -2", { checkOut: "2026-08-24" }, {}, /A stay ends after it starts/],
    ["Children", {}, { children: -1 }, /Children is a whole number from 0/],
    ["Phone", { phone: "abc" }, {}, /not a phone number/],
    ["Email", { email: "not-an-email" }, {}, /not an email address/],
  ])("refuses %s at the booking, and writes nothing", async (name, over, line, why) => {
    const res = await book(name, over, line);
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(why);
    expect(await guests(name)).toBe(0);
  });

  it("keeps an Indian guest's Aadhaar, as it keeps a foreigner's passport", async () => {
    const { res } = await walkIn("Aadhaar kept", "103",
      { identity: { idType: "aadhaar", idNumber: "2345 6789 0124" } });
    expect(res.status, await res.clone().text()).toBe(200);
    const [d] = await sql<{ id_type: string; id_number: string }>(
      `select d.id_type, d.id_number from guest_documents d join guests g on g.id = d.guest_id
        where g.full_name = $1`, [`${TAG} Aadhaar kept`]);
    expect(d).toEqual({ id_type: "aadhaar", id_number: "2345 6789 0124" });
  });

  it("keeps the reason an ID was skipped on the stay", async () => {
    const { id, res } = await walkIn("Skipped", "104", { idSkipReason: "Scanner offline" });
    expect(res.status, await res.clone().text()).toBe(200);
    const [r] = await sql<{ notes: string }>(
      "select notes from reservations where id = $1", [id]);
    expect(r!.notes).toBe("ID not captured - Scanner offline");
  });
});

describe("the check-in (FD-8, FD-2, GU-2, and the room first)", () => {
  it("refuses 0 adults in words, not as a database fault", async () => {
    const id = await booking(`${CODE}-ADULTS`);
    const res = await call(`/stays/${id}/check-in`, "POST",
      { roomNumber: "105", adults: 0, idSkipReason: "Test" });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe("Adults is a whole number from 1 to 99.");
  });

  it("refuses an Aadhaar that is not one, and a birth date in the future", async () => {
    const id = await booking(`${CODE}-ID`);
    const aadhaar = await call(`/stays/${id}/check-in`, "POST",
      { roomNumber: "105", identity: { idType: "aadhaar", idNumber: "12ab", nationality: "IN" } });
    expect(await reasonOf(aadhaar)).toMatch(/12 digits/);
    const born = await call(`/stays/${id}/check-in`, "POST", {
      roomNumber: "105",
      identity: { idType: "aadhaar", idNumber: "234567890124", nationality: "IN", dateOfBirth: "2030-01-01" },
    });
    expect(await reasonOf(born)).toBe("The date of birth is in the future.");
    expect((await sql<{ status: string }>(
      "select status from reservations where id = $1", [id]))[0]!.status).toBe("confirmed");
  });

  it("refuses an occupied room for the room, even with no ID on the form", async () => {
    const first = await booking(`${CODE}-IN`);
    expect((await call(`/stays/${first}/check-in`, "POST",
      { roomNumber: "106", idSkipReason: "Test" })).status).toBe(200);
    const second = await booking(`${CODE}-CLASH`);
    const res = await call(`/stays/${second}/check-in`, "POST", { roomNumber: "106" });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/still in room 106/);
  });
});

describe("Change dates or guests (FD-4, FD-6, FD-9)", () => {
  it.each([
    ["children -1", { children: -1 }, "Children is a whole number from 0 to 99."],
    ["a cleared arrival", { checkIn: "" }, "Choose a date."],
    ["100 nights", { checkOut: "2026-12-04" }, /at most 90 nights/],
  ])("refuses %s, and the booking is as it was", async (_, body, why) => {
    const id = await booking(`${CODE}-AMEND-${String(_).replace(/\W/g, "")}`);
    const res = await call(`/stays/${id}`, "PATCH", body);
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(why);
    expect((await sql<{ children: number; check_in: string; check_out: string }>(
      "select children, check_in::text, check_out::text from reservations where id = $1", [id]))[0])
      .toEqual({ children: 0, check_in: "2026-08-26", check_out: "2026-08-28" });
  });
});
