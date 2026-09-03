import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Printer, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise, amountInWords, dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Button, Skeleton, ErrorState } from "@/components/ui";
import { CreditNoteFlow } from "@/components/flows/CreditNoteFlow";
import { getInvoice } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE PRINTED TAX INVOICE

   The one artefact in this system a guest actually takes away. Until
   now an invoice existed as JSON and a row in a table, which is not
   an invoice — it is a record that one could be made.

   WHAT RULE 46 OF THE CGST RULES REQUIRES ON THE PAGE

     supplier name, address and GSTIN
     a consecutive number, unique for the financial year
     date of issue
     recipient name and address, and GSTIN if registered
     HSN/SAC of the supply
     description, taxable value
     RATE AND AMOUNT of CGST and SGST, separately
     place of supply
     signature

   Every one of them is below, and every one comes from the invoice
   row rather than from the property as it stands today — because an
   invoice issued in April must keep saying what it said in April,
   even if the hotel's address changed in June.

   NOTHING IS COMPUTED HERE. The taxable value, the two tax halves and
   the total are read, not recalculated. A print view that did its own
   arithmetic could disagree with the ledger, and the guest would be
   holding the wrong document while the accounts held the right one.
   The only thing this page derives is the amount in words, and that
   is derived from the stored total.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/** A labelled block of the document. */
function Party({
  title, name, lines, gstin,
}: {
  title: string;
  name: string | null;
  lines: (string | null)[];
  gstin: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-grey-500 mb-1">
        {title}
      </p>
      <p className="text-base font-semibold text-ink-900">{name ?? "—"}</p>
      {lines.filter(Boolean).map((l) => (
        <p key={l} className="text-sm text-grey-700 leading-snug">{l}</p>
      ))}
      <p className="text-sm text-grey-700 mt-1">
        <span className="text-grey-500">GSTIN </span>
        {gstin ? (
          <span className="tabular">{gstin}</span>
        ) : (
          /* Not blank, and not "N/A" dressed up as a value. An
             unregistered recipient is a fact the invoice states. */
          <span className="text-grey-400">not registered</span>
        )}
      </p>
    </div>
  );
}

export default function InvoicePage() {
  const hotelId = useHotel();
  const params = useParams();
  /* An invoice number contains slashes — 5EL/2026-27/00001 — so the
     route is a splat and the number arrives whole in params["*"]. A
     plain :number param would have captured only "5EL". */
  const number = params["*"] ?? "";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["invoice", hotelId, number],
    queryFn: () => getInvoice(hotelId, number),
  });

  if (isLoading) {
    return (
      <div className="max-w-[820px] mx-auto p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-[820px] mx-auto p-8">
        <ErrorState
          title="That invoice could not be loaded"
          error={error}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const isCreditNote = data.creditsInvoiceId !== null;

  return (
    <div className="bg-grey-100 print:bg-white min-h-screen py-6 print:py-0">
      {/* Screen furniture. None of it reaches the paper. */}
      <div className="no-print max-w-[820px] mx-auto mb-4 flex items-center justify-between gap-3 px-4">
        <Link
          to={`/h/${hotelId}/invoices`}
          className="inline-flex items-center gap-1.5 text-sm text-grey-600 hover:text-ink-900"
        >
          <ArrowLeft className="size-4" />
          All invoices
        </Link>
        <div className="flex items-center gap-2">
          {/* Only on a live tax invoice. A credit note cannot be credited,
              and one that is already cancelled has nothing left to cancel —
              the server refuses both by name, but offering a button that
              always fails is worse than not offering it. */}
          {!isCreditNote && !data.creditedBy && (
            <CreditNoteFlow
              hotelId={hotelId}
              number={data.number}
              total={moneyPrecise(data.total)}
            />
          )}
          <Button onClick={() => window.print()}>
            <Printer className="size-4" />
            Print
          </Button>
        </div>
      </div>

      <article
        className={cn(
          "max-w-[820px] mx-auto bg-white text-ink-900",
          "px-10 py-9 print:px-0 print:py-0",
          "shadow-sm print:shadow-none",
          "print-serif",
        )}
      >
        {/* ── Head ─────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-8 pb-5 border-b-2 border-ink-900">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight">
              {data.supplier.name}
            </h1>
            {data.supplier.address && (
              <p className="text-sm text-grey-700 mt-0.5">
                {data.supplier.address}
              </p>
            )}
            {/* An address line that already names its city is a COMPLETE
                address, so nothing is appended to it. The first attempt
                filtered city and state independently and printed a bare
                "MH" under "...Solapur District, Maharashtra 413216" —
                because the address spells the state out and the column
                holds the code. Two spellings of one fact is not a reason
                to print it twice. */}
            {(() => {
              const addr = (data.supplier.address ?? "").toLowerCase();
              const city = data.supplier.city;
              if (city && addr.includes(city.toLowerCase())) return null;
              const parts = [city, data.supplier.state].filter(Boolean);
              return parts.length ? (
                <p className="text-sm text-grey-700">{parts.join(", ")}</p>
              ) : null;
            })()}
            <p className="text-sm mt-1">
              <span className="text-grey-500">GSTIN </span>
              <span className="tabular">{data.supplier.gstin ?? "—"}</span>
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="text-md font-semibold uppercase tracking-wide">
              {isCreditNote ? "Credit Note" : "Tax Invoice"}
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

        {/* A credit note says, on its face, what it cancels and why.
            An auditor reads this line first. */}
        {isCreditNote && (
          <div className="mt-4 border border-amber-300 bg-amber-50 px-4 py-2.5">
            <p className="text-sm">
              <span className="font-semibold">This is a credit note.</span>{" "}
              It cancels tax invoice{" "}
              <span className="tabular font-medium">
                {data.creditsNumber ?? "—"}
              </span>
              .
            </p>
            {data.reason && (
              <p className="text-sm text-grey-700 mt-0.5">{data.reason}</p>
            )}
          </div>
        )}

        {/* Equally, an invoice that has been credited must not read as
            live. Somebody holding this page needs to know. */}
        {!isCreditNote && data.creditedBy && (
          <div className="mt-4 border border-amber-300 bg-amber-50 px-4 py-2.5">
            <p className="text-sm">
              <span className="font-semibold">Cancelled.</span> Credit note{" "}
              <span className="tabular">{data.creditedBy}</span> was issued
              against this invoice.
            </p>
          </div>
        )}

        {/* ── Parties ──────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-8 mt-6 pb-5 border-b border-grey-300">
          <Party
            title="Billed to"
            name={data.recipient.name}
            lines={[data.recipient.address]}
            gstin={data.recipient.gstin}
          />
          <div className="text-sm space-y-1.5">
            <div>
              <span className="text-2xs uppercase tracking-wide text-grey-500">
                Place of supply
              </span>
              <p className="font-medium">{data.placeOfSupply ?? "—"}</p>
              {/* Said on the page, because it is the line people query.
                  Accommodation is supplied where the property is, so the
                  tax is always CGST + SGST. */}
              <p className="text-2xs text-grey-500 leading-snug mt-0.5">
                Accommodation is supplied at the property's location —
                IGST Act s.12(3)(b) — so this supply is intra-state.
              </p>
            </div>
            <div>
              <span className="text-2xs uppercase tracking-wide text-grey-500">
                SAC
              </span>
              <p className="tabular font-medium">{data.sacCode}</p>
            </div>
          </div>
        </section>

        {/* ── Lines ────────────────────────────────────────────── */}
        <section className="mt-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grey-400">
                <th className="text-left font-semibold py-1.5">Description</th>
                <th className="text-left font-semibold py-1.5 w-24">Date</th>
                <th className="text-right font-semibold py-1.5 w-28">
                  Taxable value
                </th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={`${l.description}-${i}`} className="border-b border-grey-200">
                  <td className="py-1.5 pr-3">{l.description}</td>
                  <td className="py-1.5 tabular text-grey-600">
                    {dateLong(l.date)}
                  </td>
                  <td className="py-1.5 text-right tabular">
                    {/* The document's sign. The lines are read from the
                        folio, where they are positive, and the first
                        version printed +₹8,417.97 under a total of
                        −₹8,838.87 — a page whose lines do not sum to its
                        own footer. A credit note is the same supply with
                        the opposite sign, so its lines carry it too. */}
                    {moneyPrecise(isCreditNote ? -l.amount : l.amount)}
                  </td>
                </tr>
              ))}
              {data.lines.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-grey-500">
                    No chargeable lines.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Totals ───────────────────────────────────────────── */}
        <section className="flex justify-end mt-5">
          <table className="text-sm min-w-[300px]">
            <tbody>
              <tr>
                <td className="py-1 pr-8 text-grey-700">Taxable value</td>
                <td className="py-1 text-right tabular">
                  {moneyPrecise(data.taxableValue)}
                </td>
              </tr>
              {/* CGST and SGST as separate lines, with their rates. A
                  combined "tax" figure is not a compliant invoice. */}
              <tr>
                <td className="py-1 pr-8 text-grey-700">
                  CGST @ {data.cgst.rate}%
                </td>
                <td className="py-1 text-right tabular">
                  {moneyPrecise(data.cgst.amount)}
                </td>
              </tr>
              <tr className="border-b border-grey-300">
                <td className="py-1 pb-2 pr-8 text-grey-700">
                  SGST @ {data.sgst.rate}%
                </td>
                <td className="py-1 pb-2 text-right tabular">
                  {moneyPrecise(data.sgst.amount)}
                </td>
              </tr>
              <tr>
                <td className="pt-2 pr-8 font-semibold">Total</td>
                <td className="pt-2 text-right tabular font-semibold text-md">
                  {moneyPrecise(data.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* The words are the tie-breaker against a smudged figure. */}
        <section className="mt-4 pt-3 border-t border-grey-300">
          <p className="text-2xs uppercase tracking-wide text-grey-500">
            Amount in words
          </p>
          <p className="text-sm font-medium mt-0.5">
            {amountInWords(data.total)}
          </p>
        </section>

        {/* ── Foot ─────────────────────────────────────────────── */}
        <footer className="mt-10 flex items-end justify-between gap-8">
          <div className="text-2xs text-grey-500 leading-relaxed max-w-[46ch]">
            <p>
              This is a computer-generated document. Issued
              {data.issuedBy ? ` by ${data.issuedBy}` : ""} against invoice
              series {data.finYear}.
            </p>
            <p className="mt-1">
              An issued tax invoice is not amended. Any correction is made by a
              credit note carrying its own number.
            </p>
          </div>
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
