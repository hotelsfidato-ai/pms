/* The front door of the Reports service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { getCityLedger } from "./data/reportData";
export type { CityLedgerRow } from "./data/reportData";
export { getPeriodStatistics, getTodaySnapshot, listDailyStatistics } from "./data/statistics";
