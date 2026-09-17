import type { Client } from "../../db.ts";
import { REPORT_KEYS, type ReportDoc, type ReportKey, type ReportParams } from "./document.ts";
import { propertyById, type Property } from "./figures.ts";
import { monthlyStatistics, monthlyOccupancy, yearlyStatistics } from "./builders/statistics.ts";
import { noShowReport } from "./builders/noShow.ts";
import { cityLedgerReport } from "./builders/cityLedger.ts";
import { managerReport } from "./builders/manager.ts";
import { nightAuditReport } from "./builders/nightAudit.ts";

/* ══════════════════════════════════════════════════════════════════
   buildReport — the one door to every report's figures

   The screens call it through this service's routes; the master's PDF,
   .xlsx and CSV routes call it directly, under the caller's own session
   (contract of 17 September). Asked for a report it does not know, it
   THROWS: an empty document would print as a real report with nothing
   in it, and a report that says nothing happened is a claim.
   ══════════════════════════════════════════════════════════════════ */

type Builder = (client: Client, property: Property, params: ReportParams) => Promise<ReportDoc>;

const month = (p: ReportParams) => p.month ?? p.asOn.slice(0, 7);
const year = (p: ReportParams) => p.year ?? Number(p.asOn.slice(0, 4));

const BUILDERS: Partial<Record<ReportKey, Builder>> = {
  "monthly-statistics": (c, h, p) => monthlyStatistics(c, h, month(p)),
  "monthly-occupancy": (c, h, p) => monthlyOccupancy(c, h, month(p)),
  "yearly-statistics": (c, h, p) => yearlyStatistics(c, h, year(p)),
  "no-show": (c, h, p) => noShowReport(c, h, p.asOn),
  manager: (c, h, p) => managerReport(c, h, p.asOn),
  "night-audit": (c, h, p) => nightAuditReport(c, h, p.asOn),
  /* eZee's own default: the one day, zero-balance accounts left out. */
  "city-ledger": (c, h, p) => cityLedgerReport(c, h, p.from ?? p.asOn, p.asOn, p.ignoreZero ?? true),
};

/** The reports built so far, each with its route (documents.ts). */
export const BUILT_KEYS = Object.keys(BUILDERS) as ReportKey[];

export const isReportKey = (key: string): key is ReportKey =>
  (REPORT_KEYS as readonly string[]).includes(key);

export async function buildReport(
  client: Client, hotelId: string, key: string, params: ReportParams,
): Promise<ReportDoc> {
  if (!isReportKey(key)) throw new Error(`[reports] no report called "${key}".`);
  const builder = BUILDERS[key];
  if (!builder) throw new Error(`[reports] the ${key} report is not built yet.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.asOn)) {
    throw new Error(`[reports] asOn must be YYYY-MM-DD, not "${params.asOn}".`);
  }
  if (params.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)) {
    throw new Error(`[reports] month must be YYYY-MM, not "${params.month}".`);
  }
  const property = await propertyById(client, hotelId);
  if (!property) throw new Error(`[reports] no property ${hotelId}.`);
  return builder(client, property, params);
}
