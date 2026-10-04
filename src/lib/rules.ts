import type { Permitted } from "@/data/repositories/types";
import { dateShort } from "@/lib/format";

/* ══════════════════════════════════════════════════════════════════
   BUSINESS RULES — Rule 3

   Every rule the front desk is subject to lives here and nowhere
   else. A rule duplicated inside a component drifts, and the copy
   nobody remembers is the one that runs.

   Each returns `{ allowed, reason }` so a blocked action can be shown
   disabled WITH its reason (Rule 6) rather than hidden.
   ══════════════════════════════════════════════════════════════════ */

/** Charge categories, taken from the Manager Report's extra-charge lines. */
export const CHARGE_CATEGORIES = [
  "Room posting",
  "Food",
  "Beverages",
  "Late check-out fee",
  "Early check-in fee",
  "Extra person fee",
  "Laundry",
  "Miscellaneous",
] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

/** The hotel's own ways of paying that are On, in its order (191, the
    owner's D27-259), from GET /api/hotels: the screens and the payment door
    read the same list. `credit: false` leaves out what goes to the books as
    Bill to company - an advance is money in hand. An older server sends no
    list: the five every hotel started with (191's seed). */
const STARTING_WAYS = [
  { label: "Cash", kind: "cash" }, { label: "UPI", kind: "upi" }, { label: "Credit Card", kind: "card" },
  { label: "Debit Card", kind: "card" }, { label: "Bill to company", kind: "city_ledger" },
];
export const payingWays = (
  rules?: { paymentMethods?: { label: string; kind: string }[] }, credit = true,
): string[] =>
  (rules?.paymentMethods ?? STARTING_WAYS)
    .filter((m) => credit || m.kind !== "city_ledger").map((m) => m.label);

const ok: Permitted = { allowed: true };
const no = (reason: string): Permitted => ({ allowed: false, reason });

/* ── Check-in ─────────────────────────────────────────────────────── */

export function canCheckIn(stay: {
  status: string;
  arrival: string;
}, businessDate: string): Permitted {
  if (stay.status === "cancelled") return no("This reservation was cancelled.");
  if (stay.status === "no-show") return no("This reservation was marked a no-show.");
  if (stay.status === "in-house") return no("This guest is already checked in.");
  if (stay.status === "checked-out") return no("This stay has already ended.");
  if (stay.arrival > businessDate)
    /* Formatted, because a clerk reads this sentence. Every date on
       every other screen says "30 Aug 2026"; a refusal is not the place
       to start showing raw ISO. */
    return no(`Arrives ${dateShort(stay.arrival)}. Check-in opens that morning.`);
  return ok;
}

/* ── Folio ────────────────────────────────────────────────────────── */

export function canPostCharge(stay: { status: string }): Permitted {
  if (stay.status === "checked-out") return no("The folio closed at check-out.");
  if (stay.status === "cancelled") return no("This reservation was cancelled.");
  return ok;
}

/**
 * The ledger is append-only. A wrong posting is reversed, never edited
 * or deleted, and the reversal is its own line.
 */
export function canReverse(posting: { reversed: boolean; isReversal: boolean }): Permitted {
  if (posting.isReversal) return no("A reversal cannot itself be reversed.");
  if (posting.reversed) return no("This posting has already been reversed.");
  return ok;
}

/* ── Settlement and check-out ─────────────────────────────────────── */

/* These reasons are read at the DESK, so they say "bill" (the owner's
   choice, 15 September: Bill at the desk, Folio in Finance). Wording
   only — every rule below is unchanged. */

/**
 * The rule the whole departure flow turns on: check-out stays disabled,
 * visibly, until the folio reaches zero.
 */
export function canCheckOut(
  stay: { status: string },
  balance: number,
  formatMoney: (n: number) => string,
): Permitted {
  if (stay.status === "checked-out") return no("Already checked out.");
  if (stay.status !== "in-house" && stay.status !== "due-out")
    return no("This guest is not in house.");
  if (balance > 0) return no(`${formatMoney(balance)} is still owed on this bill.`);
  if (balance < 0) return no("This bill is overpaid. Refund the difference first.");
  return ok;
}
