import type { Role } from "../../lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY DO WHAT WITH A REPAIR — the website's copy

   REPORT A REPAIR ON A PIECE OF EQUIPMENT — the plan's table of who may do
   what (docs/STOCK-AND-EQUIPMENT-PLAN.md § 6, approved 16 September):
   everybody who works with the things — the owner, admin, GM, Hotel
   Manager, Inventory Manager, Kitchen Manager, chef, housekeeping and
   reception. The accountant and the viewer only look.

   RECORD OR CANCEL A REPAIR COST — the owner, D17-5 (17 September): the
   Hotel Manager, Inventory Manager, GM, admin and owner. No approval, but
   never without proof (D17-6).

   SEE A COST AND OPEN ITS PROOF — the owner, 17 September: those five and
   the accountant. Everybody else sees the repair and its state, without the
   money.

   ⚠ A COPY of `api/src/modules/housekeeping/repairRoles.ts`, which is what
   actually decides. `api/test/modules/housekeeping/repairRoles.test.ts`
   fails the moment the two differ. Change both in one commit.
   ══════════════════════════════════════════════════════════════════ */

export const REPAIR_REPORTERS: readonly Role[] = [
  "owner", "admin", "gm", "hotel_manager", "stores",
  "kitchen_manager", "chef", "housekeeping", "front_desk",
];

export const COST_RECORDERS: readonly Role[] = [
  "owner", "admin", "gm", "hotel_manager", "stores",
];

export const COST_VIEWERS: readonly Role[] = [...COST_RECORDERS, "finance"];

export const reportsRepairs = (role: Role): boolean => REPAIR_REPORTERS.includes(role);
export const recordsCosts = (role: Role): boolean => COST_RECORDERS.includes(role);
export const seesCosts = (role: Role): boolean => COST_VIEWERS.includes(role);

/** Rule 6: a refusal says who CAN, so the person knows whom to ask. */
export const COST_RECORDERS_WORDS =
  "the owner, an administrator, the general manager, the hotel manager or the Inventory Manager";
