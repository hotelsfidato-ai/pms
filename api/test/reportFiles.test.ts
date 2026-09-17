import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { REPORT_EXPORTERS } from "../src/routes/reportFiles.ts";
import {
  inr, formatCell, dateReport, dateTimeReport, renderPdf, renderXlsx, renderCsv,
} from "../src/reportRender.ts";
import type { ReportDoc } from "../src/modules/reports/index.ts";
import { ROLES, grantsFor } from "../../src/lib/permissions.ts";
import * as web from "../../src/lib/format.ts";

/* ══════════════════════════════════════════════════════════════════
   REPORTS AS FILES - the shared renderer and its route (D17-31, D17-32)

   The renderer is proved on a sample document in the reports service's own
   shape, built to carry what the real reports carry: grouped columns, a row
   whose unit is not its column's, a moment, an empty section. The route is
   proved end to end on a report that is built, for a role that may download
   and one that may not.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TZ = "Asia/Kolkata";
const by = { name: "Test GM", at: new Date("2026-09-17T15:30:00Z"), timezone: TZ };

const sample = (rows = 6): ReportDoc => ({
  report: "manager",
  title: "Manager Report",
  property: { code: "5EL", name: "5 Elements Akkalkot", address: "Akkalkot", gstin: "27AAAAA0000A1Z5" },
  orientation: "portrait",
  facts: [
    { label: "As on Date", value: "2026-08-25", kind: "date" },
    { label: "Currency", value: "INR", kind: "text" },
  ],
  sections: [
    {
      key: "room-revenue",
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
          kind: "row" as const,
          indent: 1 as const,
          cells: { item: `Room Charges ${i + 1}`, today: 12142.88, ptd: 419578.77, occ: 29.41, on: "2026-08-25" },
        })),
        { kind: "row", unit: "count", cells: { item: "Rooms sold", today: 5, ptd: 132, occ: null, on: null } },
        { kind: "total", cells: { item: "Total", today: null, ptd: 419578.77, occ: null, on: "Total" } },
      ],
    },
    {
      key: "entered",
      title: "Entered",
      columns: [
        { key: "who", label: "User", kind: "text" },
        { key: "at", label: "Entered On", kind: "datetime" },
      ],
      rows: [{ kind: "row", cells: { who: "Front desk", at: "2026-08-25T10:42:43Z" } }],
    },
    {
      key: "no-show",
      title: "No shows",
      columns: [{ key: "guest", label: "Guest", kind: "text" }],
      rows: [],
      empty: "No guest failed to arrive.",
    },
  ],
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
    expect(formatCell(null, "money", TZ)).toBe("-");
    expect(formatCell(undefined, "count", TZ)).toBe("-");
    expect(formatCell(29.4117, "percent", TZ)).toBe("29.41%");
  });

  it("prints dates and moments as eZee does, and a label in a date column as text (D17-77)", () => {
    expect(formatCell("2026-08-25", "date", TZ)).toBe("25/08/2026");
    expect(formatCell("Total", "date", TZ)).toBe("Total");
    expect(formatCell("2026-08-25T10:42:43Z", "datetime", TZ)).toBe("25/08/2026 04:12:43 PM");
  });

  it("prints dates exactly as the screens do: this copy and src/lib/format.ts agree", () => {
    for (const d of ["2026-08-25", "2027-01-01", "Total", "", "2026-8-5"]) {
      expect(dateReport(d), d).toBe(web.dateReport(d));
    }
    for (const m of ["2026-08-25T10:42:43Z", "2026-08-24T18:30:05Z", "2026-12-31T23:59:59+05:30", "nonsense"]) {
      for (const zone of ["Asia/Kolkata", "Asia/Dubai", "UTC"]) {
        expect(dateTimeReport(m, zone), `${m} ${zone}`).toBe(web.dateTimeReport(m, zone));
      }
    }
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

  it("makes a real .xlsx: numbers stay numbers, dates are dates, a missing figure is -", async () => {
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
    expect(values).toContain("25/08/2026");
    const moments = values.filter((v): v is Date => v instanceof Date).map((d) => d.toISOString());
    expect(moments, "the moment at the property's wall clock").toContain("2026-08-25T16:12:43.000Z");
  });

  it("makes a CSV a spreadsheet reads as numbers", () => {
    const csv = renderCsv(sample(), by);
    expect(csv).toContain("As on Date,25/08/2026");
    expect(csv).toContain("Particulars,Today,PTD,Occupancy,Date");
    expect(csv).toContain("Room Charges 1,12142.88,419578.77,29.41,25/08/2026");
    expect(csv, "a row whose unit is count").toContain("Rooms sold,5,132,-,-");
    expect(csv).toContain("Total,-,419578.77,-,Total");
    expect(csv).toContain("Front desk,25/08/2026 04:12:43 PM");
    expect(csv, "an empty section says why").toContain("No guest failed to arrive.");
    expect(csv).toContain("Printed 17/09/2026 09:00:00 PM · Test GM");
  });
});

describe("who may download", () => {
  const TAG = "REPORTFILESTEST";
  const uid = { gm: "test-uid-reportfiles-gm", front_desk: "test-uid-reportfiles-front_desk" };

  beforeAll(async () => {
    const hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
    for (const [role, firebaseUid] of Object.entries(uid)) {
      const { rows } = await sql(
        `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
         on conflict (email) do update set is_active = true, firebase_uid = excluded.firebase_uid
         returning id::text`,
        [`reportfiles-${role}@fidato.in`, `${TAG} ${role}`, firebaseUid]);
      await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);
      await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
        [rows[0].id, hotelId, role]);
    }
  });

  afterAll(async () => {
    const uids = Object.values(uid);
    await sql(`delete from staff_hotels where staff_id in
                 (select id from staff where firebase_uid = any($1))`, [uids]);
    await sql("update staff set is_active = false where firebase_uid = any($1)", [uids]);
    await closePool();
  });

  const get = (who: string, path: string) =>
    app.request(`/api/hotels${path}`, { headers: { "x-dev-staff-id": who } });

  it("is exactly the roles the matrix gives report export, and the owner", () => {
    const matrix = ["owner", ...ROLES.filter((r) => r !== "owner" && grantsFor(r, "report").includes("export"))];
    expect([...REPORT_EXPORTERS].sort()).toEqual([...new Set(matrix)].sort());
  });

  it("gives the general manager a built report as a file, named for the hotel and the month", async () => {
    for (const [ext, type] of [["csv", "text/csv"], ["xlsx", "spreadsheetml"], ["pdf", "application/pdf"]] as const) {
      const res = await get(uid.gm, `/5EL/reports/monthly-statistics.${ext}?month=2026-08`);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(res.headers.get("content-type")).toContain(type);
      expect(res.headers.get("content-disposition"))
        .toBe(`attachment; filename="5EL-monthly-statistics-2026-08.${ext}"`);
    }
    const csv = await (await get(uid.gm, "/5EL/reports/monthly-statistics.csv?month=2026-08")).text();
    expect(csv).toContain("Printed ");
    expect(csv, "the footer names who printed it").toContain(`${TAG} gm`);
  });

  it("refuses the front desk, in a sentence", async () => {
    const res = await get(uid.front_desk, "/5EL/reports/monthly-statistics.pdf");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("general manager");
  });

  it("says a report that is not built yet cannot be downloaded, and refuses a bad month", async () => {
    const later = await get(uid.gm, "/5EL/reports/night-audit.pdf");
    expect(later.status).toBe(404);
    expect(((await later.json()) as { error: string }).error).toBe("This report cannot be downloaded yet.");
    const bad = await get(uid.gm, "/5EL/reports/monthly-statistics.csv?month=2026-13");
    expect(bad.status).toBe(400);
  });

  it("leaves the reports service's own addresses to it", async () => {
    const res = await get(uid.gm, "/5EL/reports/monthly-statistics?month=2026-08");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("refuses an address that is not a report file", async () => {
    const res = await get(uid.gm, "/5EL/reports/manager.exe");
    expect(res.status).toBe(404);
  });
});
