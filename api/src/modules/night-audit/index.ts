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
