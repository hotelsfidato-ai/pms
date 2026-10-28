import { useState } from "react";
import { dateShort } from "@/lib/format";
import { Input, Switch } from "@/components/ui";
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

/* ── Petty cash (D27-370) ─────────────────────────────────────────── */

/* Every paid-out, the restaurant's and the front desk's, from the 1st of the
   month to the business date, or the days chosen. */
export function PettyCashPage() {
  const [from, setFrom] = useState(monthOf(BUSINESS_DATE).from);
  const [to, setTo] = useState(BUSINESS_DATE);
  const ok = Boolean(from && to && from <= to);
  return (
    <DocumentReport
      report="petty-cash"
      title="Petty cash"
      period={ok ? `${dateShort(from)} to ${dateShort(to)}` : "Choose the days"}
      query={ok ? { from, asOn: to } : { from: BUSINESS_DATE, asOn: BUSINESS_DATE }}
      what="the petty cash book"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
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
