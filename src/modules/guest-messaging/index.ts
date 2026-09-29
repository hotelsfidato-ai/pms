/* The front door of Guest messages. New booking's Booked card (Phase 1)
   reads what was sent about a booking - the voucher, when and by whom -
   the same way this service's own screen does. */
export { getGuestMessages, type GuestMessages, type SentMessage } from "./data/guestMessages";
/* Send check-in link (D27-105): the button, for the booking's own screens
   to place - the lane that owns each screen adds the one line. */
export { SendCheckInLink } from "./SendCheckInLink";
