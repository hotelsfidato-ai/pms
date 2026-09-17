import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { moneyPrecise, dateLong } from "@/lib/format";
import { getOrder } from "@/modules/pos/data/till";
import { ReadFailed } from "@/components/ui";

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
  for (const l of live) {
    const net = Math.round(l.qty * l.unitPrice * 100) / 100;
    const tax = Math.round(net * l.taxRate) / 100;
    const at = byRate.get(l.taxRate) ?? { net: 0, tax: 0 };
    byRate.set(l.taxRate, { net: at.net + net, tax: at.tax + tax });
  }

  return (
    <div className="bg-white text-ink-900 min-h-screen">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: 80mm auto; }
        }
      `}</style>

      <div className="no-print p-4 border-b border-grey-200 flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="h-11 px-4 rounded-md bg-ink-900 text-white text-base font-medium"
        >
          Print
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="h-11 px-4 rounded-md border border-grey-300 text-base"
        >
          Close
        </button>
      </div>

      <div className="mx-auto px-3 py-4" style={{ maxWidth: "80mm" }}>
        <div className="text-center">
          <p className="text-md font-semibold uppercase tracking-wide">
            {o.hotelName}
          </p>
          <p className="text-2xs text-grey-600">{o.outletName}</p>
          {o.hotelCity && (
            <p className="text-2xs text-grey-600">{o.hotelCity}</p>
          )}
        </div>

        <div className="border-t border-dashed border-grey-400 my-2.5" />

        <div className="text-2xs space-y-0.5">
          <Line label="Bill" value={o.orderNo} />
          {o.table && <Line label="Table" value={o.table} />}
          <Line label="Date" value={dateLong(o.businessDate)} />
          <Line label="Served by" value={o.openedBy} />
          {o.settledBy && <Line label="Settled by" value={o.settledBy} />}
        </div>

        <div className="border-t border-dashed border-grey-400 my-2.5" />

        <table className="w-full text-2xs">
          <tbody>
            {live.map((l) => (
              <tr key={l.id}>
                <td className="align-top tabular pr-1.5 w-6">{l.qty}×</td>
                <td className="align-top">
                  {l.name}
                  {l.note && (
                    <span className="block text-grey-600">{l.note}</span>
                  )}
                </td>
                <td className="align-top text-right tabular whitespace-nowrap">
                  {moneyPrecise(l.qty * l.unitPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-dashed border-grey-400 my-2.5" />

        <div className="text-2xs space-y-0.5">
          <Line label="Net" value={moneyPrecise(o.net)} />
          {[...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => (
            /* CGST and SGST each carry half. Accommodation and
               restaurant supply within the state is never IGST — the
               place of supply is where the property is. */
            <div key={rate}>
              <Line label={`CGST ${rate / 2}%`} value={moneyPrecise(v.tax / 2)} />
              <Line label={`SGST ${rate / 2}%`} value={moneyPrecise(v.tax / 2)} />
            </div>
          ))}
        </div>

        <div className="border-t border-grey-900 mt-2 pt-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">TOTAL</span>
            <span className="text-sm font-semibold tabular">
              {moneyPrecise(o.gross)}
            </span>
          </div>
        </div>

        <div className="text-center mt-3 text-2xs text-grey-600 space-y-1">
          {o.status === "settled" ? (
            <p>
              {/* D17-21: nothing was paid at the till — it went on the
                  function's bill, and the host pays for it there. */}
              {o.paymentMethod === "function"
                ? `Charged to ${o.eventTitle ?? "the function"}'s bill`
                : <>Paid by {o.paymentMethod}
                    {o.paymentMethod === "room" && " — charged to the guest's bill"}</>}
            </p>
          ) : (
            <p className="font-medium">NOT PAID</p>
          )}
          {/* Cheaper to say than to be asked. */}
          <p>
            This is a restaurant bill, not a tax invoice. A GST invoice is
            issued against the room folio at checkout.
          </p>
          {o.hotelGstin && <p className="tabular">GSTIN {o.hotelGstin}</p>}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-grey-600">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
