/* Relative, not "@/": the API's test imports this file, and the API's
   type check has no "@" alias (housekeeping's repairRoles.ts, the same). */
import type { Role } from "../../lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY SWITCH A MODULE ON OR OFF — on the screen

   The owner's decision of 17 September (D17-36): the general manager may
   open Settings, and the module switches — Point of sale, Banquet hall,
   "Reception can use the POS" — stay with the owner and an administrator.

   Not a grant in `src/lib/permissions.ts`: after D17-36 the owner, the
   administrator and the GM all hold `setting`, so the matrix cannot tell
   the switches' people from the page's. The one list is here.

   ⚠ THE SERVER HOLDS A COPY — `MODULE_SWITCH_ROLES` in
   `api/src/modules/admin/grants.ts`, which the switch route asks.
   `api/test/modules/admin/moduleSwitches.test.ts` imports this file and
   fails the moment the two differ. Change both in one commit.

   A group administrator counts as the owner, as everywhere (`roleFor`).
   ══════════════════════════════════════════════════════════════════ */

export const MODULE_SWITCH_ROLES: readonly Role[] = ["owner", "admin"];

export const switchesModules = (role: Role): boolean =>
  MODULE_SWITCH_ROLES.includes(role);
