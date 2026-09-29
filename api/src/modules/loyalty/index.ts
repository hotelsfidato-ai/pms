import type { Mount } from "../../mount.ts";
import { loyalty } from "./loyalty.ts";

/* The front door of the loyalty service on the server - the only file the
   core or another service may import (src/test/boundaries.test.ts). */
export const mounts: readonly Mount[] = [["/api/hotels", loyalty]];

/* Points at check-out (D27-179, L9): the front desk's check-out calls it
   once, in its own transaction, after the stay is checked out. */
export { earnAtCheckOut } from "./loyalty.ts";
