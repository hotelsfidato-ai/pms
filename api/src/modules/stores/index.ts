import type { Mount } from "../../mount.ts";
import { stores } from "./stores.ts";
import { barPours } from "./barPours.ts";
import { barSheet } from "./barSheet.ts";
import { barRequests } from "./barRequests.ts";

/* The front door of the store service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", stores],
  /* What each bar dish takes from the bar (D27-354). */
  ["/api/hotels", barPours],
  /* The bar's daily sheet and its count (D27-354). */
  ["/api/hotels", barSheet],
  /* The counter asks the store; the GM or the Inventory Manager approves (D27-361). */
  ["/api/hotels", barRequests],
];

/* ⚠ ADDED FOR PURCHASING (116), AND BY THAT CHAT — the master reviews it
   at merge. A delivery against a purchase order is a RECEIPT in this
   service's ledger, and the purchasing service must not write
   `stock_movements` itself: what may be received, into which store and by
   whom are the Store's rules, and a second writer is a second set of them.
   So the Store lends its door instead.

   `mayDeliverInto` is asked ONCE for a whole delivery, before its first
   write, because a refusal returned inside `withSession` is a COMMIT
   (MEMORY 243). */
export { receiveIntoStore, mayDeliverInto } from "./stores.ts";
/* And for Purchasing's bar bills (D27-354): the bar's store, its drinks, and
   a drink added to its list - the Store's rules, lent the same way. */
export { barStore, barDrinks, addBarDrink } from "./stores.ts";
/* A delivery's GST and expiry, checked one way for both doors in (D27-238):
   Purchasing asks it for every line before its first write. */
export { deliveryFactsProblem } from "./stores.ts";
