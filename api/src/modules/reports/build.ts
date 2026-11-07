import type { Client } from "../../db.ts";
import { monthEnd } from "../../businessDate.ts";
import { REPORT_KEYS, type ReportDoc, type ReportKey, type ReportParams } from "./document.ts";
import { propertyById, type Property } from "./figures.ts";
import { monthlyStatistics, monthlyOccupancy, yearlyStatistics } from "./builders/statistics.ts";
import { noShowReport } from "./builders/noShow.ts";
import { cityLedgerReport, duesByAge, companyStatement } from "./builders/cityLedger.ts";
import { commissionReport } from "./builders/commission.ts";
import { gstr1Report, inputTaxCreditReport, gstAdvancesReport } from "./builders/gst.ts";
import { managerReport } from "./builders/manager.ts";
import { nightAuditReport } from "./builders/nightAudit.ts";
import { lodgingTaxReport } from "./builders/lodgingTax.ts";
import {
  stockOnHand, stockMovements, stockConsumption, stockWastage, stockCountDifferences,
  stockDead, stockCover, supplierSpend,
} from "./builders/stock.ts";
import { equipmentReport } from "./builders/equipment.ts";
import { barStockReport } from "./builders/barStock.ts";
import { flrDaily, flrMonthly } from "./builders/flr.ts";
import { supplierDuesReport, tdsReport, supplierStatement } from "./builders/supplierDues.ts";
import { voidsReport } from "./builders/voids.ts";
import { pettyCashReport } from "./builders/pettyCash.ts";

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
  /* The bar's day: opened, bought, sold, counted (D27-354). */
  "bar-stock": (c, h, p) => barStockReport(c, h, p.asOn),
  /* The restaurant's voids over a window of days (D27-370). */
  voids: (c, h, p) => voidsReport(c, h, from(p), p.asOn),
  /* FORM F.L.R.-1A/2A/3A for a day, F.L.R.-3 for a month (D27-361). */
  "flr-daily": (c, h, p) => flrDaily(c, h, p.asOn),
  "flr-monthly": (c, h, p) => flrMonthly(c, h, month(p)),
  /* Owed on the date, and paid in the window to it (D27-370). */
  "supplier-dues": (c, h, p) => supplierDuesReport(c, h, from(p), p.asOn),
  /* TDS by section and supplier, and one supplier's ledger (D27-372). */
  tds: (c, h, p) => tdsReport(c, h, from(p), p.asOn),
  "supplier-statement": (c, h, p) => supplierStatement(c, h, p.supplier!, from(p), p.asOn),
  /* The petty cash book (D27-370): the 1st of the month to the date. */
  "petty-cash": (c, h, p) => pettyCashReport(c, h, from(p), p.asOn),
  /* What companies, agents and booking sites owe, by age, and one account's
     statement; commission owed for the stays checked out (D27-383). */
  "dues-by-age": (c, h, p) => duesByAge(c, h, p.asOn),
  "company-statement": (c, h, p) => companyStatement(c, h, p.account!, from(p), p.asOn),
  commission: (c, h, p) => commissionReport(c, h, from(p), p.asOn),
  /* GST, a month at a time (D27-383 item 4). */
  "gstr-1": (c, h, p) => gstr1Report(c, h, month(p)),
  "input-tax-credit": (c, h, p) => inputTaxCreditReport(c, h, month(p)),
  "gst-advances": (c, h, p) => gstAdvancesReport(c, h, month(p)),
};

/* ── What each report is of (D27-383 item 5: emailing one) ──────────
   Its name, the period its question covers, and whether it is of one
   supplier or account the person picks. Read to say the period in the
   email, to know whether the period holds a day the night audit has not
   closed, and to turn a schedule's period into the report's question. A
   key without a line here does not compile. */
export type Span = "day" | "window" | "month" | "year";
export const ABOUT: Readonly<Record<ReportKey, { title: string; span: Span; pick?: true }>> = {
  "night-audit": { title: "Night audit report", span: "day" },
  manager: { title: "Manager report", span: "day" },
  "city-ledger": { title: "City ledger", span: "window" },
  "no-show": { title: "No show", span: "day" },
  "monthly-occupancy": { title: "Monthly occupancy", span: "month" },
  "monthly-statistics": { title: "Monthly statistics", span: "month" },
  "yearly-statistics": { title: "Yearly statistics", span: "year" },
  "lodging-tax": { title: "Lodging tax", span: "month" },
  "stock-on-hand": { title: "Closing stock", span: "day" },
  "stock-movements": { title: "Stock movement by day", span: "window" },
  "stock-consumption": { title: "Consumption", span: "window" },
  "stock-wastage": { title: "Wastage and breakage", span: "window" },
  "stock-count-differences": { title: "Count differences", span: "window" },
  "stock-dead": { title: "Dead stock", span: "day" },
  "stock-cover": { title: "Days of cover", span: "day" },
  "supplier-spend": { title: "Supplier spend", span: "window" },
  equipment: { title: "Equipment report", span: "day" },
  "bar-stock": { title: "Bar stock", span: "day" },
  voids: { title: "Voids", span: "window" },
  "flr-daily": { title: "FORM F.L.R.-1A / 2A / 3A", span: "day" },
  "flr-monthly": { title: "FORM F.L.R.-3", span: "month" },
  "supplier-dues": { title: "Supplier dues", span: "window" },
  tds: { title: "TDS deducted", span: "window" },
  "supplier-statement": { title: "Supplier statement", span: "window", pick: true },
  "petty-cash": { title: "Petty cash", span: "window" },
  "dues-by-age": { title: "Money owed by age", span: "day" },
  "company-statement": { title: "Statement of account", span: "window", pick: true },
  commission: { title: "Commission owed", span: "window" },
  "gstr-1": { title: "GSTR-1", span: "month" },
  "input-tax-credit": { title: "Input tax credit", span: "month" },
  "gst-advances": { title: "GST on advances", span: "month" },
};

/** The first and last day a report's question covers, as its builder above reads it. */
export function periodOf(key: ReportKey, p: ReportParams): { from: string; to: string } {
  const span = ABOUT[key].span;
  if (span === "month") return { from: `${month(p)}-01`, to: monthEnd(`${month(p)}-01`) };
  if (span === "year") return { from: `${year(p)}-01-01`, to: `${year(p)}-12-31` };
  if (span === "window") return { from: key === "city-ledger" ? p.from ?? p.asOn : from(p), to: p.asOn };
  return { from: p.asOn, to: p.asOn };
}

/** The Bar stock switch (D27-367): its three reports are refused where it is off -
    by the screen's route, the file route, and left out of the nightly email. */
const BAR_REPORTS: readonly string[] = ["bar-stock", "flr-daily", "flr-monthly"];
export async function switchedOff(client: Client, hotelId: string, key: string): Promise<boolean> {
  if (!BAR_REPORTS.includes(key)) return false;
  const { rows } = await client.query<{ on: boolean }>("select app.module_enabled($1, 'bar_stock') as on", [hotelId]);
  return !rows[0]!.on;
}

/** What a report needs that it was not given, in a sentence, or null. Asked by
    the screen's route and the file route alike (D27-372: a statement is of one supplier). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const paramsProblem = (key: string, supplier: string | undefined, account?: string): string | null =>
  key === "supplier-statement" && !UUID.test(supplier ?? "") ? "Pick a supplier for the statement."
  : key === "company-statement" && !account?.trim() ? "Pick an account for the statement."
  : null;

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
