/* Leads and WhatsApp's front door (src/test/boundaries.test.ts): the one
   file another service may import from here.

   For New booking (the one-page lane): "Book this lead" opens
   /h/:code/book?lead=<token>. New booking reads the token with
   fetchLeadForBooking and pre-fills the guest's name and phone, the booking
   source by the lead's channel, and the campaign the booking keeps
   (reservations.campaign). The token is opaque, 2 hours, this hotel only;
   an expired one, or an enquiry erased in the leads app, answers 404 with a
   sentence to show. */
export { fetchLeadForBooking, bookingPathFor, type LeadForBooking } from "./data/leads";
