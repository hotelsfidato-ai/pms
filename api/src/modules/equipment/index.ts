import type { Mount } from "../../mount.ts";
import { equipment } from "./equipment.ts";

/* The front door of the equipment service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).

   The master made it and mounted it in `server.ts` on 16 September, before
   phase 1B, so this service adds its router here and never touches
   `server.ts`, which every service shares. Its routers, and where each is
   mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", equipment],
];

/* What another service may do with the register. Housekeeping's repairs
   (phase 2B, the owner's D17-7): find a tagged thing to repair, and set it
   under repair or back in use through the register's own rules. Written by
   the housekeeping chat on the owner's answer of 17 September — the master
   reviews it at merge. */
export {
  itemsForRepair, checkRepairable, setRepairStatus, REPAIR_WAITING,
  type RepairableItem, type RepairStatus, type RepairCheck,
} from "./repairs.ts";
