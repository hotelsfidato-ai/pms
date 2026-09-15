import type { Mount } from "../../mount.ts";
import { directory } from "../../routes/directory.ts";
import { bookingSources } from "../../routes/bookingSources.ts";

/* The front door of the guests and companies service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", directory],
  ["/api/hotels", bookingSources],
];
