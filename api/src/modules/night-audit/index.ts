import type { Mount } from "../../mount.ts";
import { checklist } from "./checklist.ts";
import { nightAudit } from "./nightAudit.ts";

/* The front door of the night audit service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", checklist],
  ["/api/hotels", nightAudit],
];

/* A closed day's charge put right, one correction for every caller: the
   Closed days screen and a stay's Change rate (finance, D27-162). */
export { correctClosedCharge } from "./nightAudit.ts";

/* One night's room charge, one definition (D27-204): the audit's run,
   the check-in's first night (front desk) and the printed bill's "to be
   posted tonight" (finance). */
export { roomNightsDue, postRoomNight, roomNightWords, nightsToCome } from "./roomNight.ts";
/* An early leaver's new departure, by the same rule (D27-315, front desk). */
export { leavingEarly, type LeavingEarly } from "./roomNight.ts";
/* Where a line first came from, through corrections (139): the bill's
   sections place a corrected fee by it (D27-223). */
export { ORIGIN } from "./nightAudit.ts";
