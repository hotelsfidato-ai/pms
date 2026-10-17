import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Printer, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { amountInWords, dateShort, moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useDocumentTitle } from "@/lib/documentTitle";
import { useGroupSettings, type GroupSettings } from "@/modules/admin";
import {
  Button, Skeleton, ErrorState, DocPage, DocPanel, DocMasthead, DocParties, DocFacts, DocTotals,
  DocFooter, DocLabel, DOC_TH,
} from "@/components/ui";
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

   THE HOTEL'S OLD FOLIO INVOICE'S CONTENT, IN FIDATO'S DOCUMENT STYLE (the
   owner's D27-342 and D27-343, 17 October: their old system's PDF for what
   it says; "follow the design system of Fidato" for how it looks; the
   hotel's and the group's logos; the group's office at the foot; one A4
   document, the same one e-mailed - guest-messaging's invoiceDocument.ts
   draws it in the same order): the masthead; the hotel's contacts, GSTIN
   and PAN; the booking and the stay in two columns; every line with its
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

/* The sheet's parts in Fidato's document style (D27-343): a fact is a grey
   label beside its value; the tables are DOC_TH / DOC_TD, compact. */
function Fact({ label, children, ...rest }: { label: string; children: ReactNode } & Record<`data-${string}`, boolean>) {
  return (
    <tr {...rest}>
      <th scope="row" className="py-px pr-3 text-left align-top text-xs font-normal text-grey-500 whitespace-nowrap">{label}</th>
      <td className="py-px align-top text-sm font-semibold text-ink-700">{children}</td>
    </tr>
  );
}
const TH = cn(DOC_TH, "px-1 text-[10px] tracking-[0.04em] align-bottom");
const TD = "py-1.5 px-1 border-b border-grey-200 text-xs align-top tabular";

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
  data: InvoiceDetail; hotelId: string; test: boolean; group: GroupSettings;
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
    data.supplier.phone && `Phone ${data.supplier.phone}`,
    data.supplier.email && `E-mail ${data.supplier.email}`,
    data.supplier.website,
  ].filter(Boolean).join(" · ");

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
  /* The group's office at the foot (D27-215, the voucher's), where typed. */
  const office = group.office;
  const officeLines = office ? [
    office.address,
    [office.phone && `Phone ${office.phone}`, office.email].filter(Boolean).join(" · "),
    [office.website, office.instagram && `Instagram ${office.instagram}`].filter(Boolean).join(" · "),
  ].filter(Boolean) : [];

  return (
    <div className="text-ink-700" data-invoice-sheet>
      {/* ── The masthead: the hotel's and the group's logos, the hotel, the
          document and its number (Fidato's document style) ── */}
      <DocMasthead
        logos={[group.hotelLogo, group.groupLogo]}
        name={data.supplier.name}
        group={group.name}
        title={isCreditNote ? "Credit Note" : "Tax Invoice"}
        number={data.number}
      >
        <p>{data.issuedAt}</p>
      </DocMasthead>

      {/* The hotel: how to reach it, and its GSTIN and PAN. */}
      <div className="text-xs leading-[1.5] text-grey-500 -mt-1 mb-3">
        {(data.supplier.address || supplierPlace) && (
          <p>{[data.supplier.address, supplierPlace].filter(Boolean).join(", ")}</p>
        )}
        {contact && <p>{contact}</p>}
        {!test && (
          <p className="text-ink-700">
            GSTIN <span className="font-semibold tabular">{data.supplier.gstin ?? "-"}</span>
            {data.supplier.pan && <> · PAN <span className="font-semibold tabular">{data.supplier.pan}</span></>}
          </p>
        )}
      </div>

      {/* A credit note says, on its face, what it cancels and why; an invoice
          that has been credited must not read as live. */}
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
      {!isCreditNote && data.creditedBy && (
        <DocPanel className="mb-4">
          <p>
            <span className="font-semibold">Cancelled.</span> Credit note{" "}
            <span className="tabular">{data.creditedBy}</span> was issued
            against this invoice.
          </p>
        </DocPanel>
      )}

      {/* ── The bill and the stay, two columns (the hotel's old invoice's facts) ── */}
      <DocParties className="mt-0">
        <table className="w-full self-start"><tbody>
          {stay && <Fact label="Booking ref">{stay.reference}</Fact>}
          {stay && <Fact label="Guest name">{stay.guest}</Fact>}
          <Fact label="Bill to">{data.recipient.name ?? "-"}</Fact>
          {data.recipient.address && <Fact label="Bill to address">{data.recipient.address}</Fact>}
          {!test && (
            <Fact label="Bill to GSTIN">
              {data.recipient.gstin
                ? <span className="tabular">{data.recipient.gstin}</span>
                /* Not blank: an unregistered recipient is a fact the invoice states. */
                : <span className="font-normal text-grey-500">not registered</span>}
            </Fact>
          )}
          {stay && <Fact label="Source">{stay.source ?? "-"}</Fact>}
          <Fact label="Place of supply">{data.placeOfSupply ?? "-"}</Fact>
          {/* A16: on an invoice that carries food, a dash until typed. */}
          {hasFood && (
            <Fact label="FSSAI licence" data-invoice-fssai>
              <span className="tabular">{data.supplier.fssai ?? "-"}</span>
            </Fact>
          )}
        </tbody></table>
        <table className="w-full self-start"><tbody>
          {data.businessDate && <Fact label="Business date">{dateShort(data.businessDate)}</Fact>}
          {stay && (
            <>
              <Fact label="Room">{stay.roomType} / {stay.room ?? "-"}</Fact>
              <Fact label="Persons">{stay.adults} adults · {stay.children} children</Fact>
              <Fact label="Rate type">{stay.plan ?? "-"}</Fact>
              <Fact label="Nights">{stay.nights === 0 ? "Day use" : stay.nights}</Fact>
              <Fact label="Arrival">{stay.arrival}</Fact>
              <Fact label="Departure">{stay.departure}</Fact>
            </>
          )}
        </tbody></table>
      </DocParties>

      {/* Said on the page, because it is the line people query. */}
      <p className="mt-3 text-xs text-grey-500" data-place-of-supply>
        {data.sacCode === "996311"
          ? <>Accommodation is supplied at the property's location - IGST Act s.12(3)(b) - so this supply is intra-state.</>
          : <>A function at the property is supplied at the property's location - IGST Act s.12(3)(c) - so this supply is intra-state.</>}
      </p>

      {/* D22-44: the same sale's alcohol is on its own VAT bill. */}
      {data.vatBill && (
        <p className="mt-2 text-sm" data-invoice-vat-bill>
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

      {/* ── Every line, in rupees ──────────────────────────────── */}
      <div className="overflow-x-auto mt-5">
        <table className="w-full">
          <thead>
            <tr>
              <th className={cn(TH, "text-left pl-0")}>Sr</th>
              <th className={cn(TH, "text-left")}>Particular</th>
              {/* Each line's own SAC (D27-258 Q6). */}
              <th className={cn(TH, "text-left")}>SAC</th>
              <th className={cn(TH, "text-right")}>Qty</th>
              <th className={cn(TH, "text-right")}>Rate</th>
              <th className={cn(TH, "text-right")}>Total</th>
              <th className={cn(TH, "text-right")}>Discount</th>
              <th className={cn(TH, "text-right")}>Taxable</th>
              <th className={cn(TH, "text-right")}>SGST</th>
              <th className={cn(TH, "text-right")}>CGST</th>
              <th className={cn(TH, "text-right")}>IGST</th>
              <th className={cn(TH, "text-right pr-0")}>CESS</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => {
              const off = isDiscount(l.category);
              const half = l.taxRate / 2;
              return (
                <tr key={`${l.description}-${i}`}>
                  <td className={cn(TD, "pl-0 text-grey-500")}>{i + 1}</td>
                  <td className={TD}>
                    <span className="font-semibold">{l.description}</span>
                    <span className="block text-[10px] text-grey-500">{dateShort(l.date)}</span>
                  </td>
                  <td className={cn(TD, "text-grey-500")}>{l.sac ?? "-"}</td>
                  <td className={cn(TD, "text-right")}>1</td>
                  {/* The document's sign: a credit note's lines carry it, so
                      they sum to its own (negative) footer. */}
                  <td className={cn(TD, "text-right")}>{off ? "-" : fig(sign(l.amount))}</td>
                  <td className={cn(TD, "text-right")}>{off ? "-" : fig(sign(l.amount))}</td>
                  <td className={cn(TD, "text-right")}>{fig(off ? sign(-l.amount) : 0)}</td>
                  <td className={cn(TD, "text-right font-semibold")}>{fig(sign(l.amount))}</td>
                  <td className={cn(TD, "text-right")}>
                    {fig(sign(halves[i]!.sgst))}<span className="block text-[10px] text-grey-500 whitespace-nowrap">{fig(half)} %</span>
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {fig(sign(halves[i]!.cgst))}<span className="block text-[10px] text-grey-500 whitespace-nowrap">{fig(half)} %</span>
                  </td>
                  <td className={cn(TD, "text-right")}>0.00<span className="block text-[10px] text-grey-500 whitespace-nowrap">0.00 %</span></td>
                  <td className={cn(TD, "text-right pr-0")}>0.00</td>
                </tr>
              );
            })}
            {data.lines.length === 0 && (
              <tr>
                <td colSpan={12} className={cn(TD, "px-0 text-grey-500")}>No chargeable lines.</td>
              </tr>
            )}
            <tr className="font-bold" data-invoice-line-total>
              <td colSpan={5} className={cn(TD, "pl-0 border-t-2 border-t-ink-700 border-b-0 text-right")}>Total</td>
              {[charges, discount, data.taxableValue, data.sgst.amount, data.cgst.amount].map((n, i) => (
                <td key={i} className={cn(TD, "border-t-2 border-t-ink-700 border-b-0 text-right")}>{fig(sign(n))}</td>
              ))}
              <td className={cn(TD, "border-t-2 border-t-ink-700 border-b-0 text-right")}>0.00</td>
              <td className={cn(TD, "pr-0 border-t-2 border-t-ink-700 border-b-0 text-right")}>0.00</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Words, payments and tax by rate; the totals ─────────── */}
      <section className="mt-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] print:grid-cols-[minmax(0,1fr)_auto] gap-x-8 gap-y-5">
        <div className="space-y-4 min-w-0">
          <div>
            <DocLabel className="mb-1">Total payable, in words</DocLabel>
            {/* The words are the tie-breaker against a smudged figure. */}
            <p className="text-sm font-medium leading-[1.55]">{amountInWords(data.total)}</p>
          </div>
          {payments.length > 0 && (
            <table className="w-full" data-invoice-payments>
              <thead>
                <tr>
                  <th className={cn(TH, "text-left pl-0")}>Payment date</th>
                  <th className={cn(TH, "text-left")}>Description</th>
                  <th className={cn(TH, "text-right pr-0")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i}>
                    <td className={cn(TD, "pl-0 whitespace-nowrap")}>{dateShort(p.date)}</td>
                    <td className={TD}>{p.description}</td>
                    <td className={cn(TD, "pr-0 text-right")}>{fig(p.amount)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td colSpan={2} className={cn(TD, "pl-0 border-b-0 text-right")}>Total</td>
                  <td className={cn(TD, "pr-0 border-b-0 text-right")}>{fig(received)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <table className="w-full" data-invoice-tax-details>
            <thead>
              <tr>
                <th className={cn(TH, "text-left pl-0")}>Tax details</th>
                <th className={cn(TH, "text-right")}>Taxable amount</th>
                <th className={cn(TH, "text-right pr-0")}>Tax amount</th>
              </tr>
            </thead>
            <tbody>
              {bands.flatMap((b) => [
                <tr key={`s${b.rate}`}>
                  <td className={cn(TD, "pl-0")}>SGST @ {fig(b.rate / 2)}%</td>
                  <td className={cn(TD, "text-right")}>{fig(sign(b.taxable))}</td>
                  <td className={cn(TD, "pr-0 text-right")}>{fig(sign(b.tax - b.half))}</td>
                </tr>,
                <tr key={`c${b.rate}`}>
                  <td className={cn(TD, "pl-0")}>CGST @ {fig(b.rate / 2)}%</td>
                  <td className={cn(TD, "text-right")}>{fig(sign(b.taxable))}</td>
                  <td className={cn(TD, "pr-0 text-right")}>{fig(sign(b.half))}</td>
                </tr>,
              ])}
            </tbody>
          </table>
        </div>

        <div data-invoice-totals>
          <DocTotals
            rows={[
              ["Total charges", moneyPrecise(sign(charges))],
              ["Total discount", moneyPrecise(sign(discount) || 0)],
              ["Total SGST", moneyPrecise(sign(data.sgst.amount))],
              ["Total CGST", moneyPrecise(sign(data.cgst.amount))],
              ["Total IGST", moneyPrecise(0)],
            ]}
            total={["Total", moneyPrecise(sign(data.total))]}
            after={isCreditNote ? undefined : [
              ["Total payment", moneyPrecise(received)],
              ["Balance", moneyPrecise(Math.round((data.total - received) * 100) / 100 || 0)],
            ]}
          />
        </div>
      </section>

      {/* ── Who checked the guest in and out, and who issued it ── */}
      <DocFacts
        className="mt-4"
        items={[
          ...(stay ? [
            { label: "Reception (C/I)", value: stay.checkedInBy ?? "-" },
            { label: "Cashier (C/O)", value: stay.checkedOutBy ?? "-" },
          ] : []),
          { label: "Issued by", value: data.issuedBy ?? "-" },
          { label: "Currency", value: "INR (₹)" },
        ]}
      />

      {/* ── The two signatures: the guest's, and the hotel's (Rule 46) ── */}
      <div className="break-inside-avoid">
      <div className="mt-9 flex justify-between gap-8 text-xs">
        <div className="border-t border-ink-700 pt-1 px-6 text-center">
          <p className="font-semibold">Guest signature</p>
        </div>
        <div className="border-t border-ink-700 pt-1 px-6 text-center">
          <p>For {data.supplier.name}</p>
          <p className="text-grey-500">Authorised signatory</p>
        </div>
      </div>

      {/* ── The group's office, as the voucher's foot (D27-215) ── */}
      <DocFooter
        name={group.name ?? data.supplier.name}
        left={officeLines.length ? officeLines.map((l, i) => <p key={i}>{l}</p>) : data.supplier.address}
        right={test ? undefined : <>GSTIN {data.supplier.gstin ?? "-"}</>}
        note={
          <>
            A computer-generated document, series {data.finYear}. An issued tax
            invoice is not amended: any correction is a credit note with its own number.
          </>
        }
      />
      </div>
    </div>
  );
}
