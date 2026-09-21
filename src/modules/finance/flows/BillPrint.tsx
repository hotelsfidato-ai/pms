import { moneyPrecise, dateShort } from "@/lib/format";
import type { StayBill } from "../data/bill";

/* ══════════════════════════════════════════════════════════════════
   THE PRINTED BILL — one layout, for the desk and the guest (D21-10)

   It draws the bill `app.stay_bill` answers (migration 123) and computes
   nothing: every figure, every tax row and the rounding arrive from the
   server. The desk prints it from the Bill tab; the guest's page shows the
   same component, so "exactly the bill the desk prints" is true by
   construction, not by keeping two copies in step.

   ⚠ WHAT IT REPLACED, 21 September: the desk's print carried fixed text —
   "5 Elements By Fidato Hotels · Akkalkot · GSTIN 27AAAAA0000A1Z5", the
   demo's made-up number, at every hotel — and "CGST 2.5% / SGST 2.5%"
   whatever the lines were taxed at. Now the hotel's own name and GSTIN are
   printed, a dash where no GSTIN is set, and one CGST/SGST pair per rate.
   ══════════════════════════════════════════════════════════════════ */

/** "2.5" for 5, "9" for 18: half a GST rate, without trailing zeros. */
const half = (rate: number) => String(Math.round((rate / 2) * 100) / 100);

export function BillPrint({ bill, title }: { bill: StayBill; title: string }) {
  const { hotel, stay } = bill;
  const place = [hotel.address, hotel.city, hotel.state].filter(Boolean).join(", ");

  return (
    /* Georgia is retained for printed documents, and only there. */
    <div className="print-serif bg-white border border-grey-200 rounded-md p-6" data-bill-print>
      <p className="text-xl text-ink-900">{title}</p>
      <p className="text-base text-grey-600" data-bill-hotel>{hotel.name}</p>
      <p className="text-xs text-grey-500 mt-1">
        {place && <>{place} · </>}GSTIN <span data-bill-gstin>{hotel.gstin ?? "-"}</span>
      </p>

      <div className="mt-5 pt-4 border-t border-grey-200 space-y-1 text-base">
        <Row label="Guest" value={stay.guest} />
        <Row label="Room" value={stay.room ?? "-"} />
        <Row label="Stay" value={`${dateShort(stay.checkIn)} – ${dateShort(stay.checkOut)}`} />
        <Row label="Booking" value={stay.reference} />
      </div>

      <ul className="mt-4 pt-4 border-t border-grey-200 space-y-1.5">
        {bill.lines.map((line, i) => (
          <li key={i} className="flex justify-between gap-4 text-base">
            <span className="text-grey-700 min-w-0">{line.description}</span>
            <span className="tabular shrink-0">{moneyPrecise(line.amount)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-grey-200 space-y-1">
        <Row label="Net" value={moneyPrecise(bill.net)} />
        {bill.taxes.map((t) => (
          <div key={t.rate} data-bill-tax-rate={t.rate}>
            <Row label={`CGST ${half(t.rate)}%`} value={moneyPrecise(t.cgst)} muted />
            <Row label={`SGST ${half(t.rate)}%`} value={moneyPrecise(t.sgst)} muted />
          </div>
        ))}
        {bill.roundOff !== 0 && (
          <Row label="Round off" value={moneyPrecise(bill.roundOff)} muted />
        )}
        <div className="pt-1.5 border-t border-grey-200">
          <Row label="Total" value={moneyPrecise(bill.rounded)} bold />
        </div>
        <Row label="Paid" value={moneyPrecise(bill.paid)} muted />
        <Row label="Outstanding" value={moneyPrecise(bill.balance)} muted />
      </div>
    </div>
  );
}

function Row({
  label, value, muted, bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className={muted ? "text-grey-500" : "text-grey-700"}>{label}</span>
      <span className={`tabular ${bold ? "font-semibold text-ink-900" : muted ? "text-grey-500" : "text-ink-900"}`}>
        {value}
      </span>
    </div>
  );
}
