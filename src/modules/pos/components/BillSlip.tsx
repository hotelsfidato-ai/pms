import { cn } from "@/lib/cn";
import { moneyPrecise, dateLong } from "@/lib/format";
import { addonBreakdown } from "@/modules/pos/lib/pricing";
import { BILL_TITLE, type BillHeading, type Order } from "@/modules/pos/data/till";
import {
  DocMasthead, DocFacts, DocTotals, DocPanel, DocFooter, DOC_TD,
} from "@/components/ui";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";

/* ══════════════════════════════════════════════════════════════════
   THE BILL ON PAPER — what the guest is handed

   Thermal-roll width (80mm), because that is what a restaurant printer
   takes. Drawn by the bill page (pages/Bill.tsx, "Print here") and by the
   bill printer (components/KotStation.tsx, D27-292), so the two print the
   same paper.

   WHAT IT SAYS IT IS (the owner's D27-292): INTERIM BILL before payment,
   BILL after, BILL · DUPLICATE when a paid bill is printed again.

   NOT A TAX INVOICE. A restaurant bill and a GST invoice are different
   documents with different legal contents — Rule 46 of the CGST Rules
   governs the invoice, and /h/:code/invoices issues it against the folio.
   Saying so on the page is cheaper than being asked.

   THE CRS VOUCHER'S LOOK (the owner, 27 September, D27-52), on the
   restaurant's own paper: the roll stays (D17-64), so the voucher's parts
   are laid on an 80mm sheet rather than DocPage's A4.
   ══════════════════════════════════════════════════════════════════ */

export function BillSlip({ order: o, group, heading }: {
  order: Order;
  /** The group's name and logo, as on every bill (D27-53). */
  group: { name: string | null; logo: string | null };
  heading: BillHeading;
}) {
  const live = o.lines.filter((l) => !l.voided);
  /* A TEST HOTEL'S BILL (the owner's D27-296 (8)): TEST · NOT VALID at its
     head and foot, and no GSTIN. The bill is printed in the hotel in view:
     the bill page's and the bill printer's own address. A real hotel's
     paper is unchanged - both are drawn only in a test hotel. */
  const test = useIsTestHotel();

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
    <article className="mx-auto bg-white text-ink-700 px-3 py-4" style={{ maxWidth: "80mm" }}
             data-bill-heading={heading}>
      {test && <TestDocumentMark slip />}
      <DocMasthead name={o.hotelName} group={group.name} logo={group.logo}
                   title={BILL_TITLE[heading]} number={o.orderNo} />
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
                {/* An add-on line under its dish (D27-291): "+ Extra papad". */}
                {l.extra ? `+ ${l.name}` : l.name}
                {/* The owner's breakdown (D27-289): the one line, and under
                    it what the dish and each numbered add-on cost. */}
                {l.numberedAddons && (
                  <span className="block text-xs text-grey-500 tabular">
                    {addonBreakdown(l.numberedAddons)}
                  </span>
                )}
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
        {/* D27-324: a paid bill voided by the owner, an administrator or the
            GM. Its number stays; the paper says VOID, why, who and when. */}
        {o.status === "void" ? (
          <div data-bill-void>
            <p className="font-semibold">VOID - {o.voidReason ?? "-"}</p>
            <p className="mt-0.5">
              Voided by {o.voidedBy ?? "-"} at {o.voidedAt ?? "-"}
              {o.voidReference && <>; refund reference <span className="tabular">{o.voidReference}</span></>}
            </p>
          </div>
        ) : o.status === "settled" ? (
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
            {o.status === "void" && " - cancelled with this bill"}
          </p>
        )}
      </DocPanel>

      <DocFooter
        name={o.hotelName}
        left={
          <>
            {o.hotelGstin && !test && <p className="tabular">GSTIN {o.hotelGstin}</p>}
            {/* A16: on every food bill since January 2022; a dash until typed. */}
            <p className="tabular" data-bill-fssai>FSSAI licence {o.hotelFssai ?? "-"}</p>
          </>
        }
        /* Cheaper to say than to be asked. */
        note="This is a restaurant bill, not a tax invoice. A GST invoice is issued against the room folio at checkout."
      />
      {test && <TestDocumentMark slip />}
    </article>
  );
}
