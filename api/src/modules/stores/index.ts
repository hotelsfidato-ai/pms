import type { Mount } from "../../mount.ts";
import { stores } from "./stores.ts";

/* The front door of the store service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", stores],
];

/* ⚠ ADDED FOR PURCHASING (115), AND BY THAT CHAT — the master reviews it
   at merge. A delivery against a purchase order is a RECEIPT in this
   service's ledger, and the purchasing service must not write
   `stock_movements` itself: what may be received, into which store and by
   whom are the Store's rules, and a second writer is a second set of them.
   So the Store lends its door instead.

   `mayDeliverInto` is asked ONCE for a whole delivery, before its first
   write, because a refusal returned inside `withSession` is a COMMIT
   (MEMORY 243). */
export { receiveIntoStore, mayDeliverInto } from "./stores.ts";
