import type { Mount } from "../../mount.ts";
import { roomTypesAndPlans } from "./roomTypesAndPlans.ts";
import { rateGrid } from "./rateGrid.ts";
import { rates } from "./rates.ts";
import { pricing } from "./pricing.ts";
import { inventorySetup } from "./inventorySetup.ts";
import { planSettings } from "./planSettings.ts";
import { roomTypeExtras } from "./roomTypeExtras.ts";

/* The front door of the inventory and rates service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", roomTypesAndPlans],
  ["/api/hotels", rateGrid],
  ["/api/hotels", rates],
  ["/api/hotels", pricing],
  ["/api/hotels", inventorySetup],
  ["/api/hotels", planSettings],
  ["/api/hotels", roomTypeExtras],
];
