import type { Mount } from "../../mount.ts";
import { crsRoutes } from "./routes.ts";
import { crsSetup } from "./setup.ts";

/* The front door of the CRS bridge on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   D27-168: CRS bookings are READ from the CRS every five minutes (never
   pushed to the PMS) and become waiting bookings; the hotel's answer goes
   back to the CRS's booking register through its n8n. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", crsRoutes],
  /* The mapping form: the owner and an administrator (D27-171). */
  ["/api/hotels", crsSetup],
];

/* THE READER is not started here: `server.ts` (the master's) starts it after
   listen, beside the channel manager's jobs, and it reads nothing until the
   four CRS settings are on the server. */
export { jobs, runOnce } from "./jobs.ts";
