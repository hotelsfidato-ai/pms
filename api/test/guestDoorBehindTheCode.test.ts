import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { forgetKnocksForTests, hashForTests } from "../src/routes/guestDoor.ts";

/* ══════════════════════════════════════════════════════════════════
   BEHIND THE GUEST'S SIX DIGITS (D21-6 to D21-19, D21-25, migration 121)

   The other half of api/test/guestDoor.test.ts. Every room behind the code
   is proved three ways, because a suite made only of refusals cannot tell a
   guard from a wall (root MEMORY 308):

     · REFUSED before the code is answered
     · REFUSED with the link alone once it has been answered - the code
       unlocks the phone that answered, not the link (D21-6)
     · WORKS with this phone's unlock

   And the room card, which names a ROOM: the next guest's scan reaches
   nothing of the last guest's.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"]
  ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const NOTHING = "This link is not usable. Ask the desk for a new one.";
const TAG = "GUESTBEHIND";

let ownerId: string;
let deskId: string;
let housekeeperId: string;
let hotelId: string;
let stayId: string;          // checked in, in `roomId`, with the test's own phone
let guestId: string;
let phoneWas: string | null;
let documentsWere: unknown;  // the guest's guest_documents row, put back after
let roomId: string;
let roomNumber: string;
let emptyRoomId: string;
let link: string;            // the booking's own link token
let spaWas: boolean | null;  // this hotel's spa switch, put back after
const phone = "9876500022";

const asStaff = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const asGuest = (path: string, method = "GET", body?: unknown, unlock?: string) =>
  app.request(`/api/guest${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(unlock ? { authorization: `Guest ${unlock}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const tokenOf = (url: string) => url.split("/g/")[1]!;

/** Answer the code as the guest would, with a code this test made directly.
    Returns the unlock the door hands back. */
async function unlockWith(token: string): Promise<string> {
  const hash = hashForTests(token);
  await sql(
    `insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
     select s.link_id, s.reservation_id, encode(digest('424242','sha256'),'hex'), '…0000',
            now() + interval '10 minutes'
       from app.guest_link_stay($1) s`, [hash]);
  const res = await asGuest(`/${token}/verify`, "POST", { code: "424242" });
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.json()) as { unlock?: string };
  expect(body.unlock, "the answer hands this phone its unlock").toBeTruthy();
  return body.unlock!;
}

async function printCard(room: string): Promise<string> {
  const res = await asStaff(deskId, `/5EL/online-checkin/rooms/${room}/card`, "POST", {});
  expect(res.status, await res.clone().text()).toBe(200);
  return tokenOf(((await res.json()) as { cards: { link: string }[] }).cards[0]!.link);
}

/** A stand-in for n8n that keeps what it was sent (D21-29: nothing leaves
    this machine). */
async function standInSender(): Promise<{ server: Server; received: string[] }> {
  const received: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { received.push(body); res.writeHead(200).end("ok"); });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  process.env["N8N_SEND_URL"] = `http://127.0.0.1:${(server.address() as { port: number }).port}/pms-send`;
  process.env["N8N_SEND_SECRET"] = "only-this-test-run-knows-this";
  return { server, received };
}

async function stopSender(server: Server) {
  delete process.env["N8N_SEND_URL"];
  delete process.env["N8N_SEND_SECRET"];
  await new Promise<void>((done) => server.close(() => done()));
}

beforeAll(async () => {
  ownerId = (await sql("select id::text as id from staff where email = 'owner@fidato.in'")).rows[0].id;
  hotelId = (await sql("select id::text as id from hotels where code = '5EL'")).rows[0].id;

  const person = async (email: string, name: string, role: string) => {
    const { rows } = await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1,$2,$3)
       on conflict (email) do update set is_active = true
       returning id::text as id`, [email, `${TAG} ${name}`, `test-uid-${email}`]);
    await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1,$2,$3)",
      [rows[0].id, hotelId, role]);
    return rows[0].id as string;
  };
  deskId = await person("guestbehind-desk@fidato.in", "Desk", "front_desk");
  housekeeperId = await person("guestbehind-hk@fidato.in", "Housekeeping", "housekeeping");

  /* A guest CHECKED IN to a room today, so the room card has somebody to
     find - the demo has eight at 5 Elements on its business date.

     AND THE ONLY ONE IN THAT ROOM. The first run of this file picked room
     201, where the guest due out is still checked in beside the guest who
     arrived: the card rightly found the arrival, and the fixture's guest was
     the other one (migration 121, `guest_link_stay`). */
  const { rows: inRoom } = await sql(
    `select r.id::text as stay, r.guest_id::text as guest, rm.id::text as room, rm.number
       from room_assignments ra
       join reservations r on r.id = ra.reservation_id
       join rooms rm       on rm.id = ra.room_id
      where r.hotel_id = $1 and r.status = 'checked_in' and ra.released_at is null
        and ra.from_date <= app.business_date($1)
        and not exists (
          select 1 from room_assignments ra2
            join reservations r2 on r2.id = ra2.reservation_id
           where ra2.room_id = ra.room_id and ra2.id <> ra.id
             and ra2.released_at is null and r2.status = 'checked_in')
      order by rm.number limit 1`, [hotelId]);
  ({ stay: stayId, guest: guestId, room: roomId, number: roomNumber } = inRoom[0]);

  const { rows: empty } = await sql(
    `select rm.id::text as id from rooms rm
      where rm.hotel_id = $1 and rm.is_active and not exists (
        select 1 from room_assignments ra join reservations r on r.id = ra.reservation_id
         where ra.room_id = rm.id and ra.released_at is null and r.status = 'checked_in')
      order by rm.number limit 1`, [hotelId]);
  emptyRoomId = empty[0].id;

  phoneWas = (await sql("select phone from guests where id = $1", [guestId])).rows[0].phone ?? null;
  await sql("update guests set phone = $2 where id = $1", [guestId, phone]);
  documentsWere = (await sql(
    "select to_jsonb(d) as row from guest_documents d where guest_id = $1", [guestId])).rows[0]?.row ?? null;

  spaWas = (await sql("select is_enabled from hotel_modules where hotel_id = $1 and module = 'spa'",
    [hotelId])).rows[0]?.is_enabled ?? null;

  const made = await asStaff(ownerId, `/5EL/stays/${stayId}/guest-link`, "POST", {});
  expect(made.status, await made.clone().text()).toBe(200);
  link = tokenOf(((await made.json()) as { link: string }).link);
});

beforeEach(() => { forgetKnocksForTests(); });

afterAll(async () => {
  await sql("delete from guest_requests where hotel_id = $1", [hotelId]);
  await sql("delete from guest_detail_submissions where hotel_id = $1", [hotelId]);
  await sql(`delete from guest_links where hotel_id = $1
               and (reservation_id = $2 or room_id is not null)`, [hotelId, stayId]);
  await sql("update guests set phone = $2 where id = $1", [guestId, phoneWas]);
  await sql("delete from guest_documents where guest_id = $1", [guestId]);
  if (documentsWere) {
    await sql(`insert into guest_documents
               select * from jsonb_populate_record(null::guest_documents, $1::jsonb)`,
      [JSON.stringify(documentsWere)]);
  }
  if (spaWas === null) {
    await sql("delete from hotel_modules where hotel_id = $1 and module = 'spa'", [hotelId]);
  } else {
    await sql("update hotel_modules set is_enabled = $2 where hotel_id = $1 and module = 'spa'",
      [hotelId, spaWas]);
  }
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [[deskId, housekeeperId]]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [[deskId, housekeeperId]]);
  await closePool();
});

/* ── D21-25 · the page can ask first, and one shape for every answer ── */

describe("the two open faults (D21-25)", () => {
  it("says on opening whether a code can be sent at all", async () => {
    const before = (await (await asGuest(`/${link}`)).json()) as { canSendCodes: boolean };
    expect(before.canSendCodes, "n8n is not connected here").toBe(false);

    const { server } = await standInSender();
    try {
      const after = (await (await asGuest(`/${link}`)).json()) as { canSendCodes: boolean };
      expect(after.canSendCodes).toBe(true);
    } finally { await stopSender(server); }
  });

  it("answers one knock too many exactly as it answers the right number", async () => {
    const { server } = await standInSender();
    try {
      const first = await asGuest(`/${link}/code`, "POST", { phone });
      const firstBody = await first.text();
      let last = first;
      for (let i = 0; i < 6; i += 1) last = await asGuest(`/${link}/code`, "POST", { phone });
      /* The sixth in an hour is the rate-limited one. It used to answer
         `{ sent: true, hint: null }` and the page printed a blank line. */
      expect(last.status).toBe(first.status);
      expect(await last.text()).toBe(firstBody);
    } finally { await stopSender(server); }
  });
});

/* ── OCI-2 · the code goes to the NUMBER, not to its last four digits ── */

describe("the code reaches the booking's own number (OCI-2)", () => {
  it("hands the sender the whole number, not the masked one kept for the record", async () => {
    const { server, received } = await standInSender();
    try {
      const res = await asGuest(`/${link}/code`, "POST", { phone });
      expect(res.status).toBe(200);
      expect(received.length, "one message went to the stand-in").toBe(1);
      const sent = JSON.parse(received[0]!) as { to: { phone: string } };
      /* It passed "…0022" until 21 September - so the first real code would
         have gone to nobody. */
      expect(sent.to.phone).toBe(phone);
    } finally { await stopSender(server); }
  });
});

/* ── D21-6 · the code unlocks this phone, not the link ─────────────── */

describe("the code unlocks the phone that answered, not the link (D21-6)", () => {
  it("leaves the link alone asking for a code, however it was answered before", async () => {
    const unlock = await unlockWith(link);

    const alone = (await (await asGuest(`/${link}`)).json()) as { verified: boolean };
    expect(alone.verified, "a forwarded link is asked for a code again").toBe(false);

    const here = (await (await asGuest(`/${link}`, "GET", undefined, unlock)).json()) as {
      verified: boolean; offers: string[];
    };
    expect(here.verified, "the phone that answered is unlocked").toBe(true);
    expect(Array.isArray(here.offers)).toBe(true);
  });

  it("refuses every room behind the code to the link alone, and opens it with the unlock", async () => {
    const unlock = await unlockWith(link);
    const rooms: [string, string, unknown?][] = [
      ["GET", "/details"],
      ["POST", "/details", { idType: "voter", idNumber: "ABC1234567" }],
      ["GET", "/requests"],
      ["POST", "/requests", { kind: "spa", what: "A massage" }],
      ["GET", "/bill"],
    ];

    for (const [method, path, body] of rooms) {
      for (const holding of [undefined, "an-unlock-nobody-was-given"]) {
        const res = await asGuest(`/${link}${path}`, method, body, holding);
        expect(res.status, `${method} ${path} with ${holding ?? "the link alone"}`).toBe(404);
        expect(((await res.json()) as { error: string }).error,
          "refused in the same words as a link that does not exist").toBe(NOTHING);
      }
    }
    const { rows } = await sql(
      "select count(*)::int as n from guest_detail_submissions where reservation_id = $1", [stayId]);
    expect(rows[0].n, "nothing refused was written").toBe(0);

    /* And it WORKS with the unlock - or the refusals above prove a wall. */
    expect((await asGuest(`/${link}/details`, "GET", undefined, unlock)).status).toBe(200);
    expect((await asGuest(`/${link}/requests`, "GET", undefined, unlock)).status).toBe(200);
  });

  /* ⚠ THE DATABASE IS THE GUARD, AND THE TESTS ABOVE CANNOT SEE IT. Every
     one of them goes through the door, and the door checks the unlock BEFORE
     it calls a function behind the code - so a function that forgot to ask
     `app.guest_unlocked` passed all of them. Found on 21 September by
     breaking `app.guest_bill` to take the link alone: 34 passed. The brief
     says it plainly: asked in the database function, every time. So each
     one is asked here directly, with the link's hash and no unlock, and with
     an unlock nobody was given - and must answer nothing. */
  it("is asked for in every function behind the code, in the database itself", async () => {
    const hash = hashForTests(link);
    await unlockWith(link);   // the link HAS been answered; its hash alone is still nothing

    for (const unlock of [null, hashForTests("an-unlock-nobody-was-given")]) {
      const one = async (text: string) => (await sql(text, [hash, unlock])).rows[0];
      expect((await one("select app.guest_bill($1, $2) as v")).v, "guest_bill").toBeNull();
      expect(await one("select * from app.guest_details_state($1, $2)"), "guest_details_state").toBeUndefined();
      expect(await one("select * from app.guest_requests_mine($1, $2)"), "guest_requests_mine").toBeUndefined();
      expect((await one(
        `select app.guest_details_submit($1, $2, '{"idType":"voter","idNumber":"X1"}'::jsonb) as v`)).v,
        "guest_details_submit").toBe(false);
      expect((await one("select app.guest_request_make($1, $2, 'spa', 'A massage', null) as v")).v,
        "guest_request_make").toBe(false);
      expect((await one("select app.guest_request_make($1, $2, 'desk', 'Towels', null) as v")).v,
        "guest_request_make, a message to the desk (D23-14)").toBe(false);
    }
  });

  it("keeps the unlock to the link it was answered on", async () => {
    const unlock = await unlockWith(link);
    const second = await asStaff(ownerId, `/5EL/stays/${stayId}/guest-link`, "POST", {});
    const other = tokenOf(((await second.json()) as { link: string }).link);

    const res = await asGuest(`/${other}/details`, "GET", undefined, unlock);
    expect(res.status, "an unlock is for one link, not the whole stay").toBe(404);
  });

  it("dies after its hour", async () => {
    const unlock = await unlockWith(link);
    await sql("update guest_unlocks set expires_at = now() - interval '1 second' where unlock_hash = $1",
      [hashForTests(unlock)]);
    expect((await asGuest(`/${link}/details`, "GET", undefined, unlock)).status).toBe(404);
  });

  /* OCI-4. The unlock travelled in `x-guest-unlock` and every test above
     passed, because they call the app in-process and no browser ever sends
     a preflight. In a browser the API's CORS list did not name it, so the
     first call behind the code was blocked and the guest read "could not
     reach the hotel". This asks the preflight the question a browser asks. */
  it("travels in a header a browser's preflight lets through", async () => {
    const res = await app.request("/api/guest/anything", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(",");
    expect(allowed).toContain("authorization");

    const unlock = await unlockWith(link);
    const res2 = await app.request(`/api/guest/${link}/details`, {
      headers: { authorization: `Guest ${unlock}` },
    });
    expect(res2.status, "and the door reads it from there").toBe(200);
  });

  it("keeps only the unlock's hash", async () => {
    const unlock = await unlockWith(link);
    const { rows } = await sql(
      "select unlock_hash from guest_unlocks where unlock_hash = $1", [hashForTests(unlock)]);
    expect(rows.length).toBe(1);
    expect(rows[0].unlock_hash).not.toContain(unlock);
  });
});

/* ── The room card (D21-7, D21-14, D21-15, D21-16) ─────────────────── */

describe("one fixed card per room", () => {
  it("shows the hotel and the room number, and nothing of the guest, before the code", async () => {
    const card = await printCard(roomId);
    const res = await asGuest(`/${card}`);
    const text = await res.clone().text();
    const body = (await res.json()) as {
      kind: string; room: string; occupied: boolean; booking: unknown; phoneHint: unknown;
      hotel: { name: string };
    };

    expect(body.kind).toBe("room");
    expect(body.room).toBe(roomNumber);
    expect(body.hotel.name).toBeTruthy();
    expect(body.occupied).toBe(true);
    expect(body.booking, "no name, no dates, no reference (D21-14)").toBeNull();
    expect(body.phoneHint, "not even the last four digits").toBeNull();

    const { rows } = await sql("select full_name from guests where id = $1", [guestId]);
    expect(text).not.toContain(rows[0].full_name);
  });

  it("says only that it opens once you are checked in, for an empty room (D21-15)", async () => {
    const card = await printCard(emptyRoomId);
    const body = (await (await asGuest(`/${card}`)).json()) as { occupied: boolean; booking: unknown };
    expect(body.occupied).toBe(false);
    expect(body.booking).toBeNull();
  });

  it("sends the code to the phone of whoever is checked in there now", async () => {
    const card = await printCard(roomId);
    const { server, received } = await standInSender();
    try {
      await asGuest(`/${card}/code`, "POST", { phone });
      expect(received.length).toBe(1);
      expect((JSON.parse(received[0]!) as { to: { phone: string } }).to.phone).toBe(phone);
    } finally { await stopSender(server); }
  });

  it("opens the stay with the unlock, and reaches nothing of it once they have gone", async () => {
    const card = await printCard(roomId);
    const unlock = await unlockWith(card);

    const open = (await (await asGuest(`/${card}`, "GET", undefined, unlock)).json()) as {
      verified: boolean; booking: { reference: string } | null;
    };
    expect(open.verified).toBe(true);
    expect(open.booking?.reference).toBeTruthy();

    /* They check out; the NEXT guest is checked in to the same room. Any
       other checked-in stay will do - moved here for the test. */
    /* Staying past today: an assignment must sit inside its own stay
       (`ra_within_stay`, migration 015). One night only: the room may be
       booked to somebody else from the night the last guest was due out,
       and `ra_no_double_booking` refuses an overlap with them. */
    const { rows: next } = await sql(
      `select r.id::text as stay from reservations r
        where r.hotel_id = $1 and r.status = 'checked_in' and r.id <> $2
          and r.check_out > app.business_date($1)
        limit 1`, [hotelId, stayId]);
    const nextStay = next[0].stay as string;
    const { rows: moved } = await sql(
      `update room_assignments set released_at = now()
        where reservation_id = $1 and room_id = $2 and released_at is null
        returning id::text as id`, [stayId, roomId]);
    await sql("update reservations set status = 'checked_out' where id = $1", [stayId]);

    try {
      const empty = (await (await asGuest(`/${card}`, "GET", undefined, unlock)).json()) as {
        occupied: boolean; verified: boolean;
      };
      expect(empty.occupied, "a checked-out stay is not found").toBe(false);
      expect(empty.verified).toBe(false);

      const { rows: nextRooms } = await sql(
        `update room_assignments set released_at = now()
          where reservation_id = $1 and released_at is null
          returning id::text as id, room_id::text as room, from_date::text, to_date::text`,
        [nextStay]);
      const { rows: here } = await sql(
        `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
         select $1, r.id, $3, app.business_date($1), app.business_date($1) + 1, 'move'
           from reservations r where r.id = $2
         returning id::text as id`, [hotelId, nextStay, roomId]);

      try {
        const theirs = (await (await asGuest(`/${card}`, "GET", undefined, unlock)).json()) as {
          occupied: boolean; verified: boolean; booking: unknown;
        };
        expect(theirs.occupied, "the next guest is found").toBe(true);
        expect(theirs.verified, "the last guest's unlock opens nothing of theirs").toBe(false);
        expect(theirs.booking).toBeNull();
        expect((await asGuest(`/${card}/details`, "GET", undefined, unlock)).status).toBe(404);
      } finally {
        await sql("delete from room_assignments where id = $1", [here[0].id]);
        await sql("update room_assignments set released_at = null where id = any($1::uuid[])",
          [nextRooms.map((r: { id: string }) => r.id)]);
      }
    } finally {
      await sql("update reservations set status = 'checked_in' where id = $1", [stayId]);
      await sql("update room_assignments set released_at = null where id = any($1::uuid[])",
        [moved.map((r: { id: string }) => r.id)]);
    }
  });

  it("stops the old card the moment the desk prints a new one (D21-16)", async () => {
    const old = await printCard(roomId);
    const fresh = await printCard(roomId);

    const was = await asGuest(`/${old}`);
    expect(was.status).toBe(404);
    expect(((await was.json()) as { error: string }).error).toBe(NOTHING);
    expect((await asGuest(`/${fresh}`)).status).toBe(200);
  });

  it("is printed by the desk and not by housekeeping", async () => {
    const res = await asStaff(housekeeperId, `/5EL/online-checkin/rooms/${roomId}/card`, "POST", {});
    expect(res.status).toBe(403);
  });
});

/* ── The details, as a submission (D21-8, D21-17 to D21-19) ────────── */

describe("the check-in details wait for a clerk", () => {
  const AADHAAR = "123456789012";

  it("are refused before the code, and nothing is kept", async () => {
    const res = await asGuest(`/${link}/details`, "POST", { idType: "aadhaar", idNumber: AADHAAR });
    expect(res.status).toBe(404);
    const { rows } = await sql(
      "select count(*)::int as n from guest_detail_submissions where reservation_id = $1", [stayId]);
    expect(rows[0].n).toBe(0);
  });

  it("are kept as a submission, and do NOT reach guest_documents, when the guest sends them", async () => {
    const before = (await sql(
      "select to_jsonb(d) as row from guest_documents d where guest_id = $1", [guestId])).rows[0]?.row ?? null;
    const unlock = await unlockWith(link);

    const res = await asGuest(`/${link}/details`, "POST", {
      idType: "aadhaar", idNumber: AADHAAR, addressLine: "12 Temple Road", city: "Akkalkot",
    }, unlock);
    expect(res.status, await res.clone().text()).toBe(200);

    const { rows } = await sql(
      `select id_number, status from guest_detail_submissions
        where reservation_id = $1 and status = 'waiting'`, [stayId]);
    expect(rows[0].id_number, "the full number is kept (D21-17)").toBe(AADHAAR);

    const after = (await sql(
      "select to_jsonb(d) as row from guest_documents d where guest_id = $1", [guestId])).rows[0]?.row ?? null;
    expect(after, "Form C's source is untouched until a person confirms (D21-8)").toEqual(before);

    const state = (await (await asGuest(`/${link}/details`, "GET", undefined, unlock)).json()) as {
      sent: { status: string; idLastFour: string };
    };
    expect(state.sent.status).toBe("waiting");
    expect(state.sent.idLastFour).toBe("9012");
  });

  it("show the desk the last four digits of an Aadhaar, and never the whole", async () => {
    const res = await asStaff(deskId, "/5EL/online-checkin");
    expect(res.status).toBe(200);
    const text = await res.clone().text();
    const body = (await res.json()) as { waiting: { reference: string; idNumber: string }[] };
    expect(body.waiting.length).toBeGreaterThan(0);
    expect(body.waiting[0]!.idNumber).toBe("…9012");
    expect(text, "the whole number never leaves for a screen (D21-18)").not.toContain(AADHAAR);
  });

  it("are refused to housekeeping", async () => {
    const { rows } = await sql(
      "select id::text from guest_detail_submissions where reservation_id = $1 and status = 'waiting'", [stayId]);
    const res = await asStaff(housekeeperId, `/5EL/online-checkin/submissions/${rows[0].id}/confirm`, "POST", {});
    expect(res.status).toBe(403);
  });

  it("are written to guest_documents by the clerk's one button, under the clerk's name", async () => {
    const { rows } = await sql(
      "select id::text from guest_detail_submissions where reservation_id = $1 and status = 'waiting'", [stayId]);
    const res = await asStaff(deskId, `/5EL/online-checkin/submissions/${rows[0].id}/confirm`, "POST", {});
    expect(res.status, await res.clone().text()).toBe(200);

    const { rows: doc } = await sql(
      "select id_type, id_number, address_line, captured_by::text from guest_documents where guest_id = $1",
      [guestId]);
    expect(doc[0].id_number).toBe(AADHAAR);
    expect(doc[0].address_line).toBe("12 Temple Road");
    expect(doc[0].captured_by, "the clerk who compared it with the ID").toBe(deskId);

    const { rows: sub } = await sql(
      "select status, handled_by::text from guest_detail_submissions where id = $1", [rows[0].id]);
    expect(sub[0]).toEqual({ status: "confirmed", handled_by: deskId });

    const again = await asStaff(deskId, `/5EL/online-checkin/submissions/${rows[0].id}/confirm`, "POST", {});
    expect(again.status, "confirmed once").toBe(409);
  });

  it("write nothing when the clerk sets them aside", async () => {
    const unlock = await unlockWith(link);
    await asGuest(`/${link}/details`, "POST", { idType: "voter", idNumber: "WRONG0001" }, unlock);
    const before = (await sql(
      "select to_jsonb(d) as row from guest_documents d where guest_id = $1", [guestId])).rows[0]?.row;

    const { rows } = await sql(
      "select id::text from guest_detail_submissions where reservation_id = $1 and status = 'waiting'", [stayId]);
    const res = await asStaff(deskId, `/5EL/online-checkin/submissions/${rows[0].id}/set-aside`, "POST", {});
    expect(res.status).toBe(200);

    const after = (await sql(
      "select to_jsonb(d) as row from guest_documents d where guest_id = $1", [guestId])).rows[0]?.row;
    expect(after).toEqual(before);
  });
});

/* ── The bill as it stands (D21-10, migration 124) ─────────────────── */

describe("the guest's bill", () => {
  it("is refused before the code and to the link alone, and is the desk's own bill after", async () => {
    const before = await asGuest(`/${link}/bill`);
    expect(before.status, "before the code").toBe(404);
    expect(((await before.json()) as { error: string }).error).toBe(NOTHING);

    const unlock = await unlockWith(link);
    expect((await asGuest(`/${link}/bill`)).status, "the link alone, after the code").toBe(404);
    expect((await asGuest(`/${link}/bill`, "GET", undefined, "an-unlock-nobody-was-given")).status)
      .toBe(404);

    const theirs = await asGuest(`/${link}/bill`, "GET", undefined, unlock);
    expect(theirs.status, await theirs.clone().text()).toBe(200);

    /* EXACTLY THE DESK'S (D21-10): the same stay's bill, asked for through the
       staff route the desk's print uses. One definition, so one answer. */
    const desks = await asStaff(deskId, `/5EL/stays/${stayId}/bill`);
    expect(desks.status).toBe(200);
    const guestBill = (await theirs.json()) as { stay: { reference: string }; balance: number };
    expect(guestBill).toEqual(await desks.json());
    expect(guestBill.stay.reference).toBeTruthy();
    expect(typeof guestBill.balance).toBe("number");
  });
});

/* ── A spa or laundry request (D21-9, D21-63) ──────────────────────── */

describe("a spa or laundry request", () => {
  it("is not offered, and is refused, where the hotel has the spa switched off", async () => {
    await sql(`insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'spa', false)
               on conflict (hotel_id, module) do update set is_enabled = false`, [hotelId]);
    const unlock = await unlockWith(link);

    const opened = (await (await asGuest(`/${link}`, "GET", undefined, unlock)).json()) as { offers: string[] };
    expect(opened.offers).not.toContain("spa");
    const res = await asGuest(`/${link}/requests`, "POST", { kind: "spa", what: "A massage" }, unlock);
    expect(res.status).toBe(409);
  });

  it("is kept for the desk where the spa is on, and the desk marks it done", async () => {
    await sql(`insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'spa', true)
               on conflict (hotel_id, module) do update set is_enabled = true`, [hotelId]);
    const unlock = await unlockWith(link);

    const opened = (await (await asGuest(`/${link}`, "GET", undefined, unlock)).json()) as { offers: string[] };
    expect(opened.offers).toContain("spa");
    const made = await asGuest(`/${link}/requests`, "POST",
      { kind: "spa", what: "A massage", wanted: "tomorrow morning" }, unlock);
    expect(made.status, await made.clone().text()).toBe(200);

    const desk = (await (await asStaff(deskId, "/5EL/online-checkin")).json()) as {
      requests: { id: string; what: string }[];
    };
    const mine = desk.requests.find((q) => q.what === "A massage");
    expect(mine, "the desk sees it").toBeTruthy();

    const done = await asStaff(deskId, `/5EL/online-checkin/requests/${mine!.id}`, "POST", { status: "done" });
    expect(done.status).toBe(200);
    const theirs = (await (await asGuest(`/${link}/requests`, "GET", undefined, unlock)).json()) as {
      requests: { what: string; status: string }[];
    };
    expect(theirs.requests.find((q) => q.what === "A massage")?.status).toBe("done");
  });
});

/* ── A message to the front desk (D23-14, migration 130) ───────────── */

describe("a message to the front desk (D23-14)", () => {
  type Msg = { id: string; what: string; reference: string; handledBy: string | null; handledAt: string | null };
  const messagesOf = async (who: string, query = "") =>
    ((await (await asStaff(who, `/5EL/online-checkin/messages${query}`)).json()) as { messages: Msg[] }).messages;
  const deskRows = async () => (await sql(
    `select reservation_id::text as stay, what from guest_requests
      where hotel_id = $1 and kind = 'desk' order by created_at`, [hotelId])).rows;

  it("is refused after a wrong code and to the link alone, and nothing is kept", async () => {
    await sql(
      `insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
       select s.link_id, s.reservation_id, encode(digest('424242','sha256'),'hex'), '…0000',
              now() + interval '10 minutes'
         from app.guest_link_stay($1) s`, [hashForTests(link)]);
    const wrong = await asGuest(`/${link}/verify`, "POST", { code: "111111" });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { unlock?: string }).unlock, "a wrong code unlocks nothing").toBeUndefined();

    for (const holding of [undefined, "an-unlock-nobody-was-given"]) {
      const res = await asGuest(`/${link}/requests`, "POST", { kind: "desk", what: "Towels please" }, holding);
      expect(res.status, `with ${holding ?? "the link alone"}`).toBe(404);
      expect(((await res.json()) as { error: string }).error).toBe(NOTHING);
    }
    expect(await deskRows(), "nothing refused was written").toEqual([]);
  });

  it("lands on the booking its link names, and cannot reach another booking", async () => {
    const unlock = await unlockWith(link);
    const { rows: others } = await sql(
      `select id::text as id from reservations
        where hotel_id = $1 and id <> $2 and status not in ('cancelled', 'void')
        order by created_at limit 1`, [hotelId, stayId]);
    const otherStay = others[0].id as string;
    const made = await asStaff(ownerId, `/5EL/stays/${otherStay}/guest-link`, "POST", {});
    const otherLink = tokenOf(((await made.json()) as { link: string }).link);

    try {
      /* This phone's unlock on another booking's link: refused at the door,
         and by the database function on its own (MEMORY 318). */
      const across = await asGuest(`/${otherLink}/requests`, "POST", { kind: "desk", what: "Across" }, unlock);
      expect(across.status).toBe(404);
      expect((await sql("select app.guest_request_make($1, $2, 'desk', 'Across', null) as v",
        [hashForTests(otherLink), hashForTests(unlock)])).rows[0].v).toBe(false);

      /* A booking named in the body is not read: the link decides. */
      const sent = await asGuest(`/${link}/requests`, "POST",
        { kind: "desk", what: "Towels please", reservationId: otherStay }, unlock);
      expect(sent.status, await sent.clone().text()).toBe(200);
      expect(await deskRows()).toEqual([{ stay: stayId, what: "Towels please" }]);
    } finally {
      await sql("delete from guest_links where token_hash = $1", [hashForTests(otherLink)]);
    }
  });

  it("waits unread in the booking's Guest messages, and the desk marks it handled under its name", async () => {
    const unlock = await unlockWith(link);
    expect((await asGuest(`/${link}/requests`, "POST", { kind: "desk", what: "A late checkout?" }, unlock)).status)
      .toBe(200);

    const unread = (await messagesOf(deskId)).find((m) => m.what === "A late checkout?");
    expect(unread, "the property's unread list").toBeTruthy();
    expect(unread!.handledAt).toBeNull();
    const booking = await messagesOf(deskId, `?reservation=${stayId}`);
    expect(booking.map((m) => m.id)).toContain(unread!.id);

    const checkin = (await (await asStaff(deskId, "/5EL/online-checkin")).json()) as { requests: { what: string }[] };
    expect(checkin.requests.map((q) => q.what), "not a spa or laundry request").not.toContain("A late checkout?");
    expect((await asStaff(housekeeperId, "/5EL/online-checkin/messages")).status).toBe(403);

    const done = await asStaff(deskId, `/5EL/online-checkin/requests/${unread!.id}`, "POST", { status: "done" });
    expect(done.status).toBe(200);
    const handled = (await messagesOf(deskId, `?reservation=${stayId}`)).find((m) => m.id === unread!.id);
    expect(handled?.handledBy).toBe(`${TAG} Desk`);
    expect(handled?.handledAt).toBeTruthy();
    expect((await messagesOf(deskId)).map((m) => m.id), "no longer unread").not.toContain(unread!.id);
    expect(await messagesOf(deskId, "?reservation=not-a-booking")).toEqual([]);
  });

  it("stops at ten waiting, like a request", async () => {
    await sql("delete from guest_requests where reservation_id = $1", [stayId]);
    await sql(
      `insert into guest_requests (hotel_id, reservation_id, kind, what)
       select $1, $2, 'desk', 'Message ' || n from generate_series(1, 10) n`, [hotelId, stayId]);
    const unlock = await unlockWith(link);
    const res = await asGuest(`/${link}/requests`, "POST", { kind: "desk", what: "An eleventh" }, unlock);
    expect(res.status).toBe(409);
  });
});
