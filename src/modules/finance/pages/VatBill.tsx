import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Printer, ArrowLeft } from "lucide-react";
import { moneyPrecise, amountInWords, dateLong } from "@/lib/format";
import {
  Button, Skeleton, ErrorState, DocPage, DocMasthead, DocParties, DocLabel,
  DocTotals, DocPanel, DocFooter, DOC_TH, DOC_TD,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { CreditNoteFlow } from "@/modules/finance/flows/CreditNoteFlow";
import { getVatBill } from "@/modules/finance/data/billing";
import { placeLine } from "@/modules/finance/place";
import { useDocumentTitle } from "@/lib/documentTitle";
import { useGroupSettings } from "@/modules/admin";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";

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
  /* The tab names the document (the owner, 27 September). */
  useDocumentTitle(data ? (data.cancelsNumber !== null ? "VAT credit note" : "VAT bill") : null);
  const group = useGroupSettings(hotelId);
  /* A test hotel's VAT bill (the owner's D27-296 (8)): TEST · NOT VALID across its head. */
  const test = useIsTestHotel(hotelId);

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
  /* The place once: this printed "…Maharashtra 413216, Akkalkot, MH" (the
     print samples, 28 September). */
  const place = placeLine(data.supplier.address, data.supplier.city, data.supplier.state);

  return (
    <DocPage
      toolbar={
        <>
          <Link
            to={`/h/${hotelId}/invoices`}
            className="inline-flex items-center gap-1.5 min-h-9 pointer-coarse:min-h-11 text-sm font-medium text-brand-orange-700 hover:underline underline-offset-4"
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
        </>
      }
    >
      {test && <TestDocumentMark />}
      <DocMasthead
        name={data.supplier.name}
        group={group.name}
        logo={group.logo}
        title={isCancellation ? "VAT credit note" : "VAT bill"}
        number={data.number}
      >
        <p>{data.issuedAt}</p>
        {data.businessDate && <p>business date {dateLong(data.businessDate)}</p>}
      </DocMasthead>

      {isCancellation && (
        <DocPanel className="mb-4">
          <p>
            <span className="font-semibold">This is a credit note.</span> It cancels VAT bill{" "}
            <span className="tabular font-medium">{data.cancelsNumber}</span>.
          </p>
          {data.reason && <p className="text-grey-600 mt-0.5">{data.reason}</p>}
        </DocPanel>
      )}
      {!isCancellation && data.cancelledBy && (
        <DocPanel className="mb-4">
          <p>
            <span className="font-semibold">Cancelled.</span> Credit note{" "}
            <span className="tabular">{data.cancelledBy}</span> was issued against this VAT bill.
          </p>
        </DocPanel>
      )}

      <DocParties className="mt-0">
        <div className="min-w-0">
          <DocLabel className="mb-1.5">Billed to</DocLabel>
          <p className="text-md font-extrabold">{data.recipient ?? "-"}</p>
        </div>
        {/* The GST document of the same sale, which names this bill back. */}
        <div className="min-w-0" data-vat-bill-names>
          <DocLabel className="mb-1.5">Issued with</DocLabel>
          {data.invoice ? (
            <p className="text-sm">
              Tax invoice{" "}
              <Link to={`/h/${hotelId}/invoices/doc/${data.invoice}`}
                    className="tabular font-semibold text-brand-orange-700 hover:underline">
                {data.invoice}
              </Link>
            </p>
          ) : (
            <p className="text-sm">Restaurant bill <span className="tabular font-semibold">{data.order ?? "-"}</span></p>
          )}
        </div>
      </DocParties>

      <table className="w-full mt-6">
        <thead>
          <tr>
            <th className={cn(DOC_TH, "text-left pr-2")}>Description</th>
            <th className={cn(DOC_TH, "text-right pl-2 w-32")}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l, i) => (
            <tr key={`${l.description}-${i}`}>
              <td className={cn(DOC_TD, "pr-2 font-semibold")}>
                {l.description}{l.qty !== null && ` × ${l.qty}`}
              </td>
              <td className={cn(DOC_TD, "pl-2 text-right tabular font-semibold")}>{moneyPrecise(sign(l.amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-5">
        <div className="min-w-0">
          <DocLabel className="mb-1">Amount in words</DocLabel>
          <p className="text-sm font-medium leading-[1.55]">{amountInWords(data.total)}</p>
        </div>
        <DocTotals
          rows={[
            ...(data.discount !== 0 ? [["Discount", moneyPrecise(sign(-data.discount))] as [string, string]] : []),
            ["Taxable value", moneyPrecise(data.taxableValue)],
            /* One line, never halved into CGST and SGST (D21-91). */
            [`VAT${data.vatRate === null ? "" : ` @ ${data.vatRate}%`}`, moneyPrecise(data.vatTotal)],
          ]}
          total={["Total", moneyPrecise(data.total)]}
        />
      </section>

      <div className="mt-10 flex justify-end">
        <div className="text-center">
          <div className="h-12" />
          <div className="border-t border-ink-700 pt-1 px-8">
            <p className="text-xs">For {data.supplier.name}</p>
            <p className="text-xs text-grey-500">Authorised signatory</p>
          </div>
        </div>
      </div>

      <DocFooter
        name={data.supplier.name}
        left={place || undefined}
        note={
          <>
            A computer-generated document. Issued{data.issuedBy ? ` by ${data.issuedBy}` : ""}{" "}
            against the VAT series {data.finYear}. An issued VAT bill is not amended; a
            correction is a credit note carrying its own number.
          </>
        }
      />
    </DocPage>
  );
}
