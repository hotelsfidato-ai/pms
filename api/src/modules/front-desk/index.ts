import type { Mount } from "../../mount.ts";
import { stays } from "./stays.ts";
import { operations } from "./operations.ts";
import { stayExtras } from "./stayExtras.ts";
import { lists } from "./lists.ts";
import { afterCheckIn } from "./afterCheckIn.ts";

/* The front door of the front desk service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", stays],
  ["/api/hotels", operations],
  ["/api/hotels", stayExtras],
  /* Phase 5 of the settings plan (D27-260): the lists and the desk's settings. */
  ["/api/hotels", lists],
  /* D27-397: undo a check-in, cancel a guest in house, and the desk's requests to the GM. */
  ["/api/hotels", afterCheckIn],
];

/* The front desk's request behind an approval, done or rejected by the GM
   (routes/approvals.ts), as the restaurant's is (D27-363). */
export { performStayRequest, rejectStayRequest } from "./afterCheckIn.ts";
