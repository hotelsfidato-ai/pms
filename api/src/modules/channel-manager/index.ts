import type { Mount } from "../../mount.ts";
import { connection } from "./connection.ts";
import { content } from "./content/routes.ts";
import { availability } from "./ari/routes.ts";
import { bookings } from "./inbound/routes.ts";
import { inbound } from "./inbound/door.ts";
export { jobs } from "./jobs.ts";

/* Part 4 (D17-79): the door SU pushes bookings through. NOT in `mounts`: it
   answers to SU's key, not a person's sign-in, so it hangs from its own prefix
   (`/api/channel`) outside the staff gate - the master's line in mount.ts and
   server.ts. */
export { inbound } from "./inbound/door.ts";

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
  ["/api/hotels", bookings],
  /* Part 4 (D17-79): the door SU pushes bookings to, on its own prefix and
     outside the staff gate. Wired by the master on 18 September. */
  ["/api/channel", inbound],
];
