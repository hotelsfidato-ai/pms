import type { Mount } from "../../mount.ts";
import { pos, posAdmin } from "./pos.ts";
import { till } from "./till.ts";

/* The front door of the restaurant (POS) service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", posAdmin],
  ["/api/hotels", till],
  ["/api/pos", pos],
];

/* The auth gate in server.ts resolves an outside till's key to its outlet,
   and scripts/pos-outlet.ts issues keys and makes outlets. Both come through
   this door. */
export { outletFor, hashKey, issueKey, addOutlet, type Outlet } from "./pos.ts";
