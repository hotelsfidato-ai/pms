import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import {
  VIEW_ROLES, ASK_ROLES, LINK_ROLES, REVIEWS_REFUSED,
} from "../../../src/modules/reputation/reputation.ts";
import { grantsFor, ASSIGNABLE_ROLES } from "../../../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   REVIEWS — the refusals first, because the refusals are the service

   The owner has NOT given the group's review link (D18-14, and the run
   sheet's "what the owner owes"). A service that sends a review request
   with no link to put in it would either send an empty sentence or an
   invented address, and the second is worse than never sending at all.

   So the first thing proved here is that it refuses, by name, and that
   NOTHING IS RECORDED when it does: the sender writes one row per
   attempt, and a message that could never have carried a link is not an
   attempt anybody made.

   ⚠ EVERY GUARD BELOW WAS SEEN TO FAIL with its check taken out before
   this file was called finished — the numbers are in the service's
   CHANGELOG.

   THE SEND PATH IS REAL, not mocked. A fake HTTP receiver shaped like the
   owner's n8n workflow is started here, exactly as `api/test/sending.test.ts`
   does, so "it sends the link" is proved against something that read it
   rather than asserted against a stub.

   Everything is made at a property this file provisions and removes, so
   nothing it does can be confused with somebody's data (MEMORY 292).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

/** Several statements on ONE connection. `set_config(..., false)` is a
    session setting, and every call of `sql` above opens its own pool and
    closes it - so a `set_config` there is gone by the next line, and
    `provision_property_unchecked` refuses with "only a group administrator
    may provision a property" for a reason that has nothing to do with the
    caller's rights. */
const asSession = async (
  staffId: string, run: (q: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>) => Promise<void>,
) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  const client = await db.connect();
  try {
    await client.query("select set_config('app.user_id', $1, false)", [staffId]);
    await run((text, params = []) => client.query(text, params));
  } finally {
    client.release();
    await db.end();
  }
};

/* A property of this file's own. The code is short and carries the pid so
   two runs on one machine cannot collide. */
const CODE = `RV${String(process.pid).slice(-2)}`;
const TAG = `RVTEST${process.pid}`;

let hotelId: string;
let ownerStaffId: string;
let departedId: string;
let inHouseId: string;
/** A departure whose guest has a number and no address at all on file. */
let noAddressId: string;
const staffByRole = new Map<string, string>();

const call = (staffId: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const asOwner = (path: string, method = "GET", body?: unknown) =>
  call(ownerStaffId, path, method, body);

/* ── the fake receiver, n8n's shape and nothing else ─────────────── */

interface Seen {
  secret: string | undefined;
  body: { kind?: string; channel?: string; data?: Record<string, string> };
}
let server: Server;
let receiverUrl: string;
let seen: Seen | null = null;
const THE_SECRET = "a-secret-that-exists-only-in-this-test-run";

const connected = () => {
  process.env["CRS_N8N_URL"] = process.env["M2R_N8N_URL"] = receiverUrl;
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
  process.env["CRS_N8N_SECRET"] = process.env["M2R_N8N_SECRET"] = THE_SECRET;
};

/** How many review requests this file's property has recorded. Counted for
    THIS property only: a test that assumes an empty table is a test that
    fails the day the feature beside it starts working (MEMORY, 19 Sep). */
const reviewsRecorded = async () => Number((await sql(
  "select count(*)::int as n from messages_sent where hotel_id = $1 and kind = 'review'",
  [hotelId])).rows[0].n);

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      seen = {
        secret: req.headers["x-fidato-secret"] as string | undefined,
        body: JSON.parse(raw || "{}"),
      };
      if (seen.secret !== THE_SECRET) { res.writeHead(401).end("no secret"); return; }
      res.writeHead(200).end("sent");
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;

  ownerStaffId = (await sql(
    "select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;

  await asSession(ownerStaffId, async (q) => {
    hotelId = (await q(
      "select app.provision_property_unchecked($1,'Reviews Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id as string;

    /* Stays written directly: making a booking is the reservations
       service's job and this file is about reviews. */
    const aStay = async (
      name: string, status: string, phone: string | null, email: string | null,
    ) => {
      const guest = (await q(
        "insert into guests (full_name, phone, email) values ($1, $2, $3) returning id::text",
        [`${TAG} ${name}`, phone, email])).rows[0]!.id as string;
      return (await q(
        `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                                   check_in, check_out, agreed_rate, status)
         values ($1, app.next_reference($1), $2,
                 (select id from room_types where hotel_id = $1 limit 1),
                 current_date - 2, current_date - 1, 2000, $3)
         returning id::text`, [hotelId, guest, status])).rows[0]!.id as string;
    };

    departedId = await aStay("Departed Guest", "checked_out", "+919876543210", "departed@example.com");
    inHouseId = await aStay("Still Here", "checked_in", "+919876543211", "here@example.com");
    noAddressId = await aStay("No Address", "checked_out", null, null);

    for (const role of ASSIGNABLE_ROLES) {
      const id = (await q(
        `insert into staff (email, full_name, firebase_uid)
         values ($1, $2, $3)
         on conflict (email) do update set is_active = true
         returning id::text`,
        [`rv-${role}-${process.pid}@fidato.in`, `${TAG} ${role}`,
         `test-uid-rv-${process.pid}-${role}`])).rows[0]!.id as string;
      await q("delete from staff_hotels where staff_id = $1", [id]);
      await q("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
        [id, hotelId, role]);
      staffByRole.set(role, id);
    }
  });
});

beforeEach(() => {
  seen = null;
  /* Nothing is connected unless a test says so. This is the state the
     system is actually in today. */
  delete process.env["CRS_N8N_URL"];
  delete process.env["M2R_N8N_URL"];
  delete process.env["CRS_N8N_SECRET"];
  delete process.env["M2R_N8N_SECRET"];
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await asSession(ownerStaffId, async (q) => {
    for (const id of staffByRole.values()) {
      await q("delete from staff_hotels where staff_id = $1", [id]);
      await q("update staff set is_active = false where id = $1", [id]);
    }
    /* ⚠ THE PROPERTY IS LEFT WHERE IT IS, and that is the fix for a fault
       this file caused (19 September). Removing it needs
       `alter table hotels disable trigger hotels_no_delete`, and ALTER
       TABLE takes an ACCESS EXCLUSIVE lock on `hotels` that every other
       test file's queries queue behind - global, not session-local, and
       not rolled back. Vitest runs the files in parallel, so under the
       FULL suite that window made somebody else's file go red: a POS
       promotion timed out at twenty seconds on one run and a tax-invoice
       refusal came back 200 on the next, each green when run alone, and
       the whole suite green with this file taken out. A teardown that
       breaks other people's tests is not a teardown.

       Nothing needs removing anyway: `scripts/with-test-db.sh` builds a
       scratch database per run and DROPS IT, pass or fail. The property
       carries this run's pid in its code, the guests carry it in their
       names, and none of it can reach anything real. The staff below are
       still switched off, which takes row locks and nothing more. */
  });
  await closePool();
});

/* ══════════════════════════════════════════════════════════════════
   THE LINK NOBODY HAS GIVEN YET
   ══════════════════════════════════════════════════════════════════ */

describe("a property with no review link", () => {
  it("answers null, not an empty string and not an example address", async () => {
    const body = await (await asOwner("/reviews")).json() as { link: string | null };
    expect(body.link).toBeNull();
    /* The distinction the whole rule exists for. */
    expect(body.link).not.toBe("");
  });

  it("refuses to ask a guest, and says exactly why", async () => {
    const res = await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toBe(REVIEWS_REFUSED.noLink);
  });

  it("refuses even with n8n connected - a connected sender is not a link", async () => {
    connected();
    const res = await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(409);
    expect(seen, "nothing reached the receiver").toBeNull();
  });

  it("records nothing - a message that could not carry a link was never attempted", async () => {
    const before = await reviewsRecorded();
    connected();
    await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(await reviewsRecorded()).toBe(before);
  });
});

describe("typing the link in", () => {
  it("refuses anything that is not an https address", async () => {
    for (const bad of ["http://g.page/fidato", "g.page/fidato", "javascript:alert(1)", "https://"]) {
      const res = await asOwner("/reviews/link", "PUT", { url: bad });
      expect(res.status, bad).toBe(400);
    }
    const body = await (await asOwner("/reviews")).json() as { link: string | null };
    expect(body.link, "nothing was stored by a refused attempt").toBeNull();
  });

  it("the database refuses it too, not only the route", async () => {
    await expect(sql(
      "insert into review_links (hotel_id, url) values ($1, 'http://not-secure.example')",
      [hotelId])).rejects.toThrow(/review_links_is_an_https_link/);
  });

  it("stores one a person typed, and says who and when", async () => {
    expect((await asOwner("/reviews/link", "PUT",
      { url: "https://g.page/r/example-review-link/review" })).status).toBe(200);
    const body = await (await asOwner("/reviews")).json() as
      { link: string | null; linkSetAt: string | null; linkSetBy: string | null };
    expect(body.link).toBe("https://g.page/r/example-review-link/review");
    expect(body.linkSetBy).toBe("Group Owner");
    /* Read back through app.hotel_clock, so it is the property's own time
       and not the server's (113). */
    expect(body.linkSetAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("can be cleared back to nothing, and then nothing sends again", async () => {
    expect((await asOwner("/reviews/link", "PUT", { url: "   " })).status).toBe(200);
    const body = await (await asOwner("/reviews")).json() as { link: string | null };
    expect(body.link).toBeNull();

    connected();
    const res = await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(409);
  });
});

/* ══════════════════════════════════════════════════════════════════
   AFTER CHECK-OUT, NEVER BEFORE
   ══════════════════════════════════════════════════════════════════ */

describe("when a guest may be asked", () => {
  beforeEach(async () => {
    await asOwner("/reviews/link", "PUT", { url: "https://g.page/r/example-review-link/review" });
  });

  /* Settings → Messages (D27-261): a hotel may switch review requests off. */
  it("sends nothing while the hotel has review requests switched off", async () => {
    connected();
    await sql(`insert into guest_message_settings (hotel_id, kind, is_on) values ($1, 'review', false)
               on conflict (hotel_id, kind) do update set is_on = false`, [hotelId]);
    try {
      const res = await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
      expect(res.status).toBe(409);
      expect((await res.json() as { reason: string }).reason)
        .toBe("Review requests are switched off for this hotel (Settings, Messages).");
      expect(seen, "nothing reached the receiver").toBeNull();
    } finally {
      await sql("delete from guest_message_settings where hotel_id = $1 and kind = 'review'", [hotelId]);
    }
  });

  it("refuses a stay that is still in the room", async () => {
    connected();
    const res = await asOwner(`/reviews/${inHouseId}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toBe(REVIEWS_REFUSED.notCheckedOut);
    expect(seen, "nothing reached the receiver").toBeNull();
  });

  it("lists the departures and leaves the ones nobody asked unmarked", async () => {
    const body = await (await asOwner("/reviews")).json() as {
      daysBack: number;
      departures: Array<{ id: string; guest: string; askStatus: string | null }>;
    };
    expect(body.daysBack).toBe(30);
    const rows = body.departures;
    expect(rows.some((r) => r.id === inHouseId), "an in-house stay is not a departure").toBe(false);
    const departed = rows.find((r) => r.id === departedId);
    expect(departed?.guest).toContain("Departed Guest");
    /* NOT ASKED IS NULL. It is not "pending", which would read as if
       something were on its way. */
    expect(departed?.askStatus).toBeNull();
  });

  it("refuses a channel the booking has no address for, and records nothing", async () => {
    connected();
    const before = await reviewsRecorded();
    const res = await asOwner(`/reviews/${noAddressId}/ask`, "POST", { channel: "email" });
    expect(res.status).toBe(502);
    expect((await res.json() as { reason: string }).reason).toMatch(/no email address/i);
    /* ⚠ I EXPECTED A ROW HERE AND THERE IS NONE, and the door is right:
       `send()` looks for the address BEFORE it reaches the receiver, and
       nothing that never left the building is an attempt. The same rule as
       the missing link, kept in the shared door rather than in this
       service. Pinned so the day it changes, it changes on purpose. */
    expect(await reviewsRecorded()).toBe(before);
  });

  it("refuses a message that names no way of going", async () => {
    const res = await asOwner(`/reviews/${departedId}/ask`, "POST", {});
    expect(res.status).toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE ONE DOOR OUT
   ══════════════════════════════════════════════════════════════════ */

describe("asking, once the owner has connected n8n", () => {
  beforeEach(async () => {
    await asOwner("/reviews/link", "PUT", { url: "https://g.page/r/example-review-link/review" });
  });

  it("says plainly that nothing sends while it is not connected", async () => {
    const body = await (await asOwner("/reviews")).json() as
      { canSend: boolean; notConnected: string | null };
    expect(body.canSend).toBe(false);
    expect(body.notConnected).toMatch(/not set up yet/i);

    const res = await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(503);
    expect(await reviewsRecorded()).toBe(0);
  });

  it("sends the link and the booking's reference, and nothing else", async () => {
    connected();
    const res = await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(200);

    expect(seen?.body.kind).toBe("review");
    expect(seen?.body.channel).toBe("whatsapp");
    expect(seen?.body.data?.["link"]).toBe("https://g.page/r/example-review-link/review");
    expect(seen?.body.data?.["reference"]).toMatch(/^FH-/);
    /* The wording the guest reads lives in n8n. The PMS sends no sentence. */
    expect(Object.keys(seen?.body.data ?? {}).sort()).toEqual(["link", "reference"]);
  });

  it("records the clerk who pressed it, not \"The system\"", async () => {
    connected();
    const res = await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    const { id } = await res.json() as { id: string };
    const { rows } = await sql(
      "select sent_by::text as sent_by from messages_sent where id = $1::bigint", [id]);
    expect(rows[0]?.sent_by).toBe(ownerStaffId);
  });

  it("is then shown on the screen as asked, with when and which way", async () => {
    connected();
    await asOwner(`/reviews/${departedId}/ask`, "POST", { channel: "email" });
    const body = await (await asOwner("/reviews")).json() as {
      departures: Array<{
        id: string; askStatus: string | null; askChannel: string | null; askedAt: string | null;
      }>;
    };
    const row = body.departures.find((r) => r.id === departedId)!;
    expect(row.askStatus).toBe("sent");
    expect(row.askChannel).toBe("email");
    expect(row.askedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});

/* ══════════════════════════════════════════════════════════════════
   WHO MAY DO WHAT
   ══════════════════════════════════════════════════════════════════ */

describe("who may see and use Reviews", () => {
  it("VIEW_ROLES is the website's Guests grant, exactly", () => {
    /* The server does not import the website's code, so the list in
       reputation.ts is a COPY. A role given the grant in one place and not
       the other fails here rather than failing a person. */
    expect([...VIEW_ROLES].sort()).toEqual(
      ASSIGNABLE_ROLES.filter((r) => grantsFor(r, "customer").includes("view")).sort());
  });

  it("ASK_ROLES is who may add a guest, exactly", () => {
    expect([...ASK_ROLES].sort()).toEqual(
      ASSIGNABLE_ROLES.filter((r) => grantsFor(r, "customer").includes("create")).sort());
  });

  it("only the owner and an administrator may type the link in", () => {
    expect([...LINK_ROLES].sort()).toEqual(["admin", "owner"]);
    expect([...LINK_ROLES].sort()).toEqual(
      ASSIGNABLE_ROLES.filter((r) => grantsFor(r, "hotel").includes("edit")).sort());
  });

  it("refuses the screen to every role that does not hold it", async () => {
    for (const role of ASSIGNABLE_ROLES.filter((r) => !VIEW_ROLES.includes(r))) {
      const res = await call(staffByRole.get(role)!, "/reviews");
      expect(res.status, role).toBe(403);
      expect((await res.json() as { reason: string }).reason).toBe(REVIEWS_REFUSED.view);
    }
  });

  it("lets reception ask and refuses housekeeping, who can see neither", async () => {
    await asOwner("/reviews/link", "PUT", { url: "https://g.page/r/example-review-link/review" });
    connected();

    const refused = await call(staffByRole.get("housekeeping")!,
      `/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(refused.status).toBe(403);
    expect(seen, "a refused role reaches no receiver").toBeNull();

    const allowed = await call(staffByRole.get("front_desk")!,
      `/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(allowed.status).toBe(200);
  });

  it("lets the accountant look and refuses them the send - view is not ask", async () => {
    const finance = staffByRole.get("finance")!;
    expect((await call(finance, "/reviews")).status).toBe(200);

    const body = await (await call(finance, "/reviews")).json() as
      { mayAsk: boolean; maySetLink: boolean };
    expect(body.mayAsk).toBe(false);
    expect(body.maySetLink).toBe(false);

    connected();
    const res = await call(finance, `/reviews/${departedId}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(403);
    expect((await res.json() as { reason: string }).reason).toBe(REVIEWS_REFUSED.ask);
  });

  it("refuses a general manager the link, although they may send", async () => {
    const gm = staffByRole.get("gm")!;
    const res = await call(gm, "/reviews/link", "PUT", { url: "https://example.com/theirs" });
    expect(res.status).toBe(403);
    expect((await res.json() as { reason: string }).reason).toBe(REVIEWS_REFUSED.link);

    const body = await (await call(gm, "/reviews")).json() as
      { mayAsk: boolean; maySetLink: boolean };
    expect(body.mayAsk).toBe(true);
    expect(body.maySetLink).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════
   A GROUP IS ASKED ONCE, AT ITS LEAD GUEST'S ROOM (D22-10)
   And the lead is app.group_lead (D22-52): the room booked first that
   still stands, unless the desk has picked another.
   ══════════════════════════════════════════════════════════════════ */

describe("a group, asked once at its lead guest's room (D22-10, D22-52)", () => {
  let groupId: string;
  let first: string;
  let second: string;
  let cancelled: string;

  beforeAll(async () => {
    await asSession(ownerStaffId, async (q) => {
      groupId = (await q(
        "insert into reservation_groups (name, lead_hotel_id) values ($1, $2) returning id::text",
        [`${TAG} party`, hotelId])).rows[0]!.id as string;
      const guest = (await q(
        `insert into guests (full_name, phone, email)
         values ($1, '+919876543219', 'party@example.com') returning id::text`,
        [`${TAG} Party Guest`])).rows[0]!.id as string;
      const room = async (status: string) => (await q(
        `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                                   check_in, check_out, agreed_rate, status, group_id)
         values ($1, app.next_reference($1), $2,
                 (select id from room_types where hotel_id = $1 limit 1),
                 current_date - 2, current_date - 1, 2000, $3, $4)
         returning id::text`, [hotelId, guest, status, groupId])).rows[0]!.id as string;
      first = await room("checked_out");
      second = await room("checked_out");
      cancelled = await room("cancelled");
    });
  });

  beforeEach(async () => {
    await asOwner("/reviews/link", "PUT", { url: "https://g.page/r/example-review-link/review" });
  });

  it("refuses the group's other rooms by name, and records nothing", async () => {
    connected();
    const before = await reviewsRecorded();
    const res = await asOwner(`/reviews/${second}/ask`, "POST", { channel: "whatsapp" });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toBe(REVIEWS_REFUSED.notLead);
    expect(seen, "nothing reached the receiver").toBeNull();
    expect(await reviewsRecorded()).toBe(before);
  });

  it("asks at the room booked first, and shows every room of the group as asked", async () => {
    connected();
    expect((await asOwner(`/reviews/${first}/ask`, "POST", { channel: "whatsapp" })).status)
      .toBe(200);
    const body = await (await asOwner("/reviews")).json() as {
      departures: Array<{ id: string; reference: string; askStatus: string | null;
                          leadId: string | null; leadReference: string | null }>;
    };
    const lead = body.departures.find((r) => r.id === first)!;
    const other = body.departures.find((r) => r.id === second)!;
    expect(lead.leadId).toBe(first);
    expect(other.leadId).toBe(first);
    expect(other.leadReference).toBe(lead.reference);
    expect(other.askStatus, "the group's ask, not the room's").toBe("sent");
  });

  it("lets the desk make another room the lead, and the ask moves with it", async () => {
    const res = await call(staffByRole.get("front_desk")!,
      `/groups/${groupId}/lead`, "POST", { reservationId: second });
    expect(res.status, await res.clone().text()).toBe(200);
    const group = await (await asOwner(`/groups/${groupId}`)).json() as { leadId: string };
    expect(group.leadId).toBe(second);

    connected();
    expect((await asOwner(`/reviews/${first}/ask`, "POST", { channel: "whatsapp" })).status)
      .toBe(409);
    expect((await asOwner(`/reviews/${second}/ask`, "POST", { channel: "whatsapp" })).status)
      .toBe(200);
  });

  it("refuses a lead outside the group or no longer standing, and changes nothing", async () => {
    for (const reservationId of [departedId, cancelled]) {
      const res = await asOwner(`/groups/${groupId}/lead`, "POST", { reservationId });
      expect(res.status, reservationId).toBe(409);
    }
    const group = await (await asOwner(`/groups/${groupId}`)).json() as { leadId: string };
    expect(group.leadId).toBe(second);
  });

  it("is refused to a role that may not change a booking", async () => {
    const role = ASSIGNABLE_ROLES.find((r) => !grantsFor(r, "reservation").includes("edit"))!;
    const res = await call(staffByRole.get(role)!,
      `/groups/${groupId}/lead`, "POST", { reservationId: first });
    expect(res.status, role).toBe(403);
  });
});
