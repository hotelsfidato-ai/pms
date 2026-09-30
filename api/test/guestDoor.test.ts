import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { forgetKnocksForTests } from "../src/routes/guestDoor.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN DOOR (D18-9, D18-10, D18-13, migration 114)

   The only door here opened by somebody the hotel does not employ, and
   behind it is a guest's name, their passport and what they owe. So this
   file is mostly about what it REFUSES:

     · a link that was never made, or has expired, or was revoked
     · another booking - a token is one booking and nothing else
     · any number but the booking's own: nobody types one (D27-105), the
       code goes to the number the booking carries, or to nobody
     · a guessed code: five tries and it is dead
     · the bill, before the code has been answered

   The desk's side is an ordinary staff route, so it obeys row level
   security like everything else a clerk does.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"]
  ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

let ownerStaffId: string;
let deskStaffId: string;
let stayId: string;
let otherStayId: string;
let phone: string;
let guestId: string;
let link: string;         // the token itself, as the guest would hold it

const TAG = "GUESTDOOR";

const asStaff = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const asGuest = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/guest${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const tokenOf = (url: string) => url.split("/g/")[1]!;

beforeAll(async () => {
  ownerStaffId = (await sql("select id::text as id from staff where email = 'owner@fidato.in'")).rows[0].id;

  /* A clerk at 5EL, so "a clerk who may not see this booking" is a real
     person rather than a hypothesis. */
  const { rows: desk } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1,$2,$3)
     on conflict (email) do update set is_active = true, firebase_uid = excluded.firebase_uid
     returning id::text as id`,
    [`guestdoor-desk@fidato.in`, `${TAG} Desk`, "test-uid-guestdoor-desk"]);
  deskStaffId = desk[0].id;
  const hotelId = (await sql("select id::text as id from hotels where code = '5EL'")).rows[0].id;
  await sql("delete from staff_hotels where staff_id = $1", [deskStaffId]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1,$2,'front_desk')",
    [deskStaffId, hotelId]);

  /* Two bookings at the property, so "one token, one booking" can be proved
     rather than asserted.

     THE GUEST, THE PHONE AND BOTH BOOKINGS ARE THE TEST'S OWN, made here and
     removed in afterAll. They were "the latest two 5EL bookings" - a tie
     among demo rows that other files update, send codes about and make links
     for, so which two came back depended on what ran before. */
  phone = "9876500011";
  guestId = (await sql("insert into guests (full_name, phone) values ($1, $2) returning id::text as id",
    [`${TAG} Guest`, phone])).rows[0].id;
  const book = async (ref: string) => (await sql(
    `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                               check_in, check_out, adults, status, source, agreed_rate)
     select $1, $2, (select id from room_types where hotel_id = $1 limit 1), $3,
            (now() at time zone 'Asia/Kolkata')::date + 20,
            (now() at time zone 'Asia/Kolkata')::date + 21,
            1, 'confirmed', 'direct', 1000
     returning id::text as id`, [hotelId, guestId, ref])).rows[0].id as string;
  stayId = await book("GDR-1");
  otherStayId = await book("GDR-2");

  /* THE LINK IS MADE HERE, not in the first test, so that every test below
     stands on its own. When it was made by the first test, breaking the door
     on purpose made that test fail and left `link` undefined - and the tests
     after it then asked about `/api/guest/undefined`, were refused, and
     PASSED. A guard that passes because the thing it guards never ran is not
     a guard (root MEMORY 8). */
  const made = await asStaff(ownerStaffId, `/5EL/stays/${stayId}/guest-link`, "POST", {});
  expect(made.status, await made.clone().text()).toBe(200);
  link = tokenOf(((await made.json()) as { link: string }).link);
});

beforeEach(() => { forgetKnocksForTests(); });

afterAll(async () => {
  await sql(`delete from guest_link_codes where link_id in
               (select id from guest_links where reservation_id = any($1::uuid[]))`,
    [[stayId, otherStayId]]);
  await sql("delete from guest_links where reservation_id = any($1::uuid[])", [[stayId, otherStayId]]);
  await sql("delete from reservations where id = any($1::uuid[])", [[stayId, otherStayId]]);
  await sql("alter table guests disable trigger guests_no_delete");
  await sql("delete from guests where id = $1", [guestId]);
  await sql("alter table guests enable trigger guests_no_delete");
  await sql(`delete from staff_hotels where staff_id = $1`, [deskStaffId]);
  await sql("update staff set is_active = false where id = $1", [deskStaffId]);
  await closePool();
});

describe("the desk makes a guest their link", () => {
  it("hands back the link once, and stores only its hash", async () => {
    const res = await asStaff(deskStaffId, `/5EL/stays/${otherStayId}/guest-link`, "POST", {});
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { link: string; guest: string; phoneOnBooking: string | null };
    expect(body.link).toContain("/g/");
    const token = tokenOf(body.link);

    const { rows } = await sql(
      `select token_hash, expires_at > now() as alive
         from guest_links where reservation_id = $1 order by created_at desc limit 1`,
      [otherStayId]);
    expect(rows[0].alive).toBe(true);
    expect(rows[0].token_hash, "the token itself is nowhere in the database")
      .not.toContain(token);
    expect(rows[0].token_hash, "only its sha256").toHaveLength(64);

    /* And the desk is told the last four digits of the number the booking
       carries - never the number - so a clerk can say "is it the one ending
       0011?" without reading it out. */
    const mine = await asStaff(deskStaffId, `/5EL/stays/${stayId}/guest-link`, "POST", {});
    expect(((await mine.json()) as { phoneOnBooking: string }).phoneOnBooking)
      .toMatch(/^…\d{4}$/);
  });

  it("refuses a clerk who is not rostered at that property", async () => {
    /* Rostered nowhere, so `app.auth_hotel_ids()` is empty and the booking is
       not theirs to see. The same rule that hides another property's rows,
       asked of the one route that mints a credential. */
    const { rows } = await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1,$2,$3)
       on conflict (email) do update set is_active = true
       returning id::text as id`,
      ["guestdoor-nobody@fidato.in", `${TAG} Nobody`, "test-uid-guestdoor-nobody"]);
    await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);

    const res = await asStaff(rows[0].id, `/5EL/stays/${stayId}/guest-link`, "POST", {});
    expect([403, 404]).toContain(res.status);

    await sql("update staff set is_active = false where id = $1", [rows[0].id]);
  });
});

describe("what the link shows before the guest has proved who they are", () => {
  it("shows their own name and dates, and the last four digits of their number", async () => {
    const res = await asGuest(`/${link}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      booking: { guestName: string; checkIn: string }; verified: boolean; phoneHint: string;
    };
    expect(body.booking.guestName).toBeTruthy();
    expect(body.booking.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.verified, "nothing is proved yet").toBe(false);
    expect(body.phoneHint).toMatch(/^…\d{4}$/);
  });

  it("says the same nothing to a link that was never made, one that expired, and one revoked", async () => {
    const never = await asGuest(`/${"n".repeat(43)}`);
    expect(never.status).toBe(404);
    const said = ((await never.json()) as { error: string }).error;

    /* Both dates move: the row says a link must expire after it was made, and
       a test that breaks that constraint is testing the constraint. */
    await sql(`update guest_links
                  set created_at = now() - interval '3 days',
                      expires_at = now() - interval '1 day'
                where reservation_id = $1`, [stayId]);
    const expired = await asGuest(`/${link}`);
    expect(expired.status).toBe(404);
    expect(((await expired.json()) as { error: string }).error,
      "a stranger cannot tell a real link from a dead one").toBe(said);

    await sql(`update guest_links
                  set created_at = now(), expires_at = now() + interval '2 days'
                where reservation_id = $1`, [stayId]);
    await sql("update guest_links set revoked_at = now() where reservation_id = $1", [stayId]);
    const revoked = await asGuest(`/${link}`);
    expect(revoked.status).toBe(404);
    await sql("update guest_links set revoked_at = null where reservation_id = $1", [stayId]);
  });

  it("is one booking, and knows nothing of any other", async () => {
    const made = await asStaff(ownerStaffId, `/5EL/stays/${otherStayId}/guest-link`, "POST", {});
    const second = tokenOf(((await made.json()) as { link: string }).link);
    expect(second).not.toBe(link);

    const one = (await (await asGuest(`/${link}`)).json()) as { booking: { reference: string } };
    const two = (await (await asGuest(`/${second}`)).json()) as { booking: { reference: string } };
    expect(one.booking.reference).not.toBe(two.booking.reference);
  });
});

describe("the six digits that prove it is that guest", () => {
  /* A receiver shaped like the CRS's workflow (D27-186), keeping what it
     was sent: the code must go to the BOOKING's number, whatever anybody
     posts (D27-105, and OCI-2's rule that a stand-in must read what it
     gets). */
  const withReceiver = async <T>(fn: (seen: Array<{ to: { phone: string } }>) => Promise<T>) => {
    const { createServer } = await import("node:http");
    const seen: Array<{ to: { phone: string } }> = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => { seen.push(JSON.parse(raw)); res.writeHead(200).end("ok"); });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;
    process.env["CRS_N8N_URL"] = `http://127.0.0.1:${port}/pms-send`;
    process.env["CRS_N8N_SECRET"] = "only-this-test-run-knows-this";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
    try { return await fn(seen); } finally {
      for (const k of ["CRS_N8N_URL", "M2R_N8N_URL", "CRS_N8N_SECRET", "M2R_N8N_SECRET"]) delete process.env[k];
      await new Promise<void>((done) => server.close(() => done()));
    }
  };

  it("sends the code to the booking's own number, with none typed, and says where", async () => {
    await withReceiver(async (seen) => {
      forgetKnocksForTests();
      /* A number in the body is not read: there is nothing to type. */
      const res = await asGuest(`/${link}/code`, "POST", { phone: "9000000001" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sent: boolean; message: string };
      expect(body.sent).toBe(true);
      expect(body.message).toBe("We sent the code on WhatsApp to the number ending 0011.");
      expect(seen).toHaveLength(1);
      expect(seen[0]!.to.phone, "the booking's whole number, never the one posted").toBe(phone);
    });
  });

  it("says Ask the desk, and issues nothing, for a booking with no number", async () => {
    await sql("update guests set phone = null where id = $1", [guestId]);
    try {
      await withReceiver(async (seen) => {
        forgetKnocksForTests();
        await sql("delete from guest_link_codes where link_id in (select id from guest_links where reservation_id = $1)", [stayId]);
        const res = await asGuest(`/${link}/code`, "POST", {});
        expect(res.status).toBe(200);
        expect(((await res.json()) as { message: string }).message).toMatch(/no mobile number .* Ask the desk/);
        expect(seen, "nothing sent").toHaveLength(0);
        const { rows } = await sql(
          `select 1 from guest_link_codes c join guest_links l on l.id = c.link_id
            where l.reservation_id = $1`, [stayId]);
        expect(rows, "a code nobody can receive is not issued").toHaveLength(0);
      });
    } finally {
      await sql("update guests set phone = $2 where id = $1", [guestId, phone]);
    }
  });

  /* The development-only switch (D27-105): the code in the answer, sent to
     nobody - and only beside ALLOW_DEV_AUTH, which env.ts refuses to start
     with under production. The test server runs with it on. */
  it("hands the code back, and sends nothing, only on a development server told to", async () => {
    forgetKnocksForTests();
    const off = await asGuest(`/${link}/code`, "POST", {});
    expect(off.status, "no switch: nothing can be sent, and no code in the answer").toBe(503);
    expect(await off.text()).not.toMatch(/\b\d{6}\b/);

    process.env["GUEST_CODE_ON_SCREEN"] = "1";
    try {
      const on = await asGuest(`/${link}/code`, "POST", {});
      expect(on.status).toBe(200);
      const body = (await on.json()) as { devCode: string; message: string };
      expect(body.devCode).toMatch(/^\d{6}$/);
      expect(body.message).toMatch(/Development only: nothing was sent/);
      const { rows } = await sql(
        `select c.code_hash = encode(digest($2::text, 'sha256'), 'hex') as same
           from guest_link_codes c join guest_links l on l.id = c.link_id
          where l.token_hash = encode(digest($1::text, 'sha256'), 'hex')
          order by c.created_at desc limit 1`, [link, body.devCode]);
      expect(rows[0].same, "the code on screen is the live code").toBe(true);
    } finally {
      delete process.env["GUEST_CODE_ON_SCREEN"];
    }
  });

  /* ⚠ THIS TEST USED TO SAY `expect([200, 503]).toContain(res.status)` AND
     THEREFORE SAID NOTHING. The door gated on `N8N_SEND_WEBHOOK`, a name
     nothing in this repository has ever set, so it answered 503 for ever and
     this assertion passed anyway — and with it every guest was permanently
     unverifiable, and the whole half of D18-9 that sits behind verification
     was unreachable (MEMORY 304). A test that accepts either state of a
     half-built feature asserts nothing about either.

     Both states are pinned now, each to its own condition. */
  const codesFor = () => sql(
    `select code_hash, sent_to from guest_link_codes c
       join guest_links l on l.id = c.link_id
      where l.reservation_id = $1 order by c.created_at desc`, [stayId]);

  it("sends nothing AND ISSUES NOTHING while the hotel has not connected n8n", async () => {
    delete process.env["CRS_N8N_URL"];
    delete process.env["M2R_N8N_URL"];
    delete process.env["CRS_N8N_SECRET"];
    delete process.env["M2R_N8N_SECRET"];
    await sql("delete from guest_link_codes where link_id in (select id from guest_links where reservation_id = $1)", [stayId]);
    forgetKnocksForTests();

    const res = await asGuest(`/${link}/code`, "POST", {});
    expect(res.status, "it says plainly that it cannot send").toBe(503);

    /* The issue call used to sit ABOVE the check, so a knock at a server that
       could not send spent the guest's previous live code on an attempt
       nobody ever made. */
    const { rows } = await codesFor();
    expect(rows.length, "no code is issued when none can be sent").toBe(0);
  });

  it("issues one, keeps it hashed, and never puts it in the answer, once n8n is connected", async () => {
    /* A receiver that simply answers, so `canSend()` is true and the door
       takes its other branch. WHAT the sender hands over is proved in
       api/test/sending.test.ts against a receiver that inspects it; the only
       question here is whether this door issues the code and hides it. */
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => { res.writeHead(200).end("ok"); });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;
    process.env["CRS_N8N_URL"] = `http://127.0.0.1:${port}/pms-send`;
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
    process.env["CRS_N8N_SECRET"] = "only-this-test-run-knows-this";

    try {
      await sql("delete from guest_link_codes where link_id in (select id from guest_links where reservation_id = $1)", [stayId]);
      forgetKnocksForTests();

      const res = await asGuest(`/${link}/code`, "POST", {});
      const text = await res.clone().text();
      expect(res.status).toBe(200);

      const { rows } = await codesFor();
      expect(rows.length, "the booking's own number gets a code").toBe(1);
      expect(rows[0].sent_to, "and only the last four digits are kept")
        .toMatch(/^…\d{4}$/);
      expect(rows[0].code_hash, "the code is stored hashed").toHaveLength(64);
      expect(text, "and it is never in the answer, in any environment")
        .not.toMatch(/\b\d{6}\b/);
    } finally {
      delete process.env["CRS_N8N_URL"];
      delete process.env["M2R_N8N_URL"];
      delete process.env["CRS_N8N_SECRET"];
      delete process.env["M2R_N8N_SECRET"];
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("opens for the right code, and refuses a wrong one", async () => {
    /* The code is known here only because this test made it directly - which
       is the point: nothing a guest receives passes through the answer. */
    await sql("delete from guest_link_codes where link_id in (select id from guest_links where reservation_id = $1)", [stayId]);
    await sql(
      `insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
       select id, reservation_id, encode(digest('424242','sha256'),'hex'), '…9999', now() + interval '10 minutes'
         from guest_links where reservation_id = $1`, [stayId]);

    const wrong = await asGuest(`/${link}/verify`, "POST", { code: "111111" });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { verified: boolean }).verified).toBe(false);

    const right = await asGuest(`/${link}/verify`, "POST", { code: "424242" });
    expect(right.status, await right.clone().text()).toBe(200);
    const answered = (await right.json()) as { verified: boolean; unlock?: string };
    expect(answered.verified).toBe(true);
    /* D21-6: the answer unlocks THIS phone - api/test/guestDoorBehindTheCode
       .test.ts proves the link alone opens nothing behind the code. */
    expect(answered.unlock, "this phone's unlock, handed back once").toMatch(/^[\w-]{43}$/);
    /* D27-169: for a day, not the hour it was (D21-92). */
    const { rows: life } = await sql(
      `select extract(epoch from expires_at - created_at)::int as seconds from guest_unlocks
        where unlock_hash = encode(digest($1::text, 'sha256'), 'hex')`, [answered.unlock]);
    expect(life[0].seconds, "a day unlocked").toBe(24 * 3600);

    /* THIS link, by its hash. The stay has two - the desk made it another in
       the first test - and "where reservation_id" answered whichever one the
       planner reached first: the verified one by index, the other by a
       sequential scan once guest_links had statistics. */
    const { rows } = await sql(
      "select verified_at is not null as verified from guest_links where token_hash = encode(digest($1,'sha256'),'hex')", [link]);
    expect(rows[0].verified).toBe(true);
  });

  it("dies after five wrong guesses, so a six-digit code is not a million tries", async () => {
    await sql("update guest_links set verified_at = null where reservation_id = $1", [stayId]);
    await sql("delete from guest_link_codes where link_id in (select id from guest_links where reservation_id = $1)", [stayId]);
    await sql(
      `insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
       select id, reservation_id, encode(digest('123456','sha256'),'hex'), '…9999', now() + interval '10 minutes'
         from guest_links where reservation_id = $1`, [stayId]);

    for (let i = 0; i < 5; i += 1) {
      const res = await asGuest(`/${link}/verify`, "POST", { code: "000000" });
      expect(res.status).toBe(401);
    }
    /* The sixth is the RIGHT code, and it must still be refused: the code is
       dead, not the guess. */
    const right = await asGuest(`/${link}/verify`, "POST", { code: "123456" });
    expect(right.status, "five wrong answers kill the code").toBe(401);

    const { rows } = await sql(
      "select verified_at is null as unverified from guest_links where token_hash = encode(digest($1,'sha256'),'hex')", [link]);
    expect(rows[0].unverified).toBe(true);
  });
});
