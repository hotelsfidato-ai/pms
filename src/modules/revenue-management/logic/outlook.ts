/* ══════════════════════════════════════════════════════════════════
   WHAT THE COMING NIGHTS LOOK LIKE - the words, and nothing else

   THE ONE RULE OF THIS SERVICE (D18-15, the owner's own words):
   it shows and it suggests, and it NEVER changes a price by itself.
   Nothing in this file, or anywhere in this folder, writes a rate, a
   restriction or a message to the channel manager. The GM or the owner
   makes the change on the Rates screen, as today.
   `neverWritesARate.test.ts` beside this folder refuses any file here
   that could.

   EVERY FIGURE COMES FROM THE REPORTS SERVICE. `available`, `sold` and
   `occupancyPct` are `dailyFigures()` in
   `api/src/modules/reports/figures.ts`, read through that service's
   front door - the definitions the Manager report, Monthly statistics
   and the Dashboard all add up. Occupancy is NOT worked out again here:
   the Dashboard and the Manager report disagreed for a month in August
   because two places each had their own.

   This file turns those figures into SENTENCES. It holds no query, no
   fetch and no number of its own beyond the thresholds below.
   ══════════════════════════════════════════════════════════════════ */

import { dateLong } from "@/lib/format";
import type { PeriodStatistics } from "@/data/repositories/types";

/** One night ahead, exactly as the reports service counts it. */
export interface OutlookDay {
  date: string;
  /** app.sellable_rooms(): the rooms minus the blocks on the date. */
  available: number;
  /** Paying + complimentary room-nights, as the group's eZee reports count. */
  sold: number;
  occupancyPct: number;
}

/** A night with the two things a person asks next about it. */
export interface DateAhead extends OutlookDay {
  /** Rooms still sellable that night. Never below nil. */
  left: number;
  /** Nights from the property's business date. 0 is tonight. */
  daysOut: number;
}

/**
 * ⚠ AWAITING THE OWNER (question RM-Q3, asked 18 September).
 *
 * What counts as "soft" and what counts as "filling well" decides what
 * a person is told to consider, so it is the owner's answer and not
 * this file's. The three figures below are the RECOMMENDATION put to
 * them, in one place so the answer is a one-line change:
 *
 *   closeInDays  a date this near is worth looking at at all
 *   softPct      at or below this, on a close-in date, it is soft
 *   strongPct    at or above this, it is filling well
 *
 * Until they answer, nothing here is deployed and no suggestion has
 * been shown to anybody.
 */
export const THRESHOLDS = {
  closeInDays: 14,
  softPct: 50,
  strongPct: 85,
} as const;

export type Temper = "soft" | "strong" | "steady";

/** How a night is filling, against the thresholds above. */
export function temperOf(day: DateAhead): Temper {
  if (day.available === 0) return "steady";
  if (day.occupancyPct >= THRESHOLDS.strongPct) return "strong";
  if (day.daysOut <= THRESHOLDS.closeInDays
      && day.occupancyPct <= THRESHOLDS.softPct) return "soft";
  return "steady";
}

/** A suggestion, in words, and the figures behind it. */
export interface Suggestion {
  date: string;
  temper: Exclude<Temper, "steady">;
  /** What to consider. Never an instruction, and never a figure. */
  text: string;
  /** Why - only figures the reports service has agreed to. */
  reason: string;
}

const nightsOut = (n: number) =>
  n === 0 ? "tonight" : n === 1 ? "tomorrow" : `${n} days out`;

/**
 * The sentence for one night, or null when there is nothing to say.
 *
 * NO PRICE IS NAMED. The owner's rule, and this service's whole shape:
 * a sentence says what to consider, a person decides the figure, and
 * the Rates screen is where it is typed. A suggestion that carried a
 * number would be this service setting a price with extra steps.
 */
export function suggest(day: DateAhead): Suggestion | null {
  const temper = temperOf(day);
  if (temper === "steady") return null;

  const when = dateLong(day.date);
  const reason =
    `${nightsOut(day.daysOut)}, ${day.occupancyPct}% sold, `
    + `${day.left} of ${day.available} rooms left.`;

  return temper === "soft"
    ? { date: day.date, temper, reason,
        text: `Consider a lower rate for ${when}.` }
    : { date: day.date, temper, reason,
        text: `Consider holding or raising the rate for ${when}.` };
}

/** The window, with the two derived facts added. `today` is the
    property's own business date - two hotels are routinely on
    different days. */
export function datesAhead(days: OutlookDay[], today: string): DateAhead[] {
  return days
    .filter((d) => d.date >= today)
    .map((d) => ({
      ...d,
      left: Math.max(0, d.available - d.sold),
      daysOut: nightsBetween(today, d.date),
    }));
}

/** Whole days between two YYYY-MM-DD dates. Both are plain dates, so
    they are compared at UTC midnight and no time zone can move one. */
export function nightsBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** The softest nights first, then the nearest. The screen shows the
    top of this list, because a list of ninety dates answers nothing. */
export function softestFirst(days: DateAhead[]): DateAhead[] {
  return days
    .filter((d) => temperOf(d) === "soft")
    .sort((a, b) => a.occupancyPct - b.occupancyPct || a.daysOut - b.daysOut);
}

/* ══════════════════════════════════════════════════════════════════
   PACE - this month against the same month last year

   The comparison is the reports service's own period figures, asked
   for twice. Nothing is derived here that `getPeriodStatistics` does
   not already answer.

   ⚠ WHERE THERE IS NO LAST YEAR, SAY SO. The brief's words, and the
   owner's rule about invented figures. A property that had not opened
   has an available count of NIL for that month (D17-93: available
   starts on the property's first trading day), and nil available is
   not "0% occupancy last year" - it is no comparison at all. 5
   Elements went live in this system in August 2026, so for most of
   this year this is the branch that runs, and printing a zero beside
   it would read as a collapse rather than an absence.
   ══════════════════════════════════════════════════════════════════ */

export interface Pace {
  /** This month, on the books now: nights already sold plus nights
      booked ahead, at the booking's rate (the reports definition). */
  now: PeriodStatistics;
  /** The same month last year, or null when the property had nothing
      to sell then. Null is a sentence on the screen, never a zero. */
  lastYear: PeriodStatistics | null;
}

/** A month the property could not have traded in has nothing to compare. */
export function comparable(month: PeriodStatistics | null): PeriodStatistics | null {
  return month && month.availableRoomNights > 0 ? month : null;
}

/** The same calendar month, a year earlier. February is safe: day 0 of
    the next month in UTC is that month's last day, whatever its length. */
export function sameMonthLastYear(from: string): { from: string; to: string } {
  const year = Number(from.slice(0, 4)) - 1;
  const month = Number(from.slice(5, 7));
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

/** How far ahead or behind, in points of occupancy. Null when there is
    no last year to be ahead of. */
export function aheadBy(pace: Pace): number | null {
  const then = comparable(pace.lastYear);
  return then ? Math.round((pace.now.occupancyPct - then.occupancyPct) * 100) / 100 : null;
}
