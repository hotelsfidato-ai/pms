import type { Mount } from "../../mount.ts";
import { connection } from "./connection.ts";
import { content } from "./content/routes.ts";
import { availability } from "./ari/routes.ts";
export { jobs } from "./jobs.ts";

/* The front door of the channel manager on the server — the only file the core
   or another service may import (src/test/boundaries.test.ts).

   The master made it and mounted it in `server.ts` on 17 September, when the
   owner chose SU and asked for the connection to be built (D17-66), so the
   channel-manager chat adds its routers here and never has to touch
   `server.ts`, which every service shares.

   Part 1 (token login): `connection` — is SU set up, and does its login work.
   Part 2 (content): `content` — a hotel's SU id, its room types and rate plans
   mapped, and sent to SU.
   Part 3 (rates and availability): `availability` — rooms left, prices and
   restrictions sent to SU on demand, all dates or only what changed; and `jobs`,
   which server.ts starts after listen: the same changes push every minute for
   each hotel that is due. */
export const mounts: readonly Mount[] = [
  ["/api", connection],
  ["/api/hotels", content],
  ["/api/hotels", availability],
];
