/* The front door of the Reports service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { getPeriodStatistics, getTodaySnapshot, listDailyStatistics } from "./data/statistics";
/* Finance's Company accounts reads the City ledger report itself (the owner's
   D27-127, 28 September), through this - not a second query of its own. */
export { getReport } from "./data/document";
export type { ReportDoc } from "./data/document";
/* The Store page's "Reports" button (the stores lane): where it goes, and
   who may see it - D27-240's readers, one list for both services. */
export { mayReadStockReports, STOCK_REPORTS_PATH, STOCK_REPORT_LINKS } from "./nav";
