import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { dateShort } from "@/lib/format";
import { api } from "@/lib/api";
import { useUi } from "@/lib/ui";
import { Input, NativeSelect, Switch } from "@/components/ui";
import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { getReport } from "@/modules/reports/data/document";
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

/* ── Money owed by age, a statement of account (D27-383) ──────────── */

/* What each company, agent and booking site owed on a date, by how old each
   bill is - the City ledger's own figures. */
export function DuesByAgePage() {
  const [asOn, setAsOn] = useState(BUSINESS_DATE);
  return (
    <DocumentReport
      report="dues-by-age"
      title="Money owed by age"
      period={asOn ? `Owed on ${dateShort(asOn)}` : "Choose the date"}
      query={asOn ? { asOn } : undefined}
      what="the money owed by age"
      controls={<Input type="date" aria-label="Owed on" value={asOn} max={BUSINESS_DATE} onChange={(e) => setAsOn(e.target.value)} />}
    />
  );
}

/* One account's statement for the days chosen. The account comes from the
   address (Company accounts links here) or the list: every account the City
   ledger has ever named, zero balances included. */
export function CompanyStatementPage() {
  const code = useUi((s) => s.hotelId);
  const [params, setParams] = useSearchParams();
  const account = params.get("account") ?? "";
  const [from, setFrom] = useState(monthOf(BUSINESS_DATE).from);
  const [to, setTo] = useState(BUSINESS_DATE);
  const accounts = useQuery({
    queryKey: ["report", "city-ledger", code, "accounts"],
    queryFn: () => getReport(code, "city-ledger", { asOn: BUSINESS_DATE, from: BUSINESS_DATE, ignoreZero: false }),
    enabled: Boolean(code),
  });
  const names = (accounts.data?.sections[0]?.rows ?? [])
    .filter((r) => r.kind === "row" && typeof r.cells["account"] === "string")
    .map((r) => r.cells["account"] as string);
  const ok = Boolean(account && from && to && from <= to);
  return (
    <DocumentReport
      report="company-statement"
      title={account ? `Statement: ${account}` : "Statement of account"}
      period={ok ? `${dateShort(from)} to ${dateShort(to)}` : "Pick an account and the days"}
      query={ok ? { from, asOn: to, account } : undefined}
      what="the statement of account"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="Account" value={account}
            onChange={(e) => setParams(e.target.value ? { account: e.target.value } : {}, { replace: true })}>
            <option value="">Pick an account</option>
            {[...new Set([...names, ...(account ? [account] : [])])].map((n) => <option key={n} value={n}>{n}</option>)}
          </NativeSelect>
          <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
      }
    />
  );
}

/* ── Commission owed (D27-383) ─────────────────────────────────────── */

/* The bookings from booking sites and agents that checked out in the days
   chosen, and the commission each owes. */
export function CommissionPage() {
  const [from, setFrom] = useState(monthOf(BUSINESS_DATE).from);
  const [to, setTo] = useState(BUSINESS_DATE);
  const ok = Boolean(from && to && from <= to);
  return (
    <DocumentReport
      report="commission"
      title="Commission owed"
      period={ok ? `Checked out ${dateShort(from)} to ${dateShort(to)}` : "Choose the days"}
      query={ok ? { from, asOn: to } : undefined}
      what="the commission owed"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
      }
    />
  );
}

/* ── TDS and the supplier statement (D27-372) ────────────────────── */

/* The TDS deducted from suppliers, by section and supplier, for the days
   chosen: the quarterly return's (26Q) figures. */
export function TdsPage() {
  const [from, setFrom] = useState(monthOf(BUSINESS_DATE).from);
  const [to, setTo] = useState(BUSINESS_DATE);
  const ok = Boolean(from && to && from <= to);
  return (
    <DocumentReport
      report="tds"
      title="TDS on supplier payments"
      period={ok ? `${dateShort(from)} to ${dateShort(to)}` : "Choose the days"}
      query={ok ? { from, asOn: to } : { from: BUSINESS_DATE, asOn: BUSINESS_DATE }}
      what="the TDS deducted"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
      }
    />
  );
}

/* One supplier's ledger for the days chosen: opening balance, each bill,
   payment, TDS, credit note and reversal, a running balance, the closing
   balance. The supplier comes from the address (Supplier dues links here) or
   the list; the list is the hotel's suppliers, asked of purchasing's own API. */
export function SupplierStatementPage() {
  const code = useUi((s) => s.hotelId);
  const [params, setParams] = useSearchParams();
  const supplier = params.get("supplier") ?? "";
  const [from, setFrom] = useState(monthOf(BUSINESS_DATE).from);
  const [to, setTo] = useState(BUSINESS_DATE);
  const suppliers = useQuery({
    queryKey: ["supplier-list", code],
    queryFn: async () => (await api<{ suppliers: { id: string; name: string }[] }>(`/api/hotels/${code}/purchasing/dues`)).suppliers,
    enabled: Boolean(code),
  });
  const ok = Boolean(supplier && from && to && from <= to);
  const name = suppliers.data?.find((s) => s.id === supplier)?.name;
  return (
    <DocumentReport
      report="supplier-statement"
      title={name ? `Statement: ${name}` : "Supplier statement"}
      period={ok ? `${dateShort(from)} to ${dateShort(to)}` : "Pick a supplier and the days"}
      query={ok ? { from, asOn: to, supplier } : undefined}
      what="the supplier's statement"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="Supplier" value={supplier}
            onChange={(e) => setParams(e.target.value ? { supplier: e.target.value } : {}, { replace: true })}>
            <option value="">Pick a supplier</option>
            {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
          <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
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
