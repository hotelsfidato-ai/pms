import type { ReactNode } from "react";
import { moneyPrecise, dateShort } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DocMasthead, DocFacts, DocTotals, DOC_TH, DOC_TD } from "@/components/ui";
import type { GroupSettings } from "@/modules/admin";
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
   printed, a dash where no GSTIN is set, and one CGST/SGST pair per rate -
   and, since 22 September, VAT on alcohol as one line per rate (D21-91).
   ══════════════════════════════════════════════════════════════════ */

/** "2.5" for 5, "9" for 18: half a GST rate, without trailing zeros. */
const half = (rate: number) => String(Math.round((rate / 2) * 100) / 100);

/** `group`: the group's name and logo from Settings (D27-53). The guest's
    own page has no sign-in to ask for them, so it prints the hotel's name alone. */
export function BillPrint({ bill, title, group }: { bill: StayBill; title: string; group?: GroupSettings }) {
  const { hotel, stay } = bill;
  const place = [hotel.address, hotel.city, hotel.state].filter(Boolean).join(", ");

  /* The CRS voucher's look (the owner, 27 September): the masthead, a
     strip of the stay's facts, the lines on hairlines, the totals under a
     2px rule. */
  return (
    <div className="bg-white text-ink-700 border border-grey-200 rounded-lg p-5 sm:p-6 [print-color-adjust:exact]" data-bill-print>
      <DocMasthead name={hotel.name} group={group?.name} logo={group?.logo} title={title} number={stay.reference} />
      <p className="-mt-2 mb-4 text-xs text-grey-500">
        {place && <>{place} · </>}GSTIN <span data-bill-gstin>{hotel.gstin ?? "-"}</span>
      </p>

      <DocFacts
        items={[
          { label: "Guest", value: stay.guest },
          { label: "Room", value: stay.room ?? "-" },
          { label: "Stay", value: `${dateShort(stay.checkIn)} – ${dateShort(stay.checkOut)}` },
        ]}
      />

      <table className="w-full mt-5">
        <thead>
          <tr>
            <th className={cn(DOC_TH, "text-left pr-2")}>Description</th>
            <th className={cn(DOC_TH, "text-right pl-2 w-32")}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((line, i) => (
            <tr key={i}>
              <td className={cn(DOC_TD, "pr-2")}>{line.description}</td>
              <td className={cn(DOC_TD, "pl-2 text-right tabular font-semibold")}>{moneyPrecise(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <DocTotals
          className="w-full sm:w-auto"
          rows={[
            ["Net", moneyPrecise(bill.net)],
            ...bill.taxes.flatMap((t): Array<[ReactNode, string]> => [
              [<span key="c" data-bill-tax-rate={t.rate}>{`CGST ${half(t.rate)}%`}</span>, moneyPrecise(t.cgst)],
              [`SGST ${half(t.rate)}%`, moneyPrecise(t.sgst)],
            ]),
            /* VAT on alcohol (D21-91): ONE line per rate, never halved into
               CGST and SGST. `?? []` because a bill drawn from an older
               answer has no such key. */
            ...(bill.vat ?? []).map((v): [ReactNode, string] => [
              <span key="v" data-bill-vat-rate={v.rate}>{`VAT ${v.rate}%`}</span>, moneyPrecise(v.vat),
            ]),
            ...(bill.roundOff !== 0 ? [["Round off", moneyPrecise(bill.roundOff)] as [ReactNode, string]] : []),
          ]}
          total={["Total", moneyPrecise(bill.rounded)]}
          after={[
            ["Paid", moneyPrecise(bill.paid)],
            ["Outstanding", moneyPrecise(bill.balance)],
          ]}
        />
      </div>
    </div>
  );
}
