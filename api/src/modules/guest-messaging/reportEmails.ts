import { withUser, type Client } from "../../db.ts";
import { canSend, messageIdFor, send } from "../../sending.ts";
import { dateReport, formatCell, inr, kindOf, renderPdf } from "../../reportRender.ts";
import {
  buildReport, runScheduledReports, type CellKind, type ReportDoc, type ReportSection,
} from "../reports/index.ts";
import { MOST_ATTEMPTS } from "./jobs.ts";

/* ══════════════════════════════════════════════════════════════════
   DAILY REPORT EMAILS (the owner's D27-280, 5 October)

   After a hotel's night audit closes the day, each report switched on
   goes to each address typed for it (Settings → Messages → Daily report
   emails): its KEY FIGURES in the email, the WHOLE REPORT as a PDF. Once
   per business date, report and address; three tries
   (app.daily_reports_due, migration "corrected daily reports"; until it,
   app.daily_reports_owed, migration "daily report emails").

   ONE EMAIL PER ADDRESS (D27-371, 27 October): everything owed to one
   address for one hotel's business date goes in one email - each report's
   key figures under its title, each report its own PDF attached. The
   subject ('<Hotel> daily reports - <date>') and the words are n8n's.

   NOBODY GETS ANYTHING UNTIL AN ADDRESS IS TYPED. The night audit report
   is on until switched off; the other three are off until switched on.

   NO SECOND CALCULATION. Every report is the Reports screen's own builder
   (buildReport), drawn by the same PDF renderer; the two that the owner
   named by what they hold are put together from those builders' own
   sections. The key figures are read OUT OF THAT SAME DOCUMENT, so the
   email and its PDF cannot disagree.

   Built under the session of the person who saved it while they still
   run the hotel, else of whoever runs it now (the database answers which).

   Replaces D27-261's "reports by email" to the hotel's own people's
   sign-in emails; its table is left in the database, unread.
   ══════════════════════════════════════════════════════════════════ */

export const DAILY_REPORTS = [
  { key: "night-audit", title: "Night audit report", on: true,
    contains: "The day the audit closed: rooms charged, check-outs, sales, receipts, room and guest counts, and the restaurant." },
  { key: "manager", title: "Manager report", on: false,
    contains: "Revenue, payments, the ledgers, occupancy, ADR and RevPAR: the day, the month so far and the year so far." },
  { key: "money-owed", title: "Money owed", on: false,
    contains: "The guest ledger and the city ledger: what guests and companies owe at the end of the day." },
  { key: "restaurant-stock", title: "Restaurant and stock", on: false,
    contains: "The restaurant's day, the closing stock in each store, and the day's wastage and breakage." },
  { key: "bar-stock", title: "Bar stock", on: false,
    contains: "The bar's day: each drink's opening, purchases, sales, count and closing, the dishes sold and the bar bills (D27-354)." },
] as const;

export type DailyReport = (typeof DAILY_REPORTS)[number]["key"];

export const isDailyReport = (key: unknown): key is DailyReport =>
  DAILY_REPORTS.some((r) => r.key === key);

const titleOf = (key: DailyReport) => DAILY_REPORTS.find((r) => r.key === key)!.title;

/* ── The document ──────────────────────────────────────────────── */

const sectionsOf = (doc: ReportDoc, ...keys: string[]) => doc.sections.filter((s) => keys.includes(s.key));
/** The Manager report's ledgers carry only today's figure: PTD and YTD would print dashes. */
const todayOnly = (s: ReportSection): ReportSection =>
  ({ ...s, columns: s.columns.filter((c) => c.key !== "ptd" && c.key !== "ytd") });

export async function dailyReport(
  client: Client, hotelId: string, report: DailyReport, asOn: string,
): Promise<ReportDoc> {
  if (report === "night-audit" || report === "manager" || report === "bar-stock") {
    return buildReport(client, hotelId, report, { asOn });
  }
  const facts: ReportDoc["facts"] = [{ label: "As On Date", value: asOn, kind: "date" }];
  if (report === "money-owed") {
    const manager = await buildReport(client, hotelId, "manager", { asOn });
    const city = await buildReport(client, hotelId, "city-ledger", { asOn });
    return {
      ...city, title: titleOf(report), facts,
      sections: [...sectionsOf(manager, "guest-ledger").map(todayOnly), ...city.sections],
      footnotes: [
        ...manager.footnotes.filter((f) => f.startsWith("Guest Ledger") || f.startsWith("Transfer From Advance Deposit")),
        ...city.footnotes,
      ],
    };
  }
  const audit = await buildReport(client, hotelId, "night-audit", { asOn });
  const stock = await buildReport(client, hotelId, "stock-on-hand", { asOn });
  const wasted = await buildReport(client, hotelId, "stock-wastage", { asOn, from: asOn });
  return {
    ...stock, title: titleOf(report), facts,
    sections: [...sectionsOf(audit, "pos-summary", "pos-payment-summary"), ...stock.sections, ...wasted.sections],
    footnotes: [...new Set([...stock.footnotes, ...wasted.footnotes])],
  };
}

/* ── The key figures, read out of the document ─────────────────── */

export interface Figure { label: string; value: string }

/** One cell as the report prints it, with the rupee sign on money. In
    section `key`, column `column`: the row labelled `label` in the first
    column, else the section's total, else its one row. A section that
    printed no rows printed its own "nothing happened" sentence - a counted
    nothing, so 0. A section or cell the report does not hold: "-". */
export function cell(doc: ReportDoc, key: string, column: string, label?: string): string {
  const section = doc.sections.find((s) => s.key === key);
  const col = section?.columns.find((c) => c.key === column);
  if (!section || !col) return "-";
  const first = section.columns[0]!.key;
  const row = label !== undefined
    ? section.rows.find((r) => r.cells[first] === label)
    : section.rows.findLast((r) => r.kind === "total") ?? section.rows.findLast((r) => r.kind === "row");
  const tz = doc.property.timezone ?? "Asia/Kolkata";
  if (!row) return label === undefined && section.rows.length === 0 ? shown(0, col.kind, tz) : "-";
  return shown(row.cells[column] ?? null, kindOf(col, row), tz);
}

/** The rows a section listed (its total and its bands not counted). */
const counted = (doc: ReportDoc, key: string): string => {
  const section = doc.sections.find((s) => s.key === key);
  return section ? String(section.rows.filter((r) => r.kind === "row").length) : "-";
};

const shown = (value: string | number | null, kind: CellKind, tz: string): string =>
  kind === "money" && typeof value === "number"
    ? `${value < 0 ? "-" : ""}₹${inr(Math.abs(value))}`
    : formatCell(value, kind, tz);

/* The owner's draft (D27-280 asks for "the key figures"): which ones is a
   question in this change's report. Each is a cell of the PDF attached. */
const FIGURES: Record<DailyReport, (doc: ReportDoc) => Figure[]> = {
  "night-audit": (d) => [
    { label: "Rooms occupied", value: `${cell(d, "room-status", "occupied")} of ${cell(d, "room-status", "rooms")}` },
    { label: "Room revenue with tax", value: cell(d, "room-charges", "rent") },
    { label: "Rooms given free", value: counted(d, "complimentary") },
    { label: "Checked out", value: counted(d, "checked-out") },
    { label: "Money taken", value: cell(d, "receipt-by-method", "amount") },
    { label: "Restaurant with tax", value: cell(d, "pos-summary", "total") },
  ],
  manager: (d) => [
    { label: "Occupancy", value: cell(d, "statistics", "today", "Occupancy Rate (%)") },
    { label: "ADR", value: cell(d, "statistics", "today", "Average Daily Rate (ADR)") },
    { label: "RevPAR", value: cell(d, "statistics", "today", "Revenue Per Available Room") },
    { label: "Room revenue without tax", value: cell(d, "room-charges", "today", "Total") },
    { label: "Total revenue without tax", value: cell(d, "revenue-summary", "today", "Total Revenue") },
    { label: "Payments received", value: cell(d, "payment", "today", "Total Payment") },
  ],
  "money-owed": (d) => [
    { label: "Guests owe", value: cell(d, "guest-ledger", "today", "Closing Balance*") },
    { label: "Companies owe", value: cell(d, "accounts", "closing") },
  ],
  "restaurant-stock": (d) => [
    { label: "Restaurant sales with tax", value: cell(d, "pos-summary", "total") },
    { label: "Closing stock value", value: cell(d, "all", "value") },
    { label: "Wastage", value: cell(d, "wastage", "value") },
    { label: "Breakage", value: cell(d, "breakage", "value") },
  ],
  "bar-stock": (d) => [
    { label: "Drinks on the bar's stock", value: counted(d, "bar-stock") },
    { label: "Dishes sold", value: counted(d, "bar-sold") },
    { label: "Sold with nothing set up", value: counted(d, "bar-not-set") },
    { label: "Bar bills", value: cell(d, "bar-bills", "total") },
  ],
};

export const keyFigures = (report: DailyReport, doc: ReportDoc): Figure[] => FIGURES[report](doc);

/* ── The sweep ─────────────────────────────────────────────────── */

interface Owed {
  hotelId: string; hotelCode: string; hotelName: string; timezone: string; businessDate: string;
  report: DailyReport; address: string; builtBy: string;
  /** What it is written down as; for a day run again after a cancel, its own
      key (D27-390). */
  aboutId: string;
  /** The cancel this day was run again after, or null. */
  undoId: string | null;
  /** It replaces an email that went for the day: marked Corrected (D27-390). */
  corrected: boolean;
}

export async function reportsOwed(client: Client, hotelId: string | null = null): Promise<Owed[]> {
  const { rows } = await client.query<Record<string, string | boolean | null>>(
    `select hotel_id::text, hotel_code, hotel_name, timezone, business_date, report, address, built_by::text,
            about_id, undo_id::text, corrected
       from app.daily_reports_due($1, $2::uuid) o
      /* Bar stock switched off (D27-367): its report is not sent. */
      where not (o.report = 'bar-stock' and not app.module_enabled(o.hotel_id, 'bar_stock'))`, [MOST_ATTEMPTS, hotelId]);
  return rows.map((r) => ({
    hotelId: r["hotel_id"] as string, hotelCode: r["hotel_code"] as string, hotelName: r["hotel_name"] as string,
    timezone: r["timezone"] as string, businessDate: r["business_date"] as string,
    report: r["report"] as DailyReport, address: r["address"] as string, builtBy: r["built_by"] as string,
    aboutId: r["about_id"] as string, undoId: r["undo_id"] as string | null, corrected: r["corrected"] === true,
  }));
}

export async function runReportEmails(
  asNobody: <T>(fn: (c: Client) => Promise<T>) => Promise<T> = (fn) => withUser("", fn),
  asPerson: <T>(staffId: string, fn: (c: Client) => Promise<T>) => Promise<T> = (id, fn) => withUser(id, fn),
): Promise<{ due: number; sent: number }> {
  const result = { due: 0, sent: 0 };
  if (!canSend()) return result;
  const owed = await asNobody((c) => reportsOwed(c));
  result.due = owed.length;

  /* Each report built once for all its addresses. A report that cannot be
     built holds back every email it belongs in (the owner's D27-372): nothing
     is written about them, so they all stay owed and go together on a later
     sweep, once every one builds. */
  const built = new Map<string, { title: string; figures: Figure[]; bytes: Uint8Array } | null>();
  const buildKey = (o: Owed) => [o.hotelId, o.businessDate, o.report, o.builtBy, o.corrected].join("/");
  for (const o of owed) {
    if (built.has(buildKey(o))) continue;
    try {
      built.set(buildKey(o), await asPerson(o.builtBy, async (client) => {
        const doc = await dailyReport(client, o.hotelId, o.report, o.businessDate);
        return {
          title: titleOf(o.report),
          figures: keyFigures(o.report, doc),
          bytes: await renderPdf(doc, {
            name: o.corrected ? "Corrected: sent after the night audit was run again" : "Sent after the night audit",
            at: new Date(), timezone: o.timezone,
          }),
        };
      }));
    } catch (error) {
      built.set(buildKey(o), null);
      console.error("[guest-messaging] could not build the daily report", o.report, o.businessDate,
        error instanceof Error ? error.message : error);
    }
  }

  /* ONE EMAIL PER HOTEL, BUSINESS DATE AND ADDRESS (D27-371): every report
     owed to that address that day, in DAILY_REPORTS's order, a PDF each. */
  const emails = new Map<string, Owed[]>();
  for (const o of owed) {
    const key = [o.hotelId, o.businessDate, o.address].join("/");
    emails.set(key, [...(emails.get(key) ?? []), o]);
  }
  const order = (o: Owed) => DAILY_REPORTS.findIndex((r) => r.key === o.report);
  for (const list of emails.values()) {
    if (list.some((o) => !built.get(buildKey(o)))) continue;
    list.sort((a, b) => order(a) - order(b));
    const to = list[0]!;
    const reports = list.map((o) => built.get(buildKey(o))!);
    const sent = await asNobody((client) => send(client, {
      /* Same reports, same id: the workflow drops a retry it has sent. A day
         run again after a cancel is a new email, so its id names the cancel. */
      id: messageIdFor("daily-report", to.hotelId, to.businessDate, to.address, ...list.map((o) => o.report),
        ...(to.undoId ? ["corrected", to.undoId] : [])),
      channel: "email",
      kind: "daily-report",
      hotel: { id: to.hotelId, code: to.hotelCode, name: to.hotelName },
      to: { email: to.address },
      data: {
        /* The titles, for a workflow from before D27-371 (its subject). */
        reportTitle: reports.map((r) => r.title).join(", "), hotelName: to.hotelName,
        businessDate: dateReport(to.businessDate),
        /* D27-390: it replaces the email this day's first audit sent. The
           workflow marks the subject and the top. Absent otherwise. */
        ...(to.corrected ? { corrected: "yes" } : {}),
        /* Each report: its title on a line, then one "Label: value" a line;
           a blank line between reports. The workflow sets each out as a table. */
        keyFigures: reports.map((r) => [r.title, ...r.figures.map((f) => `${f.label}: ${f.value}`)].join("\n"))
          .join("\n\n"),
      },
      files: reports.map((r) => ({
        name: `${r.title.replace(/[^A-Za-z0-9]+/g, "-")}-${to.hotelCode}-${to.businessDate}.pdf`,
        contentType: "application/pdf", bytes: r.bytes,
      })),
      /* Written down per report and address, as before: all sent, or all failed. */
      abouts: list.map((o) => ({ kind: "night-audit", id: o.aboutId })),
      sentBy: null,
    })).catch((error) => {
      console.error("[guest-messaging] could not email the daily reports", to.businessDate, to.address,
        error instanceof Error ? error.message : error);
      return { ok: false };
    });
    if (sent.ok) result.sent += list.length;
  }

  /* Then the reports on a schedule (D27-383 item 5), in the same pass: after
     the night audit of their day, each its own email. Counted on their own. */
  await runScheduledReports(MOST_ATTEMPTS, asNobody, asPerson).catch((error) =>
    console.error("[guest-messaging] the scheduled reports failed", error instanceof Error ? error.message : error));
  return result;
}
