import { useState } from "react";
import { dateShort } from "@/lib/format";
import { Switch } from "@/components/ui";
import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { monthOf } from "@/modules/reports/data/statistics";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   CITY LEDGER · NO SHOW · LODGING TAX

   The three statutory and reconciliation reports. All three carry
   negative numbers as a matter of course, and one of them is usually
   empty — both are correct behaviour rather than states to design
   around.
   ══════════════════════════════════════════════════════════════════ */

/* ── Supplier dues (D27-370) ─────────────────────────────────────── */

/* What we owed each supplier on the business date, and what was paid from
   the 1st of its month to it. */
export function SupplierDuesPage() {
  const from = monthOf(BUSINESS_DATE).from;
  return (
    <DocumentReport report="supplier-dues" title="Supplier dues" what="the supplier dues"
      period={`Owed on ${dateShort(BUSINESS_DATE)} · paid ${dateShort(from)} to ${dateShort(BUSINESS_DATE)}`}
      query={{ from, asOn: BUSINESS_DATE }} />
  );
}

/* ── City Ledger ─────────────────────────────────────────────────── */

/* The bills transferred to a company or booking site (the owner's
   decision of 17 September). eZee's defaults: the one day, and accounts
   with nothing on them left out, which the switch puts back. */
export function CityLedgerPage() {
  const [ignoreZero, setIgnoreZero] = useState(true);
  return (
    <DocumentReport
      report="city-ledger"
      title="City ledger"
      period={dateShort(BUSINESS_DATE)}
      query={{ asOn: BUSINESS_DATE, from: BUSINESS_DATE, ignoreZero }}
      what="the city ledger"
      controls={
        <Switch
          checked={ignoreZero}
          onCheckedChange={setIgnoreZero}
          label="Ignore zero balance account"
        />
      }
    />
  );
}

/* ── No Show ─────────────────────────────────────────────────────── */

/* The owner's export for 25 August 2026 has no rows at all: the
   property, the title and the date. It still prints, and it says that
   nobody failed to arrive rather than asking anyone to create something. */
export function NoShowPage() {
  return (
    <DocumentReport
      report="no-show"
      title="No show"
      period={dateShort(BUSINESS_DATE)}
      query={{ asOn: BUSINESS_DATE }}
      what="the no show report"
    />
  );
}

/* ── Lodging Tax - the statutory one ──────────────────────────────── */

/* Filed with an authority, so its shape is not ours to improve: an
   accountant reconciling it against last month's should not have to
   notice anything changed. The month is the business date's (REP-1). */
export function LodgingTaxPage() {
  const month = monthOf(BUSINESS_DATE);
  return (
    <DocumentReport
      report="lodging-tax"
      title="Lodging tax"
      period={`${month.name} ${month.year}`}
      query={{ month: month.from.slice(0, 7) }}
      what="the lodging tax report"
    />
  );
}
