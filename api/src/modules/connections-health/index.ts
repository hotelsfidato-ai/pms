import type { Mount } from "../../mount.ts";
import { health } from "./health.ts";

/* The front door of Connection health on the server - the only file the
   core or another service may import (src/test/boundaries.test.ts).

   D27-276 (point 3): every outside connection green, amber, red or grey,
   with its last success and last error, and ONE email to the owner when
   one turns red. Read-only routes. `jobs` is the alert sweep's timer,
   started by server.ts. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", health],
];

export { jobs } from "./alerts.ts";
/* The backup status line's one reader, also read by System health (admin). */
export { readBackupStatus, backupLog } from "./health.ts";
