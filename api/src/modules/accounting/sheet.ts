/* ══════════════════════════════════════════════════════════════════
   THE DAY BOOK'S COLUMNS - ONCE, FOR BOTH FILES (D22-37)

   The owner: "both the CSV and a real .xlsx". The screen writes the CSV
   (src/modules/accounting/data/accounting.ts, through src/lib/csv.ts) and
   the server writes the .xlsx (dayBook.ts, exceljs). Both lay the day book
   out with THIS function, which the website imports as it imports
   api/src/permissions.ts - so the two files cannot have different columns
   or figures, because there is only one list of either.

   No imports: the website bundles this file, so it may not pull in the
   server's database code. Its types are the fields it reads, which the
   server's DayBookRow and the website's copy of it both have.

   RAW NUMBERS, not "Rs 1,234.56". An accountant sums these columns; a
   currency symbol and a thousands comma turn them into text that sums
   to nothing. "GST", not "Tax", since 22 September: alcohol's VAT is its
   own column and is kept out of the GST ones (D21-91).
   ══════════════════════════════════════════════════════════════════ */

interface Figures {
  room: number; roomTax: number; extra: number; extraTax: number;
  pos: number; posTax: number;
  discount: number; alcohol: number; vat: number; sales: number;
  tax: number; receipt: number;
}

/* "Restaurant" and "Restaurant tax": what the outlets took in cash, by card
   or UPI, which was inside Sales and GST and in no column of its own (the
   owner's D24-24, ACC-10). */
const HEADERS = [
  "Date", "Room revenue", "Room tax", "Extra charges", "Extra tax",
  "Restaurant", "Restaurant tax",
  "Discount", "Alcohol", "VAT", "Sales", "GST", "Receipts", "Night audit",
];

/** A day's row, and the total's, written once so the last line of the
    file is made the same way as every line above it. */
const figures = (r: Figures) =>
  [r.room, r.roomTax, r.extra, r.extraTax, r.pos, r.posTax, r.discount,
   r.alcohol, r.vat, r.sales, r.tax, r.receipt];

/**
 * The day book as a sheet: a row per day, then the total.
 *
 * The "Night audit" column is the point of the last one: a day it has
 * not closed still appears with its figures, and says so. A day
 * silently printed as zero is the one an accountant files.
 */
export function dayBookSheet(book: {
  days: readonly (Figures & { date: string; closed: boolean })[];
  total: Figures;
}): { headers: string[]; rows: unknown[][] } {
  const rows: unknown[][] = book.days.map((d) => [
    d.date, ...figures(d), d.closed ? "Closed" : "Not run",
  ]);
  rows.push(["Total", ...figures(book.total), ""]);
  return { headers: HEADERS, rows };
}
