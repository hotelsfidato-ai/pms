import type { Mount } from "../../mount.ts";
import { keys } from "./keys.ts";

/* The front door of room systems on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   D27-178: key cards cut and cancelled through the hotel's lock system,
   recorded against the stay. The lock vendor is not known; `locks.ts` holds
   the two acts every lock system takes and ONE stand-in driver. Nothing is
   connected until the server's settings name a driver and the property. */
export const mounts: readonly Mount[] = [["/api/hotels", keys]];

/* Front desk's check-out, move and exchange call this once each. */
export { cancelStaleKeys } from "./keys.ts";
