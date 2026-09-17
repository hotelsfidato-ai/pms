import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { monthOf } from "@/modules/reports/data/statistics";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   MONTHLY OCCUPANCY · MONTHLY STATISTICS · YEARLY STATISTICS

   In the owner's eZee layout (D17-62), built on the server as one
   document each (api/src/modules/reports/builders/statistics.ts) and
   drawn by ReportView. The month and the year are the business date's
   (REP-1): nothing here is typed in.
   ══════════════════════════════════════════════════════════════════ */

export function MonthlyOccupancyPage() {
  const month = monthOf(BUSINESS_DATE);
  return (
    <DocumentReport
      report="monthly-occupancy"
      title="Monthly occupancy"
      period={`${month.name} ${month.year}`}
      query={{ month: month.from.slice(0, 7) }}
      what="monthly occupancy"
    />
  );
}

export function MonthlyStatisticsPage() {
  const month = monthOf(BUSINESS_DATE);
  return (
    <DocumentReport
      report="monthly-statistics"
      title="Monthly statistics"
      period={`${month.name} ${month.year}`}
      query={{ month: month.from.slice(0, 7) }}
      what="monthly statistics"
    />
  );
}

export function YearlyStatisticsPage() {
  const { year } = monthOf(BUSINESS_DATE);
  return (
    <DocumentReport
      report="yearly-statistics"
      title="Yearly statistics"
      period={String(year)}
      query={{ year }}
      what="yearly statistics"
    />
  );
}
