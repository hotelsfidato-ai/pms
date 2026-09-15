import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Skeleton } from "@/components/ui";
import {
  ReportShell, ReportTable, ReportHead, Amount,
} from "@/components/reports/ReportShell";
import {
  getCityLedger, getNoShowReport, getLodgingTax,
  PTD_FROM, BUSINESS_DATE, type LodgingTaxRow,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   CITY LEDGER · NO SHOW · LODGING TAX

   The three statutory and reconciliation reports. All three carry
   negative numbers as a matter of course, and one of them is usually
   empty — both are correct behaviour rather than states to design
   around.
   ══════════════════════════════════════════════════════════════════ */

/* ── City Ledger ─────────────────────────────────────────────────── */

const LEDGER_COLUMNS = [
  { label: "Account Name" },
  { label: "Contact Person" },
  { label: "Phone" },
  { label: "Opening Balance", numeric: true },
  { label: "Debit (₹)", numeric: true },
  { label: "Credit (₹)", numeric: true },
  { label: "Closing Balance (₹)", numeric: true },
];

export function CityLedgerPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading } = useQuery({
    queryKey: ["city-ledger", hotelId, PTD_FROM, BUSINESS_DATE],
    queryFn: () => getCityLedger(hotelId, PTD_FROM, BUSINESS_DATE),
  });

  const rows = data ?? [];
  const totalDebit = rows.reduce((t, r) => t + r.debit, 0);
  const totalCredit = rows.reduce((t, r) => t + r.credit, 0);
  const totalClosing = rows.reduce((t, r) => t + (r.closing ?? 0), 0);

  return (
    <ReportShell
      title="City ledger"
      period={`${dateShort(PTD_FROM)} to ${dateShort(BUSINESS_DATE)}`}
      meta={`Date From ${dateShort(PTD_FROM)} To ${dateShort(BUSINESS_DATE)}   Ignore zero balance account`}
      csv={() => ({
        headers: ["Account", "Contact", "Phone", "Opening", "Debit", "Credit", "Closing"],
        /* Raw numbers, not the formatted strings on screen. An export
           somebody has to strip currency symbols out of before summing
           is an export that wasted their afternoon. */
        rows: rows.map((r) => [
          r.account, r.contact, r.phone ?? "",
          r.opening, r.debit, r.credit, r.closing ?? 0,
        ]),
      })}
    >
      {isLoading ? (
        <div className="p-5 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      ) : (
        <>
          <ReportTable>
            <ReportHead columns={LEDGER_COLUMNS} />
            <tbody>
              {rows.map((r) => (
                <tr key={r.account} className="border-b border-grey-100">
                  <td className="px-4 py-2 text-ink-900">{r.account}</td>
                  <td className="px-4 py-2 text-grey-600">{r.contact}</td>
                  <td className="px-4 py-2 text-grey-400">{r.phone ?? "—"}</td>
                  <td className="px-4 py-2 text-right"><Amount value={r.opening} format={money} /></td>
                  <td className="px-4 py-2 text-right"><Amount value={r.debit} format={money} /></td>
                  <td className="px-4 py-2 text-right"><Amount value={r.credit} format={money} /></td>
                  <td className="px-4 py-2 text-right"><Amount value={r.closing} format={money} bold /></td>
                </tr>
              ))}
              <tr className="bg-grey-50 border-t-2 border-ink-900">
                <td colSpan={4} className="px-4 py-2.5 font-semibold text-ink-900">Total</td>
                <td className="px-4 py-2.5 text-right"><Amount value={totalDebit} format={money} bold /></td>
                <td className="px-4 py-2.5 text-right"><Amount value={totalCredit} format={money} bold /></td>
                <td className="px-4 py-2.5 text-right"><Amount value={totalClosing} format={money} bold /></td>
              </tr>
            </tbody>
          </ReportTable>

          <p className="px-4 py-3 text-2xs text-grey-500 leading-relaxed border-t border-grey-200">
            A negative closing balance means the account owes the property nothing
            and the property owes them — the real export carries several. Opening
            balances predate this system and print as a dash.
          </p>
        </>
      )}
    </ReportShell>
  );
}

/* ── No Show ─────────────────────────────────────────────────────── */

const NOSHOW_COLUMNS = [
  { label: "Reference" },
  { label: "Guest" },
  { label: "Room Type" },
  { label: "Arrival" },
  { label: "Departure" },
  { label: "Source" },
  { label: "Rate", numeric: true },
];

export function NoShowPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading } = useQuery({
    queryKey: ["no-show", hotelId, BUSINESS_DATE],
    queryFn: () => getNoShowReport(hotelId, BUSINESS_DATE),
  });

  const rows = data ?? [];

  return (
    <ReportShell
      title="No show"
      period={dateShort(BUSINESS_DATE)}
      meta={`As On Date ${dateShort(BUSINESS_DATE)}`}
    >
      {isLoading ? (
        <div className="p-5"><Skeleton className="h-7 w-full" /></div>
      ) : rows.length === 0 ? (
        /* The real export for this date has no rows at all — just the
           property, the title and the date. It still prints, and it is
           not an empty state asking anyone to create something. */
        <div className="px-4 py-12 text-center">
          <p className="text-base text-grey-500">
            No no-shows recorded for {dateShort(BUSINESS_DATE)}.
          </p>
          <p className="text-2xs text-grey-400 mt-2">
            This report prints whether or not it has rows.
          </p>
        </div>
      ) : (
        <ReportTable>
          <ReportHead columns={NOSHOW_COLUMNS} />
          <tbody>
            {rows.map((r) => (
              <tr key={r.reference} className="border-b border-grey-100">
                <td className="px-4 py-2 tabular">{r.reference}</td>
                <td className="px-4 py-2">{r.guest}</td>
                <td className="px-4 py-2 text-grey-600">{r.roomType}</td>
                <td className="px-4 py-2 tabular">{dateShort(r.arrival)}</td>
                <td className="px-4 py-2 tabular">{dateShort(r.departure)}</td>
                <td className="px-4 py-2 text-grey-600">{r.source}</td>
                <td className="px-4 py-2 text-right"><Amount value={r.rate} format={money} /></td>
              </tr>
            ))}
          </tbody>
        </ReportTable>
      )}
    </ReportShell>
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
