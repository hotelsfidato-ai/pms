/* The front door of the Reservations service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { listGroupMembers, listGroups } from "./data/groups";
export { GROUP_ROOMS_ID, GroupRoomsList } from "./flows/GroupRoomsPanel";
/* A booking waiting for the hotel is confirmed from its panel (Phase 1).
   The market segments are one list, the walk-in's too (the master, 27 Sep). */
export { confirmWaiting, MARKET_SEGMENTS } from "./data/booking";
