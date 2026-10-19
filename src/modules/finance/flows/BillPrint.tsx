import { moneyPrecise, dateShort } from "@/lib/format";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";
import type { GroupSettings } from "@/modules/admin";
import type { StayBill } from "../data/bill";
import type { InvoiceDetail } from "../data/billing";
import { InvoiceSheet, type Proforma } from "../pages/Invoice";

/* ══════════════════════════════════════════════════════════════════
   THE PROFORMA BILL — one layout, for the desk and the guest (D21-10;
   the owner's D27-344: "remove the interim bill, just add it as a proforma
   bill")

   The stay's bill as it stands, drawn by the tax invoice's own sheet, so the
   two read alike: the hotel, the stay, every line with its HSN/SAC and taxes,
   the payments, the totals, then paid, anything still to be posted tonight,
   and the balance due. Titled "Proforma Bill" and saying it is not a tax
   invoice (D22-7's worry, kept). Alcohol keeps its VAT, one row per rate,
   never CGST and SGST (D21-91).

   It draws the bill `app.stay_bill` answers and computes nothing but the
   paise of tonight's night, as before: every figure, tax row and total
   arrives from the server. The desk's bill also carries the stay, the
   payments, the hotel's contacts and each line's SAC (D27-344); the guest's
   own page reads the plain bill, and those parts are simply left out.
   ══════════════════════════════════════════════════════════════════ */

const NO_GROUP: GroupSettings = { name: null, logo: null };
const cents = (n: number) => Math.round(n * 100);

/** The stay's bill as the sheet reads it, and what makes it a proforma. */
export function proformaOf(bill: StayBill): { data: InvoiceDetail; proforma: Proforma } {
  const { hotel, stay } = bill;
  const gst = (k: "cgst" | "sgst") => bill.taxes.reduce((n, t) => n + cents(t[k]), 0) / 100;
  const lines = bill.lines.filter((l) => l.category !== "tax").map((l) => {
    const vat = (l.scheme ?? "gst") === "vat";
    return {
      description: l.description, category: l.category, amount: l.amount, date: l.date,
      taxRate: vat ? 0 : l.rate ?? 0, taxAmount: vat ? 0 : l.tax, sac: l.sac ?? null,
      ...(vat ? { vat: { rate: l.rate ?? 0, amount: l.tax } } : {}),
    };
  });
  /* TONIGHT'S NIGHT, NOT POSTED YET (the owner's D27-204): shown as "to be
     posted tonight" and counted in the amount due; the server's figures,
     added in paise. */
  const tonight = bill.tonight;
  const toPost = tonight ? cents(tonight.amount) + cents(tonight.tax) : 0;
  const due = (cents(bill.balance) + toPost) / 100;
  return {
    data: {
      number: stay.reference, finYear: "", issuedAt: "", issuedBy: null, businessDate: null,
      supplier: {
        name: hotel.name, address: hotel.address, city: hotel.city, state: hotel.state, gstin: hotel.gstin,
        fssai: hotel.fssai ?? null, phone: hotel.phone, email: hotel.email ?? null,
        website: hotel.website ?? null, pan: hotel.pan ?? null,
      },
      recipient: { name: stay.guest, gstin: null, address: null },
      placeOfSupply: hotel.state, sacCode: "996311",
      lines,
      taxableValue: bill.net,
      cgst: { rate: null, amount: gst("cgst") }, sgst: { rate: null, amount: gst("sgst") },
      taxTotal: bill.tax, total: bill.total,
      creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null, vatBill: null,
      stay: bill.details ?? null,
      payments: bill.payments ?? [],
    },
    proforma: {
      when: `${dateShort(stay.checkIn)} – ${dateShort(stay.checkOut)}${stay.room ? ` · room ${stay.room}` : ""}`,
      vat: bill.vat ?? [],
      after: [
        ["Paid", moneyPrecise(bill.paid)],
        ...(tonight ? [[
          <span key="t" data-bill-tonight>{`To be posted tonight · ${tonight.description}, with GST ${tonight.rate}%`}</span>,
          moneyPrecise(toPost / 100),
        ] as Proforma["after"][number]] : []),
        [due < 0 ? "Overpaid" : "Balance due", moneyPrecise(Math.abs(due))],
      ],
    },
  };
}

/** `group`: the group's name and logos from Settings (D27-53). The guest's own
    page has no sign-in to ask for them, so it prints the hotel's name alone.
    `title` is kept for its callers; the sheet says "Proforma Bill". */
export function BillPrint({ bill, group }: { bill: StayBill; title?: string; group?: GroupSettings }) {
  /* A TEST HOTEL'S BILL (the owner's D27-296 (8)): TEST · NOT VALID across
     its head, and no GSTIN. The guest's own page has no session: never one. */
  const test = useIsTestHotel();
  const { data, proforma } = proformaOf(bill);
  return (
    <div className="bg-white text-ink-700 border border-grey-200 rounded-lg p-5 sm:p-6 print:border-0 print:p-0 [print-color-adjust:exact]" data-bill-print>
      {test && <TestDocumentMark />}
      <InvoiceSheet data={data} hotelId="" test={test} group={group ?? NO_GROUP} proforma={proforma} />
    </div>
  );
}
