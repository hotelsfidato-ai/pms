import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import { READ_RULES, whoMay } from "../../../src/roleGate.ts";
import {
  judge, readBackupStatus, firebaseFact, hotelFacts, type HotelFacts, type ServerFacts,
} from "../../../src/modules/connections-health/health.ts";
import { runOnce } from "../../../src/modules/connections-health/alerts.ts";

/* ══════════════════════════════════════════════════════════════════
   CONNECTION HEALTH (the owner's D27-276, point 3)

   One page: every outside connection green, amber, red or grey, with its
   last success and its last error. When one turns red the owner is told
   by EMAIL ONLY, once, at most once an hour per connection, and never
   while sending emails is itself the red one.

   NOTHING HERE REACHES n8n, Meta or Firebase: `fetch` is stubbed for the
   whole file, the Firebase check is handed in, and the test harness runs
   with no Firebase key at all (scripts/with-test-db.sh).
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};

const NOW = new Date("2026-10-04T10:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const quiet = { lastSent: null, lastFailed: null, recent: [] };
const facts = (over: Partial<HotelFacts> = {}): HotelFacts => ({
  hotelId: "h", code: "5EL", name: "Test Hotel", timezone: "Asia/Kolkata",
  email: quiet, whatsapp: quiet, crs: null, rivals: null, alerted: {}, ...over,
});
const server = (over: Partial<ServerFacts> = {}): ServerFacts => ({
  sending: true,
  firebase: { configured: false, answering: false, lastOk: null, lastError: null },
  backup: { found: false, last: null, lastOk: null, lastFailed: null },
  ...over,
});
const row = (key: string, h = facts(), s = server()) => judge(h, s, NOW).find((r) => r.key === key)!;

/* ── 1 · Each rule ─────────────────────────────────────────────────── */

describe("emails through n8n", () => {
  it("is grey while the sending settings are empty", () => {
    expect(row("email", facts(), server({ sending: false })).status).toBe("grey");
  });
  it("is amber when it is set up and nothing has been sent yet", () => {
    expect(row("email").status).toBe("amber");
  });
  it("is green when the last one was sent, and says when", () => {
    const r = row("email", facts({ email: { lastSent: ago(5), lastFailed: null, recent: ["sent", "failed"] } }));
    expect(r.status).toBe("green");
    expect(r.lastSuccess).toBe(ago(5));
  });
  it("is amber when the last one failed but not the last three", () => {
    const r = row("email", facts({ email: {
      lastSent: ago(60), lastFailed: { at: ago(1), detail: "The receiver refused it (502)." },
      recent: ["failed", "sent", "sent"] } }));
    expect(r.status).toBe("amber");
    expect(r.lastError).toEqual({ at: ago(1), detail: "The receiver refused it (502)." });
  });
  it("is red when the last three all failed", () => {
    expect(row("email", facts({ email: {
      lastSent: null, lastFailed: { at: ago(1), detail: "Could not reach the receiver." },
      recent: ["failed", "failed", "failed"] } })).status).toBe("red");
  });
});

describe("WhatsApp through Meta", () => {
  it("is judged on the WhatsApp messages alone, Meta's own words as the error", () => {
    const meta = { lastSent: null, lastFailed: { at: ago(2), detail: "WhatsApp refused it (HTTP 400): template not approved" },
      recent: ["failed", "failed", "failed"] as ("sent" | "failed")[] };
    expect(row("whatsapp", facts({ whatsapp: meta })).status).toBe("red");
    expect(row("whatsapp", facts({ whatsapp: meta })).lastError?.detail).toContain("template not approved");
    expect(row("email", facts({ whatsapp: meta })).status, "an email row untouched by Meta").toBe("amber");
    expect(row("whatsapp", facts(), server({ sending: false })).status).toBe("grey");
  });
});

describe("the CRS bridge", () => {
  const on = { connectedAt: ago(600), lastRead: ago(3), lastError: null, lastBooking: ago(120) };
  it("is grey while the hotel is not connected", () => {
    expect(row("crs").status).toBe("grey");
  });
  it("is green when the last read worked, the last booking received as its success", () => {
    const r = row("crs", facts({ crs: on }));
    expect(r.status).toBe("green");
    expect(r.lastSuccess).toBe(ago(120));
  });
  it("is red when the last read failed, with what it said", () => {
    const r = row("crs", facts({ crs: { ...on, lastError: "CRS sign-in refused" } }));
    expect(r.status).toBe("red");
    expect(r.lastError).toEqual({ at: ago(3), detail: "CRS sign-in refused" });
  });
  it("is red when nothing has been read for over 30 minutes", () => {
    expect(row("crs", facts({ crs: { ...on, lastRead: ago(31) } })).status).toBe("red");
  });
  it("is amber just after connecting, red if it never reads", () => {
    expect(row("crs", facts({ crs: { ...on, connectedAt: ago(10), lastRead: null } })).status).toBe("amber");
    expect(row("crs", facts({ crs: { ...on, connectedAt: ago(40), lastRead: null } })).status).toBe("red");
  });
});

describe("Firebase sign-in", () => {
  it("is grey where the server has no Firebase key", () => {
    expect(row("firebase").status).toBe("grey");
  });
  it("is green when it answers, red when it does not", () => {
    expect(row("firebase", facts(), server({ firebase: {
      configured: true, answering: true, lastOk: ago(0), lastError: null } })).status).toBe("green");
    const r = row("firebase", facts(), server({ firebase: {
      configured: true, answering: false, lastOk: ago(30), lastError: { at: ago(0), detail: "timed out" } } }));
    expect(r.status).toBe("red");
    expect(r.lastSuccess).toBe(ago(30));
  });
  it("asks Firebase one read-only question, and gives up after the time it is allowed", async () => {
    expect((await firebaseFact(true, async () => undefined)).answering).toBe(true);
    const refused = await firebaseFact(true, async () => { throw new Error("PERMISSION_DENIED"); });
    expect(refused).toMatchObject({ answering: false, lastError: { detail: "PERMISSION_DENIED" } });
    const hung = await firebaseFact(true, () => new Promise(() => {}), 20);
    expect(hung.answering).toBe(false);
    expect(hung.lastError?.detail).toMatch(/did not answer/);
    let asked = false;
    expect((await firebaseFact(false, async () => { asked = true; })).configured).toBe(false);
    expect(asked, "nothing is asked without a key").toBe(false);
  });
});

describe("backups", () => {
  const ok = (at: string, uploaded = "yes") => `backup-status ${at} ok uploaded=${uploaded}`;
  it("reads the status line the nightly check writes, the last one winning", () => {
    const text = [
      "-- taking a fresh backup first -----", ok("2026-10-02T21:30:00Z"),
      "  x 1 check(s) failed", "backup-status 2026-10-03T21:30:00Z failed uploaded=no", "other noise",
    ].join("\n");
    expect(readBackupStatus(text)).toEqual({
      found: true,
      last: { at: "2026-10-03T21:30:00Z", ok: false, uploaded: false },
      lastOk: "2026-10-02T21:30:00Z", lastFailed: "2026-10-03T21:30:00Z",
    });
  });
  it("is grey where there is no backup log at all", () => {
    expect(row("backups").status).toBe("grey");
  });
  it("is amber while the log has no status line yet", () => {
    expect(row("backups", facts(), server({ backup: readBackupStatus("old output only") })).status).toBe("amber");
  });
  it("is green when last night's worked and was copied off the server", () => {
    expect(row("backups", facts(), server({ backup: readBackupStatus(ok(ago(400))) })).status).toBe("green");
  });
  it("is amber when it worked but stayed on this server's disk", () => {
    expect(row("backups", facts(), server({ backup: readBackupStatus(ok(ago(400), "no")) })).status).toBe("amber");
  });
  it("is red when the last one failed, or none has run for over 26 hours", () => {
    expect(row("backups", facts(), server({
      backup: readBackupStatus(`backup-status ${ago(400)} failed uploaded=no`) })).status).toBe("red");
    expect(row("backups", facts(), server({ backup: readBackupStatus(ok(ago(26 * 60 + 1))) })).status).toBe("red");
  });
});

describe("rivals' prices", () => {
  it("is grey while switched off here", () => {
    expect(row("rivals").status).toBe("grey");
  });
  it("is amber until its first check, green when the last check kept prices, amber when it kept none", () => {
    expect(row("rivals", facts({ rivals: { lastRunOn: null, lastKept: null, keptSinceRun: false } })).status).toBe("amber");
    const kept = row("rivals", facts({ rivals: { lastRunOn: "2026-10-01", lastKept: ago(4000), keptSinceRun: true } }));
    expect(kept.status).toBe("green");
    expect(kept.lastSuccess).toBe(ago(4000));
    expect(row("rivals", facts({ rivals: { lastRunOn: "2026-10-01", lastKept: null, keptSinceRun: false } })).status)
      .toBe("amber");
  });
});

/* ── 2 · The database's facts, the page and who may see it ─────────── */

let hotelId: string;
let otherHotelId: string;
let ownerId: string;
let adminId: string;
let gmId: string;
let deskId: string;
let outsiderId: string;

async function person(email: string, hotel: string, role: string): Promise<string> {
  const [r] = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text as id`,
    [email, `CNH ${email.split("@")[0]}`, `test-uid-${email}`]);
  await sql("delete from staff_hotels where staff_id = $1", [r!["id"]]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [r!["id"], hotel, role]);
  return r!["id"] as string;
}

const message = (channel: string, status: string, minutesAgo: number, kind = "booking-confirmation", about: string | null = null) =>
  sql(`insert into messages_sent (hotel_id, channel, kind, status, detail, sent_at, about_kind, about_id)
       values ($1, $2, $3, $4, $5, now() - make_interval(mins => $6), $7, $8)`,
  [hotelId, channel, kind, status, status === "failed" ? "Could not reach the receiver." : "The receiver took it (200).",
   minutesAgo, about ? "connection" : null, about]);

const SENDING = ["CRS_N8N_URL", "CRS_N8N_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "HEALTH_ALERT_EMAIL"];
let posted: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    posted.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  });
  hotelId = (await sql("select id::text from hotels where code = '5EL'"))[0]!["id"];
  otherHotelId = (await sql("select id::text from hotels where code <> '5EL' order by code limit 1"))[0]!["id"];
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'"))[0]!["id"];
  adminId = await person("cnh-admin@fidato.in", hotelId, "admin");
  gmId = await person("cnh-gm@fidato.in", hotelId, "gm");
  deskId = await person("cnh-desk@fidato.in", hotelId, "front_desk");
  outsiderId = await person("cnh-outsider@fidato.in", otherHotelId, "gm");
});

beforeEach(async () => {
  posted = [];
  for (const name of SENDING) delete process.env[name];
  await sql("delete from messages_sent");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const name of SENDING) delete process.env[name];
  await sql("delete from messages_sent");
  const ids = [adminId, gmId, deskId, outsiderId];
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [ids]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [ids]);
  await closePool();
});

describe("what the database says, with nobody signed in", () => {
  it("gives each hotel's last sent, last failed and the last three, per way", async () => {
    await message("email", "sent", 30);
    await message("email", "failed", 20);
    await message("email", "failed", 10);
    await message("whatsapp", "sent", 5);
    const here = (await withUser("", (client) => hotelFacts(client, null))).find((h) => h.code === "5EL")!;
    expect(here.email.recent).toEqual(["failed", "failed", "sent"]);
    expect(here.email.lastFailed?.detail).toBe("Could not reach the receiver.");
    expect(here.email.lastSent).not.toBeNull();
    expect(here.whatsapp.recent).toEqual(["sent"]);
    expect(here.crs).toBeNull();
    expect(here.rivals).toBeNull();
  });
});

const call = (who: string) =>
  app.request("/api/hotels/5EL/connections-health", { headers: { "x-dev-staff-id": who } });

describe("the page's read", () => {
  it("shows every connection, each with its colour", async () => {
    const res = await call(gmId);
    expect(res.status).toBe(200);
    const body = await res.json() as { alertsTo: boolean; connections: Array<{ key: string; status: string }> };
    expect(body.connections.map((c) => c.key)).toEqual(["email", "whatsapp", "crs", "firebase", "backups", "rivals"]);
    expect(body.connections.find((c) => c.key === "email")!.status, "no sending settings in the tests").toBe("grey");
    expect(body.alertsTo).toBe(false);
  });

  it("is the owner's, an administrator's and the GM's", async () => {
    expect(whoMay(READ_RULES["GET /api/hotels/:code/connections-health"]!)).toEqual(["owner", "admin", "gm"]);
    expect((await call(ownerId)).status).toBe(200);
    expect((await call(adminId)).status).toBe(200);
  });

  it("is refused to reception, and is no other hotel's GM's to see", async () => {
    const refused = await call(deskId);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { reason: string }).reason).toMatch(/is for the owner, an administrator or the general manager/);
    expect((await call(outsiderId)).status).toBe(404);
  });
});

/* ── 3 · The email when one turns red ──────────────────────────────── */

describe("the alert, by email only", () => {
  const firebaseRed = async () => server({ firebase: {
    configured: true, answering: false, lastOk: null, lastError: { at: NOW.toISOString(), detail: "timed out" } } });
  const firebaseGreen = async () => server({ firebase: {
    configured: true, answering: true, lastOk: NOW.toISOString(), lastError: null } });

  beforeEach(() => {
    process.env["CRS_N8N_URL"] = "http://127.0.0.1:1/pms-send";
    process.env["CRS_N8N_SECRET"] = "not-used-here-nothing-is-really-sent";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
    process.env["HEALTH_ALERT_EMAIL"] = "owner@example.test";
  });

  it("sends one email on the turn to red, and none while it stays red", async () => {
    const memory = new Set<string>();
    expect((await runOnce({ server: firebaseRed, memory, now: NOW })).sent).toEqual(["firebase"]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      channel: "email", kind: "health-alert", to: { email: "owner@example.test" },
      data: { connection: "Firebase sign-in" },
    });
    expect((await runOnce({ server: firebaseRed, memory, now: NOW })).sent).toEqual([]);
    expect(posted).toHaveLength(1);
    const recorded = await sql("select channel, kind, about_id from messages_sent where kind = 'health-alert'");
    expect(recorded).toEqual([{ channel: "email", kind: "health-alert", about_id: "firebase" }]);
    /* Still red an hour later: it never turned, so nothing more. */
    await sql("update messages_sent set sent_at = now() - interval '2 hours' where kind = 'health-alert'");
    expect((await runOnce({ server: firebaseRed, memory, now: new Date() })).sent).toEqual([]);
  });

  it("does not send again within the hour, even after it recovered and turned red again", async () => {
    const memory = new Set<string>();
    await message("email", "sent", 30, "health-alert", "firebase");
    await runOnce({ server: firebaseGreen, memory, now: new Date() });
    expect((await runOnce({ server: firebaseRed, memory, now: new Date() })).sent).toEqual([]);
    await sql("update messages_sent set sent_at = now() - interval '61 minutes' where kind = 'health-alert'");
    await runOnce({ server: firebaseGreen, memory, now: new Date() });
    expect((await runOnce({ server: firebaseRed, memory, now: new Date() })).sent).toEqual(["firebase"]);
  });

  it("sends nothing while sending emails is itself red, and tells once it is back", async () => {
    const memory = new Set<string>();
    await message("email", "failed", 3);
    await message("email", "failed", 2);
    await message("email", "failed", 1);
    expect((await runOnce({ server: firebaseRed, memory, now: NOW })).sent).toEqual([]);
    expect(posted).toEqual([]);
    await message("email", "sent", 0);
    expect((await runOnce({ server: firebaseRed, memory, now: NOW })).sent).toEqual(["firebase"]);
  });

  it("sends nothing without the owner's address in the server's settings", async () => {
    delete process.env["HEALTH_ALERT_EMAIL"];
    expect((await runOnce({ server: firebaseRed, memory: new Set(), now: NOW })).sent).toEqual([]);
    expect(posted).toEqual([]);
  });
});

/* ── 4 · The email's words, in the n8n workflow the owner imports ───── */

describe("the workflow's draft for a health alert", () => {
  const wf = JSON.parse(readFileSync(fileURLToPath(
    new URL("../../../../deploy/n8n/pms-send-crs.json", import.meta.url)), "utf8")) as {
    nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
  };
  const code = wf.nodes.find((n) => n.name === "Read the message")!.parameters.jsCode!;

  it("writes the email from the PMS's facts, a typed word staying text", () => {
    const body = {
      messageId: "3f2c9a1e-0b7d-4c55-9e21-6a7d8e9f0a1b", action: "send", channel: "email", kind: "health-alert",
      hotel: { code: "5EL", name: "Test Hotel" }, to: { name: null, email: "owner@example.test" },
      data: { connection: "Firebase sign-in", problem: "It did not answer.", hotelName: "",
        at: "04/10/2026, 15:30", lastSuccess: "", lastError: "<b>timed out</b>" },
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function("$input", "$", "$getWorkflowStaticData", code);
    const [out] = run({ first: () => ({ json: { body } }) }, () => ({}), () => ({})) as Array<{ json: Record<string, string> }>;
    expect(out!.json["stop"]).toBe(false);
    expect(out!.json["to"]).toBe("owner@example.test");
    expect(out!.json["subject"]).toContain("Firebase sign-in");
    expect(out!.json["text"]).toContain("It did not answer.");
    expect(out!.json["html"]).toContain("&lt;b&gt;timed out&lt;/b&gt;");
  });
});
