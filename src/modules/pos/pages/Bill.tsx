import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise, dateLong } from "@/lib/format";
import { getOrder } from "@/modules/pos/data/till";
import {
  ReadFailed, Button, DocMasthead, DocFacts, DocTotals, DocPanel, DocFooter, DOC_TD,
} from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   THE BILL — what the guest is handed

   Thermal-roll width (80mm), because that is what a restaurant
   printer takes. It prints from the browser; there is no driver and
   no native app, which is the whole reason this system is web based.

   NOT A TAX INVOICE. A restaurant bill and a GST invoice are
   different documents with different legal contents — Rule 46 of the
   CGST Rules governs the invoice, and /h/:code/invoices issues it
   against the folio. This is the docket that goes on the table.
   Saying so on the page is cheaper than being asked.

   THE CRS VOUCHER'S LOOK (the owner, 27 September, D27-52), on the
   restaurant's own paper: the roll stays (D17-64: A4 for hotel bills
   and tax invoices, the restaurant keeps its thermal slips), so the
   voucher's parts are laid on an 80mm sheet rather than DocPage's A4.
   ══════════════════════════════════════════════════════════════════ */

export default function BillPage() {
  const { code, id } = useParams();
  const hotelId = code ?? "";

  const order = useQuery({
    queryKey: ["bill", hotelId, id],
    queryFn: () => getOrder(hotelId, id ?? ""),
    enabled: !!id,
  });

  if (order.isLoading) {
    return <p className="p-8 text-grey-500">Loading…</p>;
  }
  /* POS-4: every failure used to print "No such order." on the page a
     guest is handed. The server says that itself when it is true. */
  if (!order.data && order.error) {
    return (
      <ReadFailed
        error={order.error}
        what="this bill"
        onRetry={() => void order.refetch()}
      />
    );
  }
  if (!order.data) {
    return <p className="p-8 text-grey-500">No such order.</p>;
  }

  const o = order.data;
  const live = o.lines.filter((l) => !l.voided);

  /* PAISE, not rupees. `money()` rounds to the whole rupee, which is
     right on a dashboard and wrong here: the first version of this bill
     printed CGST 16 + SGST 16 + CGST 4 + SGST 4 against a total of 719,
     and those add to 40 while the real tax is 39.20. A guest checking
     the arithmetic on a document they are paying finds it does not add
     up, and they are correct.

     Rate-wise, because the bill mixes rates and the folio will show one
     line per rate. A total that hid the split would disagree with the
     postings it produced. */
  const byRate = new Map<number, { net: number; tax: number }>();
  /* VAT on alcohol apart from GST (D21-91): one line per rate, never
     halved - and never merged into a GST rate that happens to be equal. */
  const vatByRate = new Map<number, { net: number; tax: number }>();
  for (const l of live) {
    const net = Math.round(l.qty * l.unitPrice * 100) / 100;
    const tax = Math.round(net * l.taxRate) / 100;
    const into = l.taxScheme === "vat" ? vatByRate : byRate;
    const at = into.get(l.taxRate) ?? { net: 0, tax: 0 };
    into.set(l.taxRate, { net: at.net + net, tax: at.tax + tax });
  }

  return (
    <div className="bg-grey-100 print:bg-white min-h-screen py-6 print:py-0 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: 80mm auto; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex gap-2 px-3" style={{ maxWidth: "80mm" }}>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Print
        </Button>
        <Button onClick={() => window.close()}>
          Close
        </Button>
      </div>

      <article className="mx-auto bg-white text-ink-700 px-3 py-4" style={{ maxWidth: "80mm" }}>
        <DocMasthead name={o.hotelName} title="Bill" number={o.orderNo} />
        <p className="-mt-2 mb-3 text-xs text-grey-500">
          {o.outletName}{o.hotelCity && ` · ${o.hotelCity}`}
        </p>

        {/* Two across: the roll has no room for four. */}
        <DocFacts
          className="grid-cols-2 print:grid-cols-2 divide-x-0 print:divide-x-0"
          items={[
            ...(o.table ? [{ label: "Table", value: o.table }] : []),
            { label: "Date", value: dateLong(o.businessDate) },
            { label: "Served by", value: o.openedBy ?? "-" },
            ...(o.settledBy ? [{ label: "Settled by", value: o.settledBy }] : []),
          ]}
        />

        <table className="w-full mt-4 border-t-2 border-ink-700">
          <tbody>
            {live.map((l) => (
              <tr key={l.id}>
                <td className={cn(DOC_TD, "tabular pr-1.5 w-6 whitespace-nowrap")}>{l.qty}×</td>
                <td className={DOC_TD}>
                  {l.name}
                  {l.note && (
                    <span className="block text-xs text-grey-500">{l.note}</span>
                  )}
                </td>
                <td className={cn(DOC_TD, "pl-2 text-right tabular font-semibold whitespace-nowrap")}>
                  {moneyPrecise(l.qty * l.unitPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <DocTotals
          className="w-full min-w-0 mt-3"
          rows={[
            ["Net", moneyPrecise(o.net)],
            /* CGST and SGST each carry half. Accommodation and
               restaurant supply within the state is never IGST — the
               place of supply is where the property is. */
            ...[...byRate.entries()].sort((a, b) => a[0] - b[0]).flatMap(
              ([rate, v]): Array<[string, string]> => [
                [`CGST ${rate / 2}%`, moneyPrecise(v.tax / 2)],
                [`SGST ${rate / 2}%`, moneyPrecise(v.tax / 2)],
              ]),
            ...[...vatByRate.entries()].sort((a, b) => a[0] - b[0]).map(
              ([rate, v]): [string, string] => [`VAT ${rate}%`, moneyPrecise(v.tax)]),
          ]}
          total={["TOTAL", moneyPrecise(o.gross)]}
        />

        <DocPanel className="mt-4">
          {o.status === "settled" ? (
            <p>
              {/* D17-21: nothing was paid at the till — it went on the
                  function's bill, and the host pays for it there. */}
              {o.paymentMethod === "function"
                ? `Charged to ${o.eventTitle ?? "the function"}'s bill`
                : <>Paid by {o.paymentMethod}
                    {o.paymentMethod === "room" && " - charged to the guest's bill"}</>}
            </p>
          ) : (
            <p className="font-semibold">NOT PAID</p>
          )}
          {/* D22-44: the alcohol's own VAT bill, issued when this was paid,
              and it names this bill back. */}
          {o.vatBill && (
            <p className="mt-0.5" data-bill-vat-bill>
              Alcohol billed under VAT: VAT bill <span className="tabular">{o.vatBill}</span>
            </p>
          )}
        </DocPanel>

        <DocFooter
          name={o.hotelName}
          left={
            <>
              {o.hotelGstin && <p className="tabular">GSTIN {o.hotelGstin}</p>}
              {/* A16: on every food bill since January 2022; a dash until typed. */}
              <p className="tabular" data-bill-fssai>FSSAI licence {o.hotelFssai ?? "-"}</p>
            </>
          }
          /* Cheaper to say than to be asked. */
          note="This is a restaurant bill, not a tax invoice. A GST invoice is issued against the room folio at checkout."
        />
      </article>
    </div>
  );
}
