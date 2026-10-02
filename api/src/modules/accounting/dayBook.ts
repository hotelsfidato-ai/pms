import ExcelJS from "exceljs";
import type { Client } from "../../db.ts";
import { dayBookSheet, companyReceiptsSheet } from "./sheet.ts";
import { companyReceipts, type CompanyReceipt } from "../finance/index.ts";
import {
  dailyFigures, sumDays, heading, posSales,
  type DayFigures, type PosDay, type Property,
} from "../reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DAY BOOK — what the accountant is handed

   THE ONE RULE OF THIS SERVICE: the export and the reports can never
   disagree. Every figure below comes from `dailyFigures()` through the
   reports service's front door - the same derivation the Manager
   report, the Dashboard and Monthly statistics add up. There is no
   query over `folio_postings` in this service and there must never be
   one: a second definition of "sales" is how the Dashboard and the
   Manager report came to disagree about occupancy in August, and an
   accountant holding two different sales figures for one month is
   worse off than one holding none.

   NOTHING HERE IS WRITTEN. This service owns no table and posts
   nothing back; it reads, adds up what it read, and hands it over.

   A DATE IS A STRING FROM END TO END. `dailyFigures` returns
   'YYYY-MM-DD' out of Postgres and it stays text through this file,
   the route and the screen. No `new Date()` anywhere in this service:
   the hotel's server runs in GMT (root MEMORY 297) and a JS date would
   move an Akkalkot sale into the previous day on the way past.
   ══════════════════════════════════════════════════════════════════ */

/** Paise, not floating dust. The same one line as the reports service's
    `round2` (api/src/modules/reports/document.ts), which its front door
    does not export - asked of the master, and recorded in MODULE.md. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DayBookRow {
  date: string;
  /** Room revenue, and the tax on it. */
  room: number;
  roomTax: number;
  /** Everything charged that is neither a room nor money: food, the
      restaurant's postings, laundry, the spa, late check-out and the
      rest. ONE LINE IN THIS VERSION - the reports door does not yet
      export the Manager report's split by kind (MODULE.md, Requests). */
  extra: number;
  extraTax: number;
  /** Positive: the discount given away. */
  discount: number;
  /** ⚠ WHAT THE RESTAURANT SOLD, and the tax on it — added 19 September,
      when this export was found to be leaving it out entirely. An order
      charged to a room is already inside `extra`; these two are the ones
      settled AT the outlet in cash, by card or by UPI, which never reach
      a folio and which `dailyFigures` therefore cannot see. Its own
      column because an accountant asking what the restaurant took should
      not have to subtract two other figures to find out. */
  pos: number;
  posTax: number;
  /** ALCOHOL, AND ITS VAT (D21-91, 22 September) - its own ledger, charged
      to a room or settled at the outlet. Taken OUT of `extra`, `extraTax`,
      `pos` and `posTax` above, so those and `tax` are GST and nothing else:
      "kept out of the GST part of the accountant's export, with its own VAT
      ledger". Both halves come from the reports door, which names them. */
  alcohol: number;
  vat: number;
  /** Room + extras + the outlets + alcohol, less the discount. */
  sales: number;
  /** The GST on all of it. VAT is not in it; it is `vat`. */
  tax: number;
  /** Money actually received. A bill moved to the city ledger is not
      money received - the reports door already takes it out (D17-74). */
  receipt: number;
  /** What companies and booking sites paid against the City ledger that
      day (the owner's D27-242, Q4): receipts, APART from sales and from
      `receipt` - the bill was sales when it was sent, and counting the
      payment again would sell it twice. From finance's door. */
  companyReceipt: number;
  /** Whether the night audit has closed this day. A day it has not run
      is exported all the same (D18-16) and SAID SO - never quietly
      treated as zero. */
  closed: boolean;
}

export type DayBookTotal = Omit<DayBookRow, "date" | "closed">;

export interface DayBook {
  property: ReturnType<typeof heading>;
  currency: string;
  /** The property's own business date, so the screen can say how far
      the hotel has actually got. */
  businessDate: string;
  from: string;
  to: string;
  days: DayBookRow[];
  total: DayBookTotal;
  /** Every day of the range the night audit has not closed, in order.
      The screen names them; the file carries the column. */
  openDays: string[];
  /** Each company receipt (D27-242): the line a Tally receipt voucher will
      be made from when the XML export is built (ACC-4, the CA's ledger
      names) - party, bank, amount, reference. */
  companyReceipts: CompanyReceipt[];
}

/** The days the night audit has completed, of those asked for.

    `night_audit_runs` is the night audit's own table and this is the
    only thing this service asks it: whether a day is shut. It is not a
    figure - no money is read here - so it does not break the rule
    above. If that service would rather own the answer, it is a door it
    can open and one line for this file to change (MODULE.md, Requests). */
async function closedDays(
  client: Client, hotelId: string, from: string, to: string,
): Promise<Set<string>> {
  const { rows } = await client.query<{ day: string }>(
    `select to_char(business_date, 'YYYY-MM-DD') as day
       from night_audit_runs
      where hotel_id = $1
        and status = 'completed'
        and business_date between $2::date and $3::date`,
    [hotelId, from, to],
  );
  return new Set(rows.map((r) => r.day));
}

/** Room + extras less the discount, PLUS what the restaurant sold, and
    the tax on all of it. Written once and used for a day and for the
    total, so the total of the days and the total of the range cannot
    part company.

    ⚠ THE RESTAURANT HALF WAS MISSING UNTIL 19 SEPTEMBER, and the export
    understated every day a meal was paid for at the outlet.

    `dailyFigures` sums `folio_postings`, and a POS order only reaches a
    folio when it is charged TO A ROOM. Settled in cash, by card or by
    UPI at the restaurant, it lives in `pos_orders` and never touches
    one. So a walk-in diner paying ₹2,400 cash was on the Manager
    report — which has always printed `Total Revenue = PMS Revenue + POS
    Revenue` — and was NOT in the file handed to the accountant. GST
    filed on an understated figure, and the two documents disagreeing,
    which is the one thing this service exists to prevent.

    Both halves now come through the reports door: `dailyFigures` for the
    hotel, `posSales` for the outlets. Neither is computed here. */
type Outlets = Pick<PosDay, "net" | "tax" | "alcohol" | "vat">;

/** A day's columns, and the total's, from the reports door's figures.
    Alcohol and its VAT are named inside `extra`/`extraTax` and the outlets'
    `net`/`tax` by the reports door; here they are only moved into their own
    two columns, so sales is unchanged and `tax` is GST alone (D21-91). */
const columns = (
  f: Pick<DayFigures, "room" | "extra" | "extraTax" | "alcohol" | "vat" | "discount" | "receipt">
    & { roomTax: number },
  pos: Outlets,
): Omit<DayBookTotal, "companyReceipt"> => ({
  room: f.room,
  roomTax: f.roomTax,
  extra: round2(f.extra - f.alcohol),
  extraTax: round2(f.extraTax - f.vat),
  discount: f.discount,
  /* Its own column, because an accountant asked what the restaurant
     took that day should not have to subtract two other numbers to
     find out. */
  pos: round2(pos.net - pos.alcohol),
  posTax: round2(pos.tax - pos.vat),
  alcohol: round2(f.alcohol + pos.alcohol),
  vat: round2(f.vat + pos.vat),
  sales: round2(f.room + f.extra - f.discount + pos.net),
  tax: round2(f.roomTax + f.extraTax - f.vat + pos.tax - pos.vat),
  receipt: f.receipt,
});

/** Nothing sold at an outlet that day is nil, not a missing row. */
const NO_POS: Outlets = { net: 0, tax: 0, alcohol: 0, vat: 0 };

/* ⚠ A TALLY EXPORT NEVER CARRIES A NULL OR A GUESSED TAX (D27-173, the
   master). A night not charged yet, at a property with no GST rate for
   rooms (a new one has none, D22-9), has an unknown tax in the reports'
   figures. Such a range is refused, in one sentence, before anything is
   built. Only a range reaching the business date or later can meet it. */
export const NO_ROOM_RATE =
  "A night in this range is not charged yet and rooms have no GST rate. Set it under Settings → Taxes and billing, or end the range before today.";
export class NoRoomRate extends Error {
  constructor() {
    super(NO_ROOM_RATE);
    this.name = "NoRoomRate";
  }
}
const priced = (f: DayFigures): f is DayFigures & { roomTax: number } => f.roomTax !== null;

export async function dayBook(
  client: Client, property: Property, from: string, to: string,
): Promise<DayBook> {
  const figures = await dailyFigures(client, property.id, from, to);
  if (!figures.every(priced)) throw new NoRoomRate();
  const closed = await closedDays(client, property.id, from, to);
  const outlets = new Map(
    (await posSales(client, property.id, from, to)).map((p) => [p.date, p]));
  const received = await companyReceipts(client, property.id, from, to);
  const receivedOn = (date: string) =>
    round2(received.filter((r) => r.date === date).reduce((t, r) => t + r.amount, 0));

  const days: DayBookRow[] = figures.map((f) => ({
    date: f.date,
    ...columns(f, outlets.get(f.date) ?? NO_POS),
    companyReceipt: receivedOn(f.date),
    closed: closed.has(f.date),
  }));

  /* The range's own totals, added up by the reports service's `sumDays`
     - not by a second sum of my own. */
  const t = sumDays(figures);
  /* The range's outlet total is the sum of the SAME DAYS' outlet figures,
     not a second query over a slightly different window — so the total of
     the days and the total of the range cannot part company here either. */
  const posTotal = figures.reduce((acc, f) => {
    const p = outlets.get(f.date) ?? NO_POS;
    return {
      net: round2(acc.net + p.net), tax: round2(acc.tax + p.tax),
      alcohol: round2(acc.alcohol + p.alcohol), vat: round2(acc.vat + p.vat),
    };
  }, NO_POS);

  return {
    property: heading(property),
    currency: property.currency,
    businessDate: property.businessDate,
    from,
    to,
    days,
    /* Every day is priced (above), so their total is too. */
    total: {
      ...columns({ ...t, roomTax: t.roomTax! }, posTotal),
      companyReceipt: round2(received.reduce((s, r) => s + r.amount, 0)),
    },
    openDays: days.filter((d) => !d.closed).map((d) => d.date),
    companyReceipts: received,
  };
}

/* ── The day book as a real .xlsx (D22-37: "both the CSV and a real .xlsx") ──
   Laid out by `dayBookSheet` (sheet.ts), the one the screen writes its CSV
   with, so the two files carry the same columns and the same figures. */
export async function dayBookXlsx(book: DayBook): Promise<Buffer> {
  const { headers, rows } = dayBookSheet(book);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Day book");
  sheet.addRow(headers).font = { bold: true };
  sheet.addRows(rows);
  /* Each company receipt on its own sheet (D27-242), for the accountant to
     match against the bank - and what a Tally receipt voucher is made from. */
  if (book.companyReceipts.length) {
    const r = companyReceiptsSheet(book);
    const second = workbook.addWorksheet("Received from companies");
    second.addRow(r.headers).font = { bold: true };
    second.addRows(r.rows);
  }
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}
