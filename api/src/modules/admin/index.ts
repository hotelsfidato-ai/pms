import type { Mount } from "../../mount.ts";
import { moduleSwitches } from "./moduleSwitches.ts";
import { adminLists } from "./adminLists.ts";
import { admin } from "./admin.ts";
import { commissioning } from "./commissioning.ts";
import { groupSettings } from "./groupSettings.ts";
import { gallery } from "./gallery.ts";
import { property } from "./property.ts";
import { bankDetails } from "./bankDetails.ts";
import { systemHealth } from "./systemHealth.ts";
import { activity } from "./activity.ts";
import { testHotels } from "./testHotelRoutes.ts";

/* The front door of the administration service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
/* P3 (D27-258): the gallery's photo check, for a room type's photos (inventory). */
export { readPhoto } from "./gallery.ts";
export const mounts: readonly Mount[] = [
  ["/api/hotels", moduleSwitches],
  ["/api/hotels", adminLists],
  /* D27-296: before admin's own /admin/hotels/:code/:state, which would
     otherwise take "test-reset" for a state it does not know. */
  ["/api", testHotels],
  ["/api", admin],
  ["/api/hotels", commissioning],
  ["/api/hotels", groupSettings],
  ["/api/hotels", gallery],
  ["/api/hotels", property],
  ["/api/hotels", bankDetails],
  ["/api/hotels", systemHealth],
  /* D27-243 (5.1): the full activity log. */
  ["/api/hotels", activity],
];
