import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { dateShort } from "@/lib/format";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   NIGHT AUDIT REPORT

   The printed proof of a day, in the owner's eZee layout (D17-62): the
   rooms charged and the complimentary ones, who checked out, the day's
   sales by type, every receipt, the miscellaneous charges, the room and
   pax counts and the restaurant. The owner's decision of 17 September:
   it lives in All reports, and the Night audit screen - where the audit
   is run - is unchanged.
   ══════════════════════════════════════════════════════════════════ */

export default function NightAuditReportPage() {
  return (
    <DocumentReport
      report="night-audit"
      title="Night audit report"
      period={`As on ${dateShort(BUSINESS_DATE)}`}
      query={{ asOn: BUSINESS_DATE }}
      what="the night audit report"
    />
  );
}
