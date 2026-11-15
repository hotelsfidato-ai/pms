import { useState } from "react";
import { dateShort } from "@/lib/format";
import { Input } from "@/components/ui";
import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { monthOf } from "@/modules/reports/data/statistics";
import { BUSINESS_DATE } from "@/data/repositories";
import type { ReportKey } from "@/modules/reports/data/document";

/* ══════════════════════════════════════════════════════════════════
   VOIDS (the owner's D27-370)

   The restaurant's voided bills, orders closed unpaid and struck dishes
   over a range of days, by outlet and day. The range starts as the
   business month so far; the server builds the one document, so the screen,
   the PDF and the Excel cannot disagree. NC bills and Item sales (the
   owner, 16 November) are the restaurant's other two over a range of days,
   and read the same way.
   ══════════════════════════════════════════════════════════════════ */

export default function VoidsPage() {
  return <WindowReport report="voids" title="Voids" what="the voids report" />;
}
export const NcBillsPage = () => <WindowReport report="nc-bills" title="NC bills" what="the NC bills" />;
export const ItemSalesPage = () => <WindowReport report="item-sales" title="Item sales" what="the item sales" />;

/** A report over From-To; it opens on the month so far unless `start` says otherwise. */
export function WindowReport({ report, title, what, start = monthOf(BUSINESS_DATE).from }: {
  report: ReportKey; title: string; what: string; start?: string;
}) {
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(BUSINESS_DATE);
  /* A cleared box asks for nothing odd: it falls back to the default end of the range. */
  const first = from || start;
  const last = to || BUSINESS_DATE;
  return (
    <DocumentReport
      report={report}
      title={title}
      period={first === last ? dateShort(last) : `${dateShort(first)} to ${dateShort(last)}`}
      query={{ from: first, asOn: last }}
      what={what}
      controls={
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-grey-600 flex flex-col gap-1">
            From
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm text-grey-600 flex flex-col gap-1">
            To
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      }
    />
  );
}
