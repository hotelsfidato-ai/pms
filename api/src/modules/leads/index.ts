import type { Mount } from "../../mount.ts";
import { leads } from "./leads.ts";

/* The front door of this service on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   Leads and WhatsApp, read LIVE from the market-to-revenue app (D27-100,
   D27-168, D27-170): nothing is copied into the PMS, and nothing runs in
   the background. It reads nothing until the owner's settings are there
   (M2R_SERVICE_ACCOUNT, M2R_HOTELS, M2R_DAILY_READS, M2R_APP_URL;
   src/modules/leads/OWNER-STEPS.md). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", leads],
];

/* For marketing's numbers (spend and campaigns, read from the same app
   under the same cap and cache). */
export { AtCap, appHotelOf, cached, connected, openReader, settings } from "./live.ts";
export { LeadsAppError } from "./firestore.ts";
