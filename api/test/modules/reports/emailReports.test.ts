import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import { runReportEmails } from "../../../src/modules/guest-messaging/reportEmails.ts";
import { fileOf, periodDays } from "../../../src/modules/reports/emails.ts";
import { buildReport } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   EMAIL ANY REPORT, AND REPORTS ON A SCHEDULE (D27-383 item 5)

   A stand-in for the CRS's n8n keeps what it was sent; nothing leaves this
   machine. Each refusal is seen: not allowed to open the report, a bad
   address, a period with a day the night audit has not closed, a paused
   schedule, a file over the limit.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const SECRET = "a-secret-that-exists-only-in-this-test-run";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};

let hotelId: string;
let gmId: string;
let deskId: string;
let revenueId: string;
let server: Server;
type Sent = { kind: string; channel: string; to: Record<string, string | null>; messageId: string;
  data: Record<string, string>; file?: { name: string; contentType: string; base64: string } };
let received: Sent[] = [];
let refuse = false;

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reports = () => received.filter((m) => m.kind === "report");
const bytesOf = (m: Sent) => Buffer.from(m.file?.base64 ?? "", "base64");

async function person(email: string, role: string): Promise<string> {
  const [row] = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text as id`,
    [email, `REM ${email.split("@")[0]}`, `test-uid-${email}`]);
  await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [row!.id, hotelId, role]);
  return row!.id as string;
}

const businessDate = async () =>
  (await sql("select to_char(app.business_date($1), 'YYYY-MM-DD') as d", [hotelId]))[0]!.d as string;
const audit = (day: string) => sql(
  `insert into night_audit_runs (hotel_id, business_date, status, started_at, completed_at)
   values ($1, $2::date, 'completed', now(), now())`, [hotelId, day]);
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("/");

beforeAll(async () => {
  hotelId = (await sql("select id::text as id from hotels where code = '5EL'"))[0]!.id;
  gmId = await person("rem-gm@fidato.in", "gm");
  deskId = await person("rem-desk@fidato.in", "front_desk");
  revenueId = await person("rem-revenue@fidato.in", "revenue_manager");
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.headers["x-fidato-secret"] !== SECRET) { res.writeHead(401).end(); return; }
      received.push(JSON.parse(raw));
      if (refuse) { res.writeHead(500).end("the mailbox is down"); return; }
      res.writeHead(200).end("sent");
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
});

beforeEach(async () => {
  received = [];
  refuse = false;
  process.env["CRS_N8N_URL"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;
  process.env["CRS_N8N_SECRET"] = SECRET;
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
  await sql("delete from daily_report_emails where hotel_id = $1", [hotelId]);
  await sql("delete from report_schedules where hotel_id = $1", [hotelId]);
  await sql("delete from messages_sent where hotel_id = $1 and kind = 'report'", [hotelId]);
  /* Each test's own audits: a schedule must not meet an earlier test's day. */
  await sql("delete from night_audit_runs where hotel_id = $1 and business_date < '2001-01-01'", [hotelId]);
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  for (const k of ["CRS_N8N_URL", "CRS_N8N_SECRET", "WHATSAPP_PHONE_NUMBER_ID"]) delete process.env[k];
  await sql("delete from report_schedules where hotel_id = $1", [hotelId]);
  await sql("delete from messages_sent where hotel_id = $1 and kind = 'report'", [hotelId]);
  await sql("delete from night_audit_runs where hotel_id = $1 and business_date < '2001-01-01'", [hotelId]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [[gmId, deskId, revenueId]]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [[gmId, deskId, revenueId]]);
  await closePool();
});

/* ── 1 · Email this report ─────────────────────────────────────────── */

describe("email this report", () => {
  const email = (who: string, key: string, body: Record<string, unknown>) =>
    call(who, "POST", `/reports/${key}/email`, { fileType: "pdf", ...body });
  const rows = () => sql(
    `select to_email, status, about_kind, about_id, sent_by::text, document_name from messages_sent
      where hotel_id = $1 and kind = 'report' order by to_email`, [hotelId]);

  it("is refused to whoever may not open that report, and to a bad address - nothing sent, nothing written", async () => {
    const res = await email(revenueId, "city-ledger", { to: ["a@example.com"] });
    expect(res.status, "the revenue manager does not read money owed (D27-147)").toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/^Reading money owed and taken is for /);
    expect((await call(revenueId, "GET", "/reports/city-ledger/email")).status, "nor sees the addresses").toBe(403);

    const bad = await email(gmId, "manager", { to: ["owner@example.com", "not an address"] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('"not an address" is not an email address.');
    expect((await email(gmId, "manager", { to: [] })).status, "nobody to send to").toBe(400);
    expect((await email(gmId, "manager", { to: ["a@example.com"], fileType: "doc" })).status).toBe(400);
    expect((await email(gmId, "lodging", { to: ["a@example.com"] })).status, "no such report").toBe(404);

    expect(reports()).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("sends the report as on screen, a PDF to each address with the note, each send written down", async () => {
    await sql(`insert into daily_report_emails (hotel_id, report, is_on, addresses, changed_by)
               values ($1, 'manager', true, '{owner@example.com}', $2)`, [hotelId, gmId]);
    const picked = (await (await call(deskId, "GET", "/reports/manager/email")).json()) as { recipients: string[] };
    expect(picked.recipients, "the hotel's report addresses, to pick from").toEqual(["owner@example.com"]);

    const day = await businessDate();
    const closed = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const res = await email(deskId, "manager", {
      query: { asOn: closed }, to: [" Owner@Example.com", "gm@example.com"], note: "For Monday's meeting.",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ sent: ["owner@example.com", "gm@example.com"], failed: [] });

    expect(reports().map((m) => `${m.channel} ${m.to["email"]}`)).toEqual(["email owner@example.com", "email gm@example.com"]);
    const m = reports()[0]!;
    expect(bytesOf(m).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(m.file?.name).toBe(`5EL-manager-${closed}.pdf`);
    expect(m.data).toMatchObject({ reportTitle: "Manager report", period: `As on ${ddmmyyyy(closed)}`,
      note: "For Monday's meeting.", sentBy: "REM rem-desk" });
    expect(m.data["facts"]).toContain(`As on Date: ${ddmmyyyy(closed)}`);
    expect(m.data["openDay"], "a closed day: final").toBeUndefined();
    expect(m.data["schedule"], "sent by a person, not a schedule").toBeUndefined();

    expect(await rows()).toEqual(["gm@example.com", "owner@example.com"].map((to_email) => ({
      to_email, status: "sent", about_kind: "report", about_id: `manager?asOn=${closed}`, sent_by: deskId,
      document_name: `5EL-manager-${closed}.pdf`,
    })));
  });

  it("says so when the period holds the day still open (decided under D27-396: sent as on screen)", async () => {
    const res = await email(gmId, "manager", { to: ["gm@example.com"], fileType: "xlsx" });
    expect(res.status, await res.clone().text()).toBe(200);
    const m = reports()[0]!;
    expect(m.data["openDay"]).toBe(ddmmyyyy(await businessDate()));
    expect(bytesOf(m).subarray(0, 2).toString("latin1"), "a real .xlsx").toBe("PK");
    expect(m.file?.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("says why when the receiver refuses, and writes the failure down", async () => {
    refuse = true;
    const res = await email(gmId, "no-show", { to: ["gm@example.com"] });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/the mailbox is down/);
    expect((await rows()).map((r) => r.status)).toEqual(["failed"]);
  });

  it("refuses a file over the sending path's limit, never cutting it", async () => {
    const day = await businessDate();
    const doc = await withUser(gmId, (c) => buildReport(c, hotelId, "manager", { asOn: day }));
    const made = await fileOf(doc, "pdf", { name: "x", at: new Date(), timezone: "Asia/Kolkata" }, "5EL", "manager",
      { asOn: day }, 100);
    expect(made).toEqual({ error: expect.stringMatching(/^This report's PDF is .* MB, and an email can carry at most 0\.0 MB\. Nothing was sent/) });
    expect((await fileOf(doc, "pdf", { name: "x", at: new Date(), timezone: "Asia/Kolkata" }, "5EL", "manager",
      { asOn: day })), "under the real limit").toHaveProperty("file");
  });
});

/* ── 2 · Scheduled reports ─────────────────────────────────────────── */

describe("scheduled reports", () => {
  const weekly = { report: "voids", period: "last-week", frequency: "weekly", weekday: 7, fileType: "pdf",
    addresses: ["owner@example.com", "gm@example.com"] };
  const add = (who: string, body: Record<string, unknown>) => call(who, "POST", "/report-schedules", body);
  type List = { schedules: { id: string; title: string; when: string; isPaused: boolean;
    last: { status: string; detail: string; date: string } | null }[];
    reports: { key: string; periods: string[] }[] };
  const list = async () => (await (await call(gmId, "GET", "/report-schedules")).json()) as List;

  it("work the period out from the day the audit closed", () => {
    expect(periodDays("yesterday", "2000-02-06")).toEqual({ from: "2000-02-06", to: "2000-02-06" });
    expect(periodDays("last-week", "2000-02-06"), "a Sunday: its own week").toEqual({ from: "2000-01-31", to: "2000-02-06" });
    expect(periodDays("last-week", "2000-02-09"), "a Wednesday: the week before").toEqual({ from: "2000-01-31", to: "2000-02-06" });
    expect(periodDays("last-month", "2000-03-01")).toEqual({ from: "2000-02-01", to: "2000-02-29" });
    expect(periodDays("month-to-date", "2000-02-09")).toEqual({ from: "2000-02-01", to: "2000-02-09" });
  });

  it("are set by the owner, an Administrator or the GM - refused to reception by the server", async () => {
    expect((await add(deskId, weekly)).status).toBe(403);
    expect((await call(deskId, "GET", "/report-schedules")).status, "nor read").not.toBe(200);
    const res = await add(gmId, weekly);
    expect(res.status, await res.clone().text()).toBe(201);
    const got = await list();
    expect(got.schedules.map((s) => [s.title, s.when, s.isPaused, s.last])).toEqual([["Voids", "every Sunday", false, null]]);
    expect(got.reports.find((r) => r.key === "monthly-statistics")!.periods, "a month's report: last month only")
      .toEqual(["last-month"]);
    expect(got.reports.find((r) => r.key === "yearly-statistics")!.periods, "a year's: never").toEqual([]);
    expect((await call(deskId, "DELETE", `/report-schedules/${got.schedules[0]!.id}`)).status).toBe(403);
  });

  it("refuse a bad address, and a period that holds days the audit has not closed", async () => {
    const refusals: [Record<string, unknown>, string][] = [
      [{ ...weekly, addresses: ["not an address"] }, '"not an address" is not an email address.'],
      [{ ...weekly, addresses: [] }, "Type at least one email address."],
      [{ ...weekly, report: "monthly-statistics", period: "month-to-date" },
        "Monthly statistics covers a whole month, so it can only go for last month."],
      [{ ...weekly, report: "yearly-statistics" },
        "Yearly statistics covers a whole year, which none of the periods is, so it cannot go on a schedule."],
      [{ ...weekly, report: "company-statement" },
        "Statement of account is of one supplier or account, so it cannot go on a schedule. Email it from its screen."],
      [{ ...weekly, weekday: 8 }, "Choose the day of the week."],
      [{ ...weekly, frequency: "monthly", dayOfMonth: 31 }, "Choose a date from 1 to 28, so every month has it."],
    ];
    for (const [body, error] of refusals) {
      const res = await add(gmId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    }
    expect((await list()).schedules).toEqual([]);
  });

  it("go after the night audit of their day, in the daily emails' pass, once, saying the period and the schedule", async () => {
    expect((await add(gmId, weekly)).status).toBe(201);
    await audit("2000-02-07");
    await runReportEmails();
    expect(reports(), "a Monday: not the schedule's day").toEqual([]);

    await audit("2000-02-06");
    await runReportEmails();
    expect(reports().map((m) => m.to["email"]).sort()).toEqual(["gm@example.com", "owner@example.com"]);
    const m = reports()[0]!;
    expect(m.data).toMatchObject({ reportTitle: "Voids", period: "31/01/2000 to 06/02/2000", schedule: "every Sunday" });
    expect(m.data["sentBy"], "nobody pressed a button").toBeUndefined();
    expect(m.file?.name).toBe("5EL-voids-2000-01-31-to-2000-02-06.pdf");
    expect(bytesOf(m).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const [s] = (await list()).schedules;
    expect(s!.last).toMatchObject({ status: "sent", date: "2000-02-06" });

    received = [];
    await runReportEmails();
    expect(reports(), "once per day closed").toEqual([]);
  });

  it("send nothing while paused", async () => {
    const { id } = (await (await add(gmId, weekly)).json()) as { id: string };
    const res = await call(gmId, "PUT", `/report-schedules/${id}`, { ...weekly, isPaused: true });
    expect(res.status, await res.clone().text()).toBe(200);
    await audit("1999-12-26");
    await runReportEmails();
    expect(reports()).toEqual([]);
    expect((await list()).schedules[0]).toMatchObject({ isPaused: true, last: null });

    await call(gmId, "PUT", `/report-schedules/${id}`, { ...weekly, isPaused: false });
    await audit("1999-12-19");
    await runReportEmails();
    expect(reports().length, "on again, after the next audit").toBe(2);
  });

  it("refuse, sending nothing, a period that holds a day the night audit has not closed", async () => {
    /* Past the API's own refusal (a whole month for the month so far), as a
       row: the sweep asks again before it builds anything. */
    const day = await businessDate();
    /* The day closed is the hotel's last: the month it is in is not over (on
       a month's last day, the year is not). */
    const report = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).getUTCDate() === 1
      ? "yearly-statistics" : "monthly-statistics";
    const [{ id }] = await sql(
      `insert into report_schedules (hotel_id, report, period, frequency, file_type, addresses, changed_by, changed_at)
       values ($1, $3, 'month-to-date', 'daily', 'pdf', '{gm@example.com}', $2, now() - interval '1 minute')
       returning id::text as id`, [hotelId, gmId, report]) as [{ id: string }];
    await audit(day);
    try {
      await runReportEmails();
      expect(reports()).toEqual([]);
      const [row] = await sql("select last_status, last_detail, last_date::text from report_schedules where id = $1", [id]);
      expect(row).toMatchObject({ last_status: "refused", last_date: day });
      expect(row!.last_detail).toMatch(/the night audit has not closed .* yet, so the report would not be final\.$/);
      await runReportEmails();
      expect(reports(), "not tried again for that day").toEqual([]);
    } finally {
      await sql("delete from night_audit_runs where hotel_id = $1 and business_date = $2::date", [hotelId, day]);
    }
  });

  it("show a failed send on the schedule and on Connection health, as the daily ones", async () => {
    expect((await add(gmId, { ...weekly, addresses: ["gm@example.com"] })).status).toBe(201);
    refuse = true;
    await audit("2000-02-13");
    await runReportEmails();
    expect((await list()).schedules[0]!.last).toMatchObject({ status: "failed", date: "2000-02-13" });
    const health = (await (await call(gmId, "GET", "/connections-health")).json()) as {
      connections: { key: string; lastError: { detail: string } | null }[] };
    expect(health.connections.find((r) => r.key === "email")!.lastError?.detail).toMatch(/the mailbox is down/);

    refuse = false;
    received = [];
    await runReportEmails();
    expect(reports().length, "tried again").toBe(1);
    expect((await list()).schedules[0]!.last?.status).toBe("sent");
  });

  it("are taken off by the GM", async () => {
    const { id } = (await (await add(gmId, weekly)).json()) as { id: string };
    expect((await call(gmId, "DELETE", `/report-schedules/${id}`)).status).toBe(200);
    expect((await list()).schedules).toEqual([]);
  });
});
