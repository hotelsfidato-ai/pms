import type { Mount } from "../../mount.ts";
import { stores } from "./stores.ts";

/* The front door of the store service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", stores],
];
