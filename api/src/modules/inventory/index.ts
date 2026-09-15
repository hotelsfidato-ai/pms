import type { Mount } from "../../mount.ts";
import { roomTypesAndPlans } from "./roomTypesAndPlans.ts";
import { rates } from "./rates.ts";
import { inventorySetup } from "./inventorySetup.ts";

/* The front door of the inventory and rates service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", roomTypesAndPlans],
  ["/api/hotels", rates],
  ["/api/hotels", inventorySetup],
];
