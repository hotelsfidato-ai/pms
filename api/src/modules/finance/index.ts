import type { Mount } from "../../mount.ts";
import { folios } from "./folios.ts";
import { postings } from "./postings.ts";
import { cashier } from "./cashier.ts";
import { billing } from "./billing.ts";
import { invoices } from "./invoices.ts";
import { tax } from "./tax.ts";
import { deposits } from "./deposits.ts";

/* The front door of the finance service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", folios],
  ["/api/hotels", postings],
  ["/api/hotels", cashier],
  ["/api/hotels", billing],
  ["/api/hotels", invoices],
  ["/api/hotels", tax],
  /* D27-190: the float kept at each close, and the cash deposits log. */
  ["/api/hotels", deposits],
];

/* ⚠ THE DOOR A CHARGE REACHES A ROOM BILL THROUGH — opened 18 September
   for the laundry and the spa, which both owe D18-7: a charge goes
   "straight onto the room bill as its own charge line", not through the
   restaurant till and not by writing `folio_postings`.

   Both chats asked for this rather than writing the table, which is the
   agreement working. There is still exactly ONE insert for a charge, and
   the checks in front of it — a cancelled booking, a closed folio, a
   charge with no words, a charge of nothing — run for a service exactly
   as they run for the desk.

   It answers `{ok:false, reason}` and never throws for a refusal,
   because a refusal returned inside `withSession` is a COMMIT
   (MEMORY 243). `taxKind` is "room" unless the service has its own rule;
   the spa does (D18-21) and laundry does not. */
export { postCharge } from "./postings.ts";
/* D25-40: the cash limit and the PAN, for the till's settle as for the desk. */
export { overCashLimit, panFor } from "./cashLimit.ts";
/* D27-195: a room rate that includes GST, split for the booking (reservations). */
export { roomRateBeforeGst } from "./tax.ts";
export type { ChargeToPost } from "./postings.ts";

/* PER BILL (28 September; the master's yes for round E): a payment on one
   folio, a tax invoice for one folio, and one folio's figures. The desk's
   routes call the same three, so a banquet function's bill - a folio with
   no stay - goes through the same checks and the same insert. Each answers
   a refusal as {ok:false, reason} (MEMORY 243). */
export { takeFolioPayment, postFolioCharge, reverseFolioCharge, editFolioCharge } from "./postings.ts";
export type { PaymentToTake, Payer } from "./postings.ts";
export { issueFolioInvoice } from "./invoices.ts";
export type { InvoiceRecipient } from "./invoices.ts";
export { folioBalance } from "./folios.ts";
