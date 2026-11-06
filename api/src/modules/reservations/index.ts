import type { Mount } from "../../mount.ts";
import { groups } from "./groups.ts";
import { desk } from "./desk.ts";

/* The front door of the reservations service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", groups],
  /* New booking's two lists, and confirming a waiting booking (Phase 1). */
  ["/api/hotels", desk],
];

/* ── For a machine, in process ─────────────────────────────────────
   The channel manager turns a booking SU pushed into a real one inside its
   own transaction, so these are functions and not routes (D17-79, its
   request 6). They go through `makeBooking` - the same act, with the same
   refusals, as a booking taken at the desk - and add what only a booking
   site has: its reference, its commission, and a cancellation that is a
   cancellation rather than a void. */
/* D27-397: a guest in house cancelled, once the front desk's check-in is
   undone in the same transaction (front-desk/afterCheckIn.ts). */
export { cancelBooking } from "./desk.ts";

export {
  createChannelBooking, cancelChannelBooking, channelBookingAlreadyHere,
  isUniqueViolation,
  type ChannelBookingInput, type ChannelBookingResult,
  type ChannelCancelInput, type ChannelCancelResult,
} from "./channel.ts";
