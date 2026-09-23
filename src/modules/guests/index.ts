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
export { ReturningGuest, ConsentTicks, stayedWords } from "./components/ReturningGuest";
export { phoneKey, emailKey, refusesOffers, type NoOffers } from "./logic/contactKeys";
/* CRM-3 (D22-8): Arrivals and the check-in warn of a booking site's guest
   whose phone or email is a blacklisted guest's. Placed by front desk. */
export { BookingSiteBlacklist } from "./components/BookingSiteBlacklist";
