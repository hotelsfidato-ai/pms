/* ══════════════════════════════════════════════════════════════════
   CARD DETAILS NEVER ENTER THE PMS — D17-83

   SU's booking message can carry a card number, its expiry, its CVC, a
   virtual card's balance and dates, and payment-gateway tokens: SU's
   "Response of Reservation Information" lists cc_number, cc_cvc,
   cc_expiration_date, cc_name, cc_type, cc_current_balance,
   cc_activation_date, vcc_expiration_date, cc_token, cc_token_expiration,
   cc_unique_code, cc_vault_token, cc_tracking_id, tokensource, tokentype,
   token_id, su_payments, pgtransactionid and pg_refid.

   The owner, 17 September (D17-83): never kept - "dropped on arrival, never
   stored, logged or shown".

   So the message is scrubbed HERE, the moment it is read off the wire and
   before anything else sees it: not before storing, not before logging,
   before ANYTHING. What is left is what the rest of the connection works
   with, so no later mistake can put a card number in a row, a log line or a
   screen: the value is already gone.

   It takes the whole message, not a known shape: SU adds fields, and a field
   added tomorrow that looks like a card is dropped without anybody editing
   this file. A key is dropped when its NAME says card, cvc, cvv or token, or
   when it is one of the payment-gateway names above. `cardFieldsRemoved`
   says how many went, so the screen can say "card details were not kept"
   rather than pretending the message never had any.
   ══════════════════════════════════════════════════════════════════ */

const CARD_NAME = /(^|_)(cc|card|cvc|cvv|vcc)($|_)|token|^su_payments$|^pgtransactionid$|^pg_refid$|^pg_type$|^bookingcharged$|^amountcharged$/i;

export interface Scrubbed {
  payload: unknown;
  cardFieldsRemoved: number;
}

export function scrubCardFields(message: unknown): Scrubbed {
  let removed = 0;

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;

    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (CARD_NAME.test(key)) {
        /* An empty string is what SU sends when there is no card at all, and
           dropping those would say "card details were not kept" about a
           booking that never had any. Only something with a value counts. */
        if (inner !== null && inner !== "" && !(Array.isArray(inner) && inner.length === 0)
            && !(typeof inner === "object" && Object.values(inner as object).every(
                   (v) => v === null || v === ""))) {
          removed += 1;
        }
        continue;
      }
      out[key] = walk(inner);
    }
    return out;
  };

  return { payload: walk(message), cardFieldsRemoved: removed };
}
