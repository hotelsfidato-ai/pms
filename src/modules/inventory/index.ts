/* The front door of the Inventory and rates service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { getInventory, getTariff } from "./data/rates";
export type { Tariff } from "./data/rates";
/* The front desk's hours and charges, shown on Settings > Configuration (D27-194). */
export { FrontDeskCard } from "./components/FrontDeskCard";
