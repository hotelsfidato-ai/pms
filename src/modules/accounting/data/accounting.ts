import { api, ApiError, downloadFile } from "@/lib/api";
import { toCsv, downloadCsv, reportFilename } from "@/lib/csv";

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

/** The three formats the owner chose (D18-16). The person exporting
    picks what their accountant asks for. */
export type ExportFormat = "day-book-csv" | "tally-prime-xml" | "tally-erp9-xml";

export interface ExportFormatChoice {
  key: ExportFormat;
  label: string;
  /** What it is, in one line, for somebody who does not run Tally. */
  what: string;
  /** Null when it can be exported today; otherwise the reason it
      cannot, in the owner's own terms. Never a disabled control with
      no explanation beside it. */
  blocked: string | null;
}

export const FORMATS: readonly ExportFormatChoice[] = [
  {
    key: "day-book-csv",
    label: "Day book (CSV and Excel)",
    what: "One row a day: sales, the tax on them and what was received. Every accounting package opens it.",
    blocked: null,
  },
  /* Offered, and honest about why they produce nothing yet. A Tally
     voucher has to name the ledger it posts to, and the ledger names
     in the hotel's own books are the owner's to give (MODULE.md). A
     name invented here would be CREATED inside their Tally on import,
     and somebody would spend an evening merging ledgers this screen
     made up. The owner's answer, 19 September: ship the day book, wait
     for the names. */
  {
    key: "tally-prime-xml",
    label: "Tally Prime (XML)",
    what: "Sales and receipt vouchers, imported straight into Tally Prime.",
    blocked: "Waiting on the ledger names in your books. Tell us what your Tally calls room rent, food, CGST, SGST and cash - and alcohol sales and VAT, if you serve alcohol - and this is switched on.",
  },
  {
    key: "tally-erp9-xml",
    label: "Tally ERP 9 (XML)",
    what: "The same vouchers in the older Tally's format.",
    blocked: "Waiting on the ledger names in your books, as above.",
  },
];

export interface DayBookRow {
  date: string;
  room: number;
  roomTax: number;
  extra: number;
  extraTax: number;
  discount: number;
  /** Alcohol and its VAT - their own ledger (D21-91, 22 September). They
      are NOT in `extra`, `extraTax` or `tax`, which are GST alone. */
  alcohol: number;
  vat: number;
  sales: number;
  /** GST on everything. VAT is `vat`. */
  tax: number;
  receipt: number;
  /** Whether the night audit has closed this day. */
  closed: boolean;
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

/* ── The file ──────────────────────────────────────────────────────── */

/* "GST", not "Tax", since 22 September: alcohol's VAT is its own column and
   is kept out of the GST ones (D21-91). The .xlsx is written on the server
   from a copy of this row and `figures` (api/src/modules/accounting/
   dayBook.ts): change both, or neither - its test reads this line. */
const HEADERS = [
  "Date", "Room revenue", "Room tax", "Extra charges", "Extra tax",
  "Discount", "Alcohol", "VAT", "Sales", "GST", "Receipts", "Night audit",
];

/** A day's row, and the total's, written once so the last line of the
    file is made the same way as every line above it. */
const figures = (r: DayBookRow | DayBookTotal) =>
  [r.room, r.roomTax, r.extra, r.extraTax, r.discount, r.alcohol, r.vat,
   r.sales, r.tax, r.receipt];

/**
 * The day book as a sheet: a row per day, then the total.
 *
 * RAW NUMBERS, not "Rs 1,234.56". An accountant sums this column; a
 * currency symbol and a thousands comma turn it into text that sums
 * to nothing. The quoting, the BOM, the CRLF endings and the leading
 * `=` that a spreadsheet would execute are all `src/lib/csv.ts`'s
 * business and are not repeated here.
 *
 * The "Night audit" column is the point of the last one: a day it has
 * not closed still appears with its figures, and says so. A day
 * silently printed as zero is the one an accountant files.
 */
export function dayBookSheet(book: DayBook): { headers: string[]; rows: unknown[][] } {
  const rows: unknown[][] = book.days.map((d) => [
    d.date, ...figures(d), d.closed ? "Closed" : "Not run",
  ]);
  rows.push(["Total", ...figures(book.total), ""]);
  return { headers: HEADERS, rows };
}

/** Hand the day book to the browser as files somebody can find again: the
    CSV, as before, and a real .xlsx of the same columns and figures, made on
    the server (D22-37: "both"). Throws if the .xlsx was not made. */
export async function downloadDayBook(book: DayBook): Promise<void> {
  const { headers, rows } = dayBookSheet(book);
  downloadCsv(
    reportFilename(book.property.name, "day book", `${book.from} to ${book.to}`),
    toCsv(headers, rows),
  );
  const range = new URLSearchParams({ from: book.from, to: book.to });
  await downloadFile(`/api/hotels/${book.property.code}/accounting/day-book.xlsx?${range}`);
}
