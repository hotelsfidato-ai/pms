/* The front door of Guest messages. New booking's Booked card (Phase 1)
   reads what was sent about a booking - the voucher, when and by whom -
   the same way this service's own screen does. */
export { getGuestMessages, type GuestMessages, type SentMessage } from "./data/guestMessages";
