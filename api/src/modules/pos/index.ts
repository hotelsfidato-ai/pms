import type { Mount } from "../../mount.ts";
import { pos, posAdmin } from "./pos.ts";
import { till } from "./till.ts";
import { tableBookings } from "./tableBookings.ts";

/* The front door of the restaurant (POS) service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", posAdmin],
  ["/api/hotels", till],
  ["/api/pos", pos],
  ["/api/hotels", tableBookings],
];

/* The auth gate in server.ts resolves an outside till's key to its outlet,
   and scripts/pos-outlet.ts issues keys and makes outlets. Both come through
   this door. */
export { outletFor, hashKey, issueKey, addOutlet, type Outlet } from "./pos.ts";

/* The night audit's restaurant figures name the dishes struck after the
   kitchen had them, from the same list Close restaurant day shows (D27-119). */
export { struckAfterKitchen } from "./till.ts";
/* And the paid bills voided that day (D27-324): who, when, why, how much -
   the same list Close restaurant day shows. */
export { voidedBills } from "./till.ts";
/* And the bills given free, NC (D27-351): who, when and why, no value. */
export { noChargeBills } from "./till.ts";
/* And their dishes at the MRP the GM typed (D27-373): the stock reports' only. */
export { noChargeAtMrp } from "./till.ts";
/* And the day's voluntary service charge and tips (264), as Close restaurant
   day shows them. */
export { serviceAndTips } from "./till.ts";
/* A waiter's request to the GM, done or refused when the GM decides it in
   the Approvals inbox (D27-363): the approvals route comes through here. */
export { performPosRequest, rejectPosRequest } from "./posRequests.ts";
/* And the day's changes of payment mode, for the night audit (D27-363). */
export { tenderChanges } from "./tenderChanges.ts";
/* What each outlet sold per day, before GST: the Store's Days view sets the
   stock issued to an outlet against it (D27-238). */
export { outletSales } from "./till.ts";
