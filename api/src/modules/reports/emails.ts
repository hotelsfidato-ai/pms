import { Hono } from "hono";
import { withSession, type Session } from "../../auth.ts";
import { withUser, type Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Role } from "../../permissions.ts";
import { READ_RULES, UNMAPPED, allows, refusalFor } from "../../roleGate.ts";
import { dateReport, formatCell, renderPdf, renderXlsx, type PrintedBy } from "../../reportRender.ts";
import { canSend, messageIdFor, NOT_CONNECTED, send, type SendableFile } from "../../sending.ts";
import { BAR_STOCK_OFF } from "../stores/index.ts";
import { ABOUT, BUILT_KEYS, buildReport, periodOf, switchedOff } from "./build.ts";
import { readQuery } from "./documents.ts";
import type { ReportDoc, ReportKey, ReportParams } from "./document.ts";

/* ══════════════════════════════════════════════════════════════════
   EMAIL A REPORT, AND REPORTS ON A SCHEDULE (the owner's D27-383 item 5,
   built under D27-396)

     GET    /:code/reports/:key/email     the hotel's report addresses to
                                          pick from; whether it can send
     POST   /:code/reports/:key/email     the report as on screen (its
                                          question), a PDF or Excel, to the
                                          addresses, with a short note
     GET    /:code/report-schedules       the hotel's list, and what may be
                                          scheduled with which period
     POST   /:code/report-schedules       add one
     PUT    /:code/report-schedules/:id   change one; pausing is a change
     DELETE /:code/report-schedules/:id   take one off

   WHO EMAILS: whoever may open that report - the role gate's OWN read rule
   for its screen (READ_RULES), asked here, so an email is no way round it.
   WHO SCHEDULES: the owner, an Administrator or the GM, as the daily report
   emails (roleGate room_config; app.manages_hotel in the database).

   ONE DOOR OUT: sending.ts, as every email. One email and one messages_sent
   row per address - who, what, to whom, when, sent or failed - so a failed
   one shows on Connection health as the daily ones do. The words are n8n's
   (kind "report", deploy/n8n/pms-send-crs.json).

   THE SWEEP (runScheduledReports) runs right after the daily report
   emails, in the same pass after each night audit (guest-messaging's
   reportEmails.ts): a day never closed sends nothing.
   ══════════════════════════════════════════════════════════════════ */

export const emails = new Hono<{ Variables: { subject: string } }>();

/** n8n takes 16 MB in one request (N8N_PAYLOAD_SIZE_MAX, deploy/n8n/IMPORT.md)
    and a file goes as base64, a third larger: 9 MB here is 12 MB there, as
    the ID photos' bundle (routes/idPhotos.ts). A larger file is refused with
    the reason, never cut. */
export const MOST_BYTES = 9 * 1024 * 1024;
/** One address: the daily report emails' own test (guest-messaging/settings.ts). */
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const MOST_ADDRESSES = 20;
const MOST_NOTE = 500;

export type FileType = "pdf" | "xlsx";
const TYPES: Record<FileType, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const FILE_WORD: Record<FileType, string> = { pdf: "PDF", xlsx: "Excel file" };

/* ── Small pieces ──────────────────────────────────────────────── */

export function addressesOf(input: unknown): { error: string } | { addresses: string[] } {
  if (!Array.isArray(input) || input.some((a) => typeof a !== "string")) {
    return { error: "Type at least one email address." };
  }
  const list = [...new Set((input as string[]).map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return { error: "Type at least one email address." };
  const bad = list.find((a) => !EMAIL.test(a));
  if (bad) return { error: `"${bad.slice(0, 80)}" is not an email address.` };
  if (list.length > MOST_ADDRESSES) return { error: `At most ${MOST_ADDRESSES} addresses.` };
  return { addresses: list };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

/** The period in the email's words, as the report covers it. */
export function periodWords(key: ReportKey, p: ReportParams): string {
  const { from, to } = periodOf(key, p);
  switch (ABOUT[key].span) {
    case "month": return `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
    case "year": return from.slice(0, 4);
    case "window": return from === to ? dateReport(to) : `${dateReport(from)} to ${dateReport(to)}`;
    default: return `As on ${dateReport(to)}`;
  }
}

/** The report's facts line (its period and what it is of), as the PDF prints it. */
const factsOf = (doc: ReportDoc): string => doc.facts
  .map((f) => `${f.label}: ${formatCell(f.value, f.kind, doc.property.timezone ?? "Asia/Kolkata")}`).join("\n");

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/** The file, or why it cannot go: over the sending path's limit (`most`, a
    test's to lower). */
export async function fileOf(
  doc: ReportDoc, type: FileType, by: PrintedBy, code: string, key: string, p: ReportParams,
  most = MOST_BYTES,
): Promise<{ file: SendableFile } | { error: string }> {
  const bytes = type === "pdf" ? await renderPdf(doc, by) : await renderXlsx(doc, by);
  if (bytes.byteLength > most) {
    return { error: `This report's ${FILE_WORD[type]} is ${mb(bytes.byteLength)} MB, and an email can carry `
      + `at most ${mb(most)} MB. Nothing was sent: choose fewer days, or download it.` };
  }
  const { from, to } = periodOf(key as ReportKey, p);
  return { file: {
    name: `${code}-${key}-${from === to ? to : `${from}-to-${to}`}.${type}`,
    contentType: TYPES[type], bytes: new Uint8Array(bytes),
  } };
}

/** The role at this hotel, as the role gate reads it; null: not rostered here. */
async function roleAt(client: Client, session: Session, hotelId: string): Promise<Role | null> {
  if (session.isGroupAdmin) return "owner";
  const { rows } = await client.query<{ role: Role }>(
    "select role from staff_hotels where staff_id = $1 and hotel_id = $2", [session.staffId, hotelId]);
  return rows[0]?.role ?? null;
}

interface Hotel { id: string; code: string; name: string; timezone: string }
const hotelFor = async (client: Client, code: string): Promise<Hotel | null> =>
  (await client.query<Hotel>("select id::text, code, name, timezone from hotels where code = upper($1)", [code]))
    .rows[0] ?? null;

/** Who may open this report may email it: its screen's own rule. */
async function mayOpen(client: Client, session: Session, hotel: Hotel, key: string): Promise<string | null> {
  const rule = READ_RULES[`GET /api/hotels/:code/reports/${key}`];
  const role = await roleAt(client, session, hotel.id);
  if (!rule) return UNMAPPED;
  return role && allows(rule, role) ? null : refusalFor(rule) || UNMAPPED;
}

/** Every address the hotel's report emails already go to: the daily ones and the schedules. */
async function recipients(client: Client, hotelId: string): Promise<string[]> {
  const { rows } = await client.query<{ a: string }>(
    `select distinct a from (
       select unnest(addresses) as a from daily_report_emails where hotel_id = $1
       union select unnest(addresses) from report_schedules where hotel_id = $1) x order by a`, [hotelId]);
  return rows.map((r) => r.a);
}

const NO_SUCH = { error: "No such property." };
const isBuilt = (key: string): key is ReportKey => (BUILT_KEYS as readonly string[]).includes(key);

/* ── Email this report ─────────────────────────────────────────── */

emails.get("/:code/reports/:key/email", async (c) => {
  const key = c.req.param("key");
  if (!isBuilt(key)) return c.json({ error: "No such report." }, 404);
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await hotelFor(client, c.req.param("code"));
    if (!hotel || !(await roleAt(client, session, hotel.id))) return null;
    const refused = await mayOpen(client, session, hotel, key);
    if (refused) return { refused };
    return { recipients: await recipients(client, hotel.id), notConnected: canSend() ? null : NOT_CONNECTED,
      mostMegabytes: Number(mb(MOST_BYTES)) };
  });
  if (!result) return c.json(NO_SUCH, 404);
  return "refused" in result ? c.json({ error: result.refused }, 403) : c.json(result);
});

emails.post("/:code/reports/:key/email", async (c) => {
  const key = c.req.param("key");
  if (!isBuilt(key)) return c.json({ error: "No such report." }, 404);
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const raw = input["query"] && typeof input["query"] === "object" ? input["query"] as Record<string, unknown> : {};
  const asked = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const query = readQuery(key, asked);
  if ("error" in query) return c.json({ error: query.error }, 400);
  const type = input["fileType"];
  if (type !== "pdf" && type !== "xlsx") return c.json({ error: "Choose PDF or Excel." }, 400);
  const to = addressesOf(input["to"]);
  if ("error" in to) return c.json({ error: to.error }, 400);
  const note = typeof input["note"] === "string" ? input["note"].trim() : "";
  if (note.length > MOST_NOTE) return c.json({ error: `The note can be at most ${MOST_NOTE} letters.` }, 400);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await hotelFor(client, c.req.param("code"));
    if (!hotel || !(await roleAt(client, session, hotel.id))) return { status: 404 as const, error: NO_SUCH.error };
    const refused = await mayOpen(client, session, hotel, key);
    if (refused) return { status: 403 as const, error: refused };
    if (!canSend()) return { status: 503 as const, error: NOT_CONNECTED };
    if (await switchedOff(client, hotel.id, key)) return { status: 403 as const, error: BAR_STOCK_OFF };

    const businessDate = await businessDateFor(client, hotel.id);
    const params: ReportParams = { asOn: query.asOn ?? businessDate, ...query.rest };
    const doc = await buildReport(client, hotel.id, key, params);
    const made = await fileOf(doc, type, { name: session.fullName, at: new Date(), timezone: hotel.timezone },
      hotel.code, key, params);
    if ("error" in made) return { status: 413 as const, error: made.error };

    /* AS ON SCREEN (decided under D27-396): a report screen opens on the
       business date, which the night audit has not closed - "a report opened
       at noon is the day so far" (manual A11.2). It is sent as it is, and the
       email says which day is still open, so nobody reads it as final. */
    const open = periodOf(key, params).to >= businessDate ? dateReport(businessDate) : null;
    const sent: string[] = [];
    const failed: { address: string; reason: string }[] = [];
    for (const address of to.addresses) {
      const answer = await send(client, {
        channel: "email", kind: "report",
        hotel: { id: hotel.id, code: hotel.code, name: hotel.name },
        to: { email: address },
        data: {
          hotelName: hotel.name, reportTitle: doc.title, period: periodWords(key, params), facts: factsOf(doc),
          sentBy: session.fullName,
          ...(note ? { note } : {}),
          ...(open ? { openDay: open } : {}),
        },
        file: made.file,
        /* What went: the report and its question, as the file route reads it. */
        about: { kind: "report", id: `${key}?${new URLSearchParams(asked).toString()}` },
        sentBy: { id: session.staffId, name: session.fullName },
      });
      if (answer.ok) sent.push(address);
      else failed.push({ address, reason: answer.reason });
    }
    return { status: 200 as const, sent, failed };
  });

  if (result.status !== 200) return c.json({ error: result.error }, result.status);
  if (!result.sent.length) {
    return c.json({ error: [...new Set(result.failed.map((f) => f.reason))].join(" "), failed: result.failed }, 502);
  }
  return c.json({ sent: result.sent, failed: result.failed });
});

/* ── Scheduled reports ─────────────────────────────────────────── */

export const PERIODS = ["yesterday", "last-week", "last-month", "month-to-date"] as const;
export type Period = (typeof PERIODS)[number];
const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The periods a report may be scheduled with (decided under D27-396): a
    report of a whole month only for last month, since the others hold days
    not yet closed; none for a whole year or a report of one supplier or
    account the person picks. */
export function periodsFor(key: ReportKey): Period[] {
  const about = ABOUT[key];
  if (about.pick || about.span === "year") return [];
  return about.span === "month" ? ["last-month"] : [...PERIODS];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const plus = (s: string, n: number) => { const d = day(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/** The days a period covers, worked out from the day the night audit closed. */
export function periodDays(period: Period, closed: string): { from: string; to: string } {
  switch (period) {
    case "yesterday": return { from: closed, to: closed };
    case "last-week": {
      const sunday = plus(closed, -(day(closed).getUTCDay() % 7));
      return { from: plus(sunday, -6), to: sunday };
    }
    case "last-month": {
      const last = plus(`${closed.slice(0, 7)}-01`, -1);
      return { from: `${last.slice(0, 7)}-01`, to: last };
    }
    case "month-to-date": return { from: `${closed.slice(0, 7)}-01`, to: closed };
  }
}

/** A schedule's period as the report's question. */
export function paramsFor(key: ReportKey, days: { from: string; to: string }): ReportParams {
  const span = ABOUT[key].span;
  if (span === "month") return { asOn: days.to, month: days.from.slice(0, 7) };
  if (span === "window") return key === "city-ledger"
    ? { asOn: days.to, from: days.from, ignoreZero: true } : { asOn: days.to, from: days.from };
  return { asOn: days.to };
}

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** When it goes, in words: for the list and the email. */
export const whenWords = (frequency: string, weekday: number | null, dayOfMonth: number | null): string =>
  frequency === "weekly" ? `every ${WEEKDAYS[(weekday ?? 1) - 1]}`
    : frequency === "monthly" ? `on the ${ordinal(dayOfMonth ?? 1)} of each month`
      : "every day";

interface ScheduleInput {
  report: ReportKey; period: Period; frequency: (typeof FREQUENCIES)[number];
  weekday: number | null; dayOfMonth: number | null; fileType: FileType; addresses: string[]; isPaused: boolean;
}

export function scheduleOf(input: Record<string, unknown>): { error: string } | { schedule: ScheduleInput } {
  const report = input["report"];
  if (typeof report !== "string" || !isBuilt(report)) return { error: "Choose a report." };
  const periods = periodsFor(report);
  if (!periods.length) {
    return { error: ABOUT[report].pick
      ? `${ABOUT[report].title} is of one supplier or account, so it cannot go on a schedule. Email it from its screen.`
      : `${ABOUT[report].title} covers a whole year, which none of the periods is, so it cannot go on a schedule.` };
  }
  const period = input["period"];
  if (!(PERIODS as readonly unknown[]).includes(period)) return { error: "Choose the period." };
  if (!periods.includes(period as Period)) {
    return { error: `${ABOUT[report].title} covers a whole month, so it can only go for last month.` };
  }
  const frequency = input["frequency"];
  if (!(FREQUENCIES as readonly unknown[]).includes(frequency)) return { error: "Choose how often it goes." };
  const weekday = frequency === "weekly" ? input["weekday"] : null;
  if (frequency === "weekly" && !(Number.isInteger(weekday) && (weekday as number) >= 1 && (weekday as number) <= 7)) {
    return { error: "Choose the day of the week." };
  }
  const dayOfMonth = frequency === "monthly" ? input["dayOfMonth"] : null;
  if (frequency === "monthly"
      && !(Number.isInteger(dayOfMonth) && (dayOfMonth as number) >= 1 && (dayOfMonth as number) <= 28)) {
    return { error: "Choose a date from 1 to 28, so every month has it." };
  }
  const fileType = input["fileType"];
  if (fileType !== "pdf" && fileType !== "xlsx") return { error: "Choose PDF or Excel." };
  const to = addressesOf(input["addresses"]);
  if ("error" in to) return to;
  if (input["isPaused"] !== undefined && typeof input["isPaused"] !== "boolean") {
    return { error: "Say whether it is paused." };
  }
  return { schedule: {
    report, period: period as Period, frequency: frequency as ScheduleInput["frequency"],
    weekday: weekday as number | null, dayOfMonth: dayOfMonth as number | null,
    fileType, addresses: to.addresses, isPaused: input["isPaused"] === true,
  } };
}

/** The owner, an Administrator or the GM, at a hotel they set up; else null. */
async function managed(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string; may: boolean }>(
    "select id::text, app.manages_hotel(id) as may from hotels where code = upper($1)", [code]);
  return rows[0]?.may ? rows[0].id : null;
}
const NOT_YOURS = { error: "No such property, or it is not yours to set up." };

emails.get("/:code/report-schedules", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managed(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<Record<string, unknown>>(
      `select s.id::text, s.report, s.period, s.frequency, s.weekday, s.day_of_month, s.file_type, s.addresses,
              s.is_paused, p.full_name as changed_by, s.changed_at, s.last_date::text, s.last_status, s.last_detail, s.last_at
         from report_schedules s left join staff p on p.id = s.changed_by
        where s.hotel_id = $1 order by s.changed_at`, [hotelId]);
    return {
      schedules: rows.map((r) => ({
        id: r["id"], report: r["report"],
        title: isBuilt(r["report"] as string) ? ABOUT[r["report"] as ReportKey].title : r["report"],
        period: r["period"], frequency: r["frequency"], weekday: r["weekday"], dayOfMonth: r["day_of_month"],
        when: whenWords(r["frequency"] as string, r["weekday"] as number | null, r["day_of_month"] as number | null),
        fileType: r["file_type"], addresses: r["addresses"], isPaused: r["is_paused"],
        changedBy: r["changed_by"], changedAt: r["changed_at"],
        last: r["last_status"]
          ? { date: r["last_date"], status: r["last_status"], detail: r["last_detail"], at: r["last_at"] } : null,
      })),
      /* In the reports' own order (document.ts), not the builders'. */
      reports: (Object.keys(ABOUT) as ReportKey[]).filter(isBuilt)
        .map((key) => ({ key, title: ABOUT[key].title, periods: periodsFor(key) })),
      notConnected: canSend() ? null : NOT_CONNECTED,
    };
  });
  return body ? c.json(body) : c.json(NOT_YOURS, 404);
});

const COLUMNS = "report, period, frequency, weekday, day_of_month, file_type, addresses, is_paused, changed_by";
const values = (s: ScheduleInput, by: string) =>
  [s.report, s.period, s.frequency, s.weekday, s.dayOfMonth, s.fileType, s.addresses, s.isPaused, by];

emails.post("/:code/report-schedules", async (c) => {
  const parsed = scheduleOf(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const id = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await managed(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ id: string }>(
      `insert into report_schedules (hotel_id, ${COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id::text`, [hotelId, ...values(parsed.schedule, session.staffId)]);
    return rows[0]!.id;
  });
  return id ? c.json({ id }, 201) : c.json(NOT_YOURS, 404);
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

emails.put("/:code/report-schedules/:id", async (c) => {
  if (!UUID.test(c.req.param("id"))) return c.json({ error: "No such schedule." }, 404);
  const parsed = scheduleOf(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const done = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await managed(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      `update report_schedules set (${COLUMNS}, changed_at) = ($3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        where hotel_id = $1 and id = $2`, [hotelId, c.req.param("id"), ...values(parsed.schedule, session.staffId)]);
    return rowCount === 1;
  });
  if (done === null) return c.json(NOT_YOURS, 404);
  return done ? c.json({ ok: true }) : c.json({ error: "No such schedule." }, 404);
});

emails.delete("/:code/report-schedules/:id", async (c) => {
  if (!UUID.test(c.req.param("id"))) return c.json({ error: "No such schedule." }, 404);
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managed(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      "delete from report_schedules where hotel_id = $1 and id = $2", [hotelId, c.req.param("id")]);
    return rowCount === 1;
  });
  if (done === null) return c.json(NOT_YOURS, 404);
  return done ? c.json({ ok: true }) : c.json({ error: "No such schedule." }, 404);
});

/* ── The sweep, after the daily report emails ──────────────────── */

interface Due {
  scheduleId: string; hotelId: string; hotelCode: string; hotelName: string; timezone: string;
  businessDate: string; report: string; period: Period; frequency: string; weekday: number | null;
  dayOfMonth: number | null; fileType: FileType; address: string; builtBy: string; aboutId: string;
}

/**
 * Every schedule due after a completed night audit, built once for all its
 * addresses and sent one email per address. Three tries, as the daily ones.
 * Refused - nothing sent, the reason on the schedule's row, not tried again
 * for that day - when the period holds a day the audit has not closed (the
 * email would not be final), the file is over the limit, or the bar's
 * reports are switched off. A report that cannot be built waits, as the
 * daily ones do (D27-372), and is tried on the next pass.
 */
export async function runScheduledReports(
  mostAttempts: number,
  asNobody: <T>(fn: (c: Client) => Promise<T>) => Promise<T> = (fn) => withUser("", fn),
  asPerson: <T>(staffId: string, fn: (c: Client) => Promise<T>) => Promise<T> = (id, fn) => withUser(id, fn),
): Promise<{ due: number; sent: number }> {
  const result = { due: 0, sent: 0 };
  if (!canSend()) return result;
  const { rows } = await asNobody((c) => c.query<Record<string, unknown>>(
    "select * from app.report_schedules_due($1)", [mostAttempts]));
  const due: Due[] = rows.map((r) => ({
    scheduleId: r["schedule_id"] as string, hotelId: r["hotel_id"] as string, hotelCode: r["hotel_code"] as string,
    hotelName: r["hotel_name"] as string, timezone: r["timezone"] as string, businessDate: r["business_date"] as string,
    report: r["report"] as string, period: r["period"] as Period, frequency: r["frequency"] as string,
    weekday: r["weekday"] as number | null, dayOfMonth: r["day_of_month"] as number | null,
    fileType: r["file_type"] as FileType, address: r["address"] as string, builtBy: r["built_by"] as string,
    aboutId: r["about_id"] as string,
  }));
  result.due = due.length;

  const runs = new Map<string, Due[]>();
  for (const d of due) {
    const k = `${d.scheduleId}/${d.businessDate}`;
    runs.set(k, [...(runs.get(k) ?? []), d]);
  }

  for (const list of runs.values()) {
    const s = list[0]!;
    const note = (status: "sent" | "failed" | "refused", detail: string) => asPerson(s.builtBy, (c) => c.query(
      `update report_schedules set last_date = $2::date, last_status = $3, last_detail = $4, last_at = now()
        where id = $1`, [s.scheduleId, s.businessDate, status, detail.slice(0, 500)]));
    if (!isBuilt(s.report)) { await note("refused", "This report is not one the system makes any more."); continue; }
    const key = s.report;
    let made: { doc: ReportDoc; file: SendableFile; params: ReportParams } | { refused: string };
    try {
      made = await asPerson(s.builtBy, async (client) => {
        if (await switchedOff(client, s.hotelId, key)) return { refused: BAR_STOCK_OFF };
        const params = paramsFor(key, periodDays(s.period, s.businessDate));
        const businessDate = await businessDateFor(client, s.hotelId);
        if (periodOf(key, params).to >= businessDate) {
          return { refused: `Not sent: the period runs to ${dateReport(periodOf(key, params).to)}, and the night `
            + `audit has not closed ${dateReport(businessDate)} yet, so the report would not be final.` };
        }
        const doc = await buildReport(client, s.hotelId, key, params);
        const file = await fileOf(doc, s.fileType, { name: "Sent by schedule", at: new Date(), timezone: s.timezone },
          s.hotelCode, key, params);
        return "error" in file ? { refused: file.error } : { doc, file: file.file, params };
      });
    } catch (error) {
      console.error("[reports] could not build the scheduled report", key, s.businessDate,
        error instanceof Error ? error.message : error);
      continue;
    }
    if ("refused" in made) { await note("refused", made.refused); continue; }

    const { doc, file, params } = made;
    const failures: string[] = [];
    for (const d of list) {
      const answer = await asNobody((client) => send(client, {
        id: messageIdFor("report-schedule", d.scheduleId, d.businessDate, d.address),
        channel: "email", kind: "report",
        hotel: { id: d.hotelId, code: d.hotelCode, name: d.hotelName },
        to: { email: d.address },
        data: {
          hotelName: d.hotelName, reportTitle: doc.title, period: periodWords(key, params), facts: factsOf(doc),
          schedule: whenWords(d.frequency, d.weekday, d.dayOfMonth),
        },
        file,
        about: { kind: "report-schedule", id: d.aboutId },
        sentBy: null,
      })).catch((error: unknown) => ({ ok: false as const, reason: error instanceof Error ? error.message : String(error) }));
      if (answer.ok) result.sent += 1;
      else failures.push(`${d.address}: ${answer.reason}`);
    }
    await note(failures.length ? "failed" : "sent", failures.length
      ? `Not sent to ${failures.join(" ")}`.trim()
      : `Sent to ${list.map((d) => d.address).join(", ")} (${periodWords(key, params)}).`);
  }
  return result;
}
