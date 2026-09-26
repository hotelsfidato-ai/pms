import { inr } from "../../reportRender.ts";

/* ══════════════════════════════════════════════════════════════════
   CASH OF ₹2 LAKH, AND THE PAN ABOVE ₹1 LAKH (the owner's D25-40)

   Income-tax Act 2025 s.186: no cash of ₹2,00,000 or more from one guest
   - counted over the stay, its group and the day at the desk (the owner,
   26 September; app.cash_taken), over the bill at the till. Rule 159: more
   than ₹1,00,000 in cash at one time needs the PAN, or Form 97 from a guest
   with none; a guest from abroad is not asked.

   Asked by the desk's payment (postings.ts) and the till's settle
   (pos/till.ts), each BEFORE its first write (root MEMORY 243).
   ══════════════════════════════════════════════════════════════════ */

export const CASH_LIMIT = 200_000;
export const PAN_ABOVE = 100_000;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** The refusal when this cash would reach ₹2,00,000, or null. */
export function overCashLimit(already: number, amount: number, otherWays: string): string | null {
  if (already + amount < CASH_LIMIT) return null;
  const left = CASH_LIMIT - already;
  return "Cash of ₹2,00,000 or more from one guest is not allowed (Income-tax Act s.186). "
    + (already <= 0 ? "Take less than ₹2,00,000 in cash. "
      : left > 0 ? `₹${inr(already)} has been taken in cash already, so less than ₹${inr(left)} more can be cash. `
      : `₹${inr(already)} has been taken in cash already, so no more can be cash. `)
    + `Take the rest by ${otherWays}.`;
}

export const PAN_NEEDED =
  "More than ₹1,00,000 in cash at one time needs the guest's PAN, or Form 97 from a guest "
  + "who has none (Income-tax Rule 159). Type the PAN, or tick Form 97.";
export const PAN_SHAPE = "A PAN is five letters, four digits and a letter, like ABCDE1234F.";

/** What is kept for this cash: the PAN and Form 97 when the rule asked, or
    the refusal when it asked and got neither. */
export function panFor(
  cash: number, answer: { pan?: unknown; form97?: unknown; foreign: boolean },
): { ok: true; pan: string | null; form97: boolean; nonResident: boolean }
  | { ok: false; reason: string } {
  const none = { ok: true as const, pan: null, form97: false, nonResident: false };
  if (cash <= PAN_ABOVE) return none;
  if (answer.foreign) return { ...none, nonResident: true };
  if (answer.form97 === true) return { ...none, form97: true };
  const pan = typeof answer.pan === "string" ? answer.pan.trim().toUpperCase() : "";
  if (!pan) return { ok: false, reason: PAN_NEEDED };
  return PAN.test(pan) ? { ...none, pan } : { ok: false, reason: PAN_SHAPE };
}
