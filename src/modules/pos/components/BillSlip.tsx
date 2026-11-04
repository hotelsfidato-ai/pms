import { cn } from "@/lib/cn";
import { moneyPrecise, dateShort } from "@/lib/format";
import { addonBreakdown } from "@/modules/pos/lib/pricing";
import { oneLinePerDish } from "@/modules/pos/lib/oneLinePerDish";
import { BILL_TITLE, allowanceWords, type BillHeading, type Order } from "@/modules/pos/data/till";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";

/* ══════════════════════════════════════════════════════════════════
   THE BILL ON PAPER — what the guest is handed

   Thermal-roll width (80mm), because that is what a restaurant printer
   takes. Drawn by the bill page (pages/Bill.tsx, "Print here") and by the
   bill printer (components/KotStation.tsx, D27-292), so the two print the
   same paper.

   A PLAIN RESTAURANT BILL (the owner's D27-334, which replaces D27-52's
   voucher look here): the hotel's name in text, BILL, Qty / Rate / Amount,
   then Sub total, Discount, the tax lines, Round off and GRAND TOTAL. It is
   handed over BEFORE payment, so it never says "interim" or "not paid";
   after payment it says how it was paid, and a reprint says DUPLICATE.

   IT ADDS UP. The tax lines are the database's own split (`taxes`, on the
   discounted value) and GRAND TOTAL is `payable`, what the till asks for:
   Sub total - Discount + tax + Round off = GRAND TOTAL, to the paisa.

   A BILL GIVEN FREE, NC (the owner's D27-351; its value since D27-394): the
   dishes with their menu prices and amounts and the Bill total (net, before
   any discount), then "NC - No charge: ₹0.00 to pay". No tax lines: nothing
   was sold, so nothing was taxed. The reason and who approved it at the foot.
   ══════════════════════════════════════════════════════════════════ */

/** A figure in a column: paise, no rupee sign, as a restaurant bill prints. */
const fig = (v: number) => moneyPrecise(v).replace("₹", "");

export function BillSlip({ order: o, heading, sample }: {
  order: Order; heading: BillHeading;
  /** Settings › Documents' made-up bill: SAMPLE · NOT VALID, no GSTIN (D27-348). */
  sample?: string;
}) {
  /* The same dish of two rounds is one line (D27-353). */
  const live = oneLinePerDish(o.lines.filter((l) => !l.voided));
  const nc = o.status === "no_charge";
  /* A TEST HOTEL'S BILL (the owner's D27-296 (8)): TEST · NOT VALID at its
     head and foot, and no GSTIN. A real hotel's paper is unchanged. */
  const test = useIsTestHotel() || Boolean(sample);

  /* CGST and SGST each carry half; SGST takes the odd paisa, so the pair
     adds up to the tax. Supply within the state is never IGST. VAT on
     alcohol is one line, never halved (D21-91). */
  const taxRows: Array<[string, number]> = o.taxes.flatMap((t): Array<[string, number]> => {
    if (t.scheme === "vat") return [[`VAT ${t.rate}%`, t.tax]];
    const cgst = Math.round(t.tax * 50) / 100;
    return [[`CGST ${t.rate / 2}%`, cgst], [`SGST ${t.rate / 2}%`, Math.round((t.tax - cgst) * 100) / 100]];
  });
  const rows: Array<[string, string]> = [
    ["Sub total", fig(o.net)],
    ...(o.discount > 0 ? [[
      `Discount${o.discountType === "percent" && o.discountValue !== null ? ` ${o.discountValue}%` : ""}`,
      fig(-o.discount),
    ] as [string, string]] : []),
    ...taxRows.map(([label, v]): [string, string] => [label, fig(v)]),
    ...(o.roundOff !== 0 ? [["Round off", `${o.roundOff > 0 ? "+" : ""}${fig(o.roundOff)}`] as [string, string]] : []),
  ];
  const steward = o.waiter ?? o.openedBy;
  const rule = "border-t border-dashed border-ink-700";

  return (
    <article className="mx-auto bg-white text-ink-700 px-3 py-4 text-sm" style={{ maxWidth: "80mm" }}
             data-bill-heading={heading}>
      {test && <TestDocumentMark slip {...(sample ? { label: sample } : {})} />}

      <header className="text-center">
        <p className="text-lg font-extrabold uppercase tracking-wide">{o.hotelName}</p>
        <p>{o.outletName}</p>
        <p className="text-xs">
          {o.hotelCity && <span className="block">{o.hotelCity}</span>}
          {o.hotelGstin && !test && <span className="tabular">GSTIN {o.hotelGstin} · </span>}
          {/* A16: on every food bill since January 2022; a dash until typed. */}
          <span className="tabular" data-bill-fssai>FSSAI licence {o.hotelFssai ?? "-"}</span>
          {/* D27-344: the HSN/SAC, as the invoice's lines carry it; a dash until set. */}
          <span className="block tabular" data-bill-sac>HSN/SAC {o.hotelSac ?? "-"}</span>
        </p>
      </header>

      <p className={cn(rule, "mt-3 border-b py-1.5 text-center font-extrabold uppercase tracking-[0.2em]")}>
        {BILL_TITLE[heading]}
      </p>

      <div className="mt-2 text-xs tabular">
        <p className="flex justify-between gap-2"><span>Bill {o.orderNo}</span><span>{dateShort(o.businessDate)}</span></p>
        <p className="flex flex-wrap justify-between gap-x-3">
          {o.table && <span>{o.orderType === "takeaway" ? o.table : `Table ${o.table}`}</span>}
          {o.covers ? <span>Covers {o.covers}</span> : null}
          {steward && <span>Steward {steward}</span>}
        </p>
      </div>

      <table className={cn(rule, "w-full mt-2 tabular")}>
        <thead>
          <tr className="text-xs font-semibold border-b border-dashed border-ink-700">
            <th className="py-1 text-left font-semibold">Item</th>
            <th className="py-1 px-1 text-right font-semibold">Qty</th>
            <th className="py-1 px-1 text-right font-semibold">Rate</th>
            <th className="py-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {live.map((l) => (
            <tr key={l.id} className="align-top">
              <td className="py-1">
                {/* An add-on line under its dish (D27-291): "+ Extra papad". */}
                {l.extra ? `+ ${l.name}` : l.name}
                {/* The owner's breakdown (D27-289): what the dish and each
                    numbered add-on cost, under the one line. */}
                {l.numberedAddons && (
                  <span className="block text-xs">{addonBreakdown(l.numberedAddons)}</span>
                )}
                {l.note && <span className="block text-xs">{l.note}</span>}
              </td>
              <td className="py-1 px-1 text-right">{l.qty}</td>
              <td className="py-1 px-1 text-right whitespace-nowrap">{fig(l.unitPrice)}</td>
              <td className="py-1 text-right whitespace-nowrap">{fig(l.qty * l.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {nc ? (
        <dl className={cn(rule, "mt-1 pt-1.5 tabular")} data-bill-nc-total>
          <div className="flex justify-between gap-2"><dt>Bill total</dt><dd>{fig(o.net)}</dd></div>
          <div className={cn(rule, "mt-1.5 border-b py-1.5 flex justify-between gap-2 text-md font-extrabold")}>
            <dt>NC - No charge</dt><dd>{moneyPrecise(0)} to pay</dd>
          </div>
        </dl>
      ) : <dl className={cn(rule, "mt-1 pt-1.5 tabular")}>
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt>{label}</dt><dd>{value}</dd>
          </div>
        ))}
        <div className={cn(rule, "mt-1.5 border-b py-1.5 flex justify-between gap-2 text-md font-extrabold")}>
          <dt>GRAND TOTAL</dt><dd>{moneyPrecise(o.payable)}</dd>
        </div>
      </dl>}

      <div className="mt-2 text-xs">
        {/* D27-324: a paid bill voided by the owner, an administrator or the
            GM. Its number stays; the paper says VOID, why, who and when. */}
        {nc ? (
          <div data-bill-nc className="border-t border-dashed border-ink-700 pt-1.5">
            <p className="font-semibold">NC · No charge - {o.ncReason ?? "-"}</p>
            <p className="mt-0.5">Approved by {o.ncBy ?? "-"} at {o.ncAt ?? "-"}</p>
          </div>
        ) : o.status === "void" ? (
          <div data-bill-void>
            <p className="font-semibold">VOID - {o.voidReason ?? "-"}</p>
            <p className="mt-0.5">
              Voided by {o.voidedBy ?? "-"} at {o.voidedAt ?? "-"}
              {o.voidReference && <>; refund reference <span className="tabular">{o.voidReference}</span></>}
            </p>
          </div>
        ) : o.status === "settled" && (
          <p>
            {/* D17-21: nothing was paid at the till — it went on the
                function's bill, and the host pays for it there. */}
            {o.paymentMethod === "function"
              ? `Charged to ${o.eventTitle ?? "the function"}'s bill`
              : allowanceWords(o.tenders) ?? <>Paid by {o.paymentMethod}
                  {o.paymentMethod === "room" && " - charged to the guest's bill"}</>}
          </p>
        )}
        {/* D22-44: the alcohol's own VAT bill, issued when this was paid,
            and it names this bill back. */}
        {o.vatBill && (
          <p className="mt-0.5" data-bill-vat-bill>
            Alcohol billed under VAT: VAT bill <span className="tabular">{o.vatBill}</span>
            {o.status === "void" && " - cancelled with this bill"}
          </p>
        )}
      </div>

      <p className="mt-3 text-center font-semibold">Thank you. Visit again.</p>
      {test && <TestDocumentMark slip {...(sample ? { label: sample } : {})} />}
    </article>
  );
}
