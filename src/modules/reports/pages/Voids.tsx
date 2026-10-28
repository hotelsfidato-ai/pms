import { useState } from "react";
import { dateShort } from "@/lib/format";
import { Input } from "@/components/ui";
import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { monthOf } from "@/modules/reports/data/statistics";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   VOIDS (the owner's D27-370)

   The restaurant's voided bills, orders closed unpaid and struck dishes
   over a range of days, by outlet and day. The range starts as the
   business month so far; the server builds the one document, so the screen,
   the PDF and the Excel cannot disagree.
   ══════════════════════════════════════════════════════════════════ */

export default function VoidsPage() {
  const [from, setFrom] = useState(monthOf(BUSINESS_DATE).from);
  const [to, setTo] = useState(BUSINESS_DATE);
  /* A cleared box asks for nothing odd: it falls back to the default end of the range. */
  const first = from || monthOf(BUSINESS_DATE).from;
  const last = to || BUSINESS_DATE;
  return (
    <DocumentReport
      report="voids"
      title="Voids"
      period={`${dateShort(first)} to ${dateShort(last)}`}
      query={{ from: first, asOn: last }}
      what="the voids report"
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
