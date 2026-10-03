import PDFDocument from "pdfkit";
import type { InvoiceFacts } from "../finance/index.ts";
import { dateReport, inr } from "../../reportRender.ts";
import type { SendableFile } from "../../sending.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TAX INVOICE, AS A PDF FOR THE GUEST (D27-252, D27-261)

   The invoice the desk prints is drawn by the browser (finance's
   Invoice page). Sending it needs it as a file, so it is drawn here from
   the SAME facts - finance's `invoiceFacts`, the one query the screen's
   route reads - in the same order: the title and number, where it is
   supplied, the two parties, the lines, the rate-wise tax where there is
   more than one rate, the amount in words, CGST and SGST, the signature
   line and the footer. A tax invoice only: credit notes are never sent
   (Q6), and an invoice since credited is not owed (193).

   Plain text the PDF's own fonts can draw, as the voucher's: "INR 12,345.00",
   no rupee sign.
   ══════════════════════════════════════════════════════════════════ */

const FOOD = ["food", "beverage", "minibar"];
const money = (n: number) => `INR ${inr(n)}`;

/* ── A copy of src/lib/format.ts's amountInWords (the API never imports
   web code); api/test holds the two to the same answers.
   ponytail: duplicated helper - one shared package if a third caller appears. */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const underHundred = (n: number) => (n < 20 ? ONES[n]! : [TENS[Math.floor(n / 10)]!, ONES[n % 10]!].filter(Boolean).join(" "));
const underThousand = (n: number) => {
  const h = Math.floor(n / 100);
  const rest = underHundred(n % 100);
  return !h ? rest : rest ? `${ONES[h]} Hundred ${rest}` : `${ONES[h]} Hundred`;
};

export function amountInWords(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const totalPaise = Math.round(Math.abs(value) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rest = rupees % 1_000;
  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));
  const words = `${parts.length ? parts.join(" ") : "Zero"} ${rupees === 1 ? "Rupee" : "Rupees"}`;
  const all = paise ? `${words} and ${underHundred(paise)} ${paise === 1 ? "Paisa" : "Paise"}` : words;
  return `${value < 0 ? "Minus " : ""}${all} Only`;
}

/** The tax by rate, summed from what was posted - as the printed invoice's. */
export function rateWise(lines: { taxRate: number; amount: number; taxAmount: number }[]) {
  const bands = new Map<number, { rate: number; taxable: number; tax: number; half: number }>();
  for (const l of lines) {
    const b = bands.get(l.taxRate) ?? { rate: l.taxRate, taxable: 0, tax: 0, half: 0 };
    b.taxable += l.amount;
    b.tax += l.taxAmount;
    bands.set(l.taxRate, b);
  }
  for (const b of bands.values()) {
    b.taxable = Math.round(b.taxable * 100) / 100;
    b.tax = Math.round(b.tax * 100) / 100;
    b.half = Math.round((b.tax / 2) * 100) / 100;
  }
  return [...bands.values()].sort((a, b) => a.rate - b.rate);
}

export async function invoicePdf(f: InvoiceFacts): Promise<Buffer> {
  const pdf = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Tax Invoice ${f.number}` } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok) => pdf.on("end", () => ok(Buffer.concat(chunks))));

  const L = 48;
  const W = pdf.page.width - 96;
  const R = L + W;
  const grey = "#5b6670";
  const ink = "#142b3a";
  const label = (t: string, x: number, y: number) =>
    pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(grey).text(t.toUpperCase(), x, y, { characterSpacing: 0.6 });
  const rule = (y: number) => pdf.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor("#dfe3e6").stroke();

  /* ── Masthead ── */
  pdf.font("Helvetica-Bold").fontSize(15).fillColor(ink).text(f.supplier.name ?? "-", L, 48, { width: W * 0.6 });
  pdf.font("Helvetica-Bold").fontSize(13).text("Tax Invoice", L, 48, { width: W, align: "right" });
  pdf.font("Helvetica").fontSize(9).fillColor(grey)
    .text(f.number ?? "-", L, 66, { width: W, align: "right" })
    .text(f.issuedAt ?? "-", L, 78, { width: W, align: "right" });
  if (f.businessDate) pdf.text(`business date ${dateReport(f.businessDate)}`, L, 90, { width: W, align: "right" });
  pdf.moveTo(L, 108).lineTo(R, 108).lineWidth(2).strokeColor("#fe611f").stroke();

  /* ── Place of supply, SAC, total ── */
  let y = 120;
  const strip: [string, string][] = [
    ["Place of supply", f.placeOfSupply ?? "-"], ["SAC", f.sacCode ?? "-"], ["Total", money(f.total)],
  ];
  strip.forEach(([k, v], i) => {
    const x = L + (W / 3) * i;
    label(k, x, y);
    pdf.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(v, x, y + 11, { width: W / 3 - 8 });
  });
  y += 34;
  pdf.font("Helvetica").fontSize(7.5).fillColor(grey).text(f.sacCode === "996311"
    ? "Accommodation is supplied at the property's location - IGST Act s.12(3)(b) - so this supply is intra-state."
    : "A function at the property is supplied at the property's location - IGST Act s.12(3)(c) - so this supply is intra-state.",
  L, y, { width: W });
  y += 14;
  if (f.vatBill) {
    pdf.fontSize(8.5).fillColor(ink).text(`Alcohol on this stay is billed separately, under VAT: VAT bill ${f.vatBill}.`, L, y, { width: W });
    y += 14;
  }
  rule(y += 4);
  y += 10;

  /* ── The two parties ── */
  const half = W / 2;
  const top = y;
  label("Supplier", L, y);
  pdf.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(f.supplier.name ?? "-", L, y + 11, { width: half - 12 });
  let ly = pdf.y + 2;
  const place = [f.supplier.city, f.supplier.state].filter(Boolean).join(", ");
  for (const line of [f.supplier.address, place].filter(Boolean) as string[]) {
    pdf.font("Helvetica").fontSize(8).fillColor(grey).text(line, L, ly, { width: half - 12 });
    ly = pdf.y + 1;
  }
  pdf.font("Helvetica").fontSize(8).fillColor(grey).text("GSTIN", L, ly + 3);
  pdf.font("Helvetica-Bold").fillColor(ink).text(f.supplier.gstin ?? "-", L + 60, ly + 3);
  ly += 14;
  if (f.lines.some((l) => FOOD.includes(l.category))) {
    pdf.font("Helvetica").fillColor(grey).text("FSSAI licence", L, ly);
    pdf.font("Helvetica-Bold").fillColor(ink).text(f.supplier.fssai ?? "-", L + 60, ly);
    ly += 12;
  }
  const rx = L + half + 6;
  label("Billed to", rx, top);
  pdf.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(f.recipient.name ?? "-", rx, top + 11, { width: half - 6 });
  let ry = pdf.y + 2;
  if (f.recipient.address) {
    pdf.font("Helvetica").fontSize(8).fillColor(grey).text(f.recipient.address, rx, ry, { width: half - 6 });
    ry = pdf.y + 1;
  }
  pdf.font("Helvetica").fontSize(8).fillColor(grey).text("GSTIN", rx, ry + 3);
  pdf.font(f.recipient.gstin ? "Helvetica-Bold" : "Helvetica").fillColor(f.recipient.gstin ? ink : grey)
    .text(f.recipient.gstin ?? "not registered", rx + 60, ry + 3);
  y = Math.max(ly, ry + 14) + 12;

  /* ── Lines ── */
  const cDate = R - 190;
  const cAmt = R - 90;
  const head = (cols: [string, number, number, "left" | "right"][]) => {
    for (const [t, x, w, align] of cols) {
      pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(grey).text(t.toUpperCase(), x, y, { width: w, align });
    }
    y += 12;
    rule(y);
    y += 5;
  };
  const page = (need: number) => { if (y + need > pdf.page.height - 90) { pdf.addPage(); y = 48; } };
  head([["Description", L, cDate - L - 8, "left"], ["Date", cDate, 90, "left"], ["Taxable value", cAmt, 90, "right"]]);
  for (const l of f.lines) {
    page(16);
    pdf.font("Helvetica-Bold").fontSize(9).fillColor(ink).text(l.description, L, y, { width: cDate - L - 8 });
    const h = pdf.y - y;
    pdf.font("Helvetica").fillColor(grey).text(dateReport(l.date), cDate, y, { width: 90 });
    pdf.font("Helvetica-Bold").fillColor(ink).text(money(l.amount), cAmt, y, { width: 90, align: "right" });
    y += Math.max(h, 12) + 4;
  }
  if (f.lines.length === 0) {
    pdf.font("Helvetica").fontSize(9).fillColor(grey).text("No chargeable lines.", L, y);
    y += 14;
  }
  rule(y);
  y += 10;

  /* ── Rate by rate, where the bill carries more than one ── */
  const bands = rateWise(f.lines);
  if (bands.length > 1) {
    page(30 + bands.length * 14);
    label("Tax, rate by rate", L, y);
    y += 12;
    const w = W / 4;
    head([["GST rate", L, w, "left"], ["Taxable value", L + w, w, "right"], ["CGST", L + 2 * w, w, "right"], ["SGST", L + 3 * w, w, "right"]]);
    for (const b of bands) {
      pdf.font("Helvetica").fontSize(9).fillColor(ink).text(`${b.rate}%`, L, y, { width: w });
      pdf.text(money(b.taxable), L + w, y, { width: w, align: "right" });
      pdf.text(money(b.half), L + 2 * w, y, { width: w, align: "right" });
      pdf.text(money(b.tax - b.half), L + 3 * w, y, { width: w, align: "right" });
      y += 14;
    }
    y += 6;
  }

  /* ── The words, and the totals ── */
  page(110);
  label("Amount in words", L, y);
  pdf.font("Helvetica").fontSize(9).fillColor(ink).text(amountInWords(f.total), L, y + 11, { width: W * 0.5 });
  const tx = R - 220;
  const totals: [string, string, boolean][] = [
    ["Taxable value", money(f.taxableValue), false],
    [`CGST${f.cgst.rate === null ? "" : ` @ ${f.cgst.rate}%`}`, money(f.cgst.amount), false],
    [`SGST${f.sgst.rate === null ? "" : ` @ ${f.sgst.rate}%`}`, money(f.sgst.amount), false],
    ["Total", money(f.total), true],
  ];
  let ty = y;
  for (const [k, v, strong] of totals) {
    if (strong) { pdf.moveTo(tx, ty).lineTo(R, ty).lineWidth(0.8).strokeColor(ink).stroke(); ty += 4; }
    pdf.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 11 : 9).fillColor(ink)
      .text(k, tx, ty, { width: 110 }).text(v, tx + 110, ty, { width: 110, align: "right" });
    ty += strong ? 16 : 13;
  }
  y = Math.max(ty, pdf.y) + 40;

  /* ── The signature (Rule 46), then who issued it ── */
  page(60);
  pdf.moveTo(R - 180, y).lineTo(R, y).lineWidth(0.6).strokeColor(ink).stroke();
  pdf.font("Helvetica").fontSize(8).fillColor(ink).text(`For ${f.supplier.name ?? "-"}`, R - 180, y + 4, { width: 180, align: "center" });
  pdf.fillColor(grey).text("Authorised signatory", R - 180, y + 15, { width: 180, align: "center" });
  y += 40;
  rule(y);
  pdf.font("Helvetica").fontSize(7.5).fillColor(grey).text(
    `This is a computer-generated document. Issued${f.issuedBy ? ` by ${f.issuedBy}` : ""} against invoice `
    + `series ${f.finYear ?? "-"}. An issued tax invoice is not amended. Any correction is made by a credit `
    + `note carrying its own number.  GSTIN ${f.supplier.gstin ?? "-"}`,
    L, y + 6, { width: W });

  pdf.end();
  return done;
}

/** The invoice as a file to go with its message. */
export async function invoiceFile(f: InvoiceFacts): Promise<SendableFile> {
  return {
    name: `Invoice-${(f.number ?? "").replace(/[^A-Za-z0-9-]/g, "-")}.pdf`,
    contentType: "application/pdf",
    bytes: await invoicePdf(f),
  };
}
