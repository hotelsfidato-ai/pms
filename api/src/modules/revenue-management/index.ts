import type { Mount } from "../../mount.ts";
import { pickup } from "./pickup.ts";

/* The front door of this service on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   Revenue management - pickup, pace and suggestions; it never moves a price (D18-15).

   The master made it and mounted it in `server.ts` on 18 September, empty, so
   that the chat which builds this service adds its routers HERE and never has
   to touch `server.ts` - the file every service shares, and the one a chat
   reached into that same day because its door did not exist yet.

   ⚠ THE DOOR IS NO LONGER EMPTY, 19 September. `pickup` is RM-1: the one
   thing this service was asked for and could not build, because counting
   room-nights needs the reports service's own `stay_nights` rule and that
   rule was not reachable. R1 asked, the master opened it on 18 September,
   and this router is the whole of the answer. It is a GET and it reads. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", pickup],
];
