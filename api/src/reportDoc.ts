/* ══════════════════════════════════════════════════════════════════
   A REPORT, AS ONE DOCUMENT — the contract between the reports service and
   the shared renderer (17 September; the owner's D17-31, D17-32, D17-62, D17-70)

   The reports service builds one of these per report, on the server, from
   its own figures. The core renders it: a PDF made on the server, a real
   .xlsx, a CSV. One shape, so the screen, the PDF and the spreadsheet can
   never show different numbers for the same report.

   VALUES ARE RAW. The renderer formats them — the builder never sends a
   formatted number:
     money    rupees, a number (Indian grouping and two decimals on paper)
     count    an integer
     percent  0 to 100 (not 0 to 1)
     ratio    a number
     date     "YYYY-MM-DD"
     text     a string
     null     a figure nobody has — printed "-", never a zero (the owner's rule)
   ══════════════════════════════════════════════════════════════════ */

export type ColumnKind = "text" | "money" | "count" | "percent" | "date" | "ratio";

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Consecutive columns sharing a group get one spanning header (Today / PTD / YTD). */
  group?: string;
}

export interface ReportRow {
  /** "total": bold, a rule above. "band": a sub-heading, its first cell only. */
  kind?: "row" | "total" | "band";
  /** 0 to 3. */
  indent?: number;
  cells: Record<string, string | number | null>;
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

export interface ReportDoc {
  report: string;
  title: string;
  property: { code: string; name: string; address: string | null; gstin: string | null };
  orientation: "portrait" | "landscape";
  /** Printed in order, top right under the title: As on Date, PTD, YTD, Currency. */
  facts: Array<{ label: string; value: string }>;
  sections: ReportSection[];
  /** Printed above the footer. */
  footnotes?: string[];
  chart?: { kind: "bar"; x: string[]; series: Array<{ label: string; values: Array<number | null> }> };
}

/** Who printed it and when — the footer, written by the renderer, never the builder. */
export interface PrintedBy {
  name: string;
  at: Date;
  timezone: string;
}
