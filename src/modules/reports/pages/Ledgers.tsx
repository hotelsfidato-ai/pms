import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Skeleton, Switch } from "@/components/ui";
import {
  ReportShell, Amount,
} from "@/modules/reports/components/ReportShell";
import { getLodgingTax, type LodgingTaxRow } from "@/modules/reports/data/reportData";
import { DocumentReport } from "@/modules/reports/components/DocumentReport";
import { PTD_FROM } from "@/modules/reports/data/statistics";
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

/* ── Lodging Tax — the statutory one ─────────────────────────────── */

/**
 * Two-level headers: CGST and SGST each span Net Amt. and Tax Amt.
 * `DataTable` cannot span columns and is a ported CRS file that must
 * not be widened for one report, so this table is bespoke — same
 * tokens, same money(), same tabular figures, separate code.
 */
export function LodgingTaxPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading } = useQuery({
    queryKey: ["lodging-tax", hotelId, PTD_FROM, BUSINESS_DATE],
    queryFn: () => getLodgingTax(hotelId, PTD_FROM, BUSINESS_DATE),
  });

  const rows = data ?? [];
  const t = (k: keyof LodgingTaxRow) =>
    Math.round(rows.reduce((s, r) => s + ((r[k] as number) ?? 0), 0) * 100) / 100;

  const th = "text-2xs font-semibold uppercase tracking-wide text-grey-500 px-3 whitespace-nowrap";
  const td = "px-3 py-2 text-right tabular whitespace-nowrap";

  return (
    <ReportShell
      title="Lodging tax"
      period={`${dateShort(PTD_FROM)} to ${dateShort(BUSINESS_DATE)}`}
      meta="Filed with authorities — the format is fixed, not ours to redesign"
      csv={() => ({
        /* The real export's own columns, in its own order. This report
           is filed with an authority: its shape is not ours to improve,
           and an accountant reconciling it against last month's should
           not have to notice anything changed. */
        headers: [
          "Date", "From bill", "To bill", "Total bill", "Total room rent",
          "Non taxable", "CGST net", "CGST tax", "SGST net", "SGST tax",
          "Service charges", "Other bills", "Less discount", "Round off",
        ],
        rows: (data ?? []).map((r) => [
          r.date, r.fromBill, r.toBill, r.totalBill, r.totalRoomRent,
          r.nonTaxable, r.cgstNet, r.cgstTax, r.sgstNet, r.sgstTax,
          r.serviceCharges, r.otherBills, r.lessDiscount, r.roundOff,
        ]),
      })}
    >
      {isLoading ? (
        <div className="p-5 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      ) : (
        <table className="w-full border-collapse text-base">
          <thead className="bg-grey-50">
            <tr className="border-b border-grey-200">
              <th rowSpan={2} className={cn(th, "text-left h-9 border-r border-grey-200")}>Date</th>
              <th rowSpan={2} className={cn(th, "text-left border-r border-grey-200")}>From Bill</th>
              <th rowSpan={2} className={cn(th, "text-left border-r border-grey-200")}>To Bill</th>
              <th rowSpan={2} className={cn(th, "text-right border-r border-grey-200")}>Total Bill</th>
              <th rowSpan={2} className={cn(th, "text-right border-r border-grey-200")}>Total Room Rent</th>
              <th rowSpan={2} className={cn(th, "text-right border-r border-grey-200")}>Non-Taxable</th>
              {/* Each tax spans two sub-columns — the reason this table is bespoke */}
              <th colSpan={2} className={cn(th, "text-center h-9 bg-brand-orange-50 border-r border-grey-200")}>
                CGST @2.5%
              </th>
              <th colSpan={2} className={cn(th, "text-center bg-brand-orange-50 border-r border-grey-200")}>
                SGST @2.5%
              </th>
              <th rowSpan={2} className={cn(th, "text-right border-r border-grey-200")}>Service Charges</th>
              <th rowSpan={2} className={cn(th, "text-right border-r border-grey-200")}>Other Bills</th>
              <th rowSpan={2} className={cn(th, "text-right border-r border-grey-200")}>Less Discount</th>
              <th rowSpan={2} className={cn(th, "text-right")}>Round-Off</th>
            </tr>
            <tr className="border-b border-grey-200">
              <th className={cn(th, "text-right h-8 bg-brand-orange-50")}>Net Amt.</th>
              <th className={cn(th, "text-right bg-brand-orange-50 border-r border-grey-200")}>Tax Amt.</th>
              <th className={cn(th, "text-right bg-brand-orange-50")}>Net Amt.</th>
              <th className={cn(th, "text-right bg-brand-orange-50 border-r border-grey-200")}>Tax Amt.</th>
            </tr>
          </thead>

          <tbody>
            {/* The real export bands its rows under a section heading. */}
            <tr>
              <td colSpan={14} className="px-3 py-2 bg-brand-yellow-50 text-2xs font-semibold uppercase tracking-wide text-[#8a6300] border-y border-grey-200">
                Check Out Bills
              </td>
            </tr>
            {rows.map((r) => (
              <tr key={r.date} className="border-b border-grey-100">
                <td className="px-3 py-2 tabular whitespace-nowrap">{dateShort(r.date)}</td>
                <td className="px-3 py-2 tabular">{r.fromBill}</td>
                <td className="px-3 py-2 tabular">{r.toBill}</td>
                <td className={td}><Amount value={r.totalBill} format={money} /></td>
                <td className={td}><Amount value={r.totalRoomRent} format={money} /></td>
                <td className={td}><Amount value={r.nonTaxable} format={money} /></td>
                <td className={td}><Amount value={r.cgstNet} format={money} /></td>
                <td className={td}><Amount value={r.cgstTax} format={money} /></td>
                <td className={td}><Amount value={r.sgstNet} format={money} /></td>
                <td className={td}><Amount value={r.sgstTax} format={money} /></td>
                <td className={td}><Amount value={r.serviceCharges} format={money} /></td>
                <td className={td}><Amount value={r.otherBills} format={money} /></td>
                <td className={td}><Amount value={r.lessDiscount} format={money} /></td>
                <td className={td}><Amount value={r.roundOff} format={money} /></td>
              </tr>
            ))}
            <tr className="bg-grey-50 border-t-2 border-ink-900">
              <td colSpan={3} className="px-3 py-2.5 font-semibold text-ink-900">TOTAL</td>
              <td className={td}><Amount value={t("totalBill")} format={money} bold /></td>
              <td className={td}><Amount value={t("totalRoomRent")} format={money} bold /></td>
              <td className={td}><Amount value={t("nonTaxable")} format={money} bold /></td>
              <td className={td}><Amount value={t("cgstNet")} format={money} bold /></td>
              <td className={td}><Amount value={t("cgstTax")} format={money} bold /></td>
              <td className={td}><Amount value={t("sgstNet")} format={money} bold /></td>
              <td className={td}><Amount value={t("sgstTax")} format={money} bold /></td>
              <td className={td}><Amount value={t("serviceCharges")} format={money} bold /></td>
              <td className={td}><Amount value={t("otherBills")} format={money} bold /></td>
              <td className={td}><Amount value={t("lessDiscount")} format={money} bold /></td>
              <td className={td}><Amount value={t("roundOff")} format={money} bold /></td>
            </tr>
          </tbody>
        </table>
      )}

      <p className="px-4 py-3 text-2xs text-grey-500 leading-relaxed border-t border-grey-200">
        Bill numbers are contiguous per day and continuous across the period. A gap
        is an audit finding, not a display quirk.
      </p>
    </ReportShell>
  );
}
