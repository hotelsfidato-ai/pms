import { describe, it, expect, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { REPORT_EXPORTERS } from "../src/routes/reportFiles.ts";
import { inr, formatCell, renderPdf, renderXlsx, renderCsv } from "../src/reportRender.ts";
import type { ReportDoc } from "../src/reportDoc.ts";
import { ROLES, grantsFor } from "../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   REPORTS AS FILES — the shared renderer and its route (D17-31, D17-32)

   The reports service's builders are not merged yet, so the renderer is
   proved on a sample document shaped like the Manager report, and the route
   on what it refuses.
   ══════════════════════════════════════════════════════════════════ */

afterAll(async () => { await closePool(); });

const by = { name: "Test GM", at: new Date("2026-09-17T15:30:00Z"), timezone: "Asia/Kolkata" };

const sample = (rows = 6): ReportDoc => ({
  report: "manager",
  title: "Manager Report",
  property: { code: "5EL", name: "5 Elements Akkalkot", address: "Akkalkot", gstin: "27AAAAA0000A1Z5" },
  orientation: "portrait",
  facts: [{ label: "As on Date", value: "25 Aug 2026" }, { label: "Currency", value: "INR" }],
  sections: [{
    title: "Room Revenue",
    columns: [
      { key: "item", label: "Particulars", kind: "text" },
      { key: "today", label: "Today", kind: "money", group: "Amount" },
      { key: "ptd", label: "PTD", kind: "money", group: "Amount" },
      { key: "occ", label: "Occupancy", kind: "percent" },
      { key: "on", label: "Date", kind: "date" },
    ],
    rows: [
      { kind: "band", cells: { item: "Rooms" } },
      ...Array.from({ length: rows }, (_, i) => ({
        indent: 1,
        cells: { item: `Room Charges ${i + 1}`, today: 12142.88, ptd: 419578.77, occ: 29.41, on: "2026-08-25" },
      })),
      { kind: "total" as const, cells: { item: "Total", today: null, ptd: 419578.77, occ: null, on: null } },
    ],
  }],
  footnotes: ["Complimentary rooms count as sold (D17-72)."],
});

describe("the figures on paper", () => {
  it("prints money in Indian grouping with two decimals", () => {
    expect(inr(419578.77)).toBe("4,19,578.77");
    expect(inr(12142.88)).toBe("12,142.88");
    expect(inr(123456789)).toBe("12,34,56,789.00");
    expect(inr(-784)).toBe("-784.00");
    expect(inr(0)).toBe("0.00");
  });

  it("prints a figure nobody has as -, never a zero", () => {
    expect(formatCell(null, "money")).toBe("-");
    expect(formatCell(undefined, "count")).toBe("-");
    expect(formatCell(29.4117, "percent")).toBe("29.41%");
    expect(formatCell("2026-08-25", "date")).toBe("25 Aug 2026");
  });
});

describe("the three files", () => {
  it("makes a PDF, and a long report runs onto more pages", async () => {
    const one = await renderPdf(sample(), by);
    expect(one.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
    expect(pages(one)).toBe(1);
    const long = await renderPdf(sample(160), by);
    expect(pages(long)).toBeGreaterThan(2);
  });

  it("makes a real .xlsx: numbers stay numbers, a missing figure is -", async () => {
    const buffer = await renderXlsx(sample(), by);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    const sheet = book.worksheets[0]!;
    expect(sheet.getCell("A1").value).toBe("5 Elements Akkalkot");
    const values: unknown[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
    expect(values).toContain(419578.77);
    expect(values).toContain("-");
    expect(values).toContain("Room Charges 1");
  });

  it("makes a CSV a spreadsheet reads as numbers", () => {
    const csv = renderCsv(sample(), by);
    expect(csv).toContain("Particulars,Today,PTD,Occupancy,Date");
    expect(csv).toContain("Room Charges 1,12142.88,419578.77,29.41,2026-08-25");
    expect(csv).toContain("Total,-,419578.77,-,-");
    expect(csv).toContain("Printed 17 Sep 2026 · 21:00 · Test GM");
  });
});

describe("who may download", () => {
  it("is exactly the roles the matrix gives report export, and the owner", () => {
    const matrix = ["owner", ...ROLES.filter((r) => r !== "owner" && grantsFor(r, "report").includes("export"))];
    expect([...REPORT_EXPORTERS].sort()).toEqual([...new Set(matrix)].sort());
  });

  it("leaves the reports service's own addresses to it", async () => {
    const res = await app.request("/api/hotels/5EL/reports/manager",
      { headers: { "x-dev-staff-id": "dev-owner" } });
    const body = (await res.json()) as { error?: string };
    expect(body.error).not.toBe("No such report.");
    expect(body.error).not.toBe("Reports cannot be downloaded yet.");
  });

  it("refuses an address that is not a report file", async () => {
    const res = await app.request("/api/hotels/5EL/reports/manager.exe",
      { headers: { "x-dev-staff-id": "dev-owner" } });
    expect(res.status).toBe(404);
  });
});
