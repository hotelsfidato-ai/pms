/* ══════════════════════════════════════════════════════════════════
   THE LISTS - who may be written to, and who never may

   D18-17, the owner: "guest lists that can be acted on - stayed twice,
   not returned in a year, came from which site - with an export, and a
   send through n8n when an offer goes out". Three lists. The brief's
   fourth, birthdays this month, is dropped (D22-17): no date of birth
   is kept. See DEFECTS MKT-2.

   ⚠ THE RULE THIS SERVICE EXISTS UNDER, and it is not about tidiness:
   a guest who has asked not to be written to is never on a list that
   sends. The "No offers" list is `offer_opt_outs` (D21-22: a phone or
   an email, for the whole group), matched by the guests service's
   `refusesOffers`. ONE gate every list goes through (`mayBeWrittenTo`),
   and no list can be called without the No offers list to hand it.

   NOTHING HERE SENDS AND NOTHING HERE EXPORTS. There is no screen and
   no server route yet (MODULE.md, Requests).
   ══════════════════════════════════════════════════════════════════ */

import { refusesOffers, type NoOffers } from "@/modules/guests";

/**
 * What this service needs to know about a guest.
 *
 * Declared here rather than imported, because the guests service's
 * front door does not export its guest list yet and reaching past a
 * front door is the one thing `src/test/boundaries.test.ts` refuses.
 * This is the shape asked of the master, written down: everything but
 * `phone` and `email` is already what `/api/hotels/:code/guests`
 * answers today.
 *
 * A guest is grouped by NAME upstream - `guests` carries a row per
 * booking, because a walk-in has no record to look up - so `id` here is
 * that grouping key and not a person's primary key. It matters for
 * consent: a flag set on one booking's row would not follow the person.
 */
export interface Addressable {
  /** The upstream grouping key - a folded name, not a guest's row id. */
  id: string;
  name: string;
  stays: number;
  /** Latest departure that has already happened, ISO, or null. */
  lastStay: string | null;
  /** Earliest arrival still ahead, ISO, or null. */
  nextStay: string | null;
  /** Where their bookings came from, as the desk words it. */
  sources: string[];
  phone: string | null;
  email: string | null;
}

/**
 * ⚠ THE ONE PLACE THIS SERVICE DECIDES WHO MAY BE WRITTEN TO.
 *
 * Every list below goes through it, so the consent condition lives here
 * once and is inherited by all of them - and later by the send.
 *
 * An address to write to, and neither the phone nor the email on the
 * No offers list (MKT-1, D21-22). The phone is compared as the database
 * compares it (`app.phone_key`): "+91 98200 11111" asked once covers
 * "098200 11111" typed at another hotel. `is_blacklisted` is a different
 * thing - a guest refused a room - and is not read here.
 */
export function mayBeWrittenTo(guest: Addressable, noOffers: NoOffers): boolean {
  return Boolean(guest.phone?.trim() || guest.email?.trim())
    && !refusesOffers(noOffers, guest.phone, guest.email);
}

/**
 * The same date a year earlier, as a string.
 *
 * ISO dates sort as text, so a year is subtracted by changing the four
 * characters that say which year it is. No `Date` is built anywhere in
 * this file: a date built from "2026-09-19" is midnight UTC, and this
 * hotel's day belongs to its property rather than to the server
 * (migration 113, root MEMORY 297). 29 February survives it - as a
 * boundary "2027-02-29" sits between the 28th and the 1st, which is
 * where a year-ago cutoff belongs.
 */
export function aYearBefore(isoDate: string): string {
  return `${Number(isoDate.slice(0, 4)) - 1}${isoDate.slice(4)}`;
}

/** Guests who have stayed more than once. */
export function stayedTwice(
  guests: readonly Addressable[], noOffers: NoOffers,
): Addressable[] {
  return guests.filter((g) => mayBeWrittenTo(g, noOffers) && g.stays >= 2);
}

/**
 * Guests whose last stay ended more than a year ago and who have
 * nothing booked ahead.
 *
 * The booking ahead is the point: somebody who left in 2024 and is
 * arriving next month has returned, and an offer to come back is the
 * wrong thing to send them.
 */
export function notReturnedInAYear(
  guests: readonly Addressable[], asOn: string, noOffers: NoOffers,
): Addressable[] {
  const cutoff = aYearBefore(asOn);
  return guests.filter((g) =>
    mayBeWrittenTo(g, noOffers) && !g.nextStay && g.lastStay !== null && g.lastStay < cutoff);
}

/**
 * Guests who came through one booking site.
 *
 * The source is matched as the desk words it (`app.booking_source_label`,
 * written once in migration 082), so this service does not become a
 * sixth place that decides what a channel is called.
 */
export function cameFrom(
  guests: readonly Addressable[], source: string, noOffers: NoOffers,
): Addressable[] {
  return guests.filter((g) => mayBeWrittenTo(g, noOffers) && g.sources.includes(source));
}

/* ── The export ───────────────────────────────────────────────────
   `src/lib/csv.ts` already writes the file: quoting, the formula-
   injection guard a guest called "=cmd" needs, CRLF and the BOM Excel
   wants. This service adds the rows and nothing else. */

export const EXPORT_HEADERS = [
  "Guest", "Telephone", "Email", "Stays", "Last stay", "Came from",
] as const;

/** A dash where there is nothing, never a blank and never a zero. */
const orDash = (value: string | null | undefined): string =>
  value?.trim() || "-";

export function exportRows(guests: readonly Addressable[]): unknown[][] {
  return guests.map((g) => [
    g.name,
    orDash(g.phone),
    orDash(g.email),
    g.stays,
    orDash(g.lastStay),
    orDash(g.sources.join(", ")),
  ]);
}
