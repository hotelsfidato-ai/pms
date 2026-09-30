import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE GUEST, ONE RECORD — the Central CRM, phase 1 (docs/briefs/crm.md)

   Every booking used to make a new guest row with no lookup, so the same
   person twice was two rows, and the blacklist was a column nothing read
   (root MEMORY 311). What is proved here is each step WORKING - not only
   what it refuses (root MEMORY 308) - through the routes a person uses:

     1  a returning guest is suggested on an exact phone or email, a clerk
        says yes, and the booking uses them; two people who share a
        surname are never suggested for each other (D21-20, D21-2)
     2  the "possible same person" list, a join, and an undo that leaves
        every stay where it was (D21-2)
     3  the blacklist warns the desk with its reason and never refuses a
        booking; only the owner, an administrator or a GM set it (D21-21)
     4  "stayed with the group N times" and nothing more at the desk (D21-13)
     5  offers only with a yes (D25-39), and "no offers", against the
        number itself (D21-22); a later answer replaces an earlier one
     6  Guest 360: every stay at every hotel, for the three only (D21-3, -4)
     7  the WhatsApp tick, saved and read back (D21-72)

   Every fixture is made through the route a person would use (root MEMORY
   313): the stays by a booking and a check-in, a walk-in, the ID by the
   check-in that captures it. Only the staff are inserted directly - a
   test has no other way to be four different people.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

const tag = `CRM-${process.pid}`;
const run = String(process.pid % 10000).padStart(4, "0");
/** Ten digits, unique to this run, never all one digit. */
const phone = (n: number) => `7${run}${String(n).padStart(5, "0")}`;
const spaced = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
const rohitEmail = `rohit.${run}@example.test`;

const staff: Record<"owner" | "clerk" | "hotelManager" | "admin" | "gm", string> = {
  owner: "", clerk: "", hotelManager: "", admin: "", gm: "",
};
let hotel5el = "";
let source = "";
let rohit = "";        // stayed at Pune: checked in there, with an ID on file
let priya = "";        // shares his surname; booked at 5 Elements, never stayed
let namesake = "";     // exactly his name, a different person, a different phone
let rohitAgain = "";   // the clerk said "no, a new guest" with his phone
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

/** A clean room nobody holds at a property, remembered so it is put back. */
async function freeRoom(code: string): Promise<{ number: string; typeId: string }> {
  const rows = await sql<{ id: string; number: string; type_id: string; occupancy: string }>(
    `select rm.id::text, rm.number, rm.room_type_id::text as type_id,
            rm.occupancy_status as occupancy
       from rooms rm join hotels h on h.id = rm.hotel_id
      where h.code = $1 and rm.is_active and rm.housekeeping_status = 'clean'
        and rm.occupancy_status <> 'occupied'
        and not exists (select 1 from room_assignments ra
                         where ra.room_id = rm.id and ra.released_at is null)
      order by rm.number limit 1`, [code]);
  expect(rows[0], `no clean free room at ${code}`).toBeTruthy();
  roomsTouched.push({ id: rows[0]!.id, occupancy: rows[0]!.occupancy });
  return { number: rows[0]!.number, typeId: rows[0]!.type_id };
}

async function book(code: string, body: Record<string, unknown>) {
  const res = await call("owner", `/${code}/bookings`, "POST", body);
  const out = await res.json() as {
    ok: boolean; reason?: string; guest?: string; bookings?: { reference: string }[];
  };
  return { status: res.status, out };
}

async function reservationOf(reference: string) {
  const rows = await sql<{ id: string; guest_id: string; whatsapp_agreed: boolean }>(
    "select id::text, guest_id::text, whatsapp_agreed from reservations where reference = $1",
    [reference]);
  return rows[0]!;
}

const aNight = async (code: string) => {
  const rows = await sql<{ d: string; e: string }>(
    `select app.business_date(h.id)::text as d, (app.business_date(h.id) + 1)::text as e
       from hotels h where h.code = $1`, [code]);
  return { checkIn: rows[0]!.d, checkOut: rows[0]!.e };
};

beforeAll(async () => {
  const db = await admin();
  try {
    staff.owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    hotel5el = (await db.query<{ id: string }>(
      "select id::text from hotels where code = '5EL'")).rows[0]!.id;
    source = (await db.query<{ id: string }>(
      "select id::text from booking_sources where is_active and kind = 'direct' order by name limit 1",
    )).rows[0]!.id;

    for (const [who, role] of [
      ["clerk", "front_desk"], ["hotelManager", "hotel_manager"], ["admin", "admin"], ["gm", "gm"],
    ] as const) {
      const { rows } = await db.query<{ id: string }>(
        `insert into staff (email, full_name) values ($1, $2)
         on conflict (email) do update set is_active = true returning id::text`,
        [`${who.toLowerCase()}.${run}@crm.example.test`, `${tag} ${who}`]);
      staff[who] = rows[0]!.id;
      await db.query("delete from staff_hotels where staff_id = $1", [staff[who]]);
      await db.query(
        "insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
        [staff[who], hotel5el, role]);
    }
  } finally { await db.end(); }

  /* ROHIT: booked at Pune and checked in there, his passport captured at
     the check-in - one visit, at another hotel, with an ID on file. */
  const pune = await freeRoom("PUN");
  const nights = await aNight("PUN");
  const made = await book("PUN", {
    guestName: `${tag} Rohit Deshpande`, phone: phone(1), email: rohitEmail,
    ...nights, bookingSourceId: source,
    lines: [{ roomTypeId: pune.typeId, adults: 1, rooms: 1, agreedRate: 2500 }],
  });
  expect(made.status, JSON.stringify(made.out)).toBe(200);
  const stay = await reservationOf(made.out.bookings![0]!.reference);
  rohit = stay.guest_id;
  const checkIn = await call("owner", `/PUN/stays/${stay.id}/check-in`, "POST", {
    roomNumber: pune.number,
    earlyReason: "CRM fixture - the arrival hour is not what these test",
    identity: { idType: "passport", idNumber: `P${run}CRM`, nationality: "IN",
                passportExpiry: "2031-04-12", addressLine: "Pune" },
    offersAgreed: true,
  });
  expect(checkIn.status, await checkIn.clone().text()).toBeLessThan(400);

  /* PRIYA: the same surname, a different person. Booked, never stayed. */
  const nights5 = await aNight("5EL");
  const room5 = (await sql<{ id: string }>(
    "select id::text from room_types where hotel_id = $1 order by sort_order limit 1",
    [hotel5el]))[0]!.id;
  const p = await book("5EL", {
    guestName: `${tag} Priya Deshpande`, phone: phone(2), ...nights5,
    bookingSourceId: source,
    lines: [{ roomTypeId: room5, adults: 1, rooms: 1, agreedRate: 3000 }],
  });
  expect(p.status, JSON.stringify(p.out)).toBe(200);
  priya = (await reservationOf(p.out.bookings![0]!.reference)).guest_id;

  /* HIS NAMESAKE: exactly his name, another phone, another person. */
  const n = await book("5EL", {
    guestName: `${tag} Rohit Deshpande`, phone: phone(3), ...nights5,
    bookingSourceId: source,
    lines: [{ roomTypeId: room5, adults: 1, rooms: 1, agreedRate: 3000 }],
  });
  expect(n.status, JSON.stringify(n.out)).toBe(200);
  namesake = (await reservationOf(n.out.bookings![0]!.reference)).guest_id;
});

afterAll(async () => {
  const db = await admin();
  try {
    const guests = (await db.query<{ id: string }>(
      "select id::text from guests where full_name like $1", [`${tag} %`])).rows.map((r) => r.id);
    const stays = (await db.query<{ id: string }>(
      "select id::text from reservations where guest_id = any($1::uuid[])", [guests]))
      .rows.map((r) => r.id);

    await db.query(
      "delete from guest_joins where kept_id = any($1::uuid[]) or joined_id = any($1::uuid[])",
      [guests]);
    await db.query("delete from offer_opt_outs where value like $1", [`7${run}%`]);
    await db.query("delete from offer_opt_outs where value = $1", [rohitEmail]);
    await db.query("delete from offer_opt_ins where value like $1 or value = $2", [`7${run}%`, rohitEmail]);
    await db.query("delete from room_assignments where reservation_id = any($1::uuid[])", [stays]);
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    try {
      await db.query(
        `delete from folio_postings where folio_id in
           (select id from folios where reservation_id = any($1::uuid[]))`, [stays]);
    } finally {
      await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    }
    await db.query("delete from folios where reservation_id = any($1::uuid[])", [stays]);
    await db.query("delete from reservations where id = any($1::uuid[])", [stays]);
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

type Match = {
  guestId?: string; visits?: number; name: string; suggested: boolean;
  blacklisted: boolean; blacklistReason: string | null;
};
const returning = async (query: Record<string, string>, who: keyof typeof staff = "clerk") => {
  const res = await call(who, `/5EL/guests/returning?${new URLSearchParams(query)}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { matches: Match[] }).matches;
};

/* ── 1 · Returning-guest matching (D21-20) ─────────────────────────── */

describe("a returning guest is suggested, and a clerk decides", () => {
  it("suggests him on his phone typed another way, with his stays at another hotel counted", async () => {
    const matches = await returning({ phone: `0${phone(1)}` });
    expect(matches).toEqual([{
      guestId: rohit, visits: 1, name: `${tag} Rohit Deshpande`,
      suggested: true, blacklisted: false, blacklistReason: null,
    }]);
  });

  it("suggests him on his email, whatever the case", async () => {
    const matches = await returning({ email: rohitEmail.toUpperCase() });
    expect(matches.map((m) => m.guestId)).toEqual([rohit]);
  });

  it("never suggests two different people who share a surname - or a whole name", async () => {
    /* His number finds him, and nobody called Deshpande with it. */
    expect((await returning({ phone: phone(1) })).map((m) => m.guestId)).toEqual([rohit]);
    /* Hers finds her, not him. */
    expect((await returning({ phone: phone(2) })).map((m) => m.guestId)).toEqual([priya]);
    /* The man with his exact name and another number is somebody else. */
    expect((await returning({ phone: phone(3) })).map((m) => m.guestId)).toEqual([namesake]);
    /* A number under ten digits, or a placeholder, suggests nobody at all. */
    expect(await returning({ phone: phone(1).slice(1) })).toEqual([]);
    expect(await returning({ phone: "0000000000" })).toEqual([]);
  });

  it("suggests nothing when what was typed disagrees with what is on file", async () => {
    /* His phone, somebody else's email: doubt, so nothing (the owner). */
    expect(await returning({ phone: phone(1), email: "someone.else@example.test" })).toEqual([]);
  });

  it("YES: the booking is his - no new guest, his name on it, and nothing on file overwritten", async () => {
    const before = await sql<{ n: string }>(
      "select count(*)::text as n from guests where app.phone_key(phone) = $1", [phone(1)]);
    const nights = await aNight("5EL");
    const type = (await sql<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 order by sort_order limit 1",
      [hotel5el]))[0]!.id;
    const made = await book("5EL", {
      guestName: "Rohit D", phone: spaced(phone(1)), guestId: rohit, ...nights,
      bookingSourceId: source, whatsappAgreed: true, offersAgreed: true,
      lines: [{ roomTypeId: type, adults: 1, rooms: 1, agreedRate: 3000 }],
    });
    expect(made.status, JSON.stringify(made.out)).toBe(200);
    expect(made.out.guest).toBe(`${tag} Rohit Deshpande`);

    const stay = await reservationOf(made.out.bookings![0]!.reference);
    expect(stay.guest_id).toBe(rohit);
    const after = await sql<{ n: string }>(
      "select count(*)::text as n from guests where app.phone_key(phone) = $1", [phone(1)]);
    expect(after[0]!.n).toBe(before[0]!.n);
    expect(await sql("select 1 from guests where full_name = 'Rohit D'")).toEqual([]);
    const him = await sql<{ email: string }>("select email::text from guests where id = $1", [rohit]);
    expect(him[0]!.email).toBe(rohitEmail);
  });

  it("fills a blank email from what was typed, when the clerk confirms", async () => {
    const nights = await aNight("5EL");
    const type = (await sql<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 order by sort_order limit 1",
      [hotel5el]))[0]!.id;
    const made = await book("5EL", {
      guestName: "Priya", phone: phone(2), email: `priya.${run}@example.test`,
      guestId: priya, ...nights, bookingSourceId: source,
      lines: [{ roomTypeId: type, adults: 1, rooms: 1, agreedRate: 3000 }],
    });
    expect(made.status, JSON.stringify(made.out)).toBe(200);
    const her = await sql<{ email: string }>("select email::text from guests where id = $1", [priya]);
    expect(her[0]!.email).toBe(`priya.${run}@example.test`);
  });

  it("refuses a guest the typed phone does not suggest, and writes nothing", async () => {
    const stays = async () => (await sql<{ n: string }>(
      "select count(*)::text as n from reservations where guest_id = $1", [rohit]))[0]!.n;
    const before = await stays();
    const nights = await aNight("5EL");
    const type = (await sql<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 order by sort_order limit 1",
      [hotel5el]))[0]!.id;
    for (const typed of [{ phone: phone(2) }, { phone: phone(1), email: "not.his@example.test" }]) {
      const made = await book("5EL", {
        guestName: `${tag} Refused`, ...typed, guestId: rohit, ...nights,
        bookingSourceId: source,
        lines: [{ roomTypeId: type, adults: 1, rooms: 1, agreedRate: 3000 }],
      });
      expect(made.status).toBe(409);
      expect(made.out.reason).toMatch(/no longer matches/);
    }
    expect(await stays()).toBe(before);
    expect(await sql("select 1 from guests where full_name = $1", [`${tag} Refused`])).toEqual([]);
    const him = await sql<{ email: string }>("select email::text from guests where id = $1", [rohit]);
    expect(him[0]!.email).toBe(rohitEmail);
  });

  it("the walk-in: YES puts her in the room as herself, with both ticks kept", async () => {
    /* A walk-in is the one-page booking (D27-158): the booking on the
       Walk-in channel, then the check-in, as the clerk's "Check in now". */
    const room = await freeRoom("5EL");
    const walkIn = (await sql<{ id: string }>("select app.walk_in_source()::text as id"))[0]!.id;
    const made = await call("clerk", "/5EL/bookings", "POST", {
      guestName: "Priya D", phone: spaced(phone(2)), guestId: priya,
      ...(await aNight("5EL")), bookingSourceId: walkIn,
      whatsappAgreed: true, offersAgreed: true,
      lines: [{ roomTypeId: room.typeId, mealPlan: "CP", adults: 1, rooms: 1, agreedRate: 3200 }],
    });
    expect(made.status, await made.clone().text()).toBe(200);
    const id = ((await made.json()) as { bookings: { id: string }[] }).bookings[0]!.id;
    const res = await call("clerk", `/5EL/stays/${id}/check-in`, "POST", {
      roomNumber: room.number, offersAgreed: true,
      earlyReason: "CRM fixture - the arrival hour is not what these test",
      idSkipReason: "Test fixture - FD-1 asks every walk-in for an ID or a reason",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const rows = await sql<{ guest_id: string; whatsapp_agreed: boolean }>(
      "select guest_id::text, whatsapp_agreed from reservations where id = $1", [id]);
    expect(rows[0]).toEqual({ guest_id: priya, whatsapp_agreed: true });
    expect(await sql("select 1 from offer_opt_ins where kind = 'phone' and value = $1", [phone(2)]))
      .toHaveLength(1);
  });

  it("NO: a new guest, as today", async () => {
    const nights = await aNight("5EL");
    const type = (await sql<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 order by sort_order limit 1",
      [hotel5el]))[0]!.id;
    const made = await book("5EL", {
      guestName: `${tag} R Deshpande`, phone: phone(1), ...nights, bookingSourceId: source,
      lines: [{ roomTypeId: type, adults: 1, rooms: 1, agreedRate: 3000 }],
    });
    expect(made.status, JSON.stringify(made.out)).toBe(200);
    rohitAgain = (await reservationOf(made.out.bookings![0]!.reference)).guest_id;
    expect(rohitAgain).not.toBe(rohit);
  });
});

/* ── 4 and 7 · What the desk sees on a stay ────────────────────────── */

describe("the stay panel: stayed before, and the WhatsApp tick", () => {
  it("counts his visit at Pune on his booking here, and not the stay itself", async () => {
    const mine = await sql<{ id: string; code: string }>(
      `select r.id::text, h.code from reservations r join hotels h on h.id = r.hotel_id
        where r.guest_id = $1 order by h.code`, [rohit]);
    const here = mine.find((r) => r.code === "5EL")!;
    const pune = mine.find((r) => r.code === "PUN")!;

    const marks = await call("clerk", `/5EL/stays/${here.id}/guest-marks`);
    expect(await marks.json()).toEqual({ stayedBefore: 1, whatsappAgreed: true });

    /* The Pune stay IS his one visit, so before it there were none. */
    const own = await call("owner", `/PUN/stays/${pune.id}/guest-marks`);
    expect(((await own.json()) as { stayedBefore: number }).stayedBefore).toBe(0);
    /* And another hotel's clerk cannot read a stay that is not theirs. */
    expect((await call("clerk", `/5EL/stays/${pune.id}/guest-marks`)).status).toBe(404);
  });

  it("saves the WhatsApp tick from the stay panel, and reads it back", async () => {
    const here = (await sql<{ id: string }>(
      "select r.id::text from reservations r where r.guest_id = $1 and r.hotel_id = $2 limit 1",
      [rohit, hotel5el]))[0]!.id;
    const off = await call("clerk", `/5EL/stays/${here}/whatsapp`, "POST", { agreed: false });
    expect(await off.json()).toEqual({ ok: true, agreed: false });
    const read = await call("clerk", `/5EL/stays/${here}/guest-marks`);
    expect(((await read.json()) as { whatsappAgreed: boolean }).whatsappAgreed).toBe(false);
    const on = await call("clerk", `/5EL/stays/${here}/whatsapp`, "POST", { agreed: true });
    expect(await on.json()).toEqual({ ok: true, agreed: true });
  });

  it("leaves a booking the clerk did not tick unticked", async () => {
    const hers = (await sql<{ whatsapp_agreed: boolean }>(
      "select whatsapp_agreed from reservations where guest_id = $1 and source <> 'walk_in'",
      [namesake]))[0]!;
    expect(hers.whatsapp_agreed).toBe(false);
  });
});

/* ── 3 · The blacklist, as a warning (D21-21) ──────────────────────── */

describe("the blacklist warns and never blocks", () => {
  it("is set only by the owner, an administrator or a GM", async () => {
    for (const who of ["clerk", "hotelManager"] as const) {
      const res = await call(who, `/5EL/crm/guests/${rohit}/blacklist`, "POST", { reason: "no" });
      expect(res.status).toBe(403);
    }
    const noReason = await call("admin", `/5EL/crm/guests/${rohit}/blacklist`, "POST", { reason: " " });
    expect(noReason.status).toBe(409);
    const res = await call("admin", `/5EL/crm/guests/${rohit}/blacklist`, "POST",
      { reason: "Left without paying, March" });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("warns the clerk with the reason, and still offers the suggestion", async () => {
    const matches = await returning({ phone: phone(1) });
    const him = matches.find((m) => m.guestId === rohit)!;
    expect(him).toMatchObject({
      suggested: true, blacklisted: true, blacklistReason: "Left without paying, March",
    });
  });

  it("does not refuse the booking - a person decides", async () => {
    const nights = await aNight("5EL");
    const type = (await sql<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 order by sort_order limit 1",
      [hotel5el]))[0]!.id;
    const made = await book("5EL", {
      guestName: "Rohit", phone: phone(1), guestId: rohit, ...nights, bookingSourceId: source,
      lines: [{ roomTypeId: type, adults: 1, rooms: 1, agreedRate: 3000 }],
    });
    expect(made.status, JSON.stringify(made.out)).toBe(200);
  });

  it("is cleared by a GM, and the warning goes", async () => {
    const res = await call("gm", `/5EL/crm/guests/${rohit}/blacklist`, "DELETE");
    expect(res.status, await res.clone().text()).toBe(200);
    const him = (await returning({ phone: phone(1) })).find((m) => m.guestId === rohit)!;
    expect(him.blacklisted).toBe(false);
  });
});

/* ── 2 · The "possible same person" list, joins and undo (D21-2) ──── */

describe("joining two records into one person, and taking it apart", () => {
  const staysOf = async (guest: string) => (await sql<{ id: string }>(
    "select id::text from reservations where guest_id = $1 order by id", [guest])).map((r) => r.id);

  it("lists the two records that share his phone, for managers only", async () => {
    expect((await call("clerk", "/5EL/crm/same-person")).status).toBe(403);
    expect((await call("hotelManager", "/5EL/crm/same-person")).status).toBe(403);
    const res = await call("gm", "/5EL/crm/same-person");
    expect(res.status).toBe(200);
    const { pairs } = (await res.json()) as {
      pairs: Array<{ a: { id: string; hasId: boolean }; b: { id: string; hasId: boolean }; samePhone: boolean }>;
    };
    const ours = pairs.find((p) => [p.a.id, p.b.id].sort().join() === [rohit, rohitAgain].sort().join());
    expect(ours?.samePhone).toBe(true);
    /* Whether an ID is on file - never the ID. */
    expect(JSON.stringify(pairs)).not.toContain(`P${run}CRM`);
    /* Two people sharing a surname are not a pair. */
    expect(pairs.some((p) => [p.a.id, p.b.id].includes(priya) && [p.a.id, p.b.id].includes(rohit)))
      .toBe(false);
  });

  it("keeps the record with the ID: joining it AWAY is refused", async () => {
    const res = await call("gm", "/5EL/crm/joins", "POST", { keptId: rohitAgain, joinedId: rohit });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/has an ID on file/);
  });

  it("refuses a clerk", async () => {
    const res = await call("clerk", "/5EL/crm/joins", "POST", { keptId: rohit, joinedId: rohitAgain });
    expect(res.status).toBe(403);
  });

  it("joins them: the stays move, the blacklist comes over, nothing is deleted - and undo puts back every stay", async () => {
    /* A mark on the record joined away, to see it carried and taken back. */
    const mark = await call("owner", `/5EL/crm/guests/${rohitAgain}/blacklist`, "POST",
      { reason: "Damaged the room" });
    expect(mark.status).toBe(200);

    const his = await staysOf(rohit);
    const again = await staysOf(rohitAgain);
    expect(again.length).toBeGreaterThan(0);

    const joined = await call("owner", "/5EL/crm/joins", "POST", { keptId: rohit, joinedId: rohitAgain });
    expect(joined.status, await joined.clone().text()).toBe(200);
    const { joinId } = (await joined.json()) as { joinId: string };

    expect(await staysOf(rohit)).toEqual([...his, ...again].sort());
    expect(await staysOf(rohitAgain)).toEqual([]);
    const after = await sql<{ joined_into: string | null; is_blacklisted: boolean; blacklist_reason: string | null }>(
      "select joined_into::text, is_blacklisted, blacklist_reason from guests where id = any($1::uuid[]) order by id = $2 desc",
      [[rohit, rohitAgain], rohit]);
    expect(after[0]).toEqual({ joined_into: null, is_blacklisted: true, blacklist_reason: "Damaged the room" });
    expect(after[1]!.joined_into).toBe(rohit);

    /* One person now: his phone suggests him once, and the pair is gone. */
    expect((await returning({ phone: phone(1) })).map((m) => m.guestId)).toEqual([rohit]);
    const list = (await (await call("owner", "/5EL/crm/same-person")).json()) as {
      pairs: Array<{ a: { id: string }; b: { id: string } }>;
    };
    expect(list.pairs.some((p) => [p.a.id, p.b.id].includes(rohitAgain))).toBe(false);

    const undo = await call("gm", `/5EL/crm/joins/${joinId}/undo`, "POST");
    expect(undo.status, await undo.clone().text()).toBe(200);

    expect(await staysOf(rohit)).toEqual(his);
    expect(await staysOf(rohitAgain)).toEqual(again);
    const back = await sql<{ joined_into: string | null; is_blacklisted: boolean }>(
      "select joined_into::text, is_blacklisted from guests where id = any($1::uuid[]) order by id = $2 desc",
      [[rohit, rohitAgain], rohit]);
    expect(back).toEqual([
      { joined_into: null, is_blacklisted: false },
      { joined_into: null, is_blacklisted: true },
    ]);

    const again2 = await call("gm", `/5EL/crm/joins/${joinId}/undo`, "POST");
    expect(again2.status).toBe(409);
    expect(((await again2.json()) as { reason: string }).reason).toMatch(/already undone/);
  });
});

/* ── 5 · Offers only with a yes (D25-39); "no offers" (D21-22) ──────── */

type Keys = { phones: string[]; emails: string[] };
const yesList = async () => (await (await call("owner", "/5EL/crm/offers-yes")).json()) as Keys;
const noList = async () => (await (await call("owner", "/5EL/crm/no-offers")).json()) as Keys;

describe("offers only with a yes", () => {
  it("the desk's yes - at the check-in, the booking and the walk-in - is kept against the number and email, read by managers only", async () => {
    expect((await call("clerk", "/5EL/crm/offers-yes")).status).toBe(403);
    const res = await call("admin", "/5EL/crm/offers-yes");
    expect(res.status, await res.clone().text()).toBe(200);
    const list = (await res.json()) as Keys;
    expect(list.phones).toContain(phone(1));
    expect(list.phones).toContain(phone(2));
    /* Only Rohit's CHECK-IN carried his email with the yes. */
    expect(list.emails).toContain(rohitEmail);
  });

  it("is recorded on Guest 360 by a manager and not by the desk", async () => {
    const res = await call("clerk", "/5EL/crm/offers-yes", "POST", { phone: phone(3) });
    expect(res.status).toBe(403);
    expect((await yesList()).phones).not.toContain(phone(3));
    const refused = await call("gm", "/5EL/crm/offers-yes", "POST", { phone: "12345" });
    expect(refused.status).toBe(409);
  });

  it("is taken away by a later no, and a later yes takes the no away", async () => {
    expect((await call("admin", "/5EL/crm/no-offers", "POST", { phone: phone(2) })).status).toBe(200);
    expect((await yesList()).phones).not.toContain(phone(2));
    expect((await noList()).phones).toContain(phone(2));

    expect((await call("owner", "/5EL/crm/no-offers", "POST", { phone: phone(1) })).status).toBe(200);
    expect((await yesList()).phones).not.toContain(phone(1));
    expect((await call("gm", "/5EL/crm/offers-yes", "POST", { phone: spaced(phone(1)) })).status).toBe(200);
    expect((await yesList()).phones).toContain(phone(1));
    expect((await noList()).phones).not.toContain(phone(1));
  });
});

describe("do not send me offers", () => {
  it("is cleared by a manager and nobody else", async () => {
    expect((await call("owner", "/5EL/crm/no-offers", "POST", { phone: phone(4) })).status).toBe(200);
    const row = (await sql<{ id: string }>(
      "select id::text from offer_opt_outs where kind = 'phone' and value = $1", [phone(4)]))[0]!;
    expect((await call("clerk", `/5EL/crm/no-offers/${row.id}`, "DELETE")).status).toBe(403);
    expect((await call("owner", `/5EL/crm/no-offers/${row.id}`, "DELETE")).status).toBe(200);
    expect((await noList()).phones).not.toContain(phone(4));
  });
});

/* ── 6 · Guest 360 (D21-3, D21-4) ─────────────────────────────────── */

describe("Guest 360", () => {
  type Whole = {
    name: string; hasId: boolean; visits: number; charged: number;
    stays: Array<{ hotelCode: string; charged: number }>;
    noOffers: Array<{ kind: string; value: string }>;
  };

  it("is for the owner, an administrator and the GM only", async () => {
    expect((await call("clerk", `/5EL/crm/guests/${rohit}`)).status).toBe(403);
    expect((await call("hotelManager", `/5EL/crm/guests/${rohit}`)).status).toBe(403);
    expect((await call("clerk", `/5EL/crm/guests?q=Deshpande`)).status).toBe(403);
    expect((await call("admin", `/5EL/crm/guests/${rohit}`)).status).toBe(200);
  });

  it("shows a GM at one hotel every stay at every hotel - and says an ID is on file without showing it", async () => {
    const res = await call("gm", `/5EL/crm/guests/${rohit}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const text = await res.clone().text();
    const whole = (await res.json()) as Whole;
    expect(whole.name).toBe(`${tag} Rohit Deshpande`);
    expect([...new Set(whole.stays.map((s) => s.hotelCode))].sort()).toEqual(["5EL", "PUN"]);
    expect(whole.visits).toBe(1);
    expect(whole.hasId).toBe(true);
    expect(text).not.toContain(`P${run}CRM`);
  });

  it("finds him by his phone typed any way", async () => {
    const res = await call("gm", `/5EL/crm/guests?q=${encodeURIComponent(spaced(phone(1)))}`);
    const { guests } = (await res.json()) as { guests: Array<{ id: string }> };
    expect(guests.map((g) => g.id)).toContain(rohit);
  });

  it("says what she was charged the way the Guests screen does - one definition, on a real charge", async () => {
    /* Her walk-in's room night, posted through the desk's own charge route:
       the check-in posts none (the night audit does), and a sum of zeros
       would agree with anything. */
    const [stay] = await sql<{ id: string }>(
      "select id::text from reservations where guest_id = $1 and status = 'checked_in'", [priya]);
    const posted = await call("owner", `/5EL/stays/${stay!.id}/charges`, "POST",
      { category: "Room", description: "Room night", amount: 3200 });
    expect(posted.status, await posted.clone().text()).toBe(200);

    const whole = (await (await call("owner", `/5EL/crm/guests/${priya}`)).json()) as Whole;
    expect(whole.charged).toBeGreaterThan(0);
    expect(whole.noOffers.map((o) => o.value)).toContain(phone(2));

    const list = (await (await call("owner", "/5EL/guests")).json()) as
      Array<{ name: string; totalSpend: number }>;
    const row = list.find((g) => g.name === `${tag} Priya Deshpande`)!;
    expect(row.totalSpend).toBeCloseTo(whole.charged, 2);
  });
});
