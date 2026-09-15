/* The front door of the Administration service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export type { HomeScreen, RoomGrouping } from "./data/admin";
export { CommissioningCard } from "./flows/CommissioningCard";
