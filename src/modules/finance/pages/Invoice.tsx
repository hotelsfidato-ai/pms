import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Printer, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { amountInWords, dateLong, dateShort, moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useDocumentTitle } from "@/lib/documentTitle";
import { useGroupSettings } from "@/modules/admin";
import { Button, Skeleton, ErrorState, DocPage, DocPanel } from "@/components/ui";
import { CreditNoteFlow } from "@/modules/finance/flows/CreditNoteFlow";
import { getInvoice, type InvoiceDetail } from "@/modules/finance/data/billing";
import { placeAfter } from "@/modules/finance/place";
import { SendInvoice } from "@/modules/guest-messaging";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";

/* ══════════════════════════════════════════════════════════════════
   THE PRINTED TAX INVOICE

   The one artefact in this system a guest actually takes away. Until
   now an invoice existed as JSON and a row in a table, which is not
   an invoice — it is a record that one could be made.

   LAID OUT AS THE HOTEL'S OLD FOLIO INVOICE (the owner's D27-342, 17
   October: "this is how the invoices need to be printed", their old
   system's PDF): a boxed sheet - the hotel centred with its GSTIN, PAN and
   contacts; the booking and the stay in two columns; every line with its
   SAC, quantity, rate, discount, taxable value and each tax; the amount
   in words, the payments and the tax by rate on the left, the totals on
   the right; who checked the guest in and out, and two signatures. Kept
   from before: "Tax Invoice" (until the CA says otherwise), the place of
   supply, the FSSAI licence on food, the VAT bill's number, the test
   hotel's mark, a credit note's panel. No G.R. card number: none is kept.

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
   even if the hotel's address changed in June. (The hotel's phone,
   e-mail and website are today's: how to reach it, not what it billed.)

   NOTHING IS COMPUTED HERE THAT THE LEDGER HOLDS. The taxable value, the
   two tax totals and the total are read, not recalculated. A line's CGST
   and SGST are its own tax split as the invoice split its total, so the
   columns add up to the totals printed under them (splitByLine).
   ══════════════════════════════════════════════════════════════════ */

/* The categories that are food on a stay's bill (FSS Act: food includes
   drink; alcohol is on its own VAT bill, never on this invoice). */
const FOOD = ["food", "beverage", "minibar"];

/** 3,200.00 - a figure in a column, the rupee said once ("in Rs"). `|| 0`:
    a credit note's zero is minus zero, which prints "-0.00". */
const fig = (n: number) =>
  (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── The rate-wise summary ────────────────────────────────────────────
   A GST invoice breaks the tax down BY RATE. Derived from the lines,
   which each carry the rate they were charged at; nothing recalculates
   the tax - the amounts are summed from what was posted. */
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
    /* CGST takes the odd paisa, as the invoice's totals do (invoices.ts). */
    b.half = Math.ceil(Math.round(b.tax * 100) / 2) / 100;
  }
  return [...bands.values()].sort((a, b) => a.rate - b.rate);
}

/** Each line's CGST and SGST: its tax in whole paise, CGST the odd paisa (the
    invoice's own rule); the last line takes what keeps each column equal to
    the invoice's stored total. Not adjusted when the lines' tax is not the
    invoice's (a standalone tax posting from the old system). */
export function splitByLine(
  lines: { taxAmount: number }[], cgstTotal: number, sgstTotal: number,
): { cgst: number; sgst: number }[] {
  const out = lines.map((l) => {
    const p = Math.round(l.taxAmount * 100);
    const c = Math.ceil(p / 2);
    return { cgst: c, sgst: p - c };
  });
  const sum = (k: "cgst" | "sgst") => out.reduce((n, x) => n + x[k], 0);
  const wantC = Math.round(cgstTotal * 100);
  const wantS = Math.round(sgstTotal * 100);
  const last = out[out.length - 1];
  if (last && sum("cgst") + sum("sgst") === wantC + wantS) {
    const d = wantC - sum("cgst");
    last.cgst += d;
    last.sgst -= d;
  }
  return out.map((x) => ({ cgst: x.cgst / 100, sgst: x.sgst / 100 }));
}

/* The sheet's parts: a label and its value, and a column cell. */
function Fact({ label, children, ...rest }: { label: string; children: ReactNode } & Record<`data-${string}`, boolean>) {
  return (
    <tr {...rest}>
      <th scope="row" className="py-[3px] pr-2 text-left align-top font-bold whitespace-nowrap">{label}</th>
      <td className="py-[3px] align-top">: <span>{children}</span></td>
    </tr>
  );
}
const TH = "border border-ink-700 px-1.5 py-1 font-bold text-[11px] align-bottom";
const TD = "border border-ink-700 px-1.5 py-1 align-top tabular";

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
            {data.creditsInvoiceId === null && !data.creditedBy && (
              <CreditNoteFlow
                hotelId={hotelId}
                number={data.number}
                total={moneyPrecise(data.total)}
              />
            )}
            {/* Not on a group's master bill: nothing sends it (D27-307 (4)). */}
            {data.creditsInvoiceId === null && !data.creditedBy && !data.masterBill && <SendInvoice hotelId={hotelId} number={data.number} />}
            <Button onClick={() => window.print()}>
              <Printer className="size-4" />
              Print
            </Button>
          </div>
        </>
      }
    >
      {test && <TestDocumentMark />}
      <InvoiceSheet data={data} hotelId={hotelId} test={test} group={group} />
    </DocPage>
  );
}

function InvoiceSheet({ data, hotelId, test, group }: {
  data: InvoiceDetail; hotelId: string; test: boolean;
  group: { name: string | null; logo: string | null };
}) {
  const isCreditNote = data.creditsInvoiceId !== null;
  const sign = (n: number) => (isCreditNote ? -n : n);
  /* Derived on every render from the lines themselves — nothing to
     keep in step, and nothing to be stale. */
  const bands = rateWise(data.lines);
  const halves = splitByLine(data.lines, data.cgst.amount, data.sgst.amount);

  /* The supplier's place, once: an address that already names its city is
     complete, so nothing is appended to it (../place.ts, shared with the VAT
     bill and the interim bill). */
  const supplierPlace = placeAfter(data.supplier.address, data.supplier.city, data.supplier.state);
  const contact = [
    data.supplier.phone && `Phone: ${data.supplier.phone}`,
    data.supplier.email && `E-mail: ${data.supplier.email}`,
    data.supplier.website && `URL: ${data.supplier.website}`,
  ].filter(Boolean).join("; ");

  /* A discount is its own negative line: its figure goes under Discount,
     and it lowers the taxable value as it lowers the total. */
  const isDiscount = (c: string) => c === "discount";
  const charges = data.lines.filter((l) => !isDiscount(l.category)).reduce((n, l) => n + l.amount, 0);
  const discount = -data.lines.filter((l) => isDiscount(l.category)).reduce((n, l) => n + l.amount, 0) || 0;
  const stay = data.stay ?? null;
  /* Money received on this bill: not on a credit note, which pays nothing. */
  const payments = isCreditNote ? [] : data.payments ?? [];
  const received = Math.round(payments.reduce((n, p) => n + p.amount, 0) * 100) / 100;
  const hasFood = data.lines.some((l) => FOOD.includes(l.category));

  return (
    <div className="border border-ink-700 text-[12px] leading-snug text-ink-900" data-invoice-sheet>
      {/* ── The hotel, centred ─────────────────────────────────── */}
      <header className="text-center px-4 pt-3 pb-4 space-y-0.5">
        <h1 className="text-[15px] font-bold">{isCreditNote ? "Credit Note" : "Tax Invoice"}</h1>
        {group.logo && <img src={group.logo} alt="" className="mx-auto max-h-12 my-1" />}
        <p className="text-[17px] font-bold">{data.supplier.name}</p>
        {group.name && <p className="text-[11px] text-grey-600">by {group.name}</p>}
        {!test && (
          <p className="text-[11px]">
            <b>GSTIN</b> : <span className="tabular">{data.supplier.gstin ?? "-"}</span>
            {data.supplier.pan && <>, <b>PAN</b> : <span className="tabular">{data.supplier.pan}</span></>}
          </p>
        )}
        {(data.supplier.address || supplierPlace) && (
          <p>{[data.supplier.address, supplierPlace].filter(Boolean).join(", ")}</p>
        )}
        {contact && <p>{contact}</p>}
      </header>

      {/* A credit note says, on its face, what it cancels and why; an invoice
          that has been credited must not read as live. */}
      {isCreditNote && (
        <DocPanel className="mx-4 mb-3">
          <p>
            <span className="font-semibold">This is a credit note.</span>{" "}
            It cancels tax invoice{" "}
            <span className="tabular font-medium">{data.creditsNumber ?? "-"}</span>.
          </p>
          {data.reason && <p className="text-grey-600 mt-0.5">{data.reason}</p>}
        </DocPanel>
      )}
      {!isCreditNote && data.creditedBy && (
        <DocPanel className="mx-4 mb-3">
          <p>
            <span className="font-semibold">Cancelled.</span> Credit note{" "}
            <span className="tabular">{data.creditedBy}</span> was issued
            against this invoice.
          </p>
        </DocPanel>
      )}

      {/* ── The booking and the stay, two columns ─────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 px-4 pb-2">
        <table className="w-full"><tbody>
          {stay && <Fact label="Booking ref">{stay.reference}</Fact>}
          <Fact label={isCreditNote ? "Credit note No" : "Invoice No"}><span className="tabular">{data.number}</span></Fact>
          {stay && <Fact label="Guest Name">{stay.guest}</Fact>}
          <Fact label="Bill To">{data.recipient.name ?? "-"}</Fact>
          {data.recipient.address && <Fact label="Bill To Address">{data.recipient.address}</Fact>}
          {!test && (
            <Fact label="Bill To GSTIN">
              {data.recipient.gstin
                ? <span className="tabular">{data.recipient.gstin}</span>
                /* Not blank: an unregistered recipient is a fact the invoice states. */
                : <span className="text-grey-600">not registered</span>}
            </Fact>
          )}
          {stay && <Fact label="Source">{stay.source ?? "-"}</Fact>}
          <Fact label="Place of Supply">{data.placeOfSupply ?? "-"}</Fact>
          {/* A16: on an invoice that carries food, a dash until typed. */}
          {hasFood && (
            <Fact label="FSSAI licence" data-invoice-fssai>
              <span className="tabular">{data.supplier.fssai ?? "-"}</span>
            </Fact>
          )}
        </tbody></table>
        <table className="w-full"><tbody>
          <Fact label={isCreditNote ? "Date" : "Date of Invoice"}>{data.issuedAt}</Fact>
          {data.businessDate && <Fact label="Business date">{dateLong(data.businessDate)}</Fact>}
          {stay && (
            <>
              <Fact label="Room">{stay.roomType} / {stay.room ?? "-"}</Fact>
              <Fact label="No of Persons">{stay.adults} (A) / {stay.children} (C)</Fact>
              <Fact label="Rate Type">{stay.plan ?? "-"}</Fact>
              <Fact label="No of Nights">{stay.nights === 0 ? "Day use" : stay.nights}</Fact>
              <Fact label="Date of Arrival">{stay.arrival}</Fact>
              <Fact label="Date of Departure">{stay.departure}</Fact>
            </>
          )}
        </tbody></table>
      </div>

      {/* Said on the page, because it is the line people query. */}
      <p className="px-4 pb-2 text-[11px] text-grey-600" data-place-of-supply>
        {data.sacCode === "996311"
          ? <>Accommodation is supplied at the property's location - IGST Act s.12(3)(b) - so this supply is intra-state.</>
          : <>A function at the property is supplied at the property's location - IGST Act s.12(3)(c) - so this supply is intra-state.</>}
      </p>

      {/* D22-44: the same sale's alcohol is on its own VAT bill. */}
      {data.vatBill && (
        <p className="px-4 pb-2 text-[11px]" data-invoice-vat-bill>
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

      {/* ── Every line ─────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className={cn(TH, "text-left border-l-0")}>Sr No</th>
              <th className={cn(TH, "text-left")}>Particular</th>
              {/* Each line's own SAC (D27-258 Q6). */}
              <th className={cn(TH, "text-left")}>HSN/SAC</th>
              <th className={cn(TH, "text-right")}>Qty</th>
              <th className={cn(TH, "text-right")}>Rate</th>
              <th className={cn(TH, "text-right")}>Total</th>
              <th className={cn(TH, "text-right")}>Discount</th>
              <th className={cn(TH, "text-right")}>Taxable</th>
              <th className={cn(TH, "text-right")}>SGST</th>
              <th className={cn(TH, "text-right")}>CGST</th>
              <th className={cn(TH, "text-right")}>IGST</th>
              <th className={cn(TH, "text-right border-r-0")}>CESS</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => {
              const off = isDiscount(l.category);
              const half = l.taxRate / 2;
              return (
                <tr key={`${l.description}-${i}`}>
                  <td className={cn(TD, "border-l-0")}>{i + 1}</td>
                  <td className={cn(TD, "font-sans")}>
                    <span>{l.description}</span>
                    <span className="block text-[10px] text-grey-600">{dateShort(l.date)}</span>
                  </td>
                  <td className={TD}>{l.sac ?? "-"}</td>
                  <td className={cn(TD, "text-right")}>1</td>
                  {/* The document's sign: a credit note's lines carry it, so
                      they sum to its own (negative) footer. */}
                  <td className={cn(TD, "text-right")}>{off ? "-" : fig(sign(l.amount))}</td>
                  <td className={cn(TD, "text-right")}>{off ? "-" : fig(sign(l.amount))}</td>
                  <td className={cn(TD, "text-right")}>{fig(off ? sign(-l.amount) : 0)}</td>
                  <td className={cn(TD, "text-right font-semibold")}>{fig(sign(l.amount))}</td>
                  <td className={cn(TD, "text-right")}>
                    {fig(sign(halves[i]!.sgst))}<span className="block text-[10px] whitespace-nowrap">{fig(half)} %</span>
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {fig(sign(halves[i]!.cgst))}<span className="block text-[10px] whitespace-nowrap">{fig(half)} %</span>
                  </td>
                  <td className={cn(TD, "text-right")}>0.00<span className="block text-[10px] whitespace-nowrap">0.00 %</span></td>
                  <td className={cn(TD, "text-right border-r-0")}>0.00</td>
                </tr>
              );
            })}
            {data.lines.length === 0 && (
              <tr>
                <td colSpan={12} className={cn(TD, "border-x-0 text-grey-600")}>No chargeable lines.</td>
              </tr>
            )}
            <tr className="font-bold" data-invoice-line-total>
              <td colSpan={5} className={cn(TD, "border-l-0 text-right")}>Total</td>
              <td className={cn(TD, "text-right")}>{fig(sign(charges))}</td>
              <td className={cn(TD, "text-right")}>{fig(sign(discount))}</td>
              <td className={cn(TD, "text-right")}>{fig(sign(data.taxableValue))}</td>
              <td className={cn(TD, "text-right")}>{fig(sign(data.sgst.amount))}</td>
              <td className={cn(TD, "text-right")}>{fig(sign(data.cgst.amount))}</td>
              <td className={cn(TD, "text-right")}>0.00</td>
              <td className={cn(TD, "text-right border-r-0")}>0.00</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Words, payments and tax by rate; the totals ─────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-6 gap-y-4 px-4 py-4">
        <div className="space-y-4 min-w-0">
          <div>
            <p className="font-bold">Total Payable Amount</p>
            {/* The words are the tie-breaker against a smudged figure. */}
            <p className="mt-0.5">{amountInWords(data.total)}</p>
          </div>
          {payments.length > 0 && (
            <table className="w-full border-collapse" data-invoice-payments>
              <thead>
                <tr>
                  <th className={cn(TH, "text-left")}>Payment Date</th>
                  <th className={cn(TH, "text-left")}>Description</th>
                  <th className={cn(TH, "text-right")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i}>
                    <td className={cn(TD, "whitespace-nowrap")}>{dateShort(p.date)}</td>
                    <td className={cn(TD, "font-sans")}>{p.description}</td>
                    <td className={cn(TD, "text-right")}>{fig(p.amount)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td colSpan={2} className={cn(TD, "text-right")}>Total</td>
                  <td className={cn(TD, "text-right")}>{fig(received)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <table className="w-full border-collapse" data-invoice-tax-details>
            <thead>
              <tr>
                <th className={cn(TH, "text-left")}>Tax Details</th>
                <th className={cn(TH, "text-right")}>Taxable Amount</th>
                <th className={cn(TH, "text-right")}>Tax Amount</th>
              </tr>
            </thead>
            <tbody>
              {bands.flatMap((b) => [
                <tr key={`s${b.rate}`}>
                  <td className={TD}>SGST @ {fig(b.rate / 2)}%</td>
                  <td className={cn(TD, "text-right")}>{fig(sign(b.taxable))}</td>
                  <td className={cn(TD, "text-right")}>{fig(sign(b.tax - b.half))}</td>
                </tr>,
                <tr key={`c${b.rate}`}>
                  <td className={TD}>CGST @ {fig(b.rate / 2)}%</td>
                  <td className={cn(TD, "text-right")}>{fig(sign(b.taxable))}</td>
                  <td className={cn(TD, "text-right")}>{fig(sign(b.half))}</td>
                </tr>,
              ])}
            </tbody>
          </table>
        </div>

        <table className="w-full self-start border-collapse" data-invoice-totals>
          <tbody>
            {([
              ["Total Charges (Rs)", fig(sign(charges))],
              ["Total Discount (Rs)", fig(sign(discount))],
              ["Total SGST (Rs)", fig(sign(data.sgst.amount))],
              ["Total CGST (Rs)", fig(sign(data.cgst.amount))],
              ["Total IGST (Rs)", "0.00"],
              ["Total (Rs)", fig(sign(data.total))],
              ...(isCreditNote ? [] : [
                ["Total Payment (Rs)", fig(received)],
                ["Balance (Rs)", fig(Math.round((data.total - received) * 100) / 100)],
              ]),
            ] as [string, string][]).map(([label, value]) => (
              <tr key={label} className={label === "Total (Rs)" ? "font-bold" : undefined}>
                <th scope="row" className={cn(TD, "text-right font-bold font-sans")}>{label} :</th>
                <td className={cn(TD, "text-right w-28")}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Who, and the two signatures (the guest's; the hotel's, Rule 46) ── */}
      <div className="border-t border-ink-700 grid grid-cols-1 sm:grid-cols-2 gap-x-6 px-4 pt-2 pb-3">
        <table className="w-full self-start"><tbody>
          <Fact label="This folio is in">Rs (INR)</Fact>
          {stay && <Fact label="Reception (C/I)">{stay.checkedInBy ?? "-"}</Fact>}
          {stay && <Fact label="Cashier (C/O)">{stay.checkedOutBy ?? "-"}</Fact>}
          <Fact label="Issued by">{data.issuedBy ?? "-"}</Fact>
        </tbody></table>
        <p className="text-[10px] text-grey-600 sm:text-right self-start pt-1">
          A computer-generated document, series {data.finYear}. An issued tax
          invoice is not amended: a correction is a credit note with its own number.
        </p>
      </div>
      <div className="border-t border-ink-700 flex justify-between gap-6 px-4 pt-12 pb-2 text-[11px]">
        <p className="border-t border-ink-700 pt-1 px-6 font-bold">(Guest Signature)</p>
        <div className="border-t border-ink-700 pt-1 px-6 text-center">
          <p>For {data.supplier.name}</p>
          <p className="text-grey-600">Authorised signatory</p>
        </div>
      </div>
    </div>
  );
}
