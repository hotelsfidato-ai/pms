import { dateLong } from "@/lib/format";

/* ══════════════════════════════════════════════════════════════════
   PICKUP, AND WHERE THE MONTH STOOD A WEEK AGO - the words, and when
   to refuse to say any

   RM-1. The brief's first item and the third part of pace were both
   left out on 18 September because the reports service's `stay_nights`
   rule could not be reached from here, and counting room-nights a
   second way is how the Dashboard and the Manager report came to
   disagree in August. R1 asked for the door; it was opened on 18
   September; `api/src/modules/revenue-management/pickup.ts` counts
   over that rule and nothing else.

   THIS FILE HOLDS NO QUERY AND NO COUNT. It decides one thing: when a
   pickup figure is a figure, and when it is a dash and a sentence.

   ⚠ WHY A DASH IS SOMETIMES THE ONLY HONEST ANSWER. "Booked in the
   last 30 days" is only a fact if this property's records go back 30
   days. Where they do not, every booking it holds was made inside the
   window, and "30 of the 30 rooms were picked up this month" cannot be
   told apart from "these are all the bookings we have". A figure that
   cannot be told apart from another figure is not a figure, so it is a
   dash with a sentence saying why - never a zero, and never a number
   that reads like news (HANDOVER § 5).

   That is the same shape as D17-93, where available rooms start on the
   property's first trading day: before a property traded it had
   nothing to sell, and before a booking was ever recorded here nothing
   could have been picked up.
   ══════════════════════════════════════════════════════════════════ */

/** One night, as the server's pickup route answers for it. */
export interface PickupNight {
  date: string;
  /** `dailyFigures().sold` - the reports service's own figure. */
  sold: number;
  last1: number;
  last7: number;
  last30: number;
}

export interface Pickup {
  from: string;
  to: string;
  /** The property's own day. Every window is counted back from it. */
  businessDate: string;
  /** The day this property's booking records begin, or null if it has
      none. The reason a figure may be a dash. */
  recordsFrom: string | null;
  nights: PickupNight[];
}

/** The three windows, as the screen shows them and the route counts them. */
export const WINDOWS = [1, 7, 30] as const;
export type Window = (typeof WINDOWS)[number];

/** A pickup figure, or null where saying one would be inventing it. */
export interface Picked {
  last1: number | null;
  last7: number | null;
  last30: number | null;
}

/** The first day a window covers: the business date, less the days
    before it. Both plain dates, compared at UTC midnight, so no time
    zone can move one (the same arithmetic as `nightsBetween`). */
export function windowOpens(businessDate: string, days: Window): string {
  return new Date(Date.parse(`${businessDate}T00:00:00Z`) - (days - 1) * 86_400_000)
    .toISOString().slice(0, 10);
}

/** Whether a window is long enough ago to mean anything here: it must
    open on or after the day this property's booking records do. */
export function counted(pickup: Pickup, days: Window): boolean {
  return pickup.recordsFrom !== null
    && windowOpens(pickup.businessDate, days) >= pickup.recordsFrom;
}

const NOTHING: Picked = { last1: null, last7: null, last30: null };

/** What was picked up for one night, with a dash wherever the records
    do not reach back far enough to say. */
export function pickupOn(pickup: Pickup | null, date: string): Picked {
  if (!pickup) return NOTHING;
  const night = pickup.nights.find((n) => n.date === date);
  if (!night) return NOTHING;
  return {
    last1: counted(pickup, 1) ? night.last1 : null,
    last7: counted(pickup, 7) ? night.last7 : null,
    last30: counted(pickup, 30) ? night.last30 : null,
  };
}

/**
 * WHERE THIS MONTH STOOD A WEEK AGO - the third part of pace.
 *
 * Every room-night on the books for this month, less every one of them
 * booked in the last seven days. What is left was already on the books
 * a week ago.
 *
 * ⚠ AND IT IS NOT A SNAPSHOT, WHICH IS A DIFFERENT THING. Nobody wrote
 * down what the books said last Tuesday, and nothing here pretends
 * otherwise: a booking made a fortnight ago and cancelled yesterday
 * was on the books then and is not counted now. So this says "of what
 * is on the books today, this much was already there a week ago" - the
 * screen says as much in a sentence, because the two readings differ
 * by exactly the week's cancellations and a reader deserves to know
 * which one they are looking at.
 *
 * Null when the records do not reach back a week: nought rooms a week
 * ago would read as a collapse rather than as an absence.
 */
export function onTheBooksAWeekAgo(
  month: { from: string; to: string; roomsSold: number },
  pickup: Pickup | null,
): number | null {
  if (!pickup || !counted(pickup, 7)) return null;
  const since = pickup.nights
    .filter((n) => n.date >= month.from && n.date <= month.to)
    .reduce((total, n) => total + n.last7, 0);
  return month.roomsSold - since;
}

/**
 * Why a pickup figure is a dash, in words, or null when none of them is.
 *
 * ONE sentence for the whole screen rather than one per cell: the
 * reason is the same everywhere, and repeating it beside nine dashes
 * is the noise RM-2 is about.
 */
export function whyNoPickup(pickup: Pickup | null): string | null {
  if (!pickup) {
    return "Pickup could not be read, so it is left blank rather than guessed.";
  }
  if (pickup.recordsFrom === null) {
    return "No booking has been recorded at this property yet, "
      + "so there is nothing to have picked up.";
  }
  if (WINDOWS.every((w) => counted(pickup, w))) return null;

  return `Booking records here start on ${dateLong(pickup.recordsFrom)}, and `
    + `this property's own day is ${dateLong(pickup.businessDate)}. `
    + "A window that opens before the records do is shown as a dash: it "
    + "cannot tell what was picked up from everything on the books.";
}

