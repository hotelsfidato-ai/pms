/* The front door of the Channel manager service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */

/* SU's booking-site codes, for Booking sources' pick-list (guests, D27-183). */
export { SU_CHANNELS, suChannelName } from "./data/suChannels";
