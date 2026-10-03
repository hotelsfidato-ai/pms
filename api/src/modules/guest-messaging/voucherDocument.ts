import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { Client } from "../../db.ts";
import { dateReport, inr } from "../../reportRender.ts";
import type { SendableFile } from "../../sending.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BOOKING VOUCHER - the PMS's own confirmation, in the CRS's design
   (D27-171, D27-172)

   One voucher per booking (per group, about its lead: D22-41), sent once
   (D27-35) from the CRS's mailbox as this PDF, attached to the booking
   confirmation's email. The layout is the CRS's printed voucher
   (D:\fidato crs, src/features/reservations/voucherPdf.ts, read, not
   copied): masthead, status strip, hotel beside guest, the stay strip,
   rooms and rates, totals, "Confirmed by the hotel", the policies, the
   footer. Drawn with pdfkit, as the reports are, in vector text.

   THE OWNER'S ANSWERS (D27-172), each one line below:
     V1  per room, the nightly rate the audit posts x nights; then room
         charges, GST by the per-night slab, and the total. NO GST RATE SET:
         GST AND THE TOTAL PRINT "-" - never a total nobody agreed to.
         "Complimentary" where so. No payment line.
     V4  the booking's own cancellation terms and the hotel's check-in and
         check-out times; no bank section until bank details exist.
     V5  "Confirmed by the hotel": the PMS reference, the clerk, and when.

   REFINED TO THE OWNER'S REFERENCE (D27-215, 1 October; facts from 169):
     - a PAYMENT cell beside the total (this lifts V1's "no payment line"):
       the advance the booking's bills have received and the balance at the
       hotel; "Pay at the hotel"; "Bill to company". Never a negative balance,
       never one worked from a total nobody agreed to;
     - BANK DETAILS when the hotel has set them (this lifts V4's "no bank
       section"), the block left out when not;
     - the hotel's reservations contact, who booked, extra guests under a
       room's line, the hotel's house policies after the booking's terms;
     - the footer is the GROUP's office once any of it is typed in Settings,
       and its Instagram address a line of text (no QR code yet).
   What each of these SAYS is worked out in voucherBlocks, and the PDF draws
   exactly that. A hotel with nothing new set prints the voucher it printed
   before, but for the Payment cell.

   ⚠ WinAnsi only - pdfkit's Helvetica cannot draw the rupee sign, a long
   dash or a middot. Money prints "INR 12,345.67" and everything goes
   through `plain()`, as the CRS's does.
   ══════════════════════════════════════════════════════════════════ */

export interface VoucherRoom {
  roomType: string;
  adults: number;
  children: number;
  nights: number;
  /** The code with its words, "EP · Room only" (meal_plans, D27-164). */
  mealPlan: string | null;
  /** The nightly rate the audit posts, before tax; null where none is set. */
  rate: number | null;
  complimentary: boolean;
  /** The database's GST rate for this rate (app.gst_rate_or_null), null
      where no rule covers it. */
  gstRate: number | null;
  /** The guests past what the room's price covers, by the tariff's own count
      (app.tariff_for); absent on facts from before 169. */
  extraAdults?: number | null;
  extraChildren?: number | null;
}

export interface VoucherFacts {
  reference: string;
  bookedOn: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  hotel: {
    name: string; address: string | null; city: string | null; state: string | null;
    phone: string | null; email: string | null; gstin: string | null;
    checkInTime: string | null; checkOutTime: string | null;
  };
  groupName: string | null;
  logoPng: string | null;
  guest: { name: string; email: string | null; phone: string | null };
  company: string | null;
  rooms: VoucherRoom[];
  terms: {
    name: string | null; freeUntilHours: number | null;
    cancelBasis: string | null; cancelPercent: number | null; cancelAmount: number | null;
    noShowBasis: string | null; noShowPercent: number | null; noShowAmount: number | null;
  };
  confirmedBy: string | null;
  confirmedAt: string | null;
  /* ── added by 169 (D27-215); each absent or null prints nothing ── */
  /** The hotel's reservations contact person. */
  contact?: string | null;
  /** Who made the booking: a person, or the source of a machine's booking. */
  bookedBy?: string | null;
  /** What the booking's bills have received (the ledger's own figure), and
      whom the lead's bill is made out to. */
  payment?: { received: number | string; billTo: string | null } | null;
  bank?: {
    accountName: string; accountNumber: string; bankName: string;
    branch: string | null; ifsc: string; upi: string | null;
  } | null;
  /** The group's office details, for the footer. */
  group?: {
    name: string | null; address: string | null; phone: string | null; email: string | null;
    website: string | null; gstin: string | null; instagram: string | null;
  } | null;
  housePolicies?: string[] | null;
  /** The guest's own check-in page (D27-264): on the voucher a guest is SENT,
      never on the desk's View voucher - the link is minted for one message. */
  checkInLink?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface VoucherFigures {
  lines: Array<VoucherRoom & { amount: number | null; tax: number | null }>;
  roomCharges: number | null;
  /** One line per GST rate; null when any room's rate is not set. */
  bands: Array<{ rate: number; tax: number }> | null;
  gst: number | null;
  total: number | null;
}

/** The voucher's arithmetic, and the only place it is done. A null is a
    figure this system does not hold, and a total that would need one is
    itself null (D27-172): no GST rule, no total. */
export function voucherFigures(rooms: VoucherRoom[]): VoucherFigures {
  /* A day use (no night) is one day at its rate, charged at check-in
     (D27-225, D27-227): its zero nights printed ₹0 and no GST. */
  const charged = (r: VoucherRoom) => Math.max(1, r.nights);
  const lines = rooms.map((r) => ({
    ...r,
    amount: r.complimentary ? 0 : r.rate === null ? null : round2(r.rate * charged(r)),
    /* Per night, as the audit posts it: round(rate x GST% / 100, 2). */
    tax: r.complimentary ? 0
      : r.rate === null || r.gstRate === null ? null
      : round2(round2((r.rate * r.gstRate) / 100) * charged(r)),
  }));
  const every = (xs: Array<number | null>) =>
    xs.every((x) => x !== null) ? round2((xs as number[]).reduce((a, b) => a + b, 0)) : null;
  const roomCharges = every(lines.map((l) => l.amount));
  const gst = every(lines.map((l) => l.tax));
  const bands = gst === null ? null : [...lines
    .filter((l) => !l.complimentary && l.gstRate !== null)
    .reduce((m, l) => m.set(l.gstRate!, round2((m.get(l.gstRate!) ?? 0) + l.tax!)), new Map<number, number>())]
    .map(([rate, tax]) => ({ rate, tax }));
  return {
    lines, roomCharges, bands, gst,
    total: roomCharges === null || gst === null ? null : round2(roomCharges + gst),
  };
}

/** "INR 1,16,216.00", or "-" for a figure nobody set. */
export const money = (n: number | null): string => (n === null ? "-" : `INR ${inr(n)}`);

/** WinAnsi-safe text: what pdfkit's Helvetica can draw. The middot is
    WinAnsi's own, so a meal plan reads "EP · Room only" as every screen
    says it (D27-164). */
export const plain = (value: unknown): string => String(value ?? "")
  .replace(/[—–]/g, "-").replace(/•/g, "·").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/₹/g, "INR ").replace(/…/g, "...").replace(/[^\x20-\x7E·]/g, "");

/* The desk's own words for terms (src/modules/inventory/pages/
   CancellationTerms.tsx `describe`), so the guest reads what the hotel set. */
function retained(basis: string | null, percent: number | null, amount: number | null): string {
  switch (basis) {
    case "nothing": return "Nothing is retained";
    case "first_night": return "The first night";
    case "full_stay": return "The whole stay";
    case "percent": return percent === null ? "-" : `${percent}% of the booking`;
    case "flat": return money(amount);
    default: return "-";
  }
}

/** The policies the voucher prints (V4): the booking's own terms, then the
    hotel's times, then the hotel's house policies in its own order (D27-215).
    No policy is written here for a hotel: it types its own in Settings. */
export function voucherPolicies(f: VoucherFacts): string[] {
  const t = f.terms;
  const lines: string[] = [];
  if (t.cancelBasis === null && t.name === null) {
    lines.push("This booking carries no cancellation terms.");
  } else {
    lines.push(`Cancellation terms: ${t.name ?? "-"}.`);
    lines.push(`Free cancellation until: ${t.freeUntilHours === null ? "no free window"
      : t.freeUntilHours === 0 ? "the check-in time" : `${t.freeUntilHours} hours before arrival`}.`);
    lines.push(`Cancelled after that: ${retained(t.cancelBasis, t.cancelPercent, t.cancelAmount)}.`);
    lines.push(`No-show: ${retained(t.noShowBasis, t.noShowPercent, t.noShowAmount)}.`);
  }
  lines.push(`Check-in from ${f.hotel.checkInTime ?? "-"}; check-out by ${f.hotel.checkOutTime ?? "-"}.`);
  lines.push(...(f.housePolicies ?? []));
  return lines;
}

export interface VoucherBlocks {
  payment: { value: string; hint?: string };
  hotelRows: [string, string][];
  guestRows: [string, string][];
  /** Per room, in order: "1 extra adult, 1 extra child", or "" for none. */
  extras: string[];
  bank: [string, string][] | null;
  policies: string[];
  instagram: string | null;
  /** What the "Scan to connect" code opens (D27-223), or null for none. */
  qr: string | null;
  /** The guest's check-in page, printed and as a QR code (D27-264), or null. */
  checkIn: string | null;
  footer: { name: string; address: string | null; lines: string[] };
}

/** The address the Instagram QR code opens (the owner's D27-223): a bare
    handle ("@fidatohotels") is its profile; a link is used as typed, given
    https:// where it has none; anything else has no code. */
export function instagramLink(typed: string | null): string | null {
  const t = (typed ?? "").trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^(www\.)?instagram\.com\/\S+$/i.test(t)) return `https://${t}`;
  if (/^@?[A-Za-z0-9._]{1,30}$/.test(t)) return `https://instagram.com/${t.replace(/^@/, "")}`;
  return null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What each block of the voucher SAYS (D27-215) - the one place it is
    decided, so the PDF below only draws. */
export function voucherBlocks(f: VoucherFacts, figures: VoucherFigures = voucherFigures(f.rooms)): VoucherBlocks {
  /* The advance is the ledger's figure (app.guest_voucher); the balance is
     the voucher's own total less it - and is said only when there is a total
     and it is not negative. */
  const received = round2(Number(f.payment?.received ?? 0));
  const balance = figures.total === null ? null : round2(figures.total - received);
  const payment = f.payment?.billTo === "company" ? { value: "Bill to company" }
    : received > 0 ? {
        value: `Advance ${money(received)}`,
        ...(balance !== null && balance >= 0 ? { hint: `Balance ${money(balance)} at the hotel` } : {}),
      }
    : { value: "Pay at the hotel" };

  /* The footer is the GROUP's office once any of it is typed; until then the
     hotel's own facts, as before. */
  const g = f.group;
  const office = g ? [g.address, g.phone, g.email, g.website, g.gstin].some(Boolean) : false;
  const hotelAddress = f.hotel.address || [f.hotel.city, f.hotel.state].filter(Boolean).join(", ") || null;
  const gstin = (value: string | null | undefined) => (value ? `GSTIN ${value}` : null);
  const footer = office
    ? { name: (g!.name ?? f.groupName ?? f.hotel.name).toUpperCase(), address: g!.address,
        lines: [g!.phone, g!.email, g!.website, gstin(g!.gstin)].filter((x): x is string => Boolean(x)) }
    : { name: (f.groupName ?? f.hotel.name).toUpperCase(), address: hotelAddress,
        lines: [f.hotel.phone, f.hotel.email, gstin(f.hotel.gstin)].filter((x): x is string => Boolean(x)) };

  const rows = (pairs: [string, string | null | undefined][]) =>
    pairs.filter((pair): pair is [string, string] => Boolean(pair[1]));

  return {
    payment,
    hotelRows: rows([
      ["Phone", f.hotel.phone], ["Email", f.hotel.email], ["Contact", f.contact],
      /* Printed only in the footer before: with the group's office there, it
         moves here so it does not leave the voucher. */
      ["GSTIN", office ? f.hotel.gstin : null],
    ]),
    guestRows: rows([["Email", f.guest.email], ["Phone", f.guest.phone], ["Booked by", f.bookedBy]]),
    extras: f.rooms.map((r) => [
      r.extraAdults ? count(r.extraAdults, "extra adult", "extra adults") : null,
      r.extraChildren ? count(r.extraChildren, "extra child", "extra children") : null,
    ].filter(Boolean).join(", ")),
    bank: f.bank ? rows([
      ["Account name", f.bank.accountName], ["Account no.", f.bank.accountNumber],
      ["Bank", f.bank.bankName], ["Branch", f.bank.branch], ["IFSC", f.bank.ifsc], ["UPI", f.bank.upi],
    ]) : null,
    policies: voucherPolicies(f),
    instagram: g?.instagram ? `Instagram: ${g.instagram}` : null,
    qr: instagramLink(g?.instagram ?? null),
    checkIn: f.checkInLink ?? null,
    footer,
  };
}

/* The CRS's colours (its voucherPdf.ts), and A4 in millimetres. */
const INK = "#142B3A";
const ORANGE = "#FE611F";
const GREY = "#67737E";
const LINE = "#DFE3E6";
const WASH = "#FAFBFB";
const PEACH = "#FFF6F1";
const MM = 72 / 25.4;
const W = 210;
const M = 13;
const RIGHT = W - M;
const CONTENT = W - M * 2;

const PAGE = 297;
/* The smallest the voucher is drawn: its 7 point policies at 5.7. Measured on
   1 October with three rooms, extra guests, bank details and the group's
   footer: eight one-line house policies need 90%, eight of 200 characters 84%. */
const SMALLEST = 0.82;

/** The PDF itself, from the facts.

    ONE A4 WHERE IT CAN BE (D27-215). The voucher is laid out once to learn
    its height. Where that is more than the page - bank details, three rooms
    and a long list of house policies - the WHOLE voucher is drawn a little
    smaller, centred, down to 82%. Only a voucher longer than that runs onto a
    second page: whole policy lines at a time and the footer whole.
    ponytail: a group of more than about a dozen rooms carries its rooms table
    onto the second page without repeating the table's header. */
export function voucherPdf(f: VoucherFacts): Promise<Uint8Array> {
  const height = voucherHeight(f);
  const pdf = new PDFDocument({ size: "A4", margin: 0, info: { Title: plain(`Reservation voucher ${f.reference}`) } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));
  draw(pdf, f, Math.max(SMALLEST, Math.min(1, PAGE / height)));
  pdf.end();
  return done;
}

/** The height the voucher needs at full size, in millimetres: 297 is the page. */
export const voucherHeight = (f: VoucherFacts): number =>
  draw(new PDFDocument({ size: "A4", margin: 0 }), f, null);

/** Draws the voucher and answers the height it needed, in millimetres.
    `scale` null only measures: nothing is ever moved to a second page. */
function draw(pdf: InstanceType<typeof PDFDocument>, f: VoucherFacts, scale: number | null): number {
  const figures = voucherFigures(f.rooms);
  const blocks = voucherBlocks(f, figures);
  const at = (v: number) => v * MM;
  /* The page's bottom, in the voucher's own millimetres. */
  const pageBottom = scale === null ? Infinity : PAGE / scale;
  const page = () => {
    /* Page breaks are decided here (`room`), never by pdfkit half-way down a
       block: it is told the page has no bottom. */
    pdf.page.margins.bottom = -100000;
    if (scale !== null && scale < 1) pdf.translate(at((W * (1 - scale)) / 2), 0).scale(scale);
  };
  page();
  const text = (value: unknown, x: number, y: number, o: {
    size?: number; color?: string; bold?: boolean; align?: "left" | "right" | "center"; width?: number | undefined;
  } = {}) => {
    const { size = 9, color = INK, bold = false, align = "left", width } = o;
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
    const w = width ?? (align === "left" ? CONTENT : 80);
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    /* y is the baseline, as the CRS draws it; pdfkit draws from the top. */
    pdf.text(plain(value), at(left), at(y) - size * 0.8, { width: at(w), align });
    return pdf.heightOfString(plain(value), { width: at(w) }) / MM;
  };
  const label = (value: string, x: number, y: number, align: "left" | "right" = "left") =>
    text(value.toUpperCase(), x, y, { size: 6, color: GREY, bold: true, align, width: align === "right" ? 60 : undefined });
  const rule = (y: number, color = LINE, width = 0.2, x1 = M, x2 = RIGHT) =>
    pdf.moveTo(at(x1), at(y)).lineTo(at(x2), at(y)).lineWidth(at(width)).strokeColor(color).stroke();
  const box = (y: number, h: number, fill: string) =>
    pdf.rect(at(M), at(y), at(CONTENT), at(h)).lineWidth(at(0.2)).fillAndStroke(fill, LINE);
  const strip = (y: number, cells: { label: string; value: string; hint?: string | undefined; right?: boolean }[]) => {
    box(y, 15, WASH);
    const colW = CONTENT / cells.length;
    cells.forEach((c, i) => {
      const left = M + colW * i;
      if (i > 0) pdf.moveTo(at(left), at(y)).lineTo(at(left), at(y + 15)).lineWidth(at(0.2)).strokeColor(LINE).stroke();
      const x = c.right ? left + colW - 4 : left + 4;
      const align = c.right ? "right" : "left";
      label(c.label, x, y + 5, align);
      /* A long value ("Advance INR 1,20,000.00") is drawn smaller, never
         wrapped onto the hint under it. */
      let size = 9.5;
      pdf.font("Helvetica-Bold");
      while (size > 6.5 && pdf.fontSize(size).widthOfString(plain(c.value)) > at(colW - 8)) size -= 0.25;
      text(c.value, x, y + 9.6, { size, bold: true, align, width: colW - 8 });
      if (c.hint) text(c.hint, x, y + 13, { size: 6.6, color: GREY, align, width: colW - 8 });
    });
    return y + 15;
  };

  /* A QR code, drawn square by square in vector, as the rest of the voucher
     is (D27-223). */
  const QR = 22;
  const qrCode = (value: string, left: number, top: number) => {
    const code = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = code.modules.size;
    const cell = QR / n;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        /* A hair wider than the cell, so no seam shows between two dark ones. */
        if (code.modules.get(r, c)) pdf.rect(at(left + c * cell), at(top + r * cell), at(cell + 0.02), at(cell + 0.02));
      }
    }
    pdf.fillColor(INK).fill();
    pdf.link(at(left), at(top), at(QR), at(QR), value);
  };

  let y = M;
  /* Room for what comes next, or a new page for it: a block is never cut. */
  let above = 0;
  const room = (height: number) => {
    if (y + height <= pageBottom - 3) return;
    above += pageBottom;
    pdf.addPage({ size: "A4", margin: 0 });
    page();
    y = M + 4;
  };

  /* ── Masthead: the hotel's own logo or the group's (a PNG; app.guest_voucher,
     168), else the hotel's name (D27-65, D27-214) ── */
  if (f.logoPng) {
    try { pdf.image(Buffer.from(f.logoPng, "base64"), at(M), at(y), { fit: [at(46), at(13)] }); }
    catch { text(f.hotel.name, M, y + 6, { size: 13, bold: true }); }
  } else {
    text(f.hotel.name, M, y + 6, { size: 13, bold: true, width: 110 });
    if (f.groupName) text(`by ${f.groupName}`, M, y + 11, { size: 8, color: GREY, width: 110 });
  }
  text("RESERVATION VOUCHER", RIGHT, y + 5.5, { size: 11, bold: true, align: "right" });
  text(f.reference, RIGHT, y + 10.5, { size: 9, color: GREY, align: "right" });
  y += 16;
  pdf.rect(at(M), at(y), at(CONTENT), at(1.1)).fill(ORANGE);
  y += 5;

  /* ── Status, and the payment (D27-215) ── */
  y = strip(y, [
    { label: "Booked on", value: dateReport(f.bookedOn) },
    { label: "Status", value: "CONFIRMED" },
    { label: "Payment", value: blocks.payment.value, hint: blocks.payment.hint },
    { label: "Total", value: money(figures.total), right: true },
  ]) + 6;

  /* ── Hotel and guest ── */
  const colW = CONTENT / 2;
  const top = y;
  label("Hotel", M, y);
  y += 5;
  y += text(f.hotel.name, M, y, { size: 11.5, bold: true, width: colW - 6 }) + 0.6;
  /* The address line as the hotel wrote it; its city and state only where there is none. */
  const address = f.hotel.address || [f.hotel.city, f.hotel.state].filter(Boolean).join(", ");
  if (address) y += text(address, M, y, { size: 8, color: GREY, width: colW - 8 }) + 1.5;
  for (const [k, v] of blocks.hotelRows) {
    text(k, M, y, { size: 7.6, color: GREY, width: 16 });
    text(v, M + 17, y, { size: 7.6, bold: true, width: colW - 24 });
    y += 4;
  }
  const hotelBottom = y;

  const gx = M + colW + 5;
  y = top;
  label("Guest", gx, y);
  y += 5;
  y += text(f.guest.name, gx, y, { size: 11.5, bold: true, width: colW - 10 }) + 0.6;
  if (f.company) y += text(f.company, gx, y, { size: 8, color: GREY, width: colW - 10 }) + 0.6;
  for (const [k, v] of blocks.guestRows) {
    text(k, gx, y, { size: 7.6, color: GREY, width: 18 });
    text(v, gx + 19, y, { size: 7.6, bold: true, width: colW - 26 });
    y += 4;
  }
  const bottom = Math.max(hotelBottom, y);
  pdf.moveTo(at(M + colW), at(top - 3)).lineTo(at(M + colW), at(bottom - 2)).lineWidth(at(0.2)).strokeColor(LINE).stroke();
  y = bottom + 3;

  /* ── Stay ── */
  const adults = f.rooms.reduce((a, r) => a + r.adults, 0);
  const children = f.rooms.reduce((a, r) => a + r.children, 0);
  y = strip(y, [
    { label: "Check in", value: dateReport(f.checkIn), hint: f.hotel.checkInTime ? `From ${f.hotel.checkInTime}` : undefined },
    { label: "Check out", value: dateReport(f.checkOut), hint: f.hotel.checkOutTime ? `By ${f.hotel.checkOutTime}` : undefined },
    { label: "Nights", value: f.nights === 0 ? "Day use" : String(f.nights) },
    {
      label: "Guests", value: `${f.rooms.length} room${f.rooms.length === 1 ? "" : "s"}`,
      hint: `${adults} adult${adults === 1 ? "" : "s"}${children ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}`,
    },
  ]) + 7;

  /* ── Rooms and rates (V1) ── */
  const cNights = M + CONTENT - 62;
  const cRate = M + CONTENT - 30;
  label("Rooms and rates", M, y);
  y += 3;
  rule(y, INK, 0.4);
  y += 3.4;
  label("Room", M, y);
  label("Nights", cNights, y);
  label("Per night", cRate, y, "right");
  label("Amount", RIGHT, y, "right");
  y += 2.4;
  figures.lines.forEach((l, i) => {
    room(blocks.extras[i] ? 15.1 : 12);
    rule(y);
    y += 4.4;
    text(`Room ${i + 1} - ${l.roomType}`, M, y, { size: 8.6, bold: true, width: cNights - M - 6 });
    text(l.nights === 0 ? "Day use" : String(l.nights), cNights, y, { size: 8.6, width: 15 });
    text(l.complimentary ? "Complimentary" : money(l.rate), cRate, y, { size: 8.6, align: "right", width: 40 });
    text(l.complimentary ? "Complimentary" : money(l.amount), RIGHT, y, { size: 8.6, bold: true, align: "right", width: 30 });
    y += 3.6;
    const people = `${l.adults} adult${l.adults === 1 ? "" : "s"}${l.children ? `, ${l.children} child${l.children === 1 ? "" : "ren"}` : ""}`;
    text(`${l.mealPlan ?? "-"} - ${people}`, M, y, { size: 7, color: GREY, width: cNights - M - 6 });
    /* The guests past what the room's price covers (the tariff's own count). */
    if (blocks.extras[i]) {
      y += 3.1;
      text(blocks.extras[i], M, y, { size: 7, color: GREY, width: cNights - M - 6 });
    }
    y += 4;
  });
  rule(y);
  y += 5;

  /* ── Totals (V1: a dash where no GST rate is set, and then no total) ── */
  room(16 + (figures.bands?.length ?? 1) * 4.2);
  const tl = M + CONTENT - 62;
  const row = (l: string, v: string, bold = false) => {
    text(l, tl, y, { size: bold ? 9 : 8, color: bold ? INK : GREY, bold, width: 30 });
    text(v, RIGHT, y, { size: bold ? 11 : 8, bold: true, align: "right", width: 40 });
    y += bold ? 5 : 4.2;
  };
  row("Room charges", money(figures.roomCharges));
  if (figures.bands === null) row("GST", "-");
  else for (const b of figures.bands) row(`GST ${b.rate}%`, money(b.tax));
  rule(y - 1, INK, 0.4, tl, RIGHT);
  y += 3.4;
  row("Grand total", money(figures.total), true);
  y += 3;

  /* ── Confirmed by the hotel (V5) ── */
  room(17);
  pdf.rect(at(M), at(y), at(CONTENT), at(17)).lineWidth(at(0.2)).fillAndStroke(PEACH, LINE);
  pdf.rect(at(M), at(y), at(1.3), at(17)).fill(ORANGE);
  text("CONFIRMED BY THE HOTEL", M + 5, y + 5, { size: 6, color: ORANGE, bold: true });
  const confirmedAt = f.confirmedAt ? `${dateReport(f.confirmedAt.slice(0, 10))} ${f.confirmedAt.slice(11, 16)}` : "-";
  const items: [string, string][] = [
    ["Confirmation number", f.reference], ["Confirmed by", f.confirmedBy ?? "-"], ["Confirmed at", confirmedAt],
  ];
  const iw = (CONTENT - 10) / items.length;
  items.forEach(([k, v], i) => {
    const x = M + 5 + iw * i;
    text(k, x, y + 9.5, { size: 6.6, color: GREY, width: iw - 4 });
    text(v, x, y + 13.8, { size: 9, bold: true, width: iw - 4 });
  });
  y += 22;

  /* ── Check in online (D27-264): the guest's own page, as its link and a QR
     code - only on a voucher that is sent, which carries a link minted for it ── */
  if (blocks.checkIn) {
    const h = QR + 6;
    const words = CONTENT - QR - 16;
    room(h);
    pdf.rect(at(M), at(y), at(CONTENT), at(h)).lineWidth(at(0.2)).strokeColor(LINE).stroke();
    label("Check in online", M + 5, y + 6);
    text("Fill in your details and ID before you arrive, on your own page for this booking:",
      M + 5, y + 11.5, { size: 8, width: words });
    const linkTop = y + 17.5;
    const tall = text(blocks.checkIn, M + 5, linkTop, { size: 7.4, color: ORANGE, bold: true, width: words });
    pdf.link(at(M + 5), at(linkTop - 3), at(words), at(tall + 1), blocks.checkIn);
    qrCode(blocks.checkIn, RIGHT - QR - 3, y + 3);
    y += h + 5;
  }

  /* ── Bank details (D27-215): when the hotel has set them. In three columns,
     the figures in Courier as the CRS draws them - an account number is
     copied by hand into a banking app, and a monospaced face is read right. ── */
  if (blocks.bank) {
    const perRow = 3;
    const h = 8 + Math.ceil(blocks.bank.length / perRow) * 8.4;
    room(h);
    pdf.rect(at(M), at(y), at(CONTENT), at(h)).lineWidth(at(0.2)).strokeColor(LINE).stroke();
    label("Bank details", M + 5, y + 5);
    const bw = (CONTENT - 10) / perRow;
    blocks.bank.forEach(([k, v], i) => {
      const x = M + 5 + bw * (i % perRow);
      const by = y + 9.6 + Math.floor(i / perRow) * 8.4;
      text(k, x, by, { size: 6.6, color: GREY, width: bw - 4 });
      const figure = k === "Account no." || k === "IFSC";
      pdf.font(figure ? "Courier-Bold" : "Helvetica-Bold").fontSize(8.4).fillColor(INK)
        .text(plain(v), at(x), at(by + 3.8) - 8.4 * 0.8, { width: at(bw - 4), lineBreak: false });
    });
    y += h + 5;
  }

  /* ── Policies (V4, then the hotel's own), and the group's Instagram ── */
  const footerHeight = 4.5 + Math.max(12, blocks.footer.lines.length * 3.4 + 4) + 3;
  const numbered = blocks.policies.map((p, i) => plain(`${i + 1}.  ${p}`));
  /* With a QR code, the policies keep clear of its column on the right. */
  const wide = blocks.qr ? CONTENT - QR - 8 : CONTENT;
  const lineHeight = (line: string, bold = false) =>
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7).heightOfString(line, { width: at(wide) }) / MM;
  room(4 + (numbered[0] ? lineHeight(numbered[0]) : 0) + (blocks.qr ? QR + 8 : 0));
  label("Hotel policies", M, y);
  const qrTop = y - 2;
  y += 4;
  /* The Instagram QR code (D27-223), with "Scan to connect" under it. */
  if (blocks.qr) {
    qrCode(blocks.qr, RIGHT - QR, qrTop);
    text("Scan to connect", RIGHT - QR / 2, qrTop + QR + 3.6, { size: 6.6, color: GREY, align: "center", width: QR + 8 });
  }
  for (const line of numbered) {
    room(lineHeight(line));
    y += text(line, M, y, { size: 7, color: GREY, width: wide }) + 1.1;
  }
  if (blocks.instagram) {
    y += 1;
    room(lineHeight(plain(blocks.instagram), true));
    y += text(blocks.instagram, M, y, { size: 7, color: INK, bold: true, width: wide }) + 1.1;
  }
  if (blocks.qr) y = Math.max(y, qrTop + QR + 5);
  y += 3;

  /* ── Footer: the group's office once any of it is typed in Settings; the
     hotel's own facts until then (voucherBlocks) ── */
  room(footerHeight);
  rule(y, INK, 0.4);
  y += 4.5;
  text(blocks.footer.name, M, y, { size: 8, bold: true, width: CONTENT / 2 });
  if (blocks.footer.address) text(blocks.footer.address, M, y + 4, { size: 7, color: GREY, width: CONTENT / 2 - 6 });
  let fy = y;
  for (const line of blocks.footer.lines) {
    text(line, RIGHT, fy, { size: 7, color: GREY, align: "right", width: 80 });
    fy += 3.4;
  }
  const last = Math.max(y + 12, fy + 4);
  text("This voucher confirms the booking described above. Please present it at check in.",
    W / 2, last, { size: 6.6, color: GREY, align: "center", width: CONTENT });
  /* The closing sentence, and the margin `room` keeps under the footer. */
  return above + last + 7;
}

/** The voucher for a confirmed booking, ready to go with its message - or
    null where the booking is not confirmed. Through the definer
    `app.guest_voucher` (162): the sweep has nobody signed in. A message's
    check-in link is printed in it (D27-264); the desk's View voucher has none. */
export async function voucherFile(
  client: Client, reservationId: string, checkInLink: string | null = null,
): Promise<SendableFile | null> {
  const facts = await voucherFacts(client, reservationId);
  return facts ? fileOf({ ...facts, checkInLink }) : null;
}

async function voucherFacts(client: Client, reservationId: string): Promise<VoucherFacts | null> {
  const { rows } = await client.query<{ facts: VoucherFacts | null }>(
    "select app.guest_voucher($1::uuid) as facts", [reservationId]);
  const facts = rows[0]?.facts;
  if (!facts) return null;
  const numbers = (r: VoucherRoom) => ({
    ...r,
    rate: r.rate === null ? null : Number(r.rate),
    gstRate: r.gstRate === null ? null : Number(r.gstRate),
  });
  return { ...facts, rooms: (facts.rooms ?? []).map(numbers) };
}

async function fileOf(facts: VoucherFacts): Promise<SendableFile> {
  return {
    name: `Voucher-${facts.reference.replace(/[^A-Za-z0-9-]/g, "")}.pdf`,
    contentType: "application/pdf",
    bytes: await voucherPdf(facts),
  };
}

/* ── The voucher on WhatsApp: our own template, booking_voucher (D27-265) ──
   The PDF as its document, and ten numbered fields (the workflow sends them
   in this order) from the SAME facts as the PDF, so the message and the
   document agree: a group's are the whole group's rooms and guests (Q5).
   Written as the owner's sample writes them - "Sat, 10 Oct 2026", the
   hotel's own times as "2:00 PM", the hotel's phone. Nothing invented:
   anything missing is a dash. The "Check in online" button is the message's
   own link (`data.link`), which the workflow cuts to its token. */
const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "-");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat, 10 Oct 2026" - spelt out here, so no locale writes "Sept". */
const dayDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? dash(iso)
    : `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** The hotel's "14:00" as "2:00 PM"; a dash where no time is set. */
const clock = (hhmm: string | null) => {
  const t = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!t) return "-";
  const h = Number(t[1]);
  return `${h % 12 || 12}:${t[2]} ${h < 12 ? "AM" : "PM"}`;
};

export function voucherFields(f: VoucherFacts): Record<string, string> {
  const types: string[] = [];
  const count = new Map<string, number>();
  for (const r of f.rooms) {
    if (!count.has(r.roomType)) types.push(r.roomType);
    count.set(r.roomType, (count.get(r.roomType) ?? 0) + 1);
  }
  const adults = f.rooms.reduce((a, r) => a + r.adults, 0);
  const children = f.rooms.reduce((a, r) => a + r.children, 0);
  return {
    guestName: dash(f.guest.name),
    hotelName: dash(f.hotel.name),
    reference: dash(f.reference),
    checkInDay: dayDate(f.checkIn),
    checkInFrom: clock(f.hotel.checkInTime),
    checkOutDay: dayDate(f.checkOut),
    checkOutBy: clock(f.hotel.checkOutTime),
    room: types.length ? types.map((t) => `${count.get(t)} × ${t}`).join(", ") : "-",
    guests: f.rooms.length
      ? `${adults} adult${adults === 1 ? "" : "s"}${children ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}`
      : "-",
    hotelPhone: dash(f.hotel.phone),
  };
}

/** The PDF and its ten fields, or null where the booking is not confirmed. */
export async function whatsAppVoucher(
  client: Client, reservationId: string, checkInLink: string | null = null,
): Promise<{ file: SendableFile; fields: Record<string, string> } | null> {
  const facts = await voucherFacts(client, reservationId);
  return facts ? { file: await fileOf({ ...facts, checkInLink }), fields: voucherFields(facts) } : null;
}
