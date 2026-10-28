import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   A REPORT, AS ONE OBJECT — the web's copy of the contract

   The server builds every report in the eZee layout as one document
   (api/src/modules/reports/document.ts, agreed with the master on
   17 September). The screen draws it with ReportView; the master's
   PDF, .xlsx and CSV routes take the same object on the server. These
   types are a copy of the server's. Change both, or neither.

   Values are raw: money in rupees, percent 0 to 100, dates
   "YYYY-MM-DD". A null is a figure this system does not hold, and
   prints "-", never 0.
   ══════════════════════════════════════════════════════════════════ */

export type CellKind =
  | "text" | "money" | "count" | "ratio" | "percent" | "date" | "datetime";

export type Cell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  kind: CellKind;
  group?: string;
}

export interface ReportRow {
  kind: "row" | "total" | "band";
  indent?: 0 | 1 | 2 | 3;
  unit?: CellKind;
  cells: Record<string, Cell>;
}

export interface ReportSection {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  empty?: string;
  note?: string;
}

export interface ReportFact {
  label: string;
  value: Cell;
  kind: CellKind;
}

export interface ReportChart {
  kind: "bar";
  title: string;
  x: string[];
  unit: CellKind;
  series: Array<{ label: string; values: Array<number | null> }>;
}

export type ReportKey =
  | "night-audit" | "manager" | "city-ledger" | "no-show"
  | "monthly-occupancy" | "monthly-statistics" | "yearly-statistics"
  | "lodging-tax"
  /* The Store and the equipment register (phase 3A, D27-238, D27-240). */
  | "stock-on-hand" | "stock-movements" | "stock-consumption" | "stock-wastage"
  | "stock-count-differences" | "stock-dead" | "stock-cover" | "supplier-spend" | "equipment"
  | "bar-stock"
  | "voids"
  /* The excise registers, as the bar keeps them on paper (D27-361). */
  | "flr-daily" | "flr-monthly"
  /* What we owe suppliers, and what was paid (D27-370). */
  | "supplier-dues"
  /* TDS deducted from suppliers, and one supplier's statement (D27-372). */
  | "tds" | "supplier-statement"
  /* The petty cash book (D27-370). */
  | "petty-cash";

export interface ReportDoc {
  /* ⚠ Kept identical to the server's copy, as the note at the top of both
     files insists. Widened by one word for purchasing (D18-3): a purchase
     order is drawn by the shared renderer rather than a second one, and it
     is NOT in REPORT_KEYS because it is not a report anybody runs. */
  report: ReportKey | "purchase-order";
  title: string;
  property: { code: string; name: string; address: string | null; gstin: string | null; timezone?: string };
  orientation: "portrait" | "landscape";
  facts: ReportFact[];
  sections: ReportSection[];
  chart?: ReportChart;
  footnotes: string[];
}

export interface ReportQuery {
  asOn?: string;
  month?: string;
  year?: number;
  from?: string;
  ignoreZero?: boolean;
  /** Supplier statement: the supplier's id (D27-372). */
  supplier?: string;
}

/**
 * One report for one property. Null when the property is not one this
 * person may see; any other failure throws, so the screen can say the
 * report did not load rather than print an empty one as if nothing
 * happened.
 */
export async function getReport(
  hotelId: string, key: ReportKey, query: ReportQuery = {},
): Promise<ReportDoc | null> {
  if (!hotelId) return null;
  const params = new URLSearchParams();
  if (query.asOn) params.set("asOn", query.asOn);
  if (query.month) params.set("month", query.month);
  if (query.year) params.set("year", String(query.year));
  if (query.from) params.set("from", query.from);
  if (query.ignoreZero !== undefined) params.set("ignoreZero", query.ignoreZero ? "1" : "0");
  if (query.supplier) params.set("supplier", query.supplier);
  const qs = params.toString();
  try {
    return await api<ReportDoc>(
      `/api/hotels/${hotelId}/reports/${key}${qs ? `?${qs}` : ""}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
