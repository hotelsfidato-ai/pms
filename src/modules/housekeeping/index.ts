/* The front door of the Housekeeping service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */

/* Phase 2B, 17 September: a piece of equipment's repairs, on its own page —
   where the kitchen and reception, who have no Work orders menu, report one
   too. The equipment service renders it; repairs stay housekeeping's. */
export { ItemRepairs, type ItemRepairsProps } from "./components/ItemRepairs";
