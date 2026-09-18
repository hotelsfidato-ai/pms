import type { Mount } from "../../mount.ts";
import { purchasing } from "./purchasing.ts";

/* The front door of the purchasing service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", purchasing],
];

/* Nothing else is exported yet: no other service reads a purchase. When
   Equipment starts receiving against an order (phase 1B's other half),
   what it needs goes here. */
export { stateOf, STATE_WORDS, type PurchaseState } from "./purchasing.ts";
