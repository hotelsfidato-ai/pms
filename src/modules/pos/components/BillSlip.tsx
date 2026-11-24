import { cn } from "@/lib/cn";
import { moneyPrecise, dateShort } from "@/lib/format";
import { addonBreakdown } from "@/modules/pos/lib/pricing";
import { oneLinePerDish } from "@/modules/pos/lib/oneLinePerDish";
import { BILL_TITLE, allowanceWords, type BillHeading, type Order } from "@/modules/pos/data/till";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";
import { UpiQr } from "@/modules/finance";

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

   FOOD AND LIQUOR APART (the owner, 25 November): with Separate bills ticked,
   BillPaper prints two slips on the one roll, a tear line between - the Food
   bill (the GST lines) and the Liquor bill (the VAT lines). Each takes its
   scheme's own Sub total, discount share, service charge and tax from the
   database's split (`schemes`). The Liquor bill's total is exactly its VAT
   bill's (taxable + VAT); the Food bill carries the round off, so the two
   GRAND TOTALs add up to `payable`, what the guest pays once.
   ══════════════════════════════════════════════════════════════════ */

/** A figure in a column: paise, no rupee sign, as a restaurant bill prints. */
const fig = (v: number) => moneyPrecise(v).replace("₹", "");

type Part = "food" | "liquor";
const schemeOf = (p: Part) => (p === "liquor" ? "vat" : "gst");
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Both kinds of line on a live bill: what Separate bills can split. */
export const hasFoodAndLiquor = (o: Pick<Order, "lines">) => {
  const live = o.lines.filter((l) => !l.voided);
  return live.some((l) => l.taxScheme === "vat") && live.some((l) => l.taxScheme !== "vat");
};

/** The bill as it prints: one slip, or Food and Liquor apart when the
    cashier ticked Separate bills on an open or paid bill with both. */
export function BillPaper({ order: o, heading }: { order: Order; heading: BillHeading }) {
  const apart = Boolean(o.separateBills) && (o.status === "open" || o.status === "settled")
    && hasFoodAndLiquor(o) && Boolean(o.schemes?.length);
  if (!apart) return <BillSlip order={o} heading={heading} />;
  return (
    <>
      <BillSlip order={o} heading={heading} part="food" />
      <p className="mx-auto bg-white py-2 text-center text-xs tracking-[0.3em] text-ink-700"
         style={{ maxWidth: "80mm" }} data-bill-tear>- - - - - tear here - - - - -</p>
      <BillSlip order={o} heading={heading} part="liquor" />
    </>
  );
}

export function BillSlip({ order: whole, heading, sample, part }: {
  order: Order; heading: BillHeading;
  /** Settings › Documents' made-up bill: SAMPLE · NOT VALID, no GSTIN (D27-348). */
  sample?: string;
  /** One of the two papers of Separate bills (the owner, 25 November). */
  part?: Part;
}) {
  const o = part ? partOf(whole, part) : whole;
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
      `${o.couponCode ? `Coupon ${o.couponCode}` : "Discount"}${o.discountType === "percent" && o.discountValue !== null ? ` ${o.discountValue}%` : ""}`,
      fig(-o.discount),
    ] as [string, string]] : []),
    /* The voluntary service charge the guest agreed to (260): it says so,
       as the CCPA's guidelines ask; the tax lines below include its GST. */
    ...(o.serviceCharge ? [[`Service charge ${o.serviceChargePct}% (voluntary)`, fig(o.serviceCharge)] as [string, string]] : []),
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

      <p className={cn(rule, "mt-3 border-b py-1.5 text-center font-extrabold uppercase tracking-[0.2em]")}
         data-bill-part={part}>
        {BILL_TITLE[heading]}{part === "food" ? " · Food" : part === "liquor" ? " · Liquor" : ""}
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

      {/* THE UPI QR (D27-396): an open bill only, for its GRAND TOTAL; never a
          paid, void or NC bill, nor a test or sample one. */}
      {o.status === "open" && !test && <UpiQr upi={o.upi} amount={o.payable} note={`Bill ${o.orderNo}`} />}

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
        {/* A tip for the staff (260), taken with the payment: not part of the bill. */}
        {o.tip && part !== "liquor" ? (
          <p className="mt-0.5 tabular" data-bill-tip>
            Tip for the staff {fig(o.tip)} by {o.tipMethod === "upi" ? "UPI" : o.tipMethod} - not part of the bill
          </p>
        ) : null}
        {/* D22-44: the alcohol's own VAT bill, issued when this was paid,
            and it names this bill back. */}
        {part === "food" && (
          <p className="mt-0.5" data-bill-other-part>Liquor on its own bill, the same bill number</p>
        )}
        {o.vatBill && part !== "food" && (
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

/* One part of the bill as an Order of its own: its lines and its scheme's
   figures; the Food bill takes the round off so the two add up to the whole
   (the owner, 25 November). */
function partOf(o: Order, part: Part): Order {
  const scheme = schemeOf(part);
  const mine = (x: string | undefined) => (x === "vat" ? "vat" : "gst") === scheme;
  const f = o.schemes?.find((t) => t.scheme === scheme)
    ?? { net: 0, discount: 0, service: 0, taxable: 0, tax: 0 };
  const vat = o.schemes?.find((t) => t.scheme === "vat");
  const liquorTotal = vat ? r2(vat.taxable + vat.tax) : 0;
  const payable = part === "liquor" ? liquorTotal : r2(o.payable - liquorTotal);
  return {
    ...o,
    lines: o.lines.filter((l) => mine(l.taxScheme)),
    taxes: o.taxes.filter((t) => t.scheme === scheme),
    net: f.net,
    discount: f.discount,
    serviceCharge: f.service,
    taxable: f.taxable,
    tax: f.tax,
    roundOff: part === "liquor" ? 0 : r2(payable - f.taxable - f.tax),
    gross: r2(f.taxable + f.tax),
    payable,
  };
}
