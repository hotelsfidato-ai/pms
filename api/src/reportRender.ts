import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import type { ReportDoc, ReportColumn, ReportRow, PrintedBy } from "./reportDoc.ts";

/* ══════════════════════════════════════════════════════════════════
   THE REPORT RENDERER — one document, three files (D17-31, D17-32)

   The eZee exports' LAYOUT with the group's own BRANDING (D17-70): the
   hotel's name top left, the report's title top right with its facts under
   it, sections as ruled tables, totals bold, and a footer on every page
   saying when it was printed, by whom, and the page. Colours are Fidato's
   (src/styles/theme.css), not eZee's navy and maroon.

   A4. Money in Indian grouping with two decimals and no symbol, as the
   exports print it ("Currency INR" is a fact at the top). A figure nobody
   has prints "-".
   ══════════════════════════════════════════════════════════════════ */

const INK = "#031728";
const MUTED = "#4c5b67";
const RULE = "#dfe4e8";
const BAND = "#f4f6f7";
const ACCENT = "#c4521d";

/* ── formatting ────────────────────────────────────────────────── */

/** 4,19,578.77 — lakhs and crores, two decimals, a minus where it is owed back. */
export function inr(n: number): string {
  const sign = n < 0 ? "-" : "";
  const [whole, dec] = Math.abs(n).toFixed(2).split(".");
  const last3 = whole!.slice(-3);
  const rest = whole!.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${sign}${grouped}.${dec}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatCell(value: string | number | null | undefined, kind: ReportColumn["kind"]): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string" && kind !== "date") return value;
  switch (kind) {
    case "money": return inr(Number(value));
    case "count": return String(Math.round(Number(value)));
    case "percent": return `${Number(value).toFixed(2)}%`;
    case "ratio": return Number(value).toFixed(2);
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
      return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(value);
    }
    default: return String(value);
  }
}

const numeric = (kind: ReportColumn["kind"]) => kind !== "text" && kind !== "date";

function printedLine(by: PrintedBy): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: by.timezone, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(by.at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  /* The month by number, not Intl's short name: en-GB spells September "Sept". */
  const monthNo = Number(new Intl.DateTimeFormat("en-GB", { timeZone: by.timezone, month: "numeric" }).format(by.at));
  return `Printed ${get("day")} ${MONTHS[monthNo - 1]} ${get("year")} · ${get("hour")}:${get("minute")} · ${by.name}`;
}

/* ── PDF ───────────────────────────────────────────────────────── */

export async function renderPdf(doc: ReportDoc, by: PrintedBy): Promise<Buffer> {
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
    pdf.font("Helvetica").fontSize(8).fillColor(MUTED);
    const sub = [doc.property.address, doc.property.gstin ? `GSTIN ${doc.property.gstin}` : null]
      .filter(Boolean).join("  ·  ");
    if (sub) pdf.text(sub, left, pdf.y + 2, { width: width * 0.55 });
    const leftEnd = pdf.y;

    pdf.font("Helvetica-Bold").fontSize(14).fillColor(ACCENT)
      .text(doc.title, left + width * 0.55, top, { width: width * 0.45, align: "right" });
    pdf.font("Helvetica").fontSize(8).fillColor(MUTED);
    for (const f of doc.facts) {
      pdf.text(`${f.label}  ${f.value}`, left + width * 0.55, pdf.y + 1, { width: width * 0.45, align: "right" });
    }
    const y = Math.max(leftEnd, pdf.y) + 8;
    pdf.moveTo(left, y).lineTo(left + width, y).lineWidth(1.2).strokeColor(ACCENT).stroke();
    pdf.y = y + 10;
  };

  const ROW_H = 15;
  const tableHead = (cols: ReportColumn[], widths: number[]) => {
    const hasGroups = cols.some((c) => c.group);
    if (hasGroups) {
      let x = left;
      let i = 0;
      while (i < cols.length) {
        const g = cols[i]!.group;
        let w = 0, j = i;
        while (j < cols.length && cols[j]!.group === g) { w += widths[j]!; j++; }
        if (g) {
          pdf.font("Helvetica-Bold").fontSize(8).fillColor(MUTED)
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
      pdf.font("Helvetica-Bold").fontSize(8).fillColor(INK)
        .text(c.label, x + 3, y, { width: widths[k]! - 6, align: numeric(c.kind) ? "right" : "left", lineBreak: false, ellipsis: true });
      x += widths[k]!;
    });
    pdf.y = y + 12;
    pdf.moveTo(left, pdf.y).lineTo(left + width, pdf.y).lineWidth(0.8).strokeColor(INK).stroke();
    pdf.y += 3;
  };

  header();

  for (const section of doc.sections) {
    const weights = section.columns.map((c) => (c.kind === "text" ? 2.6 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * width);

    if (pdf.y + 50 > bottom()) { pdf.addPage(); header(); }
    pdf.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(section.title, left, pdf.y + 4);
    pdf.y += 4;
    tableHead(section.columns, widths);

    for (const row of section.rows) {
      if (pdf.y + ROW_H > bottom()) {
        pdf.addPage(); header();
        tableHead(section.columns, widths);
      }
      drawRow(pdf, section.columns, widths, row, left, width, ROW_H);
    }
    pdf.y += 10;
  }

  if (doc.chart && doc.chart.x.length) {
    const h = 150;
    if (pdf.y + h + 20 > bottom()) { pdf.addPage(); header(); }
    drawChart(pdf, doc.chart, left, pdf.y + 6, width, h);
    pdf.y += h + 20;
  }

  if (doc.footnotes?.length) {
    pdf.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    for (const note of doc.footnotes) {
      if (pdf.y + 12 > bottom()) { pdf.addPage(); header(); }
      pdf.text(note, left, pdf.y + 2, { width });
    }
  }

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
  left: number, width: number, rowH: number,
): void {
  const y = pdf.y;
  const kind = row.kind ?? "row";
  if (kind === "band") {
    pdf.rect(left, y, width, rowH - 2).fill(BAND);
    const first = cols[0]!;
    pdf.font("Helvetica-Bold").fontSize(8.5).fillColor(INK)
      .text(formatCell(row.cells[first.key], "text"), left + 3, y + 3, { width: width - 6, lineBreak: false });
    pdf.y = y + rowH;
    return;
  }
  if (kind === "total") {
    pdf.moveTo(left, y).lineTo(left + width, y).lineWidth(0.8).strokeColor(INK).stroke();
  }
  let x = left;
  const indent = Math.min(3, Math.max(0, row.indent ?? 0)) * 8;
  cols.forEach((c, k) => {
    const pad = k === 0 ? indent : 0;
    pdf.font(kind === "total" ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK)
      .text(formatCell(row.cells[c.key], c.kind), x + 3 + pad, y + 3, {
        width: widths[k]! - 6 - pad, align: numeric(c.kind) ? "right" : "left", lineBreak: false, ellipsis: true,
      });
    x += widths[k]!;
  });
  pdf.moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.3).strokeColor(RULE).stroke();
  pdf.y = y + rowH;
}

function drawChart(
  pdf: PDFKit.PDFDocument, chart: NonNullable<ReportDoc["chart"]>,
  left: number, top: number, width: number, height: number,
): void {
  const colours = [ACCENT, INK, MUTED];
  const values = chart.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(1, ...values);
  const plotH = height - 18;
  const slot = width / chart.x.length;
  const barW = Math.max(2, (slot * 0.7) / chart.series.length);
  pdf.moveTo(left, top + plotH).lineTo(left + width, top + plotH).lineWidth(0.5).strokeColor(RULE).stroke();
  chart.x.forEach((label, i) => {
    chart.series.forEach((s, si) => {
      const v = s.values[i];
      if (v === null || v === undefined) return;
      const h = (v / max) * (plotH - 4);
      pdf.rect(left + i * slot + slot * 0.15 + si * barW, top + plotH - h, barW - 1, h).fill(colours[si % colours.length]!);
    });
    pdf.font("Helvetica").fontSize(6.5).fillColor(MUTED)
      .text(label, left + i * slot, top + plotH + 3, { width: slot, align: "center", lineBreak: false });
  });
}

/* ── Excel ─────────────────────────────────────────────────────── */

/** Indian grouping in Excel: crores, lakhs, thousands. */
const INR_FORMAT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';

export async function renderXlsx(doc: ReportDoc, by: PrintedBy): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "Fidato PMS";
  book.created = by.at;
  const sheet = book.addWorksheet(doc.title.slice(0, 31), {
    pageSetup: { paperSize: 9, orientation: doc.orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const widest = Math.max(1, ...doc.sections.map((s) => s.columns.length));

  const title = sheet.addRow([doc.property.name]);
  title.font = { bold: true, size: 14, color: { argb: "FF031728" } };
  const reportRow = sheet.addRow([doc.title]);
  reportRow.font = { bold: true, size: 12, color: { argb: "FFC4521D" } };
  for (const f of doc.facts) sheet.addRow([f.label, f.value]).font = { color: { argb: "FF4C5B67" } };
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

    for (const row of section.rows) {
      const kind = row.kind ?? "row";
      if (kind === "band") {
        const band = sheet.addRow([formatCell(row.cells[section.columns[0]!.key], "text")]);
        band.font = { bold: true, italic: true };
        continue;
      }
      const values = section.columns.map((c) => xlsxValue(row.cells[c.key], c.kind));
      const r = sheet.addRow(values);
      section.columns.forEach((c, k) => {
        const cell = r.getCell(k + 1);
        if (typeof cell.value === "number") {
          cell.numFmt = c.kind === "money" ? INR_FORMAT
            : c.kind === "percent" ? "0.00%" : c.kind === "count" ? "0" : "0.00";
        }
        if (cell.value instanceof Date) cell.numFmt = "dd mmm yyyy";
        if (cell.value === "-" || numeric(c.kind)) cell.alignment = { horizontal: "right" };
        if (k === 0 && row.indent) cell.alignment = { indent: row.indent };
      });
      if (kind === "total") {
        r.font = { bold: true };
        r.eachCell((cell) => { cell.border = { top: { style: "thin", color: { argb: "FF031728" } } }; });
      }
    }
    sheet.addRow([]);
  }

  for (const note of doc.footnotes ?? []) sheet.addRow([note]).font = { italic: true, color: { argb: "FF4C5B67" } };
  sheet.addRow([printedLine(by)]).font = { size: 9, color: { argb: "FF4C5B67" } };

  for (let c = 1; c <= widest; c++) sheet.getColumn(c).width = c === 1 ? 34 : 16;
  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function xlsxValue(value: string | number | null | undefined, kind: ReportColumn["kind"]): string | number | Date {
  if (value === null || value === undefined || value === "") return "-";
  if (kind === "percent" && typeof value === "number") return value / 100;
  if (kind === "date" && typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : value;
  }
  return value;
}

/* ── CSV ───────────────────────────────────────────────────────── */

/** One section after another, each with its title and header. Numbers are
    plain (no grouping) so a spreadsheet reads them as numbers; "-" where a
    figure nobody has. */
export function renderCsv(doc: ReportDoc, by: PrintedBy): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[] = [esc(doc.property.name), esc(doc.title)];
  for (const f of doc.facts) lines.push(`${esc(f.label)},${esc(f.value)}`);
  lines.push("");
  for (const section of doc.sections) {
    lines.push(esc(section.title));
    lines.push(section.columns.map((c) => esc(c.label)).join(","));
    for (const row of section.rows) {
      if (row.kind === "band") {
        lines.push(esc(formatCell(row.cells[section.columns[0]!.key], "text")));
        continue;
      }
      lines.push(section.columns.map((c) => {
        const v = row.cells[c.key];
        if (v === null || v === undefined || v === "") return "-";
        if (typeof v === "number") return c.kind === "count" ? String(Math.round(v)) : v.toFixed(2);
        return esc(String(v));
      }).join(","));
    }
    lines.push("");
  }
  for (const note of doc.footnotes ?? []) lines.push(esc(note));
  lines.push(esc(printedLine(by)));
  return lines.join("\r\n") + "\r\n";
}
