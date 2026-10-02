import type { Client } from "../../db.ts";
import { REPORT_KEYS, type ReportDoc, type ReportKey, type ReportParams } from "./document.ts";
import { propertyById, type Property } from "./figures.ts";
import { monthlyStatistics, monthlyOccupancy, yearlyStatistics } from "./builders/statistics.ts";
import { noShowReport } from "./builders/noShow.ts";
import { cityLedgerReport } from "./builders/cityLedger.ts";
import { managerReport } from "./builders/manager.ts";
import { nightAuditReport } from "./builders/nightAudit.ts";
import { lodgingTaxReport } from "./builders/lodgingTax.ts";
import {
  stockOnHand, stockMovements, stockConsumption, stockWastage, stockCountDifferences,
  stockDead, stockCover, supplierSpend,
} from "./builders/stock.ts";
import { equipmentReport } from "./builders/equipment.ts";

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
/** A window's first day: the one asked for, or the 1st of the as-on month. */
const from = (p: ReportParams) => p.from ?? `${p.asOn.slice(0, 7)}-01`;

const BUILDERS: Partial<Record<ReportKey, Builder>> = {
  "monthly-statistics": (c, h, p) => monthlyStatistics(c, h, month(p)),
  "monthly-occupancy": (c, h, p) => monthlyOccupancy(c, h, month(p)),
  "yearly-statistics": (c, h, p) => yearlyStatistics(c, h, year(p)),
  "no-show": (c, h, p) => noShowReport(c, h, p.asOn),
  manager: (c, h, p) => managerReport(c, h, p.asOn),
  "night-audit": (c, h, p) => nightAuditReport(c, h, p.asOn),
  "lodging-tax": (c, h, p) => lodgingTaxReport(c, h, month(p)),
  /* eZee's own default: the one day, zero-balance accounts left out. */
  "city-ledger": (c, h, p) => cityLedgerReport(c, h, p.from ?? p.asOn, p.asOn, p.ignoreZero ?? true),
  /* The Store and equipment (phase 3A): a date, or a window ending on it. */
  "stock-on-hand": (c, h, p) => stockOnHand(c, h, p.asOn),
  "stock-movements": (c, h, p) => stockMovements(c, h, from(p), p.asOn),
  "stock-consumption": (c, h, p) => stockConsumption(c, h, from(p), p.asOn),
  "stock-wastage": (c, h, p) => stockWastage(c, h, from(p), p.asOn),
  "stock-count-differences": (c, h, p) => stockCountDifferences(c, h, from(p), p.asOn),
  "stock-dead": (c, h, p) => stockDead(c, h, p.asOn),
  "stock-cover": (c, h, p) => stockCover(c, h, p.asOn),
  "supplier-spend": (c, h, p) => supplierSpend(c, h, from(p), p.asOn),
  equipment: (c, h, p) => equipmentReport(c, h, p.asOn),
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
