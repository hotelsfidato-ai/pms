import { api, ApiError, downloadFile } from "@/lib/api";
import { toCsv, downloadCsv, reportFilename } from "@/lib/csv";
import { dayBookSheet } from "../../../../api/src/modules/accounting/sheet.ts";

/* The layout of both files, from the one list the server's .xlsx is made
   with (D22-37). Re-exported so the screen's tests read the same one. */
export { dayBookSheet };

/* ══════════════════════════════════════════════════════════════════
   THE ACCOUNTING EXPORT — the seam

   One call, one object. The screen DRAWS this object and the file is
   WRITTEN from the same object, so what a person checks on the screen
   and what their accountant opens are the same figures by
   construction rather than by two code paths agreeing.

   Every figure in it was read on the server through the reports
   service's own front door (api/src/modules/accounting/dayBook.ts).
   Nothing is computed here but the file's layout.

   These types are a copy of the server's. Change both, or neither -
   the same contract the reports service keeps with its documents.
   ══════════════════════════════════════════════════════════════════ */

/** The three formats the owner chose (D18-16), and the day book as a real
    .xlsx beside its CSV (D22-37). The person exporting picks what their
    accountant asks for. */
export type ExportFormat = "day-book-csv" | "day-book-xlsx" | "tally-prime-xml" | "tally-erp9-xml";

export interface ExportFormatChoice {
  key: ExportFormat;
  label: string;
  /** What it is, in one line, for somebody who does not run Tally. */
  what: string;
}

export const FORMATS: readonly ExportFormatChoice[] = [
  {
    key: "day-book-csv",
    label: "Day book (CSV)",
    what: "One row a day: sales, the tax on them and what was received. Every accounting package opens it.",
  },
  /* D22-37, the owner: "both the CSV and a real .xlsx" - a choice of its
     own, so Export hands over the one file chosen (24 September). */
  {
    key: "day-book-xlsx",
    label: "Day book (Excel)",
    what: "The same columns and figures as the CSV, as an Excel workbook.",
  },
  {
    key: "tally-prime-xml",
    label: "Tally Prime (XML)",
    what: "Sales, receipt, payment and journal vouchers for days the night audit has closed.",
  },
  {
    key: "tally-erp9-xml",
    label: "Tally ERP 9 (XML)",
    what: "The same vouchers in the older Tally's format.",
  },
];

const TALLY: Partial<Record<ExportFormat, string>> = {
  "tally-prime-xml": "tally-prime",
  "tally-erp9-xml": "tally-erp9",
};

/** Why this format cannot be exported, naming WHICH ledgers, or null. The
    server refuses the same way (tally.ts): this says so before the press. */
export function whyNot(format: ExportFormat, ledgers: TallyLedgers | undefined): string | null {
  if (!TALLY[format]) return null;
  if (!ledgers) return "Reading the ledger names.";
  return ledgers.missing.length ? `Type these ledger names first: ${ledgers.missing.join(", ")}.` : null;
}

export interface DayBookRow {
  date: string;
  room: number;
  roomTax: number;
  extra: number;
  /** Food on a bill, and the rest of `extra` (ACC-3). */
  food: number;
  otherExtra: number;
  extraTax: number;
  /** What the outlets took in cash, by card or UPI, and its GST - never a
      bill charged to a room, which is in `extra` (ACC-11). Its own columns
      in both files since D24-24. */
  pos: number;
  posTax: number;
  discount: number;
  /** Alcohol and its VAT - their own ledger (D21-91, 22 September). They
      are NOT in `extra`, `extraTax` or `tax`, which are GST alone. */
  alcohol: number;
  vat: number;
  sales: number;
  /** GST on everything. VAT is `vat`. */
  tax: number;
  receipt: number;
  /** What companies and booking sites paid against the City ledger that
      day (D27-242): receipts, apart from sales and from `receipt`. */
  companyReceipt: number;
  /** Whether the night audit has closed this day. */
  closed: boolean;
}

/** One company receipt (D27-242): what a Tally receipt voucher will be made from. */
export interface CompanyReceiptLine {
  date: string; account: string; method: string; reference: string | null; amount: number;
}

export type DayBookTotal = Omit<DayBookRow, "date" | "closed">;

export interface DayBook {
  property: {
    code: string; name: string; address: string | null;
    gstin: string | null; timezone?: string;
  };
  currency: string;
  businessDate: string;
  from: string;
  to: string;
  days: DayBookRow[];
  total: DayBookTotal;
  openDays: string[];
  /** Optional to the reader: an answer kept on a device from before
      D27-242 has none (MEMORY 360). */
  companyReceipts?: CompanyReceiptLine[];
}

/**
 * The day book for one property over one range, both ends included.
 *
 * Null when the property is not one this person may see; any other
 * failure throws, so the screen says the export did not load rather
 * than offering an empty file as though the hotel had earned nothing.
 */
export async function getDayBook(
  hotelId: string, from: string, to: string,
): Promise<DayBook | null> {
  if (!hotelId) return null;
  const params = new URLSearchParams({ from, to });
  try {
    return await api<DayBook>(`/api/hotels/${hotelId}/accounting/day-book?${params}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/* ── The ledger names in the hotel's Tally (D27-382) ───────────────── */

export interface TallyLedger {
  key: string;
  label: string;
  what: string;
  /** As typed, or null: no name is ever invented here. */
  name: string | null;
}

export interface TallyLedgers {
  ledgers: TallyLedger[];
  /** The labels still blank. */
  missing: string[];
}

export const getTallyLedgers = (hotelId: string): Promise<TallyLedgers> =>
  api<TallyLedgers>(`/api/hotels/${hotelId}/accounting/tally-ledgers`);

export const saveTallyLedgers = (hotelId: string, names: Record<string, string>): Promise<TallyLedgers> =>
  api<TallyLedgers>(`/api/hotels/${hotelId}/accounting/tally-ledgers`,
    { method: "PUT", body: JSON.stringify({ names }) });

/* ── The file ──────────────────────────────────────────────────────── */

/** Hand the day book to the browser as a file somebody can find again. */
export function downloadDayBook(book: DayBook): void {
  const { headers, rows } = dayBookSheet(book);
  downloadCsv(
    reportFilename(book.property.name, "day book", `${book.from} to ${book.to}`),
    toCsv(headers, rows),
  );
}

/** A Tally file, made on the server. Throws the server's sentence if the range
    cannot be made into one: a day not closed, or a day that cannot balance. */
export async function downloadTally(book: DayBook, format: ExportFormat): Promise<void> {
  const range = new URLSearchParams({ from: book.from, to: book.to });
  await downloadFile(`/api/hotels/${book.property.code}/accounting/${TALLY[format]}.xml?${range}`);
}

/** The same day book as a real .xlsx, made on the server (the browser
    carries no spreadsheet library). Throws if it was not made. */
export async function downloadDayBookXlsx(book: DayBook): Promise<void> {
  const range = new URLSearchParams({ from: book.from, to: book.to });
  await downloadFile(`/api/hotels/${book.property.code}/accounting/day-book.xlsx?${range}`);
}
