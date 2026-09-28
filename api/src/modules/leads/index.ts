import type { Mount } from "../../mount.ts";
import { leads } from "./leads.ts";

/* The front door of this service on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   Leads and WhatsApp, read only from the market-to-revenue app (D27-100,
   D27-168): the sync that reads it (sync.ts) and the two reads the screen
   and New booking use (leads.ts).

   THE SYNC IS NOT STARTED HERE. `server.ts` (the master's file) starts it
   beside the others - one line to start, one to stop - and it reads nothing
   until the owner's settings are all there (M2R_SERVICE_ACCOUNT, M2R_HOTELS,
   M2R_DAILY_READS; src/modules/leads/OWNER-STEPS.md). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", leads],
];

export { jobs, syncOnce, settings, connected, type Settings } from "./sync.ts";
