import type { Mount } from "../../mount.ts";

/* The front door of this service on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   Online check-in - the staff side of the guest's own page (D18-10). The guest's door itself is the master's: api/src/routes/guestDoor.ts.

   The master made it and mounted it in `server.ts` on 18 September, empty, so
   that the chat which builds this service adds its routers HERE and never has
   to touch `server.ts` - the file every service shares, and the one a chat
   reached into that same day because its door did not exist yet. */
export const mounts: readonly Mount[] = [];
