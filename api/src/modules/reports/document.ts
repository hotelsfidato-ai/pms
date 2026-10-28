/* ══════════════════════════════════════════════════════════════════
   A REPORT, AS ONE OBJECT

   Every report this service builds comes back in this shape, so one
   thing draws it on screen and the master's PDF, .xlsx and CSV routes
   (D17-31, D17-32) take it as it is. The contract was agreed with the
   master on 17 September; the shape follows the owner's eZee exports
   (D17-62, D17-70): a property, a title, facts ("As on Date · PTD ·
   YTD · Currency"), then sections, each a band over rows, totals ruled
   off, footnotes at the foot. Branding, the footer and the page numbers
   are the renderer's; nothing here carries a colour.

   RAW VALUES, NEVER FORMATTED TEXT. Money is rupees as a number, a
   percent runs 0 to 100, a date is "YYYY-MM-DD". Whoever draws the
   report formats it, so the screen, the PDF and the spreadsheet cannot
   disagree about rounding. A null is a figure this system does not
   hold: it prints "-", never 0.

   The web keeps a copy of these types in
   src/modules/reports/data/document.ts. Change both, or neither.
   ══════════════════════════════════════════════════════════════════ */

export type CellKind =
  | "text"
  | "money"      // rupees and paise
  | "count"      // a whole number of rooms, nights, people
  | "ratio"      // a plain figure with decimals, e.g. guests per room
  | "percent"    // 29.41 means 29.41%
  | "date"       // YYYY-MM-DD
  | "datetime";  // an ISO timestamp with its offset, printed in the property's time

export type Cell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  kind: CellKind;
  /** Consecutive columns sharing a group print under one spanning
      heading, as Lodging tax's "CGST @2.5%" spans Net Amt. and Tax Amt. */
  group?: string;
}

export interface ReportRow {
  /** "total" is bold with a rule above; "band" is a sub-heading, its
      first cell only. */
  kind: "row" | "total" | "band";
  indent?: 0 | 1 | 2 | 3;
  /** Where one column carries different units row by row, as the
      Manager report's Today column holds money, counts and rates: the
      unit for every column of this row that is not text. */
  unit?: CellKind;
  cells: Record<string, Cell>;
}

export interface ReportSection {
  key: string;
  /** The band printed across the page. */
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** A section with no rows still prints; this says why it is empty. */
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
  | "night-audit"
  | "manager"
  | "city-ledger"
  | "no-show"
  | "monthly-occupancy"
  | "monthly-statistics"
  | "yearly-statistics"
  | "lodging-tax"
  /* The Store and the equipment register (phase 3A, D27-238, D27-240). */
  | "stock-on-hand"
  | "stock-movements"
  | "stock-consumption"
  | "stock-wastage"
  | "stock-count-differences"
  | "stock-dead"
  | "stock-cover"
  | "supplier-spend"
  | "equipment"
  | "bar-stock"
  /* The restaurant's voids: bills, orders closed unpaid, dishes struck (D27-370). */
  | "voids"
  /* The excise registers, as the bar keeps them on paper (D27-361). */
  | "flr-daily"
  | "flr-monthly"
  /* What we owe suppliers, and what was paid (D27-370). */
  | "supplier-dues";

export const REPORT_KEYS: readonly ReportKey[] = [
  "night-audit",
  "manager",
  "city-ledger",
  "no-show",
  "monthly-occupancy",
  "monthly-statistics",
  "yearly-statistics",
  "lodging-tax",
  "stock-on-hand",
  "stock-movements",
  "stock-consumption",
  "stock-wastage",
  "stock-count-differences",
  "stock-dead",
  "stock-cover",
  "supplier-spend",
  "equipment",
  "bar-stock",
  "voids",
  "flr-daily",
  "flr-monthly",
  "supplier-dues",
];

/** The Store and equipment reports (phase 3A): read by D27-240's readers,
    not by the `report` grant (api/src/roleGate.ts STORE_REPORTS). */
export const STORE_REPORT_KEYS: readonly ReportKey[] = [
  "stock-on-hand", "stock-movements", "stock-consumption", "stock-wastage",
  "stock-count-differences", "stock-dead", "stock-cover", "supplier-spend", "equipment",
  /* The bar's day (D27-354), and its excise registers (D27-361). */
  "bar-stock", "flr-daily", "flr-monthly",
];

export interface ReportParams {
  asOn: string;
  /** "YYYY-MM" */
  month?: string;
  year?: number;
  /** City ledger: the window's first day, and whether accounts with
      nothing on them are left out. */
  from?: string;
  ignoreZero?: boolean;
}

export interface ReportDoc {
  /* ⚠ WIDENED BY ONE WORD FOR PURCHASING (D18-3), by that chat — the
     master reviews it at merge. A purchase order is a document in the
     group's layout, and the brief for that service says plainly: the PDF
     is made by the shared renderer, do not write a second one. So the
     order is built as a ReportDoc and drawn by api/src/reportRender.ts.

     It is deliberately NOT in REPORT_KEYS: that list is what the Reports
     screen offers, and a purchase order is not a report anybody runs. */
  report: ReportKey | "purchase-order";
  title: string;
  /** From the database, never a literal (MEMORY 256). */
  /** timezone: where "datetime" cells are printed, e.g. "Asia/Kolkata"; India when absent. */
  property: {
    code: string; name: string; address: string | null; gstin: string | null; timezone?: string;
    /** D27-296: a test hotel's - every renderer prints TEST · NOT VALID. Absent for a real one. */
    test?: boolean;
  };
  orientation: "portrait" | "landscape";
  facts: ReportFact[];
  sections: ReportSection[];
  chart?: ReportChart;
  footnotes: string[];
}

/* ── Small builders, so no report spells a row by hand ────────────── */

export const col = (
  key: string, label: string, kind: CellKind = "money", group?: string,
): ReportColumn => (group ? { key, label, kind, group } : { key, label, kind });

export const row = (
  cells: Record<string, Cell>,
  extra: Omit<ReportRow, "cells" | "kind"> = {},
): ReportRow => ({ kind: "row", ...extra, cells });

export const total = (
  cells: Record<string, Cell>,
  extra: Omit<ReportRow, "cells" | "kind"> = {},
): ReportRow => ({ kind: "total", ...extra, cells });

export const band = (key: string, label: string): ReportRow =>
  ({ kind: "band", cells: { [key]: label } });

/** "2026-08-25" as a report prints it: 25/08/2026 (D17-77). For the
    footnotes, which are sentences rather than cells. */
export const reportDate = (iso: string) => iso.split("-").reverse().join("/");

/** Paise, not floating dust. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** a ÷ b to two places, or 0 when there was nothing to divide by: a
    rate over no rooms is zero, as every export prints it. */
export const ratio = (a: number, b: number) => (b ? round2(a / b) : 0);

export const pct = (a: number, b: number) =>
  b ? Math.round((a / b) * 10000) / 100 : 0;
