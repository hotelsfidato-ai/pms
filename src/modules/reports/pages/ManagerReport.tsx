import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { dateShort } from "@/lib/format";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   MANAGER REPORT

   The daily flash, in the owner's eZee layout (D17-62): Today, PTD and
   YTD in every section, in the export's order, with its footnotes. Built
   on the server as one document (api/src/modules/reports/builders/
   manager.ts), where every figure's source is written down once, and
   drawn by ReportView. A "-" is a figure this system does not hold; the
   footnote says so.
   ══════════════════════════════════════════════════════════════════ */

export default function ManagerReportPage() {
  return (
    <DocumentReport
      report="manager"
      title="Manager report"
      period={`As on ${dateShort(BUSINESS_DATE)}`}
      query={{ asOn: BUSINESS_DATE }}
      what="the manager report"
    />
  );
}
