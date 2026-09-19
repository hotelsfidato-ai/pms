import type { Mount } from "../../mount.ts";
import { guestMessages } from "./messages.ts";

/* The front door of this service on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   Guest messages - the booking confirmation with the check-in link, and a record of what was sent (D18-11, D18-12).

   The master made it and mounted it in `server.ts` on 18 September, empty, so
   that the chat which builds this service adds its routers HERE and never has
   to touch `server.ts` - the file every service shares, and the one a chat
   reached into that same day because its door did not exist yet. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", guestMessages],
];

/* ⚠ THERE IS NO `jobs` HERE YET, AND THAT IS THE HONEST STATE.

   The channel manager exports one and `server.ts` calls `jobs.start()`;
   this service will do the same, and that one line in the master's file is
   a merge-time step like R2 was. It is not asked for yet, because the sweep
   it would start cannot read a booking: a job has no staff session, and
   `reservations` and `guest_links` are both FORCE row-secured on
   `app.auth_hotel_ids()`. Both need a SECURITY DEFINER function, the way
   `messages_sent` needed `app.record_message_sent` in migration 117, and
   that migration is asked for and not yet given (19 September).

   A timer started over an empty list would be machinery pretending to work.
   What `jobs.ts` holds is the DECIDING - which bookings are due, which way
   each goes, when to stop trying - and it is proved against fakes. */
export {
  runOnce, channelFor, messageFor, KIND, CONFIRM_WITHIN_HOURS, MOST_ATTEMPTS,
  type Due, type Limits, type ListDue, type MakeLink,
  type MessageKind, type SweepResult,
} from "./jobs.ts";

/* For the screen, and for anybody who needs the desk's word for a kind
   rather than the word the sender files it under. */
export { kindWords, KIND_WORDS } from "./messages.ts";
