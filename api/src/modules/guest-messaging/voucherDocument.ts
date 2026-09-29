import PDFDocument from "pdfkit";
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

   ⚠ WinAnsi only - pdfkit's Helvetica cannot draw the rupee sign, a long
   dash or a middot. Money prints "INR 12,345.67" and everything goes
   through `plain()`, as the CRS's does.
   ══════════════════════════════════════════════════════════════════ */

export interface VoucherRoom {
  roomType: string;
  mealPlan: string | null;
  adults: number;
  children: number;
  nights: number;
  /** The nightly rate the audit posts, before tax; null where none is set. */
  rate: number | null;
  complimentary: boolean;
  /** The database's GST rate for this rate (app.gst_rate_or_null), null
      where no rule covers it. */
  gstRate: number | null;
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
  const lines = rooms.map((r) => ({
    ...r,
    amount: r.complimentary ? 0 : r.rate === null ? null : round2(r.rate * r.nights),
    /* Per night, as the audit posts it: round(rate x GST% / 100, 2). */
    tax: r.complimentary ? 0
      : r.rate === null || r.gstRate === null ? null
      : round2(round2((r.rate * r.gstRate) / 100) * r.nights),
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

/** WinAnsi-safe text: what pdfkit's Helvetica can draw. */
const plain = (value: unknown): string => String(value ?? "")
  .replace(/[—–]/g, "-").replace(/[·•]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/₹/g, "INR ").replace(/…/g, "...").replace(/[^\x20-\x7E]/g, "");

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

/* The desk's words for a meal plan: New booking's PLANS
   (src/modules/reservations/pages/NewBooking.tsx) - the API never imports
   web code, so they are written here too; change both. RO is the walk-in's
   "Room Only" (front-desk stays.ts). */
const PLAN_WORDS: Record<string, string> = {
  EP: "Room only", RO: "Room only", CP: "With breakfast", MAP: "Breakfast and one meal",
  AP: "All meals", AI: "All inclusive",
};
export const planWords = (code: string | null): string =>
  code === null ? "-" : PLAN_WORDS[code] ?? code;

/** The policies the voucher prints (V4): the booking's own terms, then the
    hotel's times. Nothing else - no policy is written here for a hotel. */
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
  return lines;
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

/** The PDF itself, from the facts.
    ponytail: one A4 page, as the CRS's; a group of more than about a dozen
    rooms runs onto a second page without a repeated header. */
export function voucherPdf(f: VoucherFacts): Promise<Uint8Array> {
  const figures = voucherFigures(f.rooms);
  const pdf = new PDFDocument({ size: "A4", margin: 0, info: { Title: plain(`Reservation voucher ${f.reference}`) } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));

  const at = (v: number) => v * MM;
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
      text(c.value, x, y + 9.6, { size: 9.5, bold: true, align, width: colW - 8 });
      if (c.hint) text(c.hint, x, y + 13, { size: 6.6, color: GREY, align, width: colW - 8 });
    });
    return y + 15;
  };

  let y = M;
  /* ── Masthead: the group's logo, else the hotel's name (D27-65) ── */
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

  /* ── Status (V1: no payment line) ── */
  y = strip(y, [
    { label: "Booked on", value: dateReport(f.bookedOn) },
    { label: "Status", value: "CONFIRMED" },
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
  for (const [k, v] of [["Phone", f.hotel.phone], ["Email", f.hotel.email]] as const) {
    if (!v) continue;
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
  for (const [k, v] of [["Email", f.guest.email], ["Phone", f.guest.phone]] as const) {
    if (!v) continue;
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
    { label: "Nights", value: String(f.nights) },
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
    rule(y);
    y += 4.4;
    text(`Room ${i + 1} - ${l.roomType}`, M, y, { size: 8.6, bold: true, width: cNights - M - 6 });
    text(String(l.nights), cNights, y, { size: 8.6, width: 15 });
    text(l.complimentary ? "Complimentary" : money(l.rate), cRate, y, { size: 8.6, align: "right", width: 40 });
    text(l.complimentary ? "Complimentary" : money(l.amount), RIGHT, y, { size: 8.6, bold: true, align: "right", width: 30 });
    y += 3.6;
    const people = `${l.adults} adult${l.adults === 1 ? "" : "s"}${l.children ? `, ${l.children} child${l.children === 1 ? "" : "ren"}` : ""}`;
    text(`${planWords(l.mealPlan)} - ${people}`, M, y, { size: 7, color: GREY, width: cNights - M - 6 });
    y += 4;
  });
  rule(y);
  y += 5;

  /* ── Totals (V1: a dash where no GST rate is set, and then no total) ── */
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

  /* ── Policies (V4) ── */
  label("Hotel policies", M, y);
  y += 4;
  voucherPolicies(f).forEach((p, i) => {
    y += text(`${i + 1}.  ${p}`, M, y, { size: 7, color: GREY, width: CONTENT }) + 1.1;
  });
  y += 3;

  /* ── Footer: the hotel's own facts ── */
  rule(y, INK, 0.4);
  y += 4.5;
  text((f.groupName ?? f.hotel.name).toUpperCase(), M, y, { size: 8, bold: true, width: CONTENT / 2 });
  if (address) text(address, M, y + 4, { size: 7, color: GREY, width: CONTENT / 2 - 6 });
  let fy = y;
  for (const line of [f.hotel.phone, f.hotel.email, f.hotel.gstin ? `GSTIN ${f.hotel.gstin}` : null]) {
    if (!line) continue;
    text(line, RIGHT, fy, { size: 7, color: GREY, align: "right", width: 80 });
    fy += 3.4;
  }
  text("This voucher confirms the booking described above. Please present it at check in.",
    W / 2, Math.max(y + 12, fy + 4), { size: 6.6, color: GREY, align: "center", width: CONTENT });

  pdf.end();
  return done;
}

/** The voucher for a confirmed booking, ready to go with its message - or
    null where the booking is not confirmed. Through the definer
    `app.guest_voucher` (162): the sweep has nobody signed in. */
export async function voucherFile(client: Client, reservationId: string): Promise<SendableFile | null> {
  const { rows } = await client.query<{ facts: VoucherFacts | null }>(
    "select app.guest_voucher($1::uuid) as facts", [reservationId]);
  const facts = rows[0]?.facts;
  if (!facts) return null;
  const numbers = (r: VoucherRoom) => ({
    ...r,
    rate: r.rate === null ? null : Number(r.rate),
    gstRate: r.gstRate === null ? null : Number(r.gstRate),
  });
  return {
    name: `Voucher-${facts.reference.replace(/[^A-Za-z0-9-]/g, "")}.pdf`,
    contentType: "application/pdf",
    bytes: await voucherPdf({ ...facts, rooms: (facts.rooms ?? []).map(numbers) }),
  };
}
