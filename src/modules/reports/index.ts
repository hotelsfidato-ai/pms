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
/* PDF and Excel on every list screen (D27-383 item 1): one button pair, one route. */
export { ExportButtons } from "./components/ExportButtons";
export type { ExportColumn, ExportFacts } from "./data/listExport";
/* The real hotels a person may ask a group question of, by role (D27-383
   item 6): the inventory service's Group rate change offers the same. */
export { hotelsWhere, useHotelsWhere } from "./groupHotels";
