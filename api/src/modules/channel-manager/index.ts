import type { Mount } from "../../mount.ts";
import { connection } from "./connection.ts";

/* The front door of the channel manager on the server — the only file the core
   or another service may import (src/test/boundaries.test.ts).

   The master made it and mounted it in `server.ts` on 17 September, when the
   owner chose SU and asked for the connection to be built (D17-66), so the
   channel-manager chat adds its routers here and never has to touch
   `server.ts`, which every service shares.

   Part 1 (token login): `connection` — is SU set up, and does its login work. */
export const mounts: readonly Mount[] = [
  ["/api", connection],
];
