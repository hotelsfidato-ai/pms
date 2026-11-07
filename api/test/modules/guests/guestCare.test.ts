import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { forgetKnocksForTests } from "../../../src/routes/guestDoor.ts";
import { SURVEY_REFUSED } from "../../../src/routes/guestSurvey.ts";

/* ══════════════════════════════════════════════════════════════════
   GUEST CARE - PREFERENCES AND THE FEEDBACK SURVEY (D27-383 item 10)

   Each refusal is seen to refuse: another hotel's guest, a role that may
   not edit the guest, the link alone, a survey switched off, a stay not yet
   checked out, a second answer, an expired page. And the two promises that
   are not refusals: an allergy is never lost, and a low score never stops
   the review request (no review gating).

   Two properties of this file's own; the guest's link and unlock are made
   directly, as the database tests make them.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};
const asSession = async (
  staffId: string, run: (q: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>) => Promise<void>,
) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  const client = await db.connect();
  try {
    await client.query("select set_config('app.user_id', $1, false)", [staffId]);
    await run((text, params = []) => client.query(text, params));
  } finally { client.release(); await db.end(); }
};
const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

const PID = String(process.pid).slice(-2);
const A = `GA${PID}`;   // the hotel under test
const B = `GB${PID}`;   // another hotel of the group
const NOTHING = "This link is not usable. Ask the desk for a new one.";

let ownerId: string;
let hotelA: string; let hotelB: string;
const staff = new Map<string, string>();     // role at A -> staff id
let clerkB: string;                          // reception at B only
let arrivingGuest: string; let arrivingStay: string;
let otherGuest: string;                      // stayed only at B
let outGuest: string; let outStay: string;   // checked out at A
let inStay: string;                          // in house at A
const tokens: Record<string, string> = {};   // stay -> token
const unlocks: Record<string, string> = {};  // stay -> unlock

const staffCall = (who: string, code: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${code}${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const guestCall = (stay: string, path: string, method = "GET", body?: unknown, withUnlock = true) =>
  app.request(`/api/guest/${tokens[stay]}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(withUnlock ? { authorization: `Guest ${unlocks[stay]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const surveyOn = (on: boolean) => sql(
  `insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'feedback_survey', $2)
   on conflict (hotel_id, module) do update set is_enabled = excluded.is_enabled`, [hotelA, on]);

/* ── the fake receiver, n8n's shape (as reputation.test.ts) ─────────── */
let server: Server; let receiverUrl: string;
let seen: { data?: Record<string, string> } | null = null;
const SECRET = "guest-care-secret";
const connected = () => {
  process.env["CRS_N8N_URL"] = process.env["M2R_N8N_URL"] = receiverUrl;
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
  process.env["CRS_N8N_SECRET"] = process.env["M2R_N8N_SECRET"] = SECRET;
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { seen = JSON.parse(raw || "{}"); res.writeHead(200).end("sent"); });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;

  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  await asSession(ownerId, async (q) => {
    hotelA = (await q("select app.provision_property_unchecked($1, 'Guest Care A', 'Nowhere')::text as id", [A])).rows[0]!.id as string;
    hotelB = (await q("select app.provision_property_unchecked($1, 'Guest Care B', 'Nowhere')::text as id", [B])).rows[0]!.id as string;
    await q("select app.bulk_create_rooms($1, 'STD', 1::smallint, 101, 103)", [hotelA]);
    await q("select app.bulk_create_rooms($1, 'STD', 1::smallint, 101, 101)", [hotelB]);

    const stay = async (hotel: string, guest: string, status: string, inDays: number, nights: number) =>
      (await q(
        `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
         values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 limit 1),
                 app.business_date($1) + $4::int, app.business_date($1) + $4::int + $5::int, 2000, $3)
         returning id::text`, [hotel, guest, status, inDays, nights])).rows[0]!.id as string;
    const guest = async (name: string) => (await q(
      "insert into guests (full_name, phone, email) values ($1, '+919800000001', 'care@example.com') returning id::text",
      [`GC${PID} ${name}`])).rows[0]!.id as string;

    arrivingGuest = await guest("Arriving");
    arrivingStay = await stay(hotelA, arrivingGuest, "confirmed", 0, 2);
    await q(`insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
             select $1, $2, id, app.business_date($1), app.business_date($1) + 2, 'arrival'
               from rooms where hotel_id = $1 and number = '101'`, [hotelA, arrivingStay]);
    otherGuest = await guest("Elsewhere");
    await stay(hotelB, otherGuest, "confirmed", 3, 1);
    outGuest = await guest("Left");
    outStay = await stay(hotelA, outGuest, "checked_out", -2, 2);
    inStay = await stay(hotelA, await guest("In house"), "checked_in", -1, 3);

    for (const s of [arrivingStay, outStay, inStay]) {
      tokens[s] = `gc-token-${PID}-${s}`;
      unlocks[s] = `gc-unlock-${PID}-${s}`;
      const link = (await q(
        `insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
         values ($1, $2, $3, now() + interval '1 day') returning id::text`,
        [hotelA, s, sha(tokens[s])])).rows[0]!.id as string;
      await q(`insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
               values ($1, $2, $3, now() + interval '1 day')`, [link, s, sha(unlocks[s])]);
    }

    for (const role of ["front_desk", "housekeeping", "gm", "pos", "chef"]) {
      const id = (await q(
        `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
         on conflict (email) do update set is_active = true returning id::text`,
        [`gc-${role}-${process.pid}@fidato.in`, `GC ${role}`, `test-uid-gc-${process.pid}-${role}`])).rows[0]!.id as string;
      await q("delete from staff_hotels where staff_id = $1", [id]);
      await q("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelA, role]);
      staff.set(role, id);
    }
    clerkB = (await q(
      `insert into staff (email, full_name, firebase_uid) values ($1, 'GC clerk B', $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`gc-clerk-b-${process.pid}@fidato.in`, `test-uid-gc-${process.pid}-clerk-b`])).rows[0]!.id as string;
    await q("delete from staff_hotels where staff_id = $1", [clerkB]);
    await q("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'front_desk')", [clerkB, hotelB]);
  });
});

beforeEach(() => {
  forgetKnocksForTests();
  seen = null;
  for (const k of ["CRS_N8N_URL", "M2R_N8N_URL", "CRS_N8N_SECRET", "M2R_N8N_SECRET"]) delete process.env[k];
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  /* The properties stay: the scratch database is dropped after the run
     (reputation.test.ts, REV-4 - a teardown here would lock `hotels`). */
  await closePool();
});

/* ══════════════════════════════════════════════════════════════════
   PREFERENCES
   ══════════════════════════════════════════════════════════════════ */

describe("a guest's preferences, at the desk", () => {
  it("are set by reception, cleaned, and read back where they help", async () => {
    const res = await staffCall(staff.get("front_desk")!, A, `/guests/${arrivingGuest}/preferences`, "PUT", {
      preferences: { floor: "high", bed: "twin", quiet: true, smoking: false, food: "jain",
                     allergies: "  peanuts ", pillow: "", notes: "Late check-in" },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const one = await (await staffCall(staff.get("front_desk")!, A, `/guests/${arrivingGuest}/preferences`)).json() as {
      preferences: Record<string, unknown>; smokingOffered: boolean };
    expect(one.preferences).toEqual({ floor: "high", bed: "twin", quiet: true, food: "jain",
                                      allergies: "peanuts", notes: "Late check-in" });
    expect(one.smokingOffered).toBe(false);

    /* The housekeeping board and the till read the list: the arriving
       guest's room, flagged arriving. */
    for (const role of ["housekeeping", "pos"]) {
      const list = await staffCall(staff.get(role)!, A, "/guest-preferences");
      expect(list.status, role).toBe(200);
      const { stays } = await list.json() as { stays: Array<{ stayId: string; room: string; arriving: boolean }> };
      expect(stays.find((s) => s.stayId === arrivingStay), role).toMatchObject({ room: "101", arriving: true });
    }
  });

  it("refuse an impossible choice in words, and write nothing", async () => {
    const res = await staffCall(staff.get("front_desk")!, A, `/guests/${arrivingGuest}/preferences`, "PUT", {
      preferences: { floor: "penthouse" } });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toBe("A floor is low or high, or none.");
    const { rows } = await sql("select preferences->>'floor' as f from guests where id = $1", [arrivingGuest]);
    expect(rows[0].f).toBe("high");
  });

  it("the database refuses a shape the route would not write", async () => {
    await expect(sql("update guests set preferences = '{\"floor\": \"penthouse\"}' where id = $1", [arrivingGuest]))
      .rejects.toThrow(/guests_preferences_ok/);
  });

  it("refuse another hotel's guest - even for the owner, who sees both hotels", async () => {
    const res = await staffCall(ownerId, A, `/guests/${otherGuest}/preferences`, "PUT", { preferences: { quiet: true } });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe("No such guest here.");
    expect((await staffCall(ownerId, A, `/guests/${otherGuest}/preferences`)).status).toBe(404);
    const { rows } = await sql("select preferences from guests where id = $1", [otherGuest]);
    expect(rows[0].preferences).toEqual({});
  });

  it("refuse a clerk of another hotel at this one", async () => {
    const res = await staffCall(clerkB, A, `/guests/${arrivingGuest}/preferences`, "PUT", { preferences: {} });
    expect([403, 404]).toContain(res.status);
    const { rows } = await sql("select preferences->>'floor' as f from guests where id = $1", [arrivingGuest]);
    expect(rows[0].f).toBe("high");
  });

  it("refuse a role that may not edit the guest (housekeeping), before anything is written", async () => {
    const res = await staffCall(staff.get("housekeeping")!, A, `/guests/${arrivingGuest}/preferences`, "PUT", {
      preferences: {} });
    expect(res.status).toBe(403);
    const { rows } = await sql("select preferences->>'floor' as f from guests where id = $1", [arrivingGuest]);
    expect(rows[0].f).toBe("high");
  });

  it("are not read by a role that reads no stays (the chef)", async () => {
    expect((await staffCall(staff.get("chef")!, A, "/guest-preferences")).status).toBe(403);
  });

  it("offer smoking only where the hotel has a smoking room, and keep it elsewhere", async () => {
    const fd = staff.get("front_desk")!;
    await staffCall(fd, A, `/guests/${arrivingGuest}/preferences`, "PUT", { preferences: { smoking: true } });
    let { rows } = await sql("select preferences ? 'smoking' as s from guests where id = $1", [arrivingGuest]);
    expect(rows[0].s, "no smoking room here: not kept").toBe(false);

    await sql("update rooms set smoking = true where hotel_id = $1 and number = '103'", [hotelA]);
    await staffCall(fd, A, `/guests/${arrivingGuest}/preferences`, "PUT", { preferences: { smoking: true, allergies: "peanuts" } });
    ({ rows } = await sql("select preferences ? 'smoking' as s from guests where id = $1", [arrivingGuest]));
    expect(rows[0].s).toBe(true);

    await sql("update rooms set smoking = false where hotel_id = $1", [hotelA]);
    await staffCall(fd, A, `/guests/${arrivingGuest}/preferences`, "PUT", { preferences: { allergies: "peanuts" } });
    ({ rows } = await sql("select preferences ? 'smoking' as s from guests where id = $1", [arrivingGuest]));
    expect(rows[0].s, "a save where it is not offered keeps it").toBe(true);
  });

  it("never lose an allergy to a join: a record joined in still shows its allergy", async () => {
    const joined = (await sql(
      `insert into guests (full_name, preferences, joined_into)
       values ('GC joined away', '{"allergies": "shellfish"}', $1) returning id::text`, [arrivingGuest])).rows[0].id;
    const { stays } = await (await staffCall(staff.get("front_desk")!, A, "/guest-preferences")).json() as {
      stays: Array<{ stayId: string; preferences: { allergies?: string } }> };
    expect(stays.find((s) => s.stayId === arrivingStay)?.preferences.allergies).toMatch(/peanuts/);
    expect(stays.find((s) => s.stayId === arrivingStay)?.preferences.allergies).toMatch(/shellfish/);
    await sql("delete from guests where id = $1", [joined]).catch(() => undefined);
  });
});

describe("a guest's preferences, on their own page", () => {
  it("show only their own, and are saved by them", async () => {
    const res = await guestCall(arrivingStay, "/preferences");
    expect(res.status).toBe(200);
    expect((await res.json() as { preferences: { allergies?: string } }).preferences.allergies).toBe("peanuts");

    const put = await guestCall(arrivingStay, "/preferences", "PUT", { preferences: { bed: "double", allergies: "peanuts" } });
    expect(put.status, await put.clone().text()).toBe(200);
    const { rows } = await sql("select preferences->>'bed' as b from guests where id = $1", [arrivingGuest]);
    expect(rows[0].b).toBe("double");
    /* Another stay's unlock reaches its own guest, never this one. */
    const other = await guestCall(inStay, "/preferences");
    expect((await other.json() as { preferences: object }).preferences).toEqual({});
  });

  it("are refused with the link alone, and nothing is written", async () => {
    expect((await guestCall(arrivingStay, "/preferences", "GET", undefined, false)).status).toBe(404);
    const put = await guestCall(arrivingStay, "/preferences", "PUT", { preferences: { bed: "twin" } }, false);
    expect(put.status).toBe(404);
    expect((await put.json() as { error: string }).error).toBe(NOTHING);
    const { rows } = await sql("select preferences->>'bed' as b from guests where id = $1", [arrivingGuest]);
    expect(rows[0].b).toBe("double");
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE FEEDBACK SURVEY
   ══════════════════════════════════════════════════════════════════ */

const GOOD = { overall: 5, room: 4, cleanliness: null, food: 5, staff: 5, comment: "Lovely." };
const BAD = { overall: 1, room: 2, cleanliness: 1, food: null, staff: 2, comment: "The AC did not work." };

describe("the feedback survey", () => {
  it("is not offered, and refused, while the hotel has it switched off (off to start)", async () => {
    const got = await (await guestCall(outStay, "/survey")).json() as { offered: boolean };
    expect(got.offered).toBe(false);
    const res = await guestCall(outStay, "/survey", "POST", GOOD);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe(SURVEY_REFUSED.off);
  });

  it("is refused before check-out", async () => {
    await surveyOn(true);
    expect((await (await guestCall(inStay, "/survey")).json() as { offered: boolean }).offered).toBe(false);
    const res = await guestCall(inStay, "/survey", "POST", GOOD);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe(SURVEY_REFUSED.not_yet);
  });

  it("is refused with the link alone", async () => {
    const res = await guestCall(outStay, "/survey", "POST", BAD, false);
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe(NOTHING);
  });

  it("refuses a score that is not 1 to 5, and an answer with no overall", async () => {
    for (const body of [{ ...GOOD, overall: 6 }, { ...GOOD, overall: null }, { ...GOOD, room: 0 }, { ...GOOD, food: 2.5 }]) {
      const res = await guestCall(outStay, "/survey", "POST", body);
      expect(res.status, JSON.stringify(body)).toBe(409);
    }
  });

  it("takes one answer after check-out, and refuses a second", async () => {
    expect((await (await guestCall(outStay, "/survey")).json() as { offered: boolean }).offered).toBe(true);
    const first = await guestCall(outStay, "/survey", "POST", BAD);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await first.json()).toEqual({ sent: true });

    const second = await guestCall(outStay, "/survey", "POST", GOOD);
    expect(second.status).toBe(409);
    expect((await second.json() as { error: string }).error).toBe(SURVEY_REFUSED.answered);
    const { rows } = await sql("select count(*)::int as n, min(overall) as o from guest_feedback where reservation_id = $1", [outStay]);
    expect(rows[0]).toEqual({ n: 1, o: 1 });
    expect(await (await guestCall(outStay, "/survey")).json()).toEqual({ offered: false, answered: true });
  });

  it("answers a happy guest exactly as an unhappy one: nothing asks for a review by score", async () => {
    /* The low answer above came back { sent: true }; a high one comes back
       the same, with no review link in either. */
    await sql("delete from guest_feedback where reservation_id = $1", [outStay]);
    const res = await guestCall(outStay, "/survey", "POST", GOOD);
    expect(await res.json()).toEqual({ sent: true });
    await sql("delete from guest_feedback where reservation_id = $1", [outStay]);
    await guestCall(outStay, "/survey", "POST", BAD);
  });

  it("is refused once the page has expired", async () => {
    await sql(`update guest_links set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute'
                where token_hash = $1`, [sha(tokens[inStay]!)]);
    await sql("update reservations set status = 'checked_out' where id = $1", [inStay]);
    const res = await guestCall(inStay, "/survey", "POST", GOOD);
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe(NOTHING);
    const { rows } = await sql("select count(*)::int as n from guest_feedback where reservation_id = $1", [inStay]);
    expect(rows[0].n).toBe(0);
  });
});

describe("what guests answered, for the GM", () => {
  it("is the scores by month and the latest answers, for the GM", async () => {
    const res = await staffCall(staff.get("gm")!, A, "/feedback");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      on: boolean; months: Array<{ answers: number; overall: number; food: number | null; low: number }>;
      answers: Array<{ stayId: string; comment: string; low: boolean }> };
    expect(body.on).toBe(true);
    expect(body.months[0]).toMatchObject({ answers: 1, overall: 1, food: null, low: 1 });
    expect(body.answers[0]).toMatchObject({ stayId: outStay, comment: "The AC did not work.", low: true });
  });

  it("is refused to reception", async () => {
    expect((await staffCall(staff.get("front_desk")!, A, "/feedback")).status).toBe(403);
  });

  it("puts a low score in the GM's Notifications, and not in reception's", async () => {
    const gm = await (await staffCall(staff.get("gm")!, A, "/notifications")).json() as Array<{ id: string; link: string }>;
    expect(gm.some((n) => n.id.startsWith("low-feedback-") && n.link === `/h/${A}/feedback`)).toBe(true);
    const desk = await (await staffCall(staff.get("front_desk")!, A, "/notifications")).json() as Array<{ id: string }>;
    expect(desk.some((n) => n.id.startsWith("low-feedback-"))).toBe(false);
  });
});

describe("the review request and the survey", () => {
  beforeAll(async () => {
    await sql("insert into review_links (hotel_id, url) values ($1, 'https://g.page/r/example-care/review')", [hotelA]);
    await sql("insert into guest_message_settings (hotel_id, kind, is_on) values ($1, 'review', true)", [hotelA]);
  });

  it("a low score never stops the review request", async () => {
    connected();
    const res = await staffCall(ownerId, A, `/reviews/${outStay}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(seen?.data?.["link"]).toBe("https://g.page/r/example-care/review");
    /* Answered already: the survey is not offered again. */
    expect(seen?.data?.["feedback"]).toBeUndefined();
  });

  it("carries the survey's link in the same message while it is unanswered", async () => {
    await sql("delete from guest_feedback where reservation_id = $1", [outStay]);
    connected();
    const res = await staffCall(ownerId, A, `/reviews/${outStay}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(200);
    expect(seen?.data?.["feedback"]).toMatch(/\/g\/[A-Za-z0-9_-]{40,}$/);
  });

  it("carries no survey link where the hotel has it switched off", async () => {
    await surveyOn(false);
    connected();
    await staffCall(ownerId, A, `/reviews/${outStay}/ask`, "POST", { channel: "whatsapp" });
    expect(seen?.data?.["feedback"]).toBeUndefined();
  });
});
