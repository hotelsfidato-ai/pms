/* The front door of the Guests and companies service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { listBookingSources } from "./data/bookingSources";
export { listCompanies, setGuestVip } from "./data/directory";
/* One guest, one record - the Central CRM, phase 1 (docs/briefs/crm.md).
   The suggestion and the two ticks, for the booking form (reservations)
   and the walk-in (front desk); "stayed with the group N times" for the
   stay panel; and the opt-out rule for marketing's gate (the master's
   line, src/modules/crm/MODULE.md). */
export { ReturningGuest, stayedWords } from "./components/ReturningGuest";
export {
  phoneKey, emailKey, refusesOffers, agreedToOffers, type NoOffers,
} from "./logic/contactKeys";
/* CRM-3 (D22-8): Arrivals and the check-in warn of a booking site's guest
   whose phone or email is a blacklisted guest's. Placed by front desk. */
export { BookingSiteBlacklist } from "./components/BookingSiteBlacklist";
/* Form III (D27-25): what the desk asks a foreign guest - one set of
   fields for check-in and the walk-in (front desk) and the register. */
export {
  ForeignGuestFields, formIIIMissing, particularsPayload, NO_PARTICULARS,
  ID_TYPES, PURPOSES, idProblem, idExpired, type Particulars,
} from "./components/ForeignGuestFields";

/* GU-1 (28 September): correcting a guest, from the stay panel and Guest 360. */
export { EditGuestFlow } from "./components/EditGuestFlow";

/* D27-163: the guest's ID asked once - the one page's and the one-page
   check-in's, so the two cannot ask different questions. */
export {
  GuestIdFields, guestIdState, guestIdPayload, noGuestId, type GuestId,
} from "./components/GuestIdFields";
