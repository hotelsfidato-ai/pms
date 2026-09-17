import type { Mount } from "../../mount.ts";
import { roomStatus } from "./roomStatus.ts";
import { housekeeping } from "./housekeeping.ts";
import { repairs } from "./repairs.ts";

/* The front door of the housekeeping service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). `repairs` is
   phase 2B: what a repair on equipment may point at, and its costs. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", roomStatus],
  ["/api/hotels", housekeeping],
  ["/api/hotels", repairs],
];
