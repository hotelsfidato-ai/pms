import type { Mount } from "../../mount.ts";
import { statistics } from "../../routes/statistics.ts";
import { reports } from "../../routes/reports.ts";
import { manager } from "../../routes/manager.ts";

/* The front door of the reports service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", statistics],
  ["/api/hotels", reports],
  ["/api/hotels", manager],
];
