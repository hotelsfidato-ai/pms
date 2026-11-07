import type { Mount } from "../../mount.ts";
import { roomStatus } from "./roomStatus.ts";
import { housekeeping } from "./housekeeping.ts";
import { repairs } from "./repairs.ts";
import { minibar } from "./minibar.ts";
import { checklists } from "./checklists.ts";

/* The front door of the housekeeping service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). `repairs` is
   phase 2B: what a repair on equipment may point at, and its costs.
   `minibar` and `checklists` are D27-383 item 10 (migrations 274, 275). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", roomStatus],
  ["/api/hotels", housekeeping],
  ["/api/hotels", repairs],
  ["/api/hotels", minibar],
  ["/api/hotels", checklists],
];
