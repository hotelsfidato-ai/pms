/* The front door of the Restaurant (POS) service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { unitPriceOf } from "./lib/pricing";

/* In-room dining (D27-224): the guest's page picks a dish's choices in the
   waiter's own pop-up (Q2), with `guest` hiding the per-dish note. */
export { DishDialog } from "./flows/DishDialog";
export type { MenuItem } from "./data/till";
/* D27-348: Settings › Documents draws a sample restaurant bill. */
export { BillSlip } from "./components/BillSlip";
export type { Order } from "./data/till";
