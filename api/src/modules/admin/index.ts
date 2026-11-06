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
import { ownerReset } from "./ownerReset.ts";
import { setup } from "./setup.ts";
import { twoStep } from "./twoStep.ts";

/* The front door of the administration service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
/* P3 (D27-258): the gallery's photo check, for a room type's photos (inventory). */
export { readPhoto } from "./gallery.ts";
/* D27-338: the night audit's opening time is the owner's and an admin's (inventory's setting). */
export { maySwitchModules as isOwnerOrAdmin } from "./grants.ts";
/* D27-311: Set up this hotel - the bell asks which reminders are due. */
export { setupReminders, STEP_TITLES } from "./setup.ts";
/* D27-380: the full reset's Drive photos, tried again every hour. */
export { jobs as ownerResetJobs } from "./ownerReset.ts";
/* D27-396: two-step sign-in - server.ts asks this for every person's request. */
export { twoStepRefusal } from "./twoStep.ts";
export type { StepId, StepState, SetupStep, Setup, SetupChoice } from "./setup.ts";
export const mounts: readonly Mount[] = [
  ["/api/hotels", moduleSwitches],
  ["/api/hotels", adminLists],
  /* D27-296: before admin's own /admin/hotels/:code/:state, which would
     otherwise take "test-reset" for a state it does not know. */
  ["/api", testHotels],
  /* D27-342: the owner's full reset - before :state for the same reason. */
  ["/api", ownerReset],
  /* D27-396: two-step sign-in, the person's own and the owner's switches. */
  ["/api", twoStep],
  ["/api", admin],
  ["/api/hotels", commissioning],
  ["/api/hotels", groupSettings],
  ["/api/hotels", gallery],
  ["/api/hotels", property],
  ["/api/hotels", bankDetails],
  ["/api/hotels", systemHealth],
  /* D27-243 (5.1): the full activity log. */
  ["/api/hotels", activity],
  /* D27-311: Set up this hotel. */
  ["/api/hotels", setup],
];
