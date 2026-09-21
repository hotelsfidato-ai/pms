/* ══════════════════════════════════════════════════════════════════
   THE KEYS A PHONE AND AN EMAIL ARE COMPARED ON — and who asked for no offers

   The owner, 21 September: '+91 98765 43210', '098765 43210' and
   '9876543210' are one number; anything else must match digit for digit;
   a number under ten digits, or all one digit, matches nobody.

   ⚠ THE DATABASE HOLDS THE SAME RULE (`app.phone_key`, `app.email_key`,
   migration "one guest, one record"), and every match the desk sees is
   made there. This copy exists for one reader: marketing's gate, which
   decides in the browser who a list may write to. Both are tested over
   the SAME sample numbers - contactKeys.test.ts and
   db/tests/modules/crm.sql - so change one, change both.
   ══════════════════════════════════════════════════════════════════ */

export function phoneKey(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  const k = d.length === 12 && d.startsWith("91") ? d.slice(2)
    : d.length === 11 && d.startsWith("0") ? d.slice(1)
    : d;
  return k.length < 10 || /^(\d)\1*$/.test(k) ? null : k;
}

export function emailKey(email: string | null | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}

/** The numbers and addresses that asked not to be sent offers, as keys
    (`GET /api/hotels/:code/crm/no-offers`). */
export interface NoOffers {
  phones: readonly string[];
  emails: readonly string[];
}

/** D21-22: an offer may not go to a phone or email that asked for none -
    whichever booking, hotel or guest record it arrives on. */
export function refusesOffers(
  noOffers: NoOffers, phone: string | null | undefined, email: string | null | undefined,
): boolean {
  const p = phoneKey(phone);
  const e = emailKey(email);
  return (p !== null && noOffers.phones.includes(p))
    || (e !== null && noOffers.emails.includes(e));
}
