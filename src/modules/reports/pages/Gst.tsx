import { useState } from "react";
import { FileJson } from "lucide-react";
import { useUi } from "@/lib/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { Button, Input, toast } from "@/components/ui";
import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { monthOf } from "@/modules/reports/data/statistics";
import { downloadGstr1 } from "@/modules/reports/data/document";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   GST: GSTR-1, INPUT TAX CREDIT, GST ON ADVANCES (D27-383 item 4)

   A month at a time, as the returns are filed. Reports only: nothing here
   issues or changes an invoice. Each says on its own page what the CA
   confirms (the footnotes), and the GSTR-1 file is the offline tool's JSON.
   ══════════════════════════════════════════════════════════════════ */

function useMonth() {
  return useState(BUSINESS_DATE.slice(0, 7));
}
const monthName = (m: string) => {
  const { name, year } = monthOf(`${m}-01`);
  return `${name} ${year}`;
};
const MonthPicker = ({ month, onChange }: { month: string; onChange: (m: string) => void }) => (
  <Input type="month" aria-label="Month" value={month} max={BUSINESS_DATE.slice(0, 7)}
    onChange={(e) => onChange(e.target.value)} />
);

/* The month's GSTR-1, table by table, and its file for the GST portal. */
export function Gstr1Page() {
  const [month, setMonth] = useMonth();
  const code = useUi((s) => s.hotelId);
  const role = useRole();
  const [busy, setBusy] = useState(false);
  const mayDownload = can(role, "export", "report");
  const save = async () => {
    setBusy(true);
    try {
      toast.success("GSTR-1 file saved", await downloadGstr1(code, month));
    } catch (error) {
      toast.error("The GSTR-1 file was not made", error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DocumentReport
      report="gstr-1"
      title="GSTR-1"
      period={month ? monthName(month) : "Choose the month"}
      query={month ? { month } : undefined}
      what="the GSTR-1"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={month} onChange={setMonth} />
          <Button variant="secondary" size="sm" disabled={!month || busy || !mayDownload} onClick={() => void save()}>
            <FileJson className="size-4" /> {busy ? "Saving…" : "GSTR-1 file (JSON)"}
          </Button>
          {!mayDownload && (
            <span className="text-sm text-grey-600">The file is for those who may download reports.</span>
          )}
        </div>
      }
    />
  );
}

/* The GST on the month's deliveries, as recorded: claimable and not. */
export function InputTaxCreditPage() {
  const [month, setMonth] = useMonth();
  return (
    <DocumentReport
      report="input-tax-credit"
      title="Input tax credit"
      period={month ? monthName(month) : "Choose the month"}
      query={month ? { month } : undefined}
      what="the input tax credit"
      controls={<MonthPicker month={month} onChange={setMonth} />}
    />
  );
}

/* GST on money taken before a tax invoice: received, given back, adjusted. */
export function GstAdvancesPage() {
  const [month, setMonth] = useMonth();
  return (
    <DocumentReport
      report="gst-advances"
      title="GST on advances"
      period={month ? monthName(month) : "Choose the month"}
      query={month ? { month } : undefined}
      what="the GST on advances"
      controls={<MonthPicker month={month} onChange={setMonth} />}
    />
  );
}
