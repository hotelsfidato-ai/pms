import type { Mount } from "../../mount.ts";

/* The front door of the equipment service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).

   EMPTY ON PURPOSE. The master made it and mounted it in `server.ts` on
   16 September, before phase 1B, so the equipment chat adds its router
   here and never has to touch `server.ts`, which every service shares.
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [];
