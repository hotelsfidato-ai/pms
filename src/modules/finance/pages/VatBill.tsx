import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Printer, ArrowLeft } from "lucide-react";
import { moneyPrecise, amountInWords, dateLong } from "@/lib/format";
import { Button, Skeleton, ErrorState } from "@/components/ui";
import { CreditNoteFlow } from "@/modules/finance/flows/CreditNoteFlow";
import { getVatBill } from "@/modules/finance/data/billing";

/* ══════════════════════════════════════════════════════════════════
   THE PRINTED VAT BILL FOR ALCOHOL (the owner's D22-44)

   Issued at the same moment as the GST document of the same sale - the
   stay's tax invoice, or the restaurant's settlement - and naming it, as
   that document names this one. Its own series (VAT/5EL/2026-27/0001).
   Like the tax invoice, nothing here is computed: every figure is read.
   A cancellation is its own numbered bill, every figure negated.
   ══════════════════════════════════════════════════════════════════ */

export default function VatBillPage() {
  const params = useParams();
  const hotelId = params.code ?? "";
  /* The number has slashes in it, so the route is a splat. */
  const number = params["*"] ?? "";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["vat-bill", hotelId, number],
    queryFn: () => getVatBill(hotelId, number),
  });

  if (isLoading) {
    return (
      <div className="max-w-[820px] mx-auto p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="max-w-[820px] mx-auto p-8">
        <ErrorState title="That VAT bill could not be loaded" error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const isCancellation = data.cancelsNumber !== null;
  const sign = (n: number) => (isCancellation ? -n : n);
  const place = [data.supplier.address, data.supplier.city, data.supplier.state]
    .filter(Boolean).join(", ");

  return (
    <div className="bg-grey-100 print:bg-white min-h-screen py-6 print:py-0">
      <div className="no-print max-w-[820px] mx-auto mb-4 flex items-center justify-between gap-3 px-4">
        <Link
          to={`/h/${hotelId}/invoices`}
          className="inline-flex items-center gap-1.5 text-sm text-grey-600 hover:text-ink-900"
        >
          <ArrowLeft className="size-4" />
          All invoices
        </Link>
        <div className="flex items-center gap-2">
          {!isCancellation && !data.cancelledBy && (
            <CreditNoteFlow hotelId={hotelId} number={data.number}
                            total={moneyPrecise(data.total)} vat />
          )}
          <Button onClick={() => window.print()}>
            <Printer className="size-4" />
            Print
          </Button>
        </div>
      </div>

      <article className="max-w-[820px] mx-auto bg-white text-ink-900 px-10 py-9 print:px-0 print:py-0 shadow-sm print:shadow-none print-serif">
        <header className="flex items-start justify-between gap-8 pb-5 border-b-2 border-ink-900">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight">{data.supplier.name}</h1>
            {place && <p className="text-sm text-grey-700 mt-0.5">{place}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-md font-semibold uppercase tracking-wide">
              {isCancellation ? "VAT credit note" : "VAT bill"}
            </p>
            <p className="text-lg tabular font-semibold mt-1">{data.number}</p>
            <p className="text-sm text-grey-700 mt-0.5">{data.issuedAt}</p>
            {data.businessDate && (
              <p className="text-2xs text-grey-500 mt-0.5">
                business date {dateLong(data.businessDate)}
              </p>
            )}
          </div>
        </header>

        {isCancellation && (
          <div className="mt-4 border border-brand-yellow bg-brand-yellow-50 px-4 py-2.5">
            <p className="text-sm">
              <span className="font-semibold">This is a credit note.</span> It cancels VAT bill{" "}
              <span className="tabular font-medium">{data.cancelsNumber}</span>.
            </p>
            {data.reason && <p className="text-sm text-grey-700 mt-0.5">{data.reason}</p>}
          </div>
        )}
        {!isCancellation && data.cancelledBy && (
          <div className="mt-4 border border-brand-yellow bg-brand-yellow-50 px-4 py-2.5">
            <p className="text-sm">
              <span className="font-semibold">Cancelled.</span> Credit note{" "}
              <span className="tabular">{data.cancelledBy}</span> was issued against this VAT bill.
            </p>
          </div>
        )}

        <section className="grid grid-cols-2 gap-8 mt-6 pb-5 border-b border-grey-300 text-sm">
          <div>
            <p className="text-2xs uppercase tracking-wide text-grey-500 mb-1">Billed to</p>
            <p className="text-base font-semibold">{data.recipient ?? "-"}</p>
          </div>
          {/* The GST document of the same sale, which names this bill back. */}
          <div data-vat-bill-names>
            <p className="text-2xs uppercase tracking-wide text-grey-500 mb-1">Issued with</p>
            {data.invoice ? (
              <p>
                Tax invoice{" "}
                <Link to={`/h/${hotelId}/invoices/doc/${data.invoice}`} className="tabular font-medium hover:underline">
                  {data.invoice}
                </Link>
              </p>
            ) : (
              <p>Restaurant bill <span className="tabular font-medium">{data.order ?? "-"}</span></p>
            )}
          </div>
        </section>

        <section className="mt-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grey-400">
                <th className="text-left font-semibold py-1.5">Description</th>
                <th className="text-right font-semibold py-1.5 w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={`${l.description}-${i}`} className="border-b border-grey-200">
                  <td className="py-1.5 pr-3">
                    {l.description}{l.qty !== null && ` × ${l.qty}`}
                  </td>
                  <td className="py-1.5 text-right tabular">{moneyPrecise(sign(l.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="flex justify-end mt-5">
          <table className="text-sm min-w-[300px]">
            <tbody>
              {data.discount !== 0 && (
                <tr>
                  <td className="py-1 pr-8 text-grey-700">Discount</td>
                  <td className="py-1 text-right tabular">{moneyPrecise(sign(-data.discount))}</td>
                </tr>
              )}
              <tr>
                <td className="py-1 pr-8 text-grey-700">Taxable value</td>
                <td className="py-1 text-right tabular">{moneyPrecise(data.taxableValue)}</td>
              </tr>
              {/* One line, never halved into CGST and SGST (D21-91). */}
              <tr className="border-b border-grey-300">
                <td className="py-1 pb-2 pr-8 text-grey-700">
                  VAT{data.vatRate === null ? "" : ` @ ${data.vatRate}%`}
                </td>
                <td className="py-1 pb-2 text-right tabular">{moneyPrecise(data.vatTotal)}</td>
              </tr>
              <tr>
                <td className="pt-2 pr-8 font-semibold">Total</td>
                <td className="pt-2 text-right tabular font-semibold text-md">{moneyPrecise(data.total)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="mt-4 pt-3 border-t border-grey-300">
          <p className="text-2xs uppercase tracking-wide text-grey-500">Amount in words</p>
          <p className="text-sm font-medium mt-0.5">{amountInWords(data.total)}</p>
        </section>

        <footer className="mt-10 flex items-end justify-between gap-8">
          <p className="text-2xs text-grey-500 leading-relaxed max-w-[46ch]">
            A computer-generated document. Issued{data.issuedBy ? ` by ${data.issuedBy}` : ""}{" "}
            against the VAT series {data.finYear}. An issued VAT bill is not amended; a
            correction is a credit note carrying its own number.
          </p>
          <div className="text-center shrink-0">
            <div className="h-12" />
            <div className="border-t border-ink-900 pt-1 px-8">
              <p className="text-2xs">For {data.supplier.name}</p>
              <p className="text-2xs text-grey-500">Authorised signatory</p>
            </div>
          </div>
        </footer>
      </article>
    </div>
  );
}
