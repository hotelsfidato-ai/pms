import { dateShort } from "@/lib/format";
import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { monthOf } from "@/modules/reports/data/statistics";
import type { ReportKey } from "@/modules/reports/data/document";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE STORE AND EQUIPMENT REPORTS (phase 3A; D27-238, D27-240)

   Each is the server's document drawn as every report is. A report "as
   on" a date is as on the business date; a report over a window runs from
   the 1st of the business month to the business date. Costs are as
   recorded, and the documents say so.
   ══════════════════════════════════════════════════════════════════ */

const asOn = (report: ReportKey, title: string, what: string) => () => (
  <DocumentReport report={report} title={title} what={what}
    period={dateShort(BUSINESS_DATE)} query={{ asOn: BUSINESS_DATE }} />
);

const over = (report: ReportKey, title: string, what: string) => () => {
  const from = monthOf(BUSINESS_DATE).from;
  return (
    <DocumentReport report={report} title={title} what={what}
      period={`${dateShort(from)} to ${dateShort(BUSINESS_DATE)}`}
      query={{ from, asOn: BUSINESS_DATE }} />
  );
};

export const StockOnHandPage = asOn("stock-on-hand", "Closing stock", "the closing stock");
export const StockMovementsPage = over("stock-movements", "Stock movement by day", "the stock movement");
export const StockConsumptionPage = over("stock-consumption", "Consumption", "the consumption report");
export const StockWastagePage = over("stock-wastage", "Wastage and breakage", "the wastage and breakage report");
export const StockCountDifferencesPage = over("stock-count-differences", "Count differences", "the count differences");
export const StockDeadPage = asOn("stock-dead", "Dead stock", "the dead stock report");
export const StockCoverPage = asOn("stock-cover", "Days of cover", "the days of cover");
export const SupplierSpendPage = over("supplier-spend", "Supplier spend", "the supplier spend");
export const EquipmentReportPage = asOn("equipment", "Equipment report", "the equipment report");
