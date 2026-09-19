import type { Client } from "../../db.ts";
import {
  dailyFigures, sumDays, heading,
  type DayFigures, type Property,
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
  /** Room + extras, less the discount. */
  sales: number;
  /** The tax on all of it. */
  tax: number;
  /** Money actually received. A bill moved to the city ledger is not
      money received - the reports door already takes it out (D17-74). */
  receipt: number;
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

/** Room + extras less the discount, and the tax on all of it. Written
    once and used for a day and for the total, so the total of the days
    and the total of the range cannot part company. */
const sales = (f: Pick<DayFigures, "room" | "extra" | "discount">) =>
  round2(f.room + f.extra - f.discount);

const taxOf = (f: Pick<DayFigures, "roomTax" | "extraTax">) =>
  round2(f.roomTax + f.extraTax);

export async function dayBook(
  client: Client, property: Property, from: string, to: string,
): Promise<DayBook> {
  const figures = await dailyFigures(client, property.id, from, to);
  const closed = await closedDays(client, property.id, from, to);

  const days: DayBookRow[] = figures.map((f) => ({
    date: f.date,
    room: f.room,
    roomTax: f.roomTax,
    extra: f.extra,
    extraTax: f.extraTax,
    discount: f.discount,
    sales: sales(f),
    tax: taxOf(f),
    receipt: f.receipt,
    closed: closed.has(f.date),
  }));

  /* The range's own totals, added up by the reports service's `sumDays`
     - not by a second sum of my own. */
  const t = sumDays(figures);

  return {
    property: heading(property),
    currency: property.currency,
    businessDate: property.businessDate,
    from,
    to,
    days,
    total: {
      room: t.room,
      roomTax: t.roomTax,
      extra: t.extra,
      extraTax: t.extraTax,
      discount: t.discount,
      sales: sales(t),
      tax: taxOf(t),
      receipt: t.receipt,
    },
    openDays: days.filter((d) => !d.closed).map((d) => d.date),
  };
}
