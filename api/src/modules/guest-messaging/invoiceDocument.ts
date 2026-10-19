import PDFDocument from "pdfkit";
import type { InvoiceFacts } from "../finance/index.ts";
import { inr, TEST_MARK } from "../../reportRender.ts";
import type { SendableFile } from "../../sending.ts";
import type { Client } from "../../db.ts";
import { plain } from "./voucherDocument.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TAX INVOICE, AS A PDF FOR THE GUEST (D27-252, D27-261)

   The invoice the desk prints is drawn by the browser (finance's
   Invoice page). Sending it needs it as a file, so it is drawn here from
   the SAME facts - finance's `invoiceFacts`, the one query the screen's
   route reads - as the SAME document (the owner's D27-343, "one PDF", A4):
   the printed page's sections in its order, in Fidato's document style
   (the voucher's colours), with the hotel's and the group's logos and the
   group's office. A tax invoice only: credit notes are never sent (Q6),
   and an invoice since credited is not owed (193).

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
    b.half = Math.ceil(Math.round(b.tax * 100) / 2) / 100;
  }
  return [...bands.values()].sort((a, b) => a.rate - b.rate);
}

/** Each line's CGST and SGST, as the printed invoice splits them (a copy of
    src/modules/finance/pages/Invoice.tsx's splitByLine - the API never imports
    web code): CGST the odd paisa; the last line takes what keeps each column
    equal to the invoice's stored total.
    ponytail: duplicated helper, as amountInWords above. */
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

/** The hotel's and the group's logos (PNG only: pdfkit draws no SVG - the
    voucher's rule) and the group's name and office, for the masthead and the
    foot (D27-343). Each null where not set. */
export interface InvoiceBrand {
  groupName: string | null;
  hotelLogoPng: string | null;
  groupLogoPng: string | null;
  office: { address: string | null; phone: string | null; email: string | null;
            website: string | null; instagram: string | null } | null;
}
export const NO_BRAND: InvoiceBrand = { groupName: null, hotelLogoPng: null, groupLogoPng: null, office: null };

export async function invoiceBrand(client: Client, hotelId: string): Promise<InvoiceBrand> {
  const { rows } = await client.query<Record<string, string | null>>(
    `select gs.name,
            case when gs.logo_type = 'image/png' then encode(gs.logo, 'base64') end as group_logo,
            gs.office_address, gs.phone, gs.email, gs.website, gs.instagram,
            (select case when l.logo_type = 'image/png' then encode(l.logo, 'base64') end
               from hotel_logos l where l.hotel_id = $1) as hotel_logo
       from (select 1) one left join group_settings gs on true`,
    [hotelId]);
  const r = rows[0] ?? {};
  const png = (v: string | null | undefined) => (v ? v.replace(/\s/g, "") : null);
  return {
    groupName: r["name"] ?? null,
    hotelLogoPng: png(r["hotel_logo"]), groupLogoPng: png(r["group_logo"]),
    office: { address: r["office_address"] ?? null, phone: r["phone"] ?? null, email: r["email"] ?? null,
              website: r["website"] ?? null, instagram: r["instagram"] ?? null },
  };
}

/* Fidato's document colours (the voucher's, the CRS's). */
const INK = "#142B3A";
const ORANGE = "#FE611F";
const GREY = "#67737E";
const LINE = "#DFE3E6";
const WASH = "#FAFBFB";
const PEACH = "#FFF6F1";

/** THE SAME INVOICE AS THE PRINTED ONE (the owner's D27-343: "one PDF", A4):
    the printed page's sections in its order - the masthead with both logos,
    the hotel's contacts with GSTIN and PAN, the stay in two columns, every
    line with its SAC and taxes, words, payments and tax by rate beside the
    totals, who checked the guest in and out, two signatures, the group's
    office at the foot. Helvetica, so WinAnsi: "INR", never the rupee sign
    (plain()). A long bill runs onto a second page, a row at a time. */
export async function invoicePdf(given: InvoiceFacts, test = false, brand: InvoiceBrand = NO_BRAND): Promise<Buffer> {
  /* D27-296 (8): a test hotel's invoice is not a valid one, and carries no
     GSTIN - neither the hotel's nor the company's it is made out to - and so
     no PAN. */
  const f: InvoiceFacts = test
    ? { ...given, supplier: { ...given.supplier, gstin: null, pan: null }, recipient: { ...given.recipient, gstin: null } }
    : given;
  const pdf = new PDFDocument({ size: "A4", margin: 0, info: { Title: plain(`Tax Invoice ${f.number}`) } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok) => pdf.on("end", () => ok(Buffer.concat(chunks))));
  pdf.page.margins.bottom = -100000;

  const PH = pdf.page.height;
  const M = 37;
  const R = pdf.page.width - M;
  const W = R - M;
  const isCreditNote = f.creditsInvoiceId !== null;
  const sign = (n: number) => (isCreditNote ? -n : n);
  const fig = (n: number) => inr(n || 0);
  /* "11 Oct 2026", as the printed page writes a day. */
  const day = (iso: string | null | undefined) => (iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "-");
  const text = (value: unknown, x: number, y: number, o: {
    size?: number; color?: string; bold?: boolean; align?: "left" | "right" | "center"; width?: number;
  } = {}) => {
    const { size = 8.5, color = INK, bold = false, align = "left", width = W } = o;
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
    pdf.text(plain(value), x, y, { width, align });
    return pdf.heightOfString(plain(value), { width });
  };
  const label = (value: string, x: number, y: number, o: { width?: number; align?: "left" | "right" } = {}) =>
    text(value.toUpperCase(), x, y, { size: 6.2, color: GREY, bold: true, ...o });
  const rule = (y: number, color = LINE, width = 0.6, x1 = M, x2 = R) =>
    pdf.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke();
  let y = M;
  /** A new page when `need` does not fit; true when one was begun. */
  const room = (need: number) => {
    if (y + need <= PH - M) return false;
    pdf.addPage({ size: "A4", margin: 0 });
    pdf.page.margins.bottom = -100000;
    y = M;
    return true;
  };

  /* ── The masthead: both logos, the hotel, "by" the group; the document ── */
  let lx = M;
  for (const logo of [brand.hotelLogoPng, brand.groupLogoPng]) {
    if (!logo) continue;
    try { pdf.image(Buffer.from(logo, "base64"), lx, y, { fit: [110, 34] }); lx += 122; } catch { /* not a picture: left out */ }
  }
  let ly = lx > M ? y + 40 : y;
  ly += text(f.supplier.name ?? "-", M, ly, { size: 15, bold: true, width: W - 170 });
  if (brand.groupName) ly += text(`by ${brand.groupName}`, M, ly + 1, { size: 8, color: GREY, bold: true, width: W - 170 }) + 1;
  const tx = R - 150;
  let ty = Math.max(y, ly - 46);
  const titleTop = ty;
  ty += text(test ? TEST_MARK : isCreditNote ? "CREDIT NOTE" : "TAX INVOICE", tx + 9, ty,
    { size: 11.5, bold: true, color: test ? ORANGE : INK, width: 141 });
  ty += text(f.number ?? "-", tx + 9, ty + 1, { size: 8, color: GREY, width: 141 }) + 1;
  ty += text(f.issuedAt ?? "-", tx + 9, ty, { size: 8, color: GREY, width: 141 });
  /* The guest's copy (D27-344; CGST Rule 48). */
  ty += text("ORIGINAL FOR RECIPIENT", tx + 9, ty + 2, { size: 6.2, color: GREY, bold: true, width: 141 }) + 2;
  pdf.rect(tx, titleTop, 3, ty - titleTop).fill(ORANGE);
  y = Math.max(ly, ty) + 8;
  pdf.rect(M, y, W, 2.2).fill(ORANGE);
  y += 3;
  rule(y);
  y += 8;

  /* ── The hotel: where, how to reach it, GSTIN and PAN ── */
  /* The place once, as the printed page (src/modules/finance/place.ts): an
     address that names its city is complete. */
  const named = f.supplier.city && (f.supplier.address ?? "").toLowerCase().includes(f.supplier.city.toLowerCase());
  const place = named ? "" : [f.supplier.city, f.supplier.state].filter(Boolean).join(", ");
  const contact = [f.supplier.phone && `Phone ${f.supplier.phone}`, f.supplier.email && `E-mail ${f.supplier.email}`, f.supplier.website]
    .filter(Boolean).join(" - ");
  for (const line of [[f.supplier.address, place].filter(Boolean).join(", "), contact].filter(Boolean)) {
    y += text(line, M, y, { size: 7.6, color: GREY });
  }
  if (!test) y += text(`GSTIN ${f.supplier.gstin ?? "-"}${f.supplier.pan ? `  -  PAN ${f.supplier.pan}` : ""}`, M, y, { size: 7.6, bold: true });
  y += 8;

  /* ── A credit note's panel, as the screen's ── */
  const panel = (words: string) => {
    const h = pdf.font("Helvetica").fontSize(8.5).heightOfString(plain(words), { width: W - 20 }) + 12;
    pdf.rect(M, y, W, h).lineWidth(0.6).fillAndStroke(PEACH, LINE);
    pdf.rect(M, y, 3, h).fill(ORANGE);
    text(words, M + 10, y + 6, { width: W - 20 });
    y += h + 8;
  };
  if (isCreditNote) panel(`This is a credit note. It cancels tax invoice ${f.creditsNumber ?? "-"}.${f.reason ? ` ${f.reason}` : ""}`);
  if (!isCreditNote && f.creditedBy) panel(`Cancelled. Credit note ${f.creditedBy} was issued against this invoice.`);

  /* ── The bill and the stay, two columns ── */
  const st = f.stay ?? null;
  const hasFood = f.lines.some((l) => FOOD.includes(l.category));
  const left: [string, string][] = [
    ...(st ? [["Booking ref", st.reference], ["G.R. card no", st.grCardNo == null ? "-" : String(st.grCardNo)], ["Guest name", st.guest]] as [string, string][] : []),
    ["Bill to", f.recipient.name ?? "-"],
    ...(f.recipient.address ? [["Bill to address", f.recipient.address]] as [string, string][] : []),
    ...(test ? [] : [["Bill to GSTIN", f.recipient.gstin ?? "not registered"]] as [string, string][]),
    ...(st ? [["Source", st.source ?? "-"]] as [string, string][] : []),
    ["Place of supply", f.placeOfSupply ?? "-"],
    ...(hasFood ? [["FSSAI licence", f.supplier.fssai ?? "-"]] as [string, string][] : []),
  ];
  const right: [string, string][] = [
    ...(f.businessDate ? [["Business date", day(f.businessDate)]] as [string, string][] : []),
    ...(st ? [
      ["Room", `${st.roomType} / ${st.room ?? "-"}`],
      ["Persons", `${st.adults} adults - ${st.children} children`],
      ["Rate type", st.plan ?? "-"],
      ["Nights", st.nights === 0 ? "Day use" : String(st.nights)],
      ["Arrival", st.arrival], ["Departure", st.departure],
    ] as [string, string][] : []),
  ];
  const half = W / 2;
  const facts = (rows: [string, string][], x: number, top: number) => {
    let fy = top;
    for (const [k, v] of rows) {
      text(k, x, fy + 0.6, { size: 7.4, color: GREY, width: 78 });
      fy += Math.max(text(v, x + 80, fy, { size: 8.4, bold: true, width: half - 92 }), 10) + 2.5;
    }
    return fy;
  };
  const factsTop = y;
  const bottom = Math.max(facts(left, M, y), facts(right, M + half + 10, y));
  pdf.moveTo(M + half, factsTop).lineTo(M + half, bottom).lineWidth(0.6).strokeColor(LINE).stroke();
  y = bottom + 4;
  y += text(f.sacCode === "996311"
    ? "Accommodation is supplied at the property's location - IGST Act s.12(3)(b) - so this supply is intra-state."
    : "A function at the property is supplied at the property's location - IGST Act s.12(3)(c) - so this supply is intra-state.",
  M, y, { size: 7.2, color: GREY }) + 3;
  if (f.vatBill) y += text(`Alcohol on this stay is billed separately, under VAT: VAT bill ${f.vatBill}.`, M, y, { size: 8 }) + 3;
  y += 8;

  /* ── Every line ── */
  const cols: [string, number, "left" | "right"][] = [
    ["Sr", 16, "left"], ["Particular", 118, "left"], ["SAC", 40, "left"], ["Qty", 22, "right"],
    ["Rate", 46, "right"], ["Total", 46, "right"], ["Discount", 42, "right"], ["Taxable", 48, "right"],
    ["SGST", 40, "right"], ["CGST", 40, "right"], ["IGST", 34, "right"], ["CESS", 29, "right"],
  ];
  const xs: number[] = [];
  cols.reduce((x, [, w]) => { xs.push(x); return x + w; }, M);
  const cell = (i: number, v: string, yy: number, o: { bold?: boolean; color?: string; size?: number } = {}) =>
    text(v, xs[i]! + (i === 0 ? 0 : 2), yy, { size: o.size ?? 7.4, bold: o.bold ?? false, color: o.color ?? INK,
      width: cols[i]![1] - (i === 0 ? 2 : 4), align: cols[i]![2] });
  const head = () => {
    cols.forEach(([t], i) => label(t, xs[i]! + (i === 0 ? 0 : 2), y, { width: cols[i]![1] - (i === 0 ? 2 : 4), align: cols[i]![2] }));
    y += 10;
    rule(y, INK, 1.2);
    y += 4;
  };
  head();
  const isDiscount = (c: string) => c === "discount";
  const halves = splitByLine(f.lines, f.cgst.amount, f.sgst.amount);
  f.lines.forEach((l, i) => {
    /* A long bill's next page repeats the columns' names. */
    if (room(26)) head();
    const off = isDiscount(l.category);
    const pct = `${fig(l.taxRate / 2)} %`;
    cell(0, String(i + 1), y, { color: GREY });
    const h = cell(1, l.description, y, { bold: true });
    text(day(l.date), xs[1]! + 2, y + h, { size: 6.4, color: GREY, width: cols[1]![1] - 4 });
    cell(2, l.sac ?? "-", y, { color: GREY });
    cell(3, "1", y);
    cell(4, off ? "-" : fig(sign(l.amount)), y);
    cell(5, off ? "-" : fig(sign(l.amount)), y);
    cell(6, fig(off ? sign(-l.amount) : 0), y);
    cell(7, fig(sign(l.amount)), y, { bold: true });
    cell(8, fig(sign(halves[i]!.sgst)), y); cell(8, pct, y + 9, { size: 6.4, color: GREY });
    cell(9, fig(sign(halves[i]!.cgst)), y); cell(9, pct, y + 9, { size: 6.4, color: GREY });
    cell(10, "0.00", y); cell(10, "0.00 %", y + 9, { size: 6.4, color: GREY });
    cell(11, "0.00", y);
    y += Math.max(h + 9, 18) + 3;
    rule(y);
    y += 4;
  });
  if (f.lines.length === 0) { y += text("No chargeable lines.", M, y, { color: GREY }) + 4; }
  const charges = f.lines.filter((l) => !isDiscount(l.category)).reduce((n, l) => n + l.amount, 0);
  const discount = -f.lines.filter((l) => isDiscount(l.category)).reduce((n, l) => n + l.amount, 0) || 0;
  room(20);
  rule(y - 4, INK, 1.2);
  cell(4, "Total", y, { bold: true });
  [charges, discount, f.taxableValue, f.sgst.amount, f.cgst.amount, 0, 0]
    .forEach((n, i) => cell(5 + i, fig(sign(n)), y, { bold: true }));
  y += 18;

  /* ── Words, payments and tax by rate; the totals ── */
  const payments = isCreditNote ? [] : f.payments ?? [];
  const received = Math.round(payments.reduce((n, p) => n + p.amount, 0) * 100) / 100;
  const bands = rateWise(f.lines);
  const LW = W - 215;
  room(60 + payments.length * 13 + bands.length * 26);
  const sectionTop = y;
  label("Total payable, in words", M, y);
  y += 9;
  y += text(amountInWords(f.total), M, y, { size: 8.4, width: LW }) + 8;
  const smallTable = (heads: [string, number, "left" | "right"][], rows: string[][], total?: string[]) => {
    let x = M;
    const at: number[] = heads.map(([, w]) => { const v = x; x += w; return v; });
    heads.forEach(([t, w, a], i) => label(t, at[i]!, y, { width: w - 4, align: a }));
    y += 10; rule(y, INK, 1.2); y += 4;
    for (const r of [...rows, ...(total ? [total] : [])]) {
      const bold = r === total;
      let h = 0;
      r.forEach((v, i) => { h = Math.max(h, text(v, at[i]!, y, { size: 7.6, bold, width: heads[i]![1] - 4, align: heads[i]![2] })); });
      y += h + 3;
      if (!bold) { rule(y); y += 4; }
    }
    y += 6;
  };
  if (payments.length) {
    smallTable([["Payment date", 70, "left"], ["Description", LW - 150, "left"], ["Amount", 80, "right"]],
      payments.map((p) => [day(p.date), p.description, fig(p.amount)]), ["", "Total", fig(received)]);
  }
  smallTable([["Tax details", LW - 160, "left"], ["Taxable amount", 80, "right"], ["Tax amount", 80, "right"]],
    bands.flatMap((b) => [
      [`SGST @ ${fig(b.rate / 2)}%`, fig(sign(b.taxable)), fig(sign(b.tax - b.half))],
      [`CGST @ ${fig(b.rate / 2)}%`, fig(sign(b.taxable)), fig(sign(b.half))],
    ]));
  const leftEnd = y;
  /* The totals, as DocTotals: label left, figure right, the total over an ink rule. */
  const TX = R - 190;
  let yy = sectionTop;
  const total = (k: string, v: string, o: { strong?: boolean; quiet?: boolean } = {}) => {
    text(k, TX, yy, { size: o.strong ? 10 : 8.4, bold: o.strong ?? false, color: o.strong ? INK : GREY, width: 100 });
    text(v, TX + 90, yy, { size: o.strong ? 11 : 8.4, bold: !o.quiet, color: o.quiet ? GREY : INK, width: 100, align: "right" });
    yy += o.strong ? 17 : 13;
  };
  total("Total charges", money(sign(charges)));
  total("Total discount", money(sign(discount) || 0));
  total("Total SGST", money(sign(f.sgst.amount)));
  total("Total CGST", money(sign(f.cgst.amount)));
  total("Total IGST", money(0));
  rule(yy, INK, 1.2, TX, R);
  yy += 5;
  total("Total", money(sign(f.total)), { strong: true });
  if (!isCreditNote) {
    total("Total payment", money(received), { quiet: true });
    total("Balance", money(Math.round((f.total - received) * 100) / 100 || 0), { quiet: true });
  }
  y = Math.max(leftEnd, yy) + 8;

  /* ── Who checked the guest in and out, who issued it: the washed strip ── */
  room(34 + 130);
  const strip = [
    ...(st ? [["Reception (C/I)", st.checkedInBy ?? "-"], ["Cashier (C/O)", st.checkedOutBy ?? "-"]] : []),
    ["Issued by", f.issuedBy ?? "-"], ["Currency", "INR"],
  ];
  pdf.rect(M, y, W, 30).lineWidth(0.6).fillAndStroke(WASH, LINE);
  const cw = W / strip.length;
  strip.forEach(([k, v], i) => {
    if (i > 0) pdf.moveTo(M + cw * i, y).lineTo(M + cw * i, y + 30).lineWidth(0.6).strokeColor(LINE).stroke();
    label(k!, M + cw * i + 8, y + 6, { width: cw - 16 });
    text(v, M + cw * i + 8, y + 15, { size: 8.6, bold: true, width: cw - 16 });
  });
  y += 30 + 34;

  /* ── The two signatures: the guest's; the hotel's (Rule 46) ── */
  pdf.moveTo(M, y).lineTo(M + 130, y).lineWidth(0.6).strokeColor(INK).stroke();
  text("Guest signature", M, y + 4, { size: 7.6, bold: true, width: 130, align: "center" });
  pdf.moveTo(R - 160, y).lineTo(R, y).lineWidth(0.6).strokeColor(INK).stroke();
  text(`For ${f.supplier.name ?? "-"}`, R - 160, y + 4, { size: 7.6, width: 160, align: "center" });
  text("Authorised signatory", R - 160, y + 14, { size: 7.6, color: GREY, width: 160, align: "center" });
  y += 34;

  /* ── The group's office at the foot (D27-215), as the voucher's ── */
  rule(y, INK, 1.6);
  y += 6;
  const o = brand.office;
  const office = o ? [
    o.address,
    [o.phone && `Phone ${o.phone}`, o.email].filter(Boolean).join(" - "),
    [o.website, o.instagram && `Instagram ${o.instagram}`].filter(Boolean).join(" - "),
  ].filter(Boolean) as string[] : [];
  text((brand.groupName ?? f.supplier.name ?? "-").toUpperCase(), M, y, { size: 7.2, bold: true, width: half });
  if (!test) text(`GSTIN ${f.supplier.gstin ?? "-"}`, M + half, y, { size: 7.2, color: GREY, width: half, align: "right" });
  y += 10;
  for (const line of office.length ? office : [f.supplier.address ?? ""].filter(Boolean)) {
    y += text(line, M, y, { size: 7.2, color: GREY, width: half });
  }
  y += 6;
  text(`A computer-generated document, series ${f.finYear ?? "-"}. An issued tax invoice is not amended: `
    + "any correction is a credit note with its own number.", M, y, { size: 7, color: GREY, align: "center" });

  pdf.end();
  return done;
}

/** The invoice as a file to go with its message. */
export async function invoiceFile(f: InvoiceFacts, test = false, brand: InvoiceBrand = NO_BRAND): Promise<SendableFile> {
  return {
    name: `Invoice-${(f.number ?? "").replace(/[^A-Za-z0-9-]/g, "-")}.pdf`,
    contentType: "application/pdf",
    bytes: await invoicePdf(f, test, brand),
  };
}
