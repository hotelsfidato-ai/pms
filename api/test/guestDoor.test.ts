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
     · a phone that is not the one on the booking: no code, and no hint
       that it was wrong
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
let phoneWas: string | null;
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

     THE PHONE IS THE TEST'S OWN. The demo guests carry none, and a test that
     depends on which fixture rows happen to have one is a test that passes
     here and not on the runner - which is how the whole of 18 September went.
     Put back in afterAll. */
  const { rows: stays } = await sql(
    `select r.id::text as id, r.guest_id::text as guest_id
       from reservations r
      where r.hotel_id = $1 and r.status not in ('cancelled','void')
      order by r.check_in desc limit 2`, [hotelId]);
  stayId = stays[0].id;
  otherStayId = stays[1].id;
  guestId = stays[0].guest_id;

  const { rows: had } = await sql("select phone from guests where id = $1", [guestId]);
  phoneWas = had[0].phone ?? null;
  phone = "9876500011";
  await sql("update guests set phone = $2 where id = $1", [guestId, phone]);

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
  await sql("update guests set phone = $2 where id = $1", [guestId, phoneWas]);
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
  it("says the same thing, in the same way, whether or not the number was right", async () => {
    const right = await asGuest(`/${link}/code`, "POST", { phone });
    const wrong = await asGuest(`/${link}/code`, "POST", { phone: "9000000001" });

    /* One of them made a code and one did not. A stranger trying numbers must
       not be able to tell which - not by the words, and NOT BY THE STATUS
       (D18-13). The first version of the door answered 200 for a wrong number
       and 503 for the right one, which is exactly how a stranger would have
       found the guest's number; this test caught it on its first run. */
    expect(wrong.status).toBe(right.status);
    expect(((await wrong.json()) as { message: string }).message)
      .toBe(((await right.json()) as { message: string }).message);
  });

  it("never puts the code in the answer, and makes one only for the booking's own number", async () => {
    await sql("delete from guest_link_codes where link_id in (select id from guest_links where reservation_id = $1)", [stayId]);
    const res = await asGuest(`/${link}/code`, "POST", { phone });
    const text = await res.clone().text();
    expect([200, 503]).toContain(res.status);

    const { rows } = await sql(
      `select code_hash, sent_to from guest_link_codes c
         join guest_links l on l.id = c.link_id
        where l.reservation_id = $1 order by c.created_at desc limit 1`, [stayId]);
    expect(rows.length, "the booking's own number gets a code").toBe(1);
    expect(rows[0].sent_to).toMatch(/^…\d{4}$/);
    expect(text, "the answer carries no code, in any environment")
      .not.toMatch(/\b\d{6}\b/);
    expect(rows[0].code_hash, "and the code is stored hashed").toHaveLength(64);
  });

  it("opens for the right code, and refuses a wrong one", async () => {
    /* The code is known here only because this test made it directly - which
       is the point: nothing a guest receives passes through the answer. */
    await sql("delete from guest_link_codes where link_id in (select id from guest_links where reservation_id = $1)", [stayId]);
    await sql(
      `insert into guest_link_codes (link_id, code_hash, sent_to, expires_at)
       select id, encode(digest('424242','sha256'),'hex'), '…9999', now() + interval '10 minutes'
         from guest_links where reservation_id = $1`, [stayId]);

    const wrong = await asGuest(`/${link}/verify`, "POST", { code: "111111" });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { verified: boolean }).verified).toBe(false);

    const right = await asGuest(`/${link}/verify`, "POST", { code: "424242" });
    expect(right.status, await right.clone().text()).toBe(200);
    expect(((await right.json()) as { verified: boolean }).verified).toBe(true);

    const { rows } = await sql(
      "select verified_at is not null as verified from guest_links where reservation_id = $1", [stayId]);
    expect(rows[0].verified).toBe(true);
  });

  it("dies after five wrong guesses, so a six-digit code is not a million tries", async () => {
    await sql("update guest_links set verified_at = null where reservation_id = $1", [stayId]);
    await sql("delete from guest_link_codes where link_id in (select id from guest_links where reservation_id = $1)", [stayId]);
    await sql(
      `insert into guest_link_codes (link_id, code_hash, sent_to, expires_at)
       select id, encode(digest('123456','sha256'),'hex'), '…9999', now() + interval '10 minutes'
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
      "select verified_at is null as unverified from guest_links where reservation_id = $1", [stayId]);
    expect(rows[0].unverified).toBe(true);
  });
});
