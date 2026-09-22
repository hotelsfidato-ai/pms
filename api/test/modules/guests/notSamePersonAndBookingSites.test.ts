import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import { createChannelBooking } from "../../../src/modules/reservations/index.ts";

/* ══════════════════════════════════════════════════════════════════
   CRM-2 AND CRM-3 — the owner's D22-8, 22 September

     CRM-2  two people who share a phone stayed on "possible same person"
            for ever. A manager - owner, admin, GM (CRM-Q5) - may now say
            "not the same person": the pair leaves the list, who said so
            and when is kept, and it can be undone, as a join can.
     CRM-3  a booking from a booking site had no clerk to see the
            blacklist warning. Arrivals and the check-in now ask which
            booking-site guests match a blacklisted guest - exact phone or
            email, the desk's own rule - and are WARNED, never refused
            (D21-2, D21-21).

   Each is proved WORKING, not only refusing (root MEMORY 308). The
   channel booking is made through the channel manager's own door
   (createChannelBooking, in process, as /api/channel calls it); the rest
   through the routes a person uses. Only the staff are inserted directly.
   The database functions under the routes are proved on their own in
   db/tests/modules/crm.sql (MEMORY 318).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

const tag = `NSP-${process.pid}`;
const run = String(process.pid % 10000).padStart(4, "0");
const phone = (n: number) => `6${run}${String(n).padStart(5, "0")}`;
const spaced = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
const vikramEmail = `vikram.${run}@example.test`;

const staff: Record<"owner" | "clerk" | "hotelManager" | "admin" | "gm", string> = {
  owner: "", clerk: "", hotelManager: "", admin: "", gm: "",
};
let hotel5el = "";
let direct = "";
let agoda = "";
let bookingCom = "";
let roomType = "";
let today = "";
let later = "";
let meera = "";          // shares one mobile with her husband
let arjun = "";
let vikram = "";         // blacklisted
const stays: Record<"viaChannel" | "byEmail" | "stranger" | "typedOta" | "atDesk", string> = {
  viaChannel: "", byEmail: "", stranger: "", typedOta: "", atDesk: "",
};
const roomsTouched: Array<{ id: string; occupancy: string }> = [];

const call = (who: keyof typeof staff, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: {
      "x-dev-staff-id": staff[who],
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

/** A booking at 5 Elements through the desk's own route; its reservation. */
async function book(body: Record<string, unknown>, nights = { checkIn: later, checkOut: "" }) {
  const checkOut = nights.checkOut || (await sql<{ d: string }>(
    "select ($1::date + 1)::text as d", [nights.checkIn]))[0]!.d;
  const res = await call("owner", "/5EL/bookings", "POST", {
    checkIn: nights.checkIn, checkOut,
    lines: [{ roomTypeId: roomType, adults: 1, rooms: 1, agreedRate: 3000 }],
    ...body,
  });
  const out = await res.json() as { ok: boolean; bookings?: { reference: string }[] };
  expect(res.status, JSON.stringify(out)).toBe(200);
  const rows = await sql<{ id: string; guest_id: string }>(
    "select id::text, guest_id::text from reservations where reference = $1",
    [out.bookings![0]!.reference]);
  return rows[0]!;
}

beforeAll(async () => {
  const db = await admin();
  try {
    staff.owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    hotel5el = (await db.query<{ id: string }>(
      "select id::text from hotels where code = '5EL'")).rows[0]!.id;
    const source = async (where: string) => (await db.query<{ id: string }>(
      `select id::text from booking_sources where is_active and ${where} order by name limit 1`)).rows[0]!.id;
    direct = await source("kind = 'direct'");
    agoda = await source("name = 'Agoda'");
    bookingCom = await source("name = 'Booking.com'");
    roomType = (await db.query<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 order by sort_order limit 1",
      [hotel5el])).rows[0]!.id;
    const dates = (await db.query<{ d: string; l: string }>(
      "select app.business_date($1)::text as d, (app.business_date($1) + 30)::text as l",
      [hotel5el])).rows[0]!;
    today = dates.d;
    later = dates.l;

    for (const [who, role] of [
      ["clerk", "front_desk"], ["hotelManager", "hotel_manager"], ["admin", "admin"], ["gm", "gm"],
    ] as const) {
      const { rows } = await db.query<{ id: string }>(
        `insert into staff (email, full_name) values ($1, $2)
         on conflict (email) do update set is_active = true returning id::text`,
        [`${who.toLowerCase()}.${run}@nsp.example.test`, `${tag} ${who}`]);
      staff[who] = rows[0]!.id;
      await db.query("delete from staff_hotels where staff_id = $1", [staff[who]]);
      await db.query(
        "insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
        [staff[who], hotel5el, role]);
    }
  } finally { await db.end(); }

  /* A MARRIED COUPLE ON ONE MOBILE: two bookings, the clerk said "a new
     guest" the second time, as they should have. */
  meera = (await book({ guestName: `${tag} Meera Iyer`, phone: phone(1), bookingSourceId: direct })).guest_id;
  arjun = (await book({ guestName: `${tag} Arjun Iyer`, phone: spaced(phone(1)), bookingSourceId: direct })).guest_id;

  /* VIKRAM: booked at the desk, then blacklisted by the GM with a reason. */
  vikram = (await book({
    guestName: `${tag} Vikram Rao`, phone: phone(2), email: vikramEmail, bookingSourceId: direct,
  })).guest_id;
  const black = await call("gm", `/5EL/crm/guests/${vikram}/blacklist`, "POST",
    { reason: "Left without paying, June" });
  expect(black.status, await black.clone().text()).toBe(200);
});

afterAll(async () => {
  const db = await admin();
  try {
    const guests = (await db.query<{ id: string }>(
      "select id::text from guests where full_name like $1", [`${tag} %`])).rows.map((r) => r.id);
    const ids = (await db.query<{ id: string }>(
      "select id::text from reservations where guest_id = any($1::uuid[])", [guests]))
      .rows.map((r) => r.id);

    await db.query(
      "delete from guest_not_same where a = any($1::uuid[]) or b = any($1::uuid[])", [guests]);
    await db.query(
      "delete from guest_joins where kept_id = any($1::uuid[]) or joined_id = any($1::uuid[])", [guests]);
    await db.query("delete from room_assignments where reservation_id = any($1::uuid[])", [ids]);
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    try {
      await db.query(
        `delete from folio_postings where folio_id in
           (select id from folios where reservation_id = any($1::uuid[]))`, [ids]);
    } finally {
      await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    }
    await db.query("delete from folios where reservation_id = any($1::uuid[])", [ids]);
    await db.query("delete from reservations where id = any($1::uuid[])", [ids]);
    for (const room of roomsTouched) {
      await db.query("update rooms set occupancy_status = $2 where id = $1", [room.id, room.occupancy]);
    }
    await db.query("delete from guest_documents where guest_id = any($1::uuid[])", [guests]);
    await db.query("update guests set joined_into = null where id = any($1::uuid[])", [guests]);
    await db.query("alter table guests disable trigger guests_no_delete");
    try {
      await db.query("delete from guests where id = any($1::uuid[])", [guests]);
    } finally {
      await db.query("alter table guests enable trigger guests_no_delete");
    }
    const people = Object.entries(staff).filter(([who]) => who !== "owner").map(([, id]) => id);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [people]);
    await db.query("update staff set is_active = false where id = any($1::uuid[])", [people]);

    const left = await db.query<{ n: string }>(
      "select count(*)::text as n from guests where full_name like $1", [`${tag} %`]);
    expect(left.rows[0]!.n, "the fixtures outlived the test").toBe("0");
  } finally { await db.end(); }
  await closePool();
});

type Pair = { a: { id: string }; b: { id: string }; samePhone: boolean };
const pairsFor = async (who: keyof typeof staff = "gm") => {
  const res = await call(who, "/5EL/crm/same-person");
  expect(res.status).toBe(200);
  return ((await res.json()) as { pairs: Pair[] }).pairs;
};
const isThem = (p: Pair, x: string, y: string) => [p.a.id, p.b.id].sort().join() === [x, y].sort().join();

/* ── CRM-2 · "Not the same person" ────────────────────────────────── */

describe("not the same person (CRM-2)", () => {
  let answerId = "";

  it("lists the couple on one mobile until somebody answers", async () => {
    const ours = (await pairsFor()).find((p) => isThem(p, meera, arjun));
    expect(ours?.samePhone).toBe(true);
  });

  it("is answered only by the owner, an administrator or a GM", async () => {
    for (const who of ["clerk", "hotelManager"] as const) {
      const res = await call(who, "/5EL/crm/not-same", "POST", { aId: meera, bId: arjun });
      expect(res.status).toBe(403);
      expect((await call(who, "/5EL/crm/not-same")).status).toBe(403);
    }
    /* Nothing was recorded by the refusals. */
    expect(await sql("select 1 from guest_not_same where a = any($1::uuid[])", [[meera, arjun]]))
      .toEqual([]);
  });

  it("refuses what is not two records from the list, and records nothing", async () => {
    for (const body of [{ aId: meera }, { aId: meera, bId: meera }, { aId: "x", bId: arjun }]) {
      const res = await call("gm", "/5EL/crm/not-same", "POST", body);
      expect(res.status, JSON.stringify(body)).toBe(409);
    }
    expect(await sql("select 1 from guest_not_same where a = any($1::uuid[])", [[meera, arjun]]))
      .toEqual([]);
  });

  it("takes the pair off the list, and keeps who said so and when", async () => {
    const res = await call("gm", "/5EL/crm/not-same", "POST", { aId: arjun, bId: meera });
    expect(res.status, await res.clone().text()).toBe(200);
    answerId = ((await res.json()) as { id: string }).id;

    expect((await pairsFor()).some((p) => isThem(p, meera, arjun))).toBe(false);
    /* The owner's list too: it is one answer for the whole group. */
    expect((await pairsFor("owner")).some((p) => isThem(p, meera, arjun))).toBe(false);

    /* Asked as the GM: a name the viewer may not read is a dash (MEMORY
       283), and an administrator is not shown a GM's staff row. */
    const listed = await call("gm", "/5EL/crm/not-same");
    const { answers } = (await listed.json()) as {
      answers: Array<{ id: string; aId: string; bId: string; aName: string; bName: string; by: string; at: string }>;
    };
    const ours = answers.find((x) => x.id === answerId)!;
    expect([ours.aName, ours.bName].sort()).toEqual([`${tag} Arjun Iyer`, `${tag} Meera Iyer`]);
    expect(ours.by).toBe(`${tag} gm`);
    expect(ours.at).toBeTruthy();
    const said = await sql<{ said_by: string }>(
      "select said_by::text from guest_not_same where id = $1", [answerId]);
    expect(said[0]!.said_by).toBe(staff.gm);
    /* And the administrator sees the answer, whoever gave it. */
    const theirs = (await (await call("admin", "/5EL/crm/not-same")).json()) as { answers: Array<{ id: string }> };
    expect(theirs.answers.map((x) => x.id)).toContain(answerId);

    /* Nothing about either guest changed: an answer is not a join. */
    const rows = await sql<{ joined_into: string | null }>(
      "select joined_into::text from guests where id = any($1::uuid[])", [[meera, arjun]]);
    expect(rows).toEqual([{ joined_into: null }, { joined_into: null }]);
  });

  it("is the same answer when pressed twice", async () => {
    const res = await call("admin", "/5EL/crm/not-same", "POST", { aId: meera, bId: arjun });
    expect(((await res.json()) as { id: string }).id).toBe(answerId);
    const rows = await sql("select 1 from guest_not_same where a = any($1::uuid[])", [[meera, arjun]]);
    expect(rows).toHaveLength(1);
  });

  it("is undone by a manager - the pair is listed again - and only once", async () => {
    expect((await call("clerk", `/5EL/crm/not-same/${answerId}/undo`, "POST")).status).toBe(403);

    const undo = await call("admin", `/5EL/crm/not-same/${answerId}/undo`, "POST");
    expect(undo.status, await undo.clone().text()).toBe(200);
    expect((await pairsFor()).some((p) => isThem(p, meera, arjun))).toBe(true);
    const kept = await sql<{ undone_by: string }>(
      "select undone_by::text from guest_not_same where id = $1", [answerId]);
    expect(kept[0]!.undone_by).toBe(staff.admin);

    const again = await call("admin", `/5EL/crm/not-same/${answerId}/undo`, "POST");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { reason: string }).reason).toMatch(/already undone/);
  });
});

/* ── CRM-3 · A booking site's guest who is a blacklisted guest ─────── */

type Warning = {
  stayId: string; reference: string; guest: string; source: string;
  blacklistedName: string; reason: string | null;
};
const warnings = async (from: string, to: string, who: keyof typeof staff = "clerk") => {
  const res = await call(who, `/5EL/guests/blacklist-warnings?from=${from}&to=${to}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { warnings: Warning[] }).warnings;
};

describe("a booking site's guest who matches a blacklisted guest (CRM-3)", () => {
  beforeAll(async () => {
    const checkOut = (await sql<{ d: string }>("select ($1::date + 1)::text as d", [later]))[0]!.d;
    const viaDoor = async (ref: string, guest: { guestName: string; phone?: string; email?: string }) => {
      const made = await withUser(staff.owner, (client) => createChannelBooking(client, staff.owner, {
        hotelId: hotel5el, ...guest, checkIn: later, checkOut,
        bookingSourceId: agoda, externalRef: `${tag}-${ref}`,
        lines: [{ roomTypeId: roomType, mealPlan: "EP", adults: 1, rooms: 1, agreedRate: 3500 }],
      }));
      expect(made.ok, JSON.stringify(made)).toBe(true);
      return made.ok ? made.reservationIds[0]! : "";
    };
    /* Through the channel manager's door: his number as the site sent it,
       his email in capitals with no phone, and a stranger. */
    stays.viaChannel = await viaDoor("1", { guestName: `${tag} V Rao`, phone: spaced(phone(2)) });
    stays.byEmail = await viaDoor("2", { guestName: `${tag} Mr Rao`, email: vikramEmail.toUpperCase() });
    stays.stranger = await viaDoor("3", { guestName: `${tag} Stranger`, phone: phone(3) });
    /* A booking site's reservation typed in at the desk, arriving today. */
    stays.typedOta = (await book(
      { guestName: `${tag} Vik Rao`, phone: phone(2), bookingSourceId: bookingCom },
      { checkIn: today, checkOut: "" })).id;
    /* His number on a desk booking that is NOT from a booking site: the
       clerk who typed it was shown the warning then (D21-21). */
    stays.atDesk = (await book({ guestName: `${tag} Vikram R`, phone: phone(2), bookingSourceId: direct })).id;
  });

  it("warns of the channel manager's booking on his phone, and the one on his email, with the reason", async () => {
    const found = await warnings(today, later);
    const channel = found.find((w) => w.stayId === stays.viaChannel);
    expect(channel).toMatchObject({
      guest: `${tag} V Rao`, source: "Agoda",
      blacklistedName: `${tag} Vikram Rao`, reason: "Left without paying, June",
    });
    expect(found.find((w) => w.stayId === stays.byEmail)?.blacklistedName).toBe(`${tag} Vikram Rao`);
    expect(found.find((w) => w.stayId === stays.typedOta)?.source).toBe("Booking.com");
  });

  it("does not warn of a stranger, of a desk booking, or of the blacklisted guest's own desk booking", async () => {
    const found = (await warnings(today, later)).map((w) => w.stayId);
    expect(found).not.toContain(stays.stranger);
    expect(found).not.toContain(stays.atDesk);
    const own = (await sql<{ id: string }>(
      "select id::text from reservations where guest_id = $1", [vikram]))[0]!.id;
    expect(found).not.toContain(own);
  });

  it("keeps to the dates asked, and to the hotel's own bookings", async () => {
    const todayOnly = (await warnings(today, today)).map((w) => w.stayId);
    expect(todayOnly).toContain(stays.typedOta);
    expect(todayOnly).not.toContain(stays.viaChannel);

    /* Pune is not this clerk's hotel. */
    expect((await call("clerk", `/PUN/guests/blacklist-warnings?from=${today}&to=${later}`)).status)
      .toBe(404);
    const bad = await call("clerk", `/5EL/guests/blacklist-warnings?from=${later}&to=${today}`);
    expect(bad.status).toBe(400);
  });

  it("never blocks: the warned guest is checked in", async () => {
    const room = (await sql<{ id: string; number: string; occupancy: string }>(
      `select rm.id::text, rm.number, rm.occupancy_status as occupancy
         from rooms rm
        where rm.hotel_id = $1 and rm.room_type_id = $2 and rm.is_active
          and rm.housekeeping_status = 'clean' and rm.occupancy_status <> 'occupied'
          and not exists (select 1 from room_assignments ra
                           where ra.room_id = rm.id and ra.released_at is null)
        order by rm.number limit 1`, [hotel5el, roomType]))[0];
    expect(room, "no clean free room of that type at 5EL").toBeTruthy();
    roomsTouched.push({ id: room!.id, occupancy: room!.occupancy });

    const res = await call("clerk", `/5EL/stays/${stays.typedOta}/check-in`, "POST", {
      roomNumber: room!.number,
      earlyReason: "CRM-3 fixture - the arrival hour is not what this tests",
      idSkipReason: "CRM-3 fixture",
    });
    expect(res.status, await res.clone().text()).toBeLessThan(400);
    const status = await sql<{ status: string }>(
      "select status from reservations where id = $1", [stays.typedOta]);
    expect(status[0]!.status).toBe("checked_in");
  });

  it("goes when the blacklist is cleared", async () => {
    const clear = await call("gm", `/5EL/crm/guests/${vikram}/blacklist`, "DELETE");
    expect(clear.status).toBe(200);
    const found = (await warnings(today, later)).map((w) => w.stayId);
    expect(found).not.toContain(stays.viaChannel);
    expect(found).not.toContain(stays.byEmail);
  });
});
