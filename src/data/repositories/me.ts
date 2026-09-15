import type { HomeScreen, RoomGrouping } from "@/lib/api";
import type { AdminResult } from "./result";
import { put } from "./http";
/* A person's own preferences.

   Service: core. Moved out of admin.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/** A person's own preferences. Any one may be sent alone. */
export function setMyPreferences(
  prefs: { homeScreen?: HomeScreen; roomGrouping?: RoomGrouping; startHereDismissed?: boolean },
): Promise<AdminResult> {
  return put(`/api/me/preferences`, prefs);
}
