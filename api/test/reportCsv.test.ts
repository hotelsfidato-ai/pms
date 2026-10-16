import { describe, it, expect } from "vitest";

const { renderCsv } = await import("../src/reportRender.ts");

/* ══════════════════════════════════════════════════════════════════
   A REPORT'S CSV DEFUSES A FORMULA (the owner's D27-340)

   A value starting =, +, - or @ is a formula to a spreadsheet: a guest named
   "=HYPERLINK(...)" would run in the accountant's Excel. The server's CSV
   now keeps such text as text (a tab in front), as the website's CSV did
   already (src/lib/csv.test.ts); figures and the dash for none are untouched.
   ══════════════════════════════════════════════════════════════════ */

const doc = {
  report: "x", title: "Guests", orientation: "portrait", facts: [], footnotes: [],
  property: { code: "CSV", name: "CSV Hotel", address: null, gstin: null },
  sections: [{
    key: "s", title: "Guests",
    columns: [{ key: "name", label: "Guest", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }],
    rows: [
      { cells: { name: '=HYPERLINK("http://evil.example","Click")', amount: -1234.5 } },
      { cells: { name: "@SUM(A1:A9)", amount: null } },
      { cells: { name: "+91 98765 43210", amount: 10 } },
      { cells: { name: "-cmd", amount: 5 } },
      { cells: { name: "Asha Rao", amount: 5 } },
    ],
  }],
} as unknown as Parameters<typeof renderCsv>[0];

describe("a report's CSV (D27-340)", () => {
  const lines = renderCsv(doc, { name: "x", at: new Date(), timezone: "Asia/Kolkata" }).split("\r\n");
  const row = (start: string) => lines.find((l) => l.replace(/^"/, "").replace(/^\t/, "").startsWith(start));

  it("keeps a formula as text: a tab in front of =, @, + and -", () => {
    expect(row("=HYPERLINK")).toBe('"\t=HYPERLINK(""http://evil.example"",""Click"")",-1234.50');
    expect(row("@SUM")).toBe("\t@SUM(A1:A9),-");
    expect(row("+91")).toBe("\t+91 98765 43210,10.00");
    expect(row("-cmd")).toBe("\t-cmd,5.00");
  });

  it("leaves a plain name, a negative figure and the dash for none as they were", () => {
    expect(row("Asha Rao")).toBe("Asha Rao,5.00");
    expect(lines.some((l) => l.endsWith(",-1234.50"))).toBe(true);
  });
});
