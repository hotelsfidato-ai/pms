import { withUser, type Client } from "../../db.ts";
import { canSend, messageIdFor, send } from "../../sending.ts";
import { dateReport, renderPdf } from "../../reportRender.ts";
import { buildReport } from "../reports/index.ts";
import { MOST_ATTEMPTS } from "./jobs.ts";

/* ══════════════════════════════════════════════════════════════════
   REPORTS BY EMAIL AFTER THE NIGHT AUDIT (D27-261, Q7)

   After each completed night audit, each report the hotel chose goes as a
   PDF to each person chosen for it - to their own sign-in email, never a
   typed address (Settings → Messages → Reports by email). Once each; three
   tries (app.report_emails_owed, migration "messages and reports").

   BUILT UNDER THAT PERSON'S OWN SESSION: the report holds only what they
   may read, exactly as if they opened it themselves - the same builder and
   the same PDF as the Reports screen's (buildReport, renderPdf).

   Nothing in the night audit's own files changes: this asks for audits
   that have completed, a minute later.
   ══════════════════════════════════════════════════════════════════ */

export const REPORT_TITLES: Record<string, string> = {
  "night-audit": "Night audit",
  manager: "Manager summary",
  "city-ledger": "City ledger",
  "no-show": "No-shows",
  "lodging-tax": "Lodging tax",
  "monthly-occupancy": "Monthly occupancy",
};

interface OwedReport {
  runId: string; hotelId: string; hotelCode: string; hotelName: string; timezone: string; businessDate: string;
  report: string; staffId: string; staffName: string; staffEmail: string;
}

export async function reportsOwed(client: Client, hotelId: string | null = null): Promise<OwedReport[]> {
  const { rows } = await client.query<Record<string, string>>(
    `select run_id::text, hotel_id::text, hotel_code, hotel_name, timezone, business_date, report,
            staff_id::text, staff_name, staff_email
       from app.report_emails_owed($1, $2::uuid)`, [MOST_ATTEMPTS, hotelId]);
  return rows.map((r) => ({
    runId: r["run_id"]!, hotelId: r["hotel_id"]!, hotelCode: r["hotel_code"]!, hotelName: r["hotel_name"]!,
    timezone: r["timezone"]!,
    businessDate: r["business_date"]!, report: r["report"]!, staffId: r["staff_id"]!,
    staffName: r["staff_name"]!, staffEmail: r["staff_email"]!,
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
  for (const o of owed) {
    try {
      const sent = await asPerson(o.staffId, async (client) => {
        const doc = await buildReport(client, o.hotelId, o.report, { asOn: o.businessDate });
        const bytes = await renderPdf(doc, { name: "Fidato PMS, after the night audit", at: new Date(), timezone: o.timezone });
        const title = REPORT_TITLES[o.report] ?? o.report;
        return send(client, {
          id: messageIdFor("report", o.runId, o.report, o.staffId),
          channel: "email",
          kind: "report",
          hotel: { id: o.hotelId, code: o.hotelCode, name: o.hotelName },
          to: { name: o.staffName, email: o.staffEmail },
          data: { reportTitle: title, hotelName: o.hotelName, businessDate: dateReport(o.businessDate) },
          file: { name: `${title.replace(/[^A-Za-z0-9]+/g, "-")}-${o.hotelCode}-${o.businessDate}.pdf`,
            contentType: "application/pdf", bytes },
          about: { kind: "night-audit", id: `${o.runId}/${o.report}/${o.staffId}` },
          sentBy: null,
        });
      });
      if (sent.ok) result.sent += 1;
    } catch (error) {
      console.error("[guest-messaging] could not email report", o.report, o.businessDate,
        error instanceof Error ? error.message : error);
    }
  }
  return result;
}
