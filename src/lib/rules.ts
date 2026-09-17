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

export const TAX_RATE = 0.05;            // CGST 2.5 + SGST 2.5
export const CGST_RATE = 0.025;
export const SGST_RATE = 0.025;

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

/** Payment methods the property actually accepts, from the Night Audit. */
export const PAYMENT_METHODS = [
  "Cash", "UPI", "Credit Card", "Debit Card", "Google Pay", "Bill to company",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Housekeeping states. Independent of whether anyone is in the room. */
export const HOUSEKEEPING_STATES = ["dirty", "clean", "inspected", "out-of-service"] as const;
export type HousekeepingState = (typeof HOUSEKEEPING_STATES)[number];

const ok: Permitted = { allowed: true };
const no = (reason: string): Permitted => ({ allowed: false, reason });

/* ── Money ────────────────────────────────────────────────────────── */

export function taxOn(amount: number): number {
  return Math.round(amount * TAX_RATE * 100) / 100;
}

export function splitTax(amount: number) {
  const cgst = Math.round(amount * CGST_RATE * 100) / 100;
  return { cgst, sgst: cgst, total: Math.round((cgst * 2) * 100) / 100 };
}

/** Indian hotel bills round to the rupee; the difference is a real line. */
export function roundOff(amount: number): { rounded: number; adjustment: number } {
  const rounded = Math.round(amount);
  return { rounded, adjustment: Math.round((rounded - amount) * 100) / 100 };
}

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

/** Only a clean or inspected room may receive a guest. */
export function canAssignRoom(room: { housekeeping: string; occupied: boolean }): Permitted {
  if (room.occupied) return no("Someone is still in this room.");
  if (room.housekeeping === "out-of-service") return no("This room is out of service.");
  if (room.housekeeping === "dirty") return no("This room has not been cleaned yet.");
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

export function canSettle(balance: number): Permitted {
  if (balance === 0) return no("Nothing is owed on this bill.");
  if (balance < 0) return no("This bill is overpaid - it needs a refund, not a payment.");
  return ok;
}

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

/* ── Housekeeping ─────────────────────────────────────────────────── */

/** A room becomes dirty on departure and cannot be sold until cleaned. */
export function nextHousekeepingState(current: HousekeepingState): HousekeepingState | null {
  switch (current) {
    case "dirty": return "clean";
    case "clean": return "inspected";
    default: return null;
  }
}

export function canMarkClean(room: { housekeeping: string }): Permitted {
  if (room.housekeeping === "out-of-service") return no("This room is out of service.");
  if (room.housekeeping === "clean") return no("Already marked clean.");
  if (room.housekeeping === "inspected") return no("Already inspected.");
  return ok;
}

export function canMarkInspected(room: { housekeeping: string }): Permitted {
  if (room.housekeeping === "out-of-service") return no("This room is out of service.");
  if (room.housekeeping === "dirty") return no("Clean the room before inspecting it.");
  if (room.housekeeping === "inspected") return no("Already inspected.");
  return ok;
}

/* ── Walk-in ──────────────────────────────────────────────────────── */

/** A rate below rack needs a reason, and the reason is kept. */
export function rateOverrideNeedsReason(rack: number, offered: number): boolean {
  return offered < rack;
}

export function canConfirmWalkIn(input: {
  guestName: string;
  nights: number;
  offeredTariff: number;
  rackTariff: number;
  overrideReason: string;
}): Permitted {
  if (!input.guestName.trim()) return no("A guest name is required.");
  if (input.nights < 1) return no("A walk-in needs at least one night.");
  if (input.offeredTariff < 0) return no("The rate cannot be negative.");
  if (
    rateOverrideNeedsReason(input.rackTariff, input.offeredTariff) &&
    !input.overrideReason.trim()
  ) {
    return no("A rate below rack needs a reason.");
  }
  return ok;
}

/* ── Business date ────────────────────────────────────────────────── */

/**
 * A charge entered at 01:40 belongs to the previous business date until
 * the night audit runs. Stage 5 enforces this against the database; the
 * rule is written here so the interface already speaks it.
 */
export function postingDateFor(_now: Date, businessDate: string): string {
  return businessDate;
}
