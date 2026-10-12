import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Printer, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise, amountInWords, dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useDocumentTitle } from "@/lib/documentTitle";
import { useGroupSettings } from "@/modules/admin";
import {
  Button, Skeleton, ErrorState, DocPage, DocMasthead, DocFacts, DocParties, DocLabel,
  DocTotals, DocPanel, DocFooter, DOC_TH, DOC_TD,
} from "@/components/ui";
import { CreditNoteFlow } from "@/modules/finance/flows/CreditNoteFlow";
import { getInvoice } from "@/modules/finance/data/billing";
import { placeAfter } from "@/modules/finance/place";
import { SendInvoice } from "@/modules/guest-messaging";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";

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

/* The categories that are food on a stay's bill (FSS Act: food includes
   drink; alcohol is on its own VAT bill, never on this invoice). */
const FOOD = ["food", "beverage", "minibar"];

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── The rate-wise summary ────────────────────────────────────────────
   A bill that carries one rate states it in the header and needs
   nothing more. A bill that carries several has to break the tax down
   BY RATE — that is what makes it a compliant document rather than a
   total with a plausible-looking percentage beside it.

   This became possible, and therefore necessary, when 067 made GST a
   slab: a family in a ₹4,000 room and a party in a ₹9,000 suite settling
   on one master folio produce exactly this bill.

   Derived from the lines, which each carry the rate they were charged
   at. Nothing here is stored, and nothing recalculates the tax — the
   amounts are summed from what was posted. */
interface RateBand {
  rate: number;
  taxable: number;
  half: number;
  tax: number;
}

function rateWise(lines: { taxRate: number; amount: number; taxAmount: number }[]): RateBand[] {
  const bands = new Map<number, RateBand>();
  for (const l of lines) {
    const band = bands.get(l.taxRate)
      ?? { rate: l.taxRate, taxable: 0, half: 0, tax: 0 };
    band.taxable += l.amount;
    band.tax += l.taxAmount;
    bands.set(l.taxRate, band);
  }
  for (const b of bands.values()) {
    b.taxable = Math.round(b.taxable * 100) / 100;
    b.tax = Math.round(b.tax * 100) / 100;
    /* Half of the tax, not half of the rate applied again — the halves
       have to sum to what was posted, or the summary disagrees with the
       total three rows below it. */
    b.half = Math.round((b.tax / 2) * 100) / 100;
  }
  return [...bands.values()].sort((a, b) => a.rate - b.rate);
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
  /* The tab names the document (the owner, 27 September: each tab its
     screen's name); it kept the page before's. */
  useDocumentTitle(data ? (data.creditsInvoiceId !== null ? "Credit note" : "Tax invoice") : null);
  /* The group's name and logo from Settings (D27-53): "by <group>" under
     the property's name, the logo as a picture; nothing while unset. */
  const group = useGroupSettings(hotelId);
  /* A TEST HOTEL'S INVOICE (the owner's D27-296 (8)): TEST · NOT VALID
     across its head, and NO GSTIN on it - the hotel's or the company's - so
     it can never pass for a tax invoice. A real hotel's is unchanged. */
  const test = useIsTestHotel(hotelId);

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
  /* Derived on every render from the lines themselves — nothing to
     keep in step, and nothing to be stale. */
  const bands = rateWise(data.lines);

  /* The supplier's place, once: an address that already names its city is
     complete, so nothing is appended to it. The first attempt filtered city
     and state independently and printed a bare "MH" under "...Solapur
     District, Maharashtra 413216" - the address spells the state out and
     the column holds the code. Two spellings of one fact is not a reason to
     print it twice. (The rule is ../place.ts now, shared with the VAT bill
     and the interim bill.) */
  const supplierPlace = placeAfter(data.supplier.address, data.supplier.city, data.supplier.state);
  const sign = (n: number) => (isCreditNote ? -n : n);

  return (
    <DocPage
      toolbar={
        <>
          {/* Screen furniture. None of it reaches the paper. A link is
              orange, so it reads as one (the owner, 27 September). */}
          <Link
            to={`/h/${hotelId}/invoices`}
            className="inline-flex items-center gap-1.5 min-h-9 pointer-coarse:min-h-11 text-sm font-medium text-brand-orange-700 hover:underline underline-offset-4"
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
            {/* Not on a group's master bill: nothing sends it (D27-307 (4)). */}
            {!isCreditNote && !data.creditedBy && !data.masterBill && <SendInvoice hotelId={hotelId} number={data.number} />}
            <Button onClick={() => window.print()}>
              <Printer className="size-4" />
              Print
            </Button>
          </div>
        </>
      }
    >
      {/* ── The masthead: the group's logo when one is set in Settings,
          the property's name until then; the document and its number ── */}
      {test && <TestDocumentMark />}
      <DocMasthead
        name={data.supplier.name}
        group={group.name}
        logo={group.logo}
        title={isCreditNote ? "Credit Note" : "Tax Invoice"}
        number={data.number}
      >
        <p>{data.issuedAt}</p>
        {data.businessDate && <p>business date {dateLong(data.businessDate)}</p>}
      </DocMasthead>

      {/* A credit note says, on its face, what it cancels and why. An
          auditor reads this line first. */}
      {isCreditNote && (
        <DocPanel className="mb-4">
          <p>
            <span className="font-semibold">This is a credit note.</span>{" "}
            It cancels tax invoice{" "}
            <span className="tabular font-medium">{data.creditsNumber ?? "-"}</span>.
          </p>
          {data.reason && <p className="text-grey-600 mt-0.5">{data.reason}</p>}
        </DocPanel>
      )}

      {/* Equally, an invoice that has been credited must not read as live.
          Somebody holding this page needs to know. */}
      {!isCreditNote && data.creditedBy && (
        <DocPanel className="mb-4">
          <p>
            <span className="font-semibold">Cancelled.</span> Credit note{" "}
            <span className="tabular">{data.creditedBy}</span> was issued
            against this invoice.
          </p>
        </DocPanel>
      )}

      {/* ── The strip: where it is supplied, and what it comes to ── */}
      <DocFacts
        items={[
          { label: "Place of supply", value: data.placeOfSupply ?? "-" },
          { label: "SAC", value: data.sacCode },
          { label: "Total", value: moneyPrecise(data.total), end: true, strong: true },
        ]}
      />
      {/* Said on the page, because it is the line people query.
          Accommodation is supplied where the property is, so the tax is
          always CGST + SGST. */}
      {/* A banquet function's invoice (SAC 996334 or 997212, round E) is
          s.12(3)(c): a function at the property - still the hotel's place,
          still CGST + SGST. */}
      <p className="mt-1.5 text-xs text-grey-500" data-place-of-supply>
        {data.sacCode === "996311"
          ? <>Accommodation is supplied at the property's location - IGST Act s.12(3)(b) - so this supply is intra-state.</>
          : <>A function at the property is supplied at the property's location - IGST Act s.12(3)(c) - so this supply is intra-state.</>}
      </p>

      {/* D22-44: the same sale's alcohol is on its own VAT bill, and each
          document names the other. */}
      {data.vatBill && (
        <p className="mt-3 text-sm" data-invoice-vat-bill>
          Alcohol on this stay is billed separately, under VAT: VAT bill{" "}
          <Link
            to={`/h/${hotelId}/invoices/vat/${data.vatBill}`}
            className="tabular font-medium text-brand-orange-700 hover:underline"
          >
            {data.vatBill}
          </Link>
          .
        </p>
      )}

      {/* ── The two parties ──────────────────────────────────── */}
      <DocParties>
        <div className="min-w-0">
          <DocLabel className="mb-1.5">Supplier</DocLabel>
          <p className="text-md font-extrabold">{data.supplier.name}</p>
          {data.supplier.address && (
            <p className="text-xs leading-[1.5] text-grey-500 mt-0.5">{data.supplier.address}</p>
          )}
          {supplierPlace && <p className="text-xs text-grey-500">{supplierPlace}</p>}
          <table className="mt-2">
            <tbody>
              {!test && (
                <tr>
                  <td className="py-0.5 pr-4 text-xs text-grey-500">GSTIN</td>
                  <td className="py-0.5 text-xs font-semibold tabular">{data.supplier.gstin ?? "-"}</td>
                </tr>
              )}
              {/* A16 (the owner, 26 September): on an invoice that carries
                  food - restaurant, drinks or minibar - a dash until typed. */}
              {data.lines.some((l) => FOOD.includes(l.category)) && (
                <tr data-invoice-fssai>
                  <td className="py-0.5 pr-4 text-xs text-grey-500">FSSAI licence</td>
                  <td className="py-0.5 text-xs font-semibold tabular">{data.supplier.fssai ?? "-"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="min-w-0">
          <DocLabel className="mb-1.5">Billed to</DocLabel>
          <p className="text-md font-extrabold">{data.recipient.name ?? "-"}</p>
          {data.recipient.address && (
            <p className="text-xs leading-[1.5] text-grey-500 mt-0.5">{data.recipient.address}</p>
          )}
          {!test && (
            <table className="mt-2">
              <tbody>
                <tr>
                  <td className="py-0.5 pr-4 text-xs text-grey-500">GSTIN</td>
                  <td className="py-0.5 text-xs font-semibold">
                    {data.recipient.gstin ? (
                      <span className="tabular">{data.recipient.gstin}</span>
                    ) : (
                      /* Not blank, and not "N/A" dressed up as a value. An
                         unregistered recipient is a fact the invoice states. */
                      <span className="font-normal text-grey-500">not registered</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </DocParties>

      {/* ── Lines ────────────────────────────────────────────── */}
      <table className="w-full mt-6">
        <thead>
          <tr>
            <th className={cn(DOC_TH, "text-left pr-2")}>Description</th>
            <th className={cn(DOC_TH, "text-left px-2 w-32")}>Date</th>
            {/* Each line's own SAC (D27-258 Q6). */}
            <th className={cn(DOC_TH, "text-left px-2 w-20")}>SAC</th>
            <th className={cn(DOC_TH, "text-right pl-2 w-32")}>Taxable value</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l, i) => (
            <tr key={`${l.description}-${i}`}>
              <td className={cn(DOC_TD, "pr-2 font-semibold")}>{l.description}</td>
              <td className={cn(DOC_TD, "px-2 tabular text-grey-500")}>{dateLong(l.date)}</td>
              <td className={cn(DOC_TD, "px-2 tabular text-grey-500")}>{l.sac ?? "-"}</td>
              <td className={cn(DOC_TD, "pl-2 text-right tabular font-semibold")}>
                {/* The document's sign. The lines are read from the folio,
                    where they are positive, and the first version printed
                    +₹8,417.97 under a total of −₹8,838.87 — a page whose
                    lines do not sum to its own footer. A credit note is the
                    same supply with the opposite sign, so its lines carry it
                    too. */}
                {moneyPrecise(sign(l.amount))}
              </td>
            </tr>
          ))}
          {data.lines.length === 0 && (
            <tr>
              <td colSpan={4} className={cn(DOC_TD, "text-grey-500")}>No chargeable lines.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ── Rate-wise, when the bill carries more than one ──────── */}
      {bands.length > 1 && (
        <section className="mt-5">
          <DocLabel className="mb-2">Tax, rate by rate</DocLabel>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={cn(DOC_TH, "text-left pr-2")}>GST rate</th>
                  <th className={cn(DOC_TH, "text-right px-2")}>Taxable value</th>
                  <th className={cn(DOC_TH, "text-right px-2")}>CGST</th>
                  <th className={cn(DOC_TH, "text-right pl-2")}>SGST</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b.rate}>
                    <td className={cn(DOC_TD, "pr-2 tabular")}>{b.rate}%</td>
                    <td className={cn(DOC_TD, "px-2 text-right tabular")}>{moneyPrecise(sign(b.taxable))}</td>
                    <td className={cn(DOC_TD, "px-2 text-right tabular")}>{moneyPrecise(sign(b.half))}</td>
                    <td className={cn(DOC_TD, "pl-2 text-right tabular")}>{moneyPrecise(sign(b.tax - b.half))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── The words, and the totals ──────────────────────────── */}
      <section className="mt-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-5">
        {/* The words are the tie-breaker against a smudged figure. */}
        <div className="min-w-0">
          <DocLabel className="mb-1">Amount in words</DocLabel>
          <p className="text-sm font-medium leading-[1.55]">{amountInWords(data.total)}</p>
        </div>
        {/* CGST and SGST as separate lines, with their rates. A combined
            "tax" figure is not a compliant invoice.

            THE RATE IS OMITTED WHEN THE LINES DISAGREE. Since 067 one bill
            can carry a room at 5% and a suite at 18%, and `rate` is null in
            that case. Printing "CGST @ %" — or worse, an average — would
            state a rate nobody was charged. The rate-wise summary above
            carries it instead. */}
        <DocTotals
          rows={[
            ["Taxable value", moneyPrecise(data.taxableValue)],
            [`CGST${data.cgst.rate === null ? "" : ` @ ${data.cgst.rate}%`}`, moneyPrecise(data.cgst.amount)],
            [`SGST${data.sgst.rate === null ? "" : ` @ ${data.sgst.rate}%`}`, moneyPrecise(data.sgst.amount)],
          ]}
          total={["Total", moneyPrecise(data.total)]}
        />
      </section>

      {/* ── The signature (Rule 46), then who issued it ──────────── */}
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
        left={data.supplier.address}
        right={test ? undefined : <>GSTIN {data.supplier.gstin ?? "-"}</>}
        note={
          <>
            This is a computer-generated document. Issued
            {data.issuedBy ? ` by ${data.issuedBy}` : ""} against invoice
            series {data.finYear}. An issued tax invoice is not amended. Any
            correction is made by a credit note carrying its own number.
          </>
        }
      />
    </DocPage>
  );
}
