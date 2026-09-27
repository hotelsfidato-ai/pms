import type { Mount } from "../../mount.ts";
import { guestMessages } from "./messages.ts";
import { voucher } from "./voucher.ts";

/* The front door of this service on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   Guest messages - the booking confirmation with the check-in link, and a record of what was sent (D18-11, D18-12).

   The master made it and mounted it in `server.ts` on 18 September, empty, so
   that the chat which builds this service adds its routers HERE and never has
   to touch `server.ts` - the file every service shares, and the one a chat
   reached into that same day because its door did not exist yet. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", guestMessages],
  /* Send voucher (D27-35): the booking confirmation, now, from the desk. */
  ["/api/hotels", voucher],
];

/* THE SWEEP, and it is NOT started here. `server.ts` (the master's file)
   starts it at merge, beside the channel manager's - one line to start, one
   to stop - and it does nothing at all until the owner switches sending on
   (D21-76): the n8n settings and the owner's pace both have to be there.

   It reads and mints through the two SECURITY DEFINER functions of "what the
   guest is owed", because a job has no staff session and `reservations` and
   `guest_links` are FORCE row-secured on `app.auth_hotel_ids()`. */
export {
  jobs, runOnce, channelFor, messageFor, KIND, CONFIRM_WITHIN_HOURS, MOST_ATTEMPTS,
  type Due, type Limits, type ListDue, type MakeLink,
  type MessageKind, type SweepResult,
} from "./jobs.ts";

/* For the screen, and for anybody who needs the desk's word for a kind
   rather than the word the sender files it under. */
export { kindWords, KIND_WORDS } from "./messages.ts";
