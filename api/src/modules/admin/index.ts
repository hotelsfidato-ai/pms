import type { Mount } from "../../mount.ts";
import { moduleSwitches } from "./moduleSwitches.ts";
import { adminLists } from "./adminLists.ts";
import { admin } from "./admin.ts";
import { commissioning } from "./commissioning.ts";
import { groupSettings } from "./groupSettings.ts";
import { gallery } from "./gallery.ts";
import { bankDetails } from "./bankDetails.ts";
import { systemHealth } from "./systemHealth.ts";

/* The front door of the administration service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", moduleSwitches],
  ["/api/hotels", adminLists],
  ["/api", admin],
  ["/api/hotels", commissioning],
  ["/api/hotels", groupSettings],
  ["/api/hotels", gallery],
  ["/api/hotels", bankDetails],
  ["/api/hotels", systemHealth],
];
