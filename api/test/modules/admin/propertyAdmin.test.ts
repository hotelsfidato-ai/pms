import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A GENERAL MANAGER RUNS THEIR OWN HOTEL, AND ONLY THEIR OWN

   ⚠ THE ASSERTIONS THAT MATTER HERE ARE THE REFUSALS. A file that only
   proved a GM can roster their own staff would pass just as happily
   against a predicate that let them roster everybody's — and
   `app.is_manager()`, which was sitting right there and looks like the
   obvious gate, is exactly that predicate: it returns true for a
   manager ANYWHERE.

   Three doors this must keep shut:

     the manager of one hotel rostering staff at another
     a gm appointing an `owner`, which grants every action there
     a gm resetting a GROUP ADMINISTRATOR's password, which is how a
       property manager becomes an owner of seven hotels

   Firebase is NOT exercised here. Creating accounts needs a service
   account this suite does not carry, so the endpoints that touch it are
   covered by their refusals and by the browser. What is proved here is
   the authorisation, which is the part that must not be wrong.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;
let gmId: string;
let clerkId: string;
let strangerId: string;

const as = (id: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { "x-dev-staff-id": id, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const owner = await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'");
    ownerId = owner.rows[0]!.id;

    /* A manager at AGR and nowhere else, a clerk at AGR, and somebody
       with no property at all — the three positions the rules differ
       between. */
    const mk = async (email: string, name: string) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into staff (email, full_name, firebase_uid)
         values ($1, $2, $3)
         on conflict (email) do update
           set is_active = true, full_name = excluded.full_name
         returning id::text`,
        [email, name, `test-uid-${email.replace(/\W/g, "")}`]);
      return rows[0]!.id;
    };
    gmId = await mk("pa-gm@fidato.in", "PATEST Manager");
    clerkId = await mk("pa-clerk@fidato.in", "PATEST Clerk");
    strangerId = await mk("pa-stranger@fidato.in", "PATEST Stranger");

    await db.query(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, 'gm' from hotels where code = 'AGR'
       on conflict (staff_id, hotel_id) do update set role = 'gm'`, [gmId]);
    await db.query(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, 'front_desk' from hotels where code = 'AGR'
       on conflict (staff_id, hotel_id) do update set role = 'front_desk'`,
      [clerkId]);
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query(
      "delete from staff_hotels where staff_id = any($1)",
      [[gmId, clerkId, strangerId]]);
    await db.query("update staff set is_active = false where id = any($1)",
      [[gmId, clerkId, strangerId]]);
  } finally { await db.end(); }
  await closePool();
});

describe("rostering, scoped to one hotel", () => {
  it("lets the manager of AGR give a role AT AGR", async () => {
    const res = await as(gmId, `/admin/staff/${strangerId}/access`, "POST",
      { code: "AGR", role: "housekeeping" });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("⚠ REFUSES the manager of AGR at another hotel", async () => {
    /* `app.is_manager()` would have allowed this. It asks "are you a
       manager anywhere", and there is no hotel_id anywhere in it.

       ⚠ THE REFUSAL ARRIVES EARLIER THAN THE GUARD, and that is better
       rather than worse. `hotels_read` is "group admin, or you have a
       row at that hotel", so the manager of Akkalkot cannot SEE Pune at
       all and the route answers "no property with code PUN" before
       app.require_hotel_admin is reached. Two independent layers, and
       neither is load-bearing alone — so this asserts the EFFECT rather
       than which layer spoke. */
    const res = await as(gmId, `/admin/staff/${strangerId}/access`, "POST",
      { code: "PUN", role: "housekeeping" });
    expect([403, 409]).toContain(res.status);

    const db = await admin();
    try {
      const { rows } = await db.query(
        `select 1 from staff_hotels sh join hotels h on h.id = sh.hotel_id
          where sh.staff_id = $1 and h.code = 'PUN'`, [strangerId]);
      expect(rows.length, "the refusal was cosmetic — the row was written")
        .toBe(0);
    } finally { await db.end(); }
  });

  it("⚠ REFUSES a manager appointing an owner", async () => {
    /* `owner` grants every action on every resource at the property, so
       a gm who could assign it could assign it to themselves. */
    const res = await as(gmId, `/admin/staff/${strangerId}/access`, "POST",
      { code: "AGR", role: "owner" });
    expect(res.status).toBe(409);
    const reason = ((await res.json()) as { reason: string }).reason;
    expect(reason).toMatch(/not yours to give/i);
    /* The role they asked for is NAMED — a refusal that will not repeat
       what you typed reads as though it did not understand you. What
       must not contain it is the LIST that follows, because a refusal
       advertising the thing it just refused is worse than useless. */
    expect(reason.split("You may give:")[1]).not.toMatch(/owner/);
  });

  it("lets a manager appoint another manager", async () => {
    /* A relief manager is an ordinary thing, and a gm is what they
       already are — this is not escalation. */
    const res = await as(gmId, `/admin/staff/${strangerId}/access`, "POST",
      { code: "AGR", role: "gm" });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("refuses a clerk entirely", async () => {
    const res = await as(clerkId, `/admin/staff/${strangerId}/access`, "POST",
      { code: "AGR", role: "housekeeping" });
    expect(res.status).toBe(403);
  });

  it("scopes taking access away the same as giving it", async () => {
    const mine = await as(gmId, `/admin/staff/${strangerId}/access/AGR`,
      "DELETE");
    expect(mine.status, await mine.clone().text()).toBe(200);

    const theirs = await as(gmId, `/admin/staff/${ownerId}/access/PUN`,
      "DELETE");
    expect([403, 409], "a gate on giving and not on taking is a gate")
      .toContain(theirs.status);
  });
});

describe("who may set a password", () => {
  it("⚠ REFUSES a manager aiming at a group administrator", async () => {
    /* The one door this whole feature must not open. Reset the owner's
       password and you sign in as the owner, at all seven properties.

       ⚠ AND THE GROUP ADMIN IS MADE VISIBLE FIRST, deliberately. Without
       a shared property the manager cannot see that staff row at all and
       the answer is "no such person" — which is a refusal, but it would
       prove RLS rather than `app.may_set_password`, and the day somebody
       rosters the owner at a hotel the untested predicate is the only
       thing left. Rostering them here is the hostile case. */
    const db = await admin();
    try {
      await db.query(
        `insert into staff_hotels (staff_id, hotel_id, role)
         select $1, id, 'owner' from hotels where code = 'AGR'
         on conflict (staff_id, hotel_id) do nothing`, [ownerId]);

      const res = await as(gmId, `/admin/staff/${ownerId}/password`, "POST",
        { password: "not-happening-1" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { reason: string }).reason)
        .toMatch(/not for a group administrator/i);
    } finally {
      await db.query(
        `delete from staff_hotels
          where staff_id = $1
            and hotel_id = (select id from hotels where code = 'AGR')`,
        [ownerId]).catch(() => undefined);
      await db.end();
    }
  });

  it("refuses a clerk setting somebody else's", async () => {
    const res = await as(clerkId, `/admin/staff/${gmId}/password`, "POST",
      { password: "not-happening-1" });
    expect(res.status).toBe(409);
  });

  it("refuses a password too short to be worth having", async () => {
    const res = await as(ownerId, `/admin/staff/${clerkId}/password`, "POST",
      { password: "short" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/at least 8/i);
  });

  it("refuses one character repeated", async () => {
    const res = await as(ownerId, `/admin/staff/${clerkId}/password`, "POST",
      { password: "aaaaaaaaaa" });
    expect(res.status).toBe(409);
  });

  it("refuses an empty one rather than setting it", async () => {
    const res = await as(ownerId, `/admin/staff/${clerkId}/password`, "POST",
      {});
    expect(res.status).toBe(409);
  });
});

describe("adding somebody", () => {
  it("REFUSES without a password, and says why", async () => {
    /* ⚠ THE DEFECT THIS WHOLE CHANGE EXISTS FOR. Adding somebody used
       to write a row and stop: they appeared on the People screen with
       a role and a property and could not sign in, because no account
       existed and no password had ever been set. An optional password
       would recreate that hole for anybody who left the box empty. */
    const res = await as(ownerId, "/admin/staff", "POST",
      { email: "pa-nopass@fidato.in", name: "PATEST No Password" });
    expect(res.status).toBe(409);
    const reason = ((await res.json()) as { reason: string }).reason;
    expect(reason).toMatch(/no way for them to sign in/i);

    const db = await admin();
    try {
      const { rows } = await db.query(
        "select 1 from staff where email = 'pa-nopass@fidato.in'");
      expect(rows.length, "a row was written for somebody who cannot sign in")
        .toBe(0);
    } finally { await db.end(); }
  });

  it("refuses a manager adding somebody at another hotel", async () => {
    const res = await as(gmId, "/admin/staff", "POST", {
      email: "pa-elsewhere@fidato.in", name: "PATEST Elsewhere",
      password: "a-real-password", hotelCode: "PUN", role: "front_desk",
    });
    expect([403, 409]).toContain(res.status);

    const db = await admin();
    try {
      const { rows } = await db.query(
        "select 1 from staff where email = 'pa-elsewhere@fidato.in'");
      expect(rows.length, "a person was created for a hotel they do not run")
        .toBe(0);
    } finally { await db.end(); }
  });

  it("REFUSES a manager 'adding' the owner — that was a takeover", async () => {
    /* ⚠ THE HOLE 088 CLOSES. Adding somebody adopts an account that
       already exists and SETS ITS PASSWORD. A gm who typed the owner's
       email, a role they may give and a password of their own chose the
       owner's password — and Firebase cannot be rolled back, so the
       refusal at the staff row came too late.

       Firebase is not configured in this suite, so a request that got as
       far as ensureAccount comes back a 500. A 403 carrying the reason is
       the proof that the refusal now comes FIRST. Capitals, because the
       address is citext and a check that missed them would miss them. */
    const res = await as(gmId, "/admin/staff", "POST", {
      email: "OWNER@fidato.in", name: "Anybody", password: "the-gm-chose-this",
      hotelCode: "AGR", role: "front_desk",
    });
    expect(res.status, await res.clone().text()).toBe(403);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/already belongs to somebody you cannot manage/i);
  });

  it("refuses the same for somebody at a hotel the manager does not run", async () => {
    const res = await as(gmId, "/admin/staff", "POST", {
      email: "pune@fidato.in", name: "Anybody", password: "the-gm-chose-this",
      hotelCode: "AGR", role: "front_desk",
    });
    expect(res.status, await res.clone().text()).toBe(403);
  });

  it("refuses a hotel with no role named", async () => {
    const res = await as(gmId, "/admin/staff", "POST", {
      email: "pa-norole@fidato.in", name: "PATEST No Role",
      password: "a-real-password", hotelCode: "AGR",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/which role/i);
  });
});

describe("one property, for whoever runs it", () => {
  it("gives the manager their own hotel, with its team", async () => {
    const res = await as(gmId, "/admin/hotels/AGR");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      property: { code: string; gstin: string | null };
      staff: { email: string; role: string; canSignIn: boolean }[];
      grantableRoles: string[];
    };
    expect(body.property.code).toBe("AGR");
    expect(body.staff.some((x) => x.email === "pa-clerk@fidato.in")).toBe(true);
    /* The picker offers exactly what the server will accept. */
    expect(body.grantableRoles).not.toContain("owner");
    expect(body.grantableRoles).toContain("front_desk");
  });

  it("⚠ REFUSES them another hotel — it carries its GSTIN", async () => {
    /* 404 rather than 403, because `hotels_read` hides it before the
       guard is reached — and 404 leaks less than 403, which would
       confirm that a property with that code exists. */
    const res = await as(gmId, "/admin/hotels/PUN");
    expect([403, 404]).toContain(res.status);
    expect(await res.clone().text()).not.toMatch(/gstin/i);
  });

  it("gives the owner every role in the picker", async () => {
    const res = await as(ownerId, "/admin/hotels/AGR");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grantableRoles: string[] };
    expect(body.grantableRoles).toContain("owner");
  });

  it("says who cannot sign in", async () => {
    /* A staff row with no Firebase account is a person on the list with
       a role and a property who cannot get in. Until this field existed
       the only way to find out was to walk to a terminal and try. */
    const db = await admin();
    try {
      await db.query(
        "update staff set firebase_uid = null where id = $1", [clerkId]);
      const res = await as(ownerId, "/admin/hotels/AGR");
      const body = (await res.json()) as {
        staff: { email: string; canSignIn: boolean }[];
      };
      const clerk = body.staff.find((x) => x.email === "pa-clerk@fidato.in");
      expect(clerk!.canSignIn).toBe(false);
    } finally {
      await db.query(
        "update staff set firebase_uid = $2 where id = $1",
        [clerkId, "test-uid-paclerkfidatoin"]).catch(() => undefined);
      await db.end();
    }
  });
});
