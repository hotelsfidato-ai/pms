import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import type {
  ReportDoc, ReportColumn, ReportRow, ReportSection, CellKind, Cell,
} from "./modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE REPORT RENDERER - one document, three files (D17-31, D17-32)

   The reports service builds a report as one object (its `ReportDoc`,
   api/src/modules/reports/document.ts, the contract of 17 September);
   this file draws it as a PDF, a real .xlsx and a CSV. The shape is the
   reports service's, not a copy here, so the screen and the files can
   never read two different contracts.

   The eZee exports' LAYOUT with the group's own BRANDING (D17-70): the
   hotel's name top left, the report's title top right with its facts under
   it, sections as ruled tables, totals bold, and a footer on every page
   saying when it was printed, by whom, and the page. Colours are Fidato's
   (src/styles/theme.css), not eZee's navy and maroon.

   A4. Money in Indian grouping with two decimals and no symbol, as the
   exports print it ("Currency INR" is a fact at the top). Dates 25/08/2026
   and moments 25/08/2026 04:12:43 PM in the property's time (D17-77). A
   figure nobody has prints "-".
   ══════════════════════════════════════════════════════════════════ */

/** Who printed it and when: the footer, written here, never by a builder. */
export interface PrintedBy {
  name: string;
  at: Date;
  /** The property's, so "printed at" reads as the hotel's clock. */
  timezone: string;
}

const INK = "#031728";
const MUTED = "#4c5b67";
const RULE = "#dfe4e8";
const BAND = "#f4f6f7";
const ACCENT = "#c4521d";

/* ── formatting ────────────────────────────────────────────────── */

/** 4,19,578.77 - lakhs and crores, two decimals, a minus where it is owed back. */
export function inr(n: number): string {
  const sign = n < 0 ? "-" : "";
  const [whole, dec] = Math.abs(n).toFixed(2).split(".");
  const last3 = whole!.slice(-3);
  const rest = whole!.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${sign}${grouped}.${dec}`;
}

/* A COPY of dateReport and dateTimeReport in src/lib/format.ts: the API
   never imports web code. api/test/reportFiles.test.ts holds the two to
   the same answers. */

/** "2026-08-25" -> "25/08/2026". Anything that is not a calendar date: "-". */
export function dateReport(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "-";
}

/** The wall-clock parts of a moment in a time zone. */
function clockParts(d: Date, timeZone: string, hour12: boolean) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: get("day"), month: get("month"), year: get("year"),
    hour: get("hour"), minute: get("minute"), second: get("second"),
    period: get("dayPeriod").toUpperCase(),
  };
}

const toMoment = (value: string | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** An ISO moment -> "25/08/2026 04:12:43 PM" in the given time zone. */
export function dateTimeReport(value: string | Date | null | undefined, timeZone: string): string {
  const d = toMoment(value);
  if (!d) return "-";
  const p = clockParts(d, timeZone, true);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} ${p.period}`;
}

/** What a cell holds: the row's unit where one column mixes units, else the column's. */
export const kindOf = (column: ReportColumn, row: ReportRow): CellKind =>
  column.kind === "text" ? "text" : (row.unit ?? column.kind);

/** One cell as it prints. A string in a figure's column (the "Total" label
    in a date column) prints as it is. */
export function formatCell(value: Cell | undefined, kind: CellKind, timeZone: string): string {
  if (value === null || value === undefined || value === "") return "-";
  switch (kind) {
    case "text": return String(value);
    case "money": return typeof value === "number" ? inr(value) : value;
    case "count": return typeof value === "number" ? String(Math.round(value)) : value;
    case "percent": return typeof value === "number" ? `${value.toFixed(2)}%` : value;
    case "ratio": return typeof value === "number" ? value.toFixed(2) : value;
    case "date": {
      const s = typeof value === "string" ? dateReport(value) : "-";
      return s === "-" ? String(value) : s;
    }
    case "datetime": {
      const s = typeof value === "string" ? dateTimeReport(value, timeZone) : "-";
      return s === "-" ? String(value) : s;
    }
  }
}

const numeric = (kind: CellKind) => kind !== "text" && kind !== "date" && kind !== "datetime";

export function printedLine(by: PrintedBy): string {
  return `Printed ${dateTimeReport(by.at, by.timezone)} · ${by.name}`;
}

/* ── PDF ───────────────────────────────────────────────────────── */

/** Each column's width, and the type size its section prints at.

    A text column takes 2.6 shares to a figure's 1, and that stands while
    everything fits. The Night audit's Room Charges and Checked Out did not:
    thirteen columns in landscape left a figure 32pt, so "11,897.00" and a
    check-out's date and time wrapped under themselves into the next row.
    Where anything would not fit its share, every column is sized to the
    widest thing it prints, the page's spare width shared out in proportion;
    a section wider than the page even then prints smaller. Never over its
    neighbour. */
export function columnLayout(
  pdf: PDFKit.PDFDocument, section: ReportSection, width: number, tz: string,
): { widths: number[]; scale: number } {
  const PAD = 7;   // 3pt each side, and 1 so an exact fit is not wrapped
  const need = section.columns.map((c, k) => {
    let w = pdf.font("Helvetica-Bold").fontSize(8).widthOfString(c.label);
    for (const row of section.rows) {
      if (row.kind === "band") continue;   // a band spans the whole row
      const indent = k === 0 ? Math.min(3, Math.max(0, row.indent ?? 0)) * 8 : 0;
      pdf.font(row.kind === "total" ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      w = Math.max(w, pdf.widthOfString(formatCell(row.cells[c.key], kindOf(c, row), tz)) + indent);
    }
    return w;
  });

  const weights = section.columns.map((c) => (c.kind === "text" ? 2.6 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => (w / total) * width);
  if (need.every((n, k) => n + PAD <= shares[k]!)) return { widths: shares, scale: 1 };

  const scale = Math.min(1, (width - PAD * need.length) / need.reduce((a, b) => a + b, 0));
  const fitted = need.map((n) => n * scale + PAD);
  const used = fitted.reduce((a, b) => a + b, 0);
  return { widths: fitted.map((w) => w + (width - used) * (w / used)), scale };
}

/** D27-296 (8): what a test hotel's documents say of themselves. */
export const TEST_MARK = "TEST · NOT VALID";

export async function renderPdf(doc: ReportDoc, by: PrintedBy): Promise<Buffer> {
  const tz = by.timezone;
  const pdf = new PDFDocument({
    size: "A4", layout: doc.orientation,
    margins: { top: 36, bottom: 48, left: 36, right: 36 },
    bufferPages: true,
    info: { Title: `${doc.title} · ${doc.property.name}`, Author: "Fidato PMS" },
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => pdf.on("end", () => resolve()));

  const left = pdf.page.margins.left;
  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const bottom = () => pdf.page.height - pdf.page.margins.bottom - 14;

  const header = () => {
    const top = pdf.page.margins.top;
    pdf.font("Helvetica-Bold").fontSize(13).fillColor(INK)
      .text(doc.property.name, left, top, { width: width * 0.55 });
    /* D27-296: a test hotel's document is not a real one, and carries no GSTIN. */
    if (doc.property.test) {
      pdf.font("Helvetica-Bold").fontSize(10).fillColor(ACCENT)
        .text(TEST_MARK, left, pdf.y + 1, { width: width * 0.55 });
    }
    pdf.font("Helvetica").fontSize(8).fillColor(MUTED);
    const sub = [doc.property.address,
      doc.property.gstin && !doc.property.test ? `GSTIN ${doc.property.gstin}` : null]
      .filter(Boolean).join("  ·  ");
    if (sub) pdf.text(sub, left, pdf.y + 2, { width: width * 0.55 });
    const leftEnd = pdf.y;

    pdf.font("Helvetica-Bold").fontSize(14).fillColor(ACCENT)
      .text(doc.title, left + width * 0.55, top, { width: width * 0.45, align: "right" });
    pdf.font("Helvetica").fontSize(8).fillColor(MUTED);
    for (const f of doc.facts) {
      pdf.text(`${f.label}  ${formatCell(f.value, f.kind, tz)}`, left + width * 0.55, pdf.y + 1,
        { width: width * 0.45, align: "right" });
    }
    const y = Math.max(leftEnd, pdf.y) + 8;
    pdf.moveTo(left, y).lineTo(left + width, y).lineWidth(1.2).strokeColor(ACCENT).stroke();
    pdf.y = y + 10;
  };

  const ROW_H = 15;
  const tableHead = (cols: ReportColumn[], widths: number[], scale: number) => {
    if (cols.some((c) => c.group)) {
      let x = left;
      let i = 0;
      while (i < cols.length) {
        const g = cols[i]!.group;
        let w = 0, j = i;
        while (j < cols.length && cols[j]!.group === g) { w += widths[j]!; j++; }
        if (g) {
          pdf.font("Helvetica-Bold").fontSize(8 * scale).fillColor(MUTED)
            .text(g, x, pdf.y, { width: w - 4, align: "center", lineBreak: false });
          pdf.moveTo(x + 4, pdf.y + 11).lineTo(x + w - 4, pdf.y + 11).lineWidth(0.5).strokeColor(RULE).stroke();
        }
        x += w; i = j;
      }
      pdf.y += 14;
    }
    let x = left;
    const y = pdf.y;
    cols.forEach((c, k) => {
      pdf.font("Helvetica-Bold").fontSize(8 * scale).fillColor(INK)
        .text(c.label, x + 3, y, { width: widths[k]! - 6, align: numeric(c.kind) ? "right" : "left", lineBreak: false, ellipsis: true });
      x += widths[k]!;
    });
    pdf.y = y + 12;
    pdf.moveTo(left, pdf.y).lineTo(left + width, pdf.y).lineWidth(0.8).strokeColor(INK).stroke();
    pdf.y += 3;
  };

  const quiet = (text: string, italic: boolean) => {
    if (pdf.y + 12 > bottom()) { pdf.addPage(); header(); }
    pdf.font(italic ? "Helvetica-Oblique" : "Helvetica").fontSize(7.5).fillColor(MUTED)
      .text(text, left + 3, pdf.y + 3, { width: width - 6 });
  };

  header();

  for (const section of doc.sections) {
    const { widths, scale } = columnLayout(pdf, section, width, tz);

    if (pdf.y + 50 > bottom()) { pdf.addPage(); header(); }
    pdf.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(section.title, left, pdf.y + 4);
    pdf.y += 4;
    tableHead(section.columns, widths, scale);

    if (section.rows.length === 0 && section.empty) quiet(section.empty, true);
    for (const row of section.rows) {
      if (pdf.y + ROW_H > bottom()) {
        pdf.addPage(); header();
        tableHead(section.columns, widths, scale);
      }
      drawRow(pdf, section.columns, widths, row, left, width, ROW_H, tz, scale);
    }
    if (section.note) quiet(section.note, false);
    pdf.y += 10;
  }

  if (doc.chart && doc.chart.x.length) {
    const h = 170;
    if (pdf.y + h + 20 > bottom()) { pdf.addPage(); header(); }
    drawChart(pdf, doc.chart, left, pdf.y + 6, width, h, tz);
    pdf.y += h + 20;
  }

  for (const note of doc.footnotes) quiet(note, false);

  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    const y = pdf.page.height - pdf.page.margins.bottom + 16;
    /* The footer sits below the bottom margin, and pdfkit starts a NEW page for
       any text written past it. Lifting the margin for the footer keeps a
       one-page report on one page. */
    pdf.page.margins.bottom = 0;
    pdf.moveTo(left, y - 6).lineTo(left + width, y - 6).lineWidth(0.5).strokeColor(RULE).stroke();
    pdf.font("Helvetica").fontSize(7.5).fillColor(MUTED)
      .text(printedLine(by), left, y, { width: width * 0.7, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, left + width * 0.7, y, { width: width * 0.3, align: "right", lineBreak: false });
  }

  pdf.end();
  await done;
  return Buffer.concat(chunks);
}

function drawRow(
  pdf: PDFKit.PDFDocument, cols: ReportColumn[], widths: number[], row: ReportRow,
  left: number, width: number, rowH: number, tz: string, scale: number,
): void {
  const y = pdf.y;
  if (row.kind === "band") {
    pdf.rect(left, y, width, rowH - 2).fill(BAND);
    pdf.font("Helvetica-Bold").fontSize(8.5).fillColor(INK)
      .text(formatCell(row.cells[cols[0]!.key], "text", tz), left + 3, y + 3, { width: width - 6, lineBreak: false });
    pdf.y = y + rowH;
    return;
  }
  if (row.kind === "total") {
    pdf.moveTo(left, y).lineTo(left + width, y).lineWidth(0.8).strokeColor(INK).stroke();
  }
  let x = left;
  const indent = Math.min(3, Math.max(0, row.indent ?? 0)) * 8 * scale;
  cols.forEach((c, k) => {
    const pad = k === 0 ? indent : 0;
    const kind = kindOf(c, row);
    pdf.font(row.kind === "total" ? "Helvetica-Bold" : "Helvetica").fontSize(8.5 * scale).fillColor(INK)
      .text(formatCell(row.cells[c.key], kind, tz), x + 3 + pad, y + 3, {
        width: widths[k]! - 6 - pad, align: numeric(kind) ? "right" : "left", lineBreak: false, ellipsis: true,
      });
    x += widths[k]!;
  });
  pdf.moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.3).strokeColor(RULE).stroke();
  pdf.y = y + rowH;
}

function drawChart(
  pdf: PDFKit.PDFDocument, chart: NonNullable<ReportDoc["chart"]>,
  left: number, top: number, width: number, height: number, tz: string,
): void {
  const colours = [ACCENT, INK, MUTED];
  pdf.font("Helvetica-Bold").fontSize(9).fillColor(INK)
    .text(chart.title, left, top, { width: width * 0.6, lineBreak: false });
  if (chart.series.length > 1) {
    let x = left + width;
    [...chart.series].reverse().forEach((s, ri) => {
      const si = chart.series.length - 1 - ri;
      const w = pdf.font("Helvetica").fontSize(7.5).widthOfString(s.label);
      x -= w;
      pdf.fillColor(MUTED).text(s.label, x, top + 1, { lineBreak: false });
      x -= 10;
      pdf.rect(x, top + 2, 6, 6).fill(colours[si % colours.length]!);
      x -= 10;
    });
  }

  const plotTop = top + 18;
  const plotH = height - 18 - 16;
  const values = chart.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(1, ...values);
  const slot = width / chart.x.length;
  const barW = Math.max(2, (slot * 0.7) / Math.max(1, chart.series.length));

  pdf.font("Helvetica").fontSize(6.5).fillColor(MUTED)
    .text(formatCell(max, chart.unit === "text" ? "ratio" : chart.unit, tz), left, plotTop - 2, { lineBreak: false });
  pdf.moveTo(left, plotTop + plotH).lineTo(left + width, plotTop + plotH).lineWidth(0.5).strokeColor(RULE).stroke();
  chart.x.forEach((label, i) => {
    chart.series.forEach((s, si) => {
      const v = s.values[i];
      if (v === null || v === undefined) return;
      const h = (v / max) * (plotH - 8);
      pdf.rect(left + i * slot + slot * 0.15 + si * barW, plotTop + plotH - h, barW - 1, h)
        .fill(colours[si % colours.length]!);
    });
    pdf.font("Helvetica").fontSize(6.5).fillColor(MUTED)
      .text(label, left + i * slot, plotTop + plotH + 3, { width: slot, align: "center", lineBreak: false });
  });
}

/* ── Excel ─────────────────────────────────────────────────────── */

/** Indian grouping in Excel: crores, lakhs, thousands. */
const INR_FORMAT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';

const NUMBER_FORMAT: Partial<Record<CellKind, string>> = {
  money: INR_FORMAT, percent: "0.00%", count: "0", ratio: "0.00",
  date: "dd/mm/yyyy", datetime: "dd/mm/yyyy hh:mm:ss AM/PM",
};

export async function renderXlsx(doc: ReportDoc, by: PrintedBy): Promise<Buffer> {
  const tz = by.timezone;
  const book = new ExcelJS.Workbook();
  book.creator = "Fidato PMS";
  book.created = by.at;
  const sheet = book.addWorksheet(doc.title.slice(0, 31), {
    pageSetup: { paperSize: 9, orientation: doc.orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const widest = Math.max(1, ...doc.sections.map((s) => s.columns.length));
  const quiet = (text: string) => { sheet.addRow([text]).font = { italic: true, color: { argb: "FF4C5B67" } }; };

  const title = sheet.addRow([doc.property.name]);
  title.font = { bold: true, size: 14, color: { argb: "FF031728" } };
  /* D27-296: a test hotel's. */
  if (doc.property.test) sheet.addRow([TEST_MARK]).font = { bold: true, color: { argb: "FFC4521D" } };
  const reportRow = sheet.addRow([doc.title]);
  reportRow.font = { bold: true, size: 12, color: { argb: "FFC4521D" } };
  for (const f of doc.facts) {
    sheet.addRow([f.label, formatCell(f.value, f.kind, tz)]).font = { color: { argb: "FF4C5B67" } };
  }
  sheet.addRow([]);

  for (const section of doc.sections) {
    sheet.addRow([section.title]).font = { bold: true, size: 11 };
    if (section.columns.some((c) => c.group)) {
      const groupRow = sheet.addRow(section.columns.map((c) => c.group ?? ""));
      groupRow.font = { bold: true, color: { argb: "FF4C5B67" } };
      let i = 0;
      while (i < section.columns.length) {
        let j = i;
        while (j + 1 < section.columns.length && section.columns[j + 1]!.group === section.columns[i]!.group) j++;
        if (section.columns[i]!.group && j > i) sheet.mergeCells(groupRow.number, i + 1, groupRow.number, j + 1);
        groupRow.getCell(i + 1).alignment = { horizontal: "center" };
        i = j + 1;
      }
    }
    const head = sheet.addRow(section.columns.map((c) => c.label));
    head.font = { bold: true };
    head.eachCell((cell, n) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6F7" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FF031728" } } };
      cell.alignment = { horizontal: numeric(section.columns[n - 1]!.kind) ? "right" : "left" };
    });

    if (section.rows.length === 0 && section.empty) quiet(section.empty);
    for (const row of section.rows) {
      if (row.kind === "band") {
        const band = sheet.addRow([formatCell(row.cells[section.columns[0]!.key], "text", tz)]);
        band.font = { bold: true, italic: true };
        continue;
      }
      const r = sheet.addRow(section.columns.map((c) => xlsxValue(row.cells[c.key], kindOf(c, row), tz)));
      section.columns.forEach((c, k) => {
        const kind = kindOf(c, row);
        const cell = r.getCell(k + 1);
        if (typeof cell.value === "number" || cell.value instanceof Date) {
          const fmt = NUMBER_FORMAT[kind];
          if (fmt) cell.numFmt = fmt;
        }
        if (cell.value === "-" || numeric(kind)) cell.alignment = { horizontal: "right" };
        if (k === 0 && row.indent) cell.alignment = { indent: row.indent };
      });
      if (row.kind === "total") {
        r.font = { bold: true };
        r.eachCell((cell) => { cell.border = { top: { style: "thin", color: { argb: "FF031728" } } }; });
      }
    }
    if (section.note) quiet(section.note);
    sheet.addRow([]);
  }

  for (const note of doc.footnotes) quiet(note);
  sheet.addRow([printedLine(by)]).font = { size: 9, color: { argb: "FF4C5B67" } };

  for (let c = 1; c <= widest; c++) sheet.getColumn(c).width = c === 1 ? 34 : 16;
  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** A cell as Excel should hold it: numbers as numbers, a percent as a
    fraction, a date or a moment as a real date (a moment at the property's
    wall-clock time, since Excel has no time zones). */
function xlsxValue(value: Cell | undefined, kind: CellKind, tz: string): string | number | Date {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return kind === "percent" ? value / 100 : value;
  if (kind === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : value;
  }
  if (kind === "datetime") {
    const d = toMoment(value);
    if (!d) return value;
    const p = clockParts(d, tz, false);
    const hour = Number(p.hour) % 24;
    return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second)));
  }
  return value;
}

/* ── CSV ───────────────────────────────────────────────────────── */

/** One section after another, each with its title and header. Numbers are
    plain (no grouping) so a spreadsheet reads them as numbers; dates as
    25/08/2026 (D17-77); "-" where a figure nobody has. */
export function renderCsv(doc: ReportDoc, by: PrintedBy): string {
  const tz = by.timezone;
  /* A value starting =, +, - or @ is a formula to a spreadsheet (D27-340): a
     guest named "=HYPERLINK(...)" would run in the accountant's Excel. A tab in
     front keeps it text, as the website's CSV does (src/lib/csv.ts); a figure
     (-1,234.50, -12.50%) and the dash for none stay as they are. */
  const defuse = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^(-|-?[\d,]+(\.\d+)?%?)$/.test(v) ? `\t${v}` : v);
  const esc = (raw: string) => {
    const v = defuse(raw);
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines: string[] = [esc(doc.property.name),
    /* D27-296: a test hotel's. */
    ...(doc.property.test ? [esc(TEST_MARK)] : []), esc(doc.title)];
  for (const f of doc.facts) lines.push(`${esc(f.label)},${esc(formatCell(f.value, f.kind, tz))}`);
  lines.push("");
  for (const section of doc.sections) {
    lines.push(esc(section.title));
    lines.push(section.columns.map((c) => esc(c.label)).join(","));
    if (section.rows.length === 0 && section.empty) lines.push(esc(section.empty));
    for (const row of section.rows) {
      if (row.kind === "band") {
        lines.push(esc(formatCell(row.cells[section.columns[0]!.key], "text", tz)));
        continue;
      }
      lines.push(section.columns.map((c) => {
        const kind = kindOf(c, row);
        const v = row.cells[c.key];
        if (v === null || v === undefined || v === "") return "-";
        if (typeof v === "number") return kind === "count" ? String(Math.round(v)) : v.toFixed(2);
        return esc(formatCell(v, kind, tz));
      }).join(","));
    }
    if (section.note) lines.push(esc(section.note));
    lines.push("");
  }
  for (const note of doc.footnotes) lines.push(esc(note));
  lines.push(esc(printedLine(by)));
  return lines.join("\r\n") + "\r\n";
}
