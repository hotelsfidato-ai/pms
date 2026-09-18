import type { Mount } from "../../mount.ts";
import { laundry } from "./laundry.ts";

/* The front door of this service on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   Laundry - a guest's bag and the hotel's own linen, every docket saying whose it is (D18-5).

   The master made it and mounted it in `server.ts` on 18 September, empty, so
   that the chat which builds this service adds its routers HERE and never has
   to touch `server.ts` - the file every service shares, and the one a chat
   reached into that same day because its door did not exist yet. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", laundry],
];
