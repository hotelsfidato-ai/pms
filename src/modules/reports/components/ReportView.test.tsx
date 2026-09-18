import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReportView, formatCell } from "@/modules/reports/components/ReportView";
import type { ReportDoc } from "@/modules/reports/data/document";

/* ══════════════════════════════════════════════════════════════════
   THE ONE THING THAT DRAWS EVERY REPORT

   Every report in the owner's layout is a ReportDoc from the server,
   drawn here. What must never go wrong: a figure this system does not
   hold printed as 0, a negative balance hidden, a two-level heading
   losing its group, and a total that looks like any other row.
   ══════════════════════════════════════════════════════════════════ */

const DOC: ReportDoc = {
  report: "lodging-tax",
  title: "Lodging tax",
  property: { code: "5EL", name: "5 Elements Akkalkot", address: null, gstin: null, timezone: "Asia/Kolkata" },
  orientation: "landscape",
  facts: [{ label: "Month", value: "August 2026", kind: "text" }],
  sections: [
    {
      key: "bills",
      title: "Check Out Bills",
      columns: [
        { key: "date", label: "Date", kind: "date" },
        { key: "bill", label: "Total Bill Amount", kind: "money" },
        { key: "cgstNet", label: "Net Amt.", kind: "money", group: "CGST @2.5%" },
        { key: "cgstTax", label: "Tax Amt.", kind: "money", group: "CGST @2.5%" },
        { key: "expense", label: "Expense", kind: "money" },
      ],
      rows: [
        { kind: "row", cells: { date: "2026-08-25", bill: -784, cgstNet: 4000, cgstTax: 100, expense: null } },
        { kind: "total", cells: { date: "Total", bill: 4200.5, cgstNet: 4000, cgstTax: 100, expense: null } },
      ],
    },
    {
      key: "empty",
      title: "Cancellations",
      columns: [{ key: "a", label: "Room", kind: "text" }],
      rows: [],
      empty: "No bill was cancelled on this day.",
    },
  ],
  footnotes: ["Bill numbers are contiguous per day."],
};

describe("a report document on screen", () => {
  it("prints a figure nobody holds as a hyphen, never a zero", () => {
    expect(formatCell(null, "money")).toBe("-");
    expect(formatCell(0, "money")).toBe("₹0.00");
    render(<ReportView doc={DOC} />);
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("-");
    expect(cells.join(" ")).not.toContain("—");
  });

  it("keeps a negative balance visible, in red, with its sign", () => {
    render(<ReportView doc={DOC} />);
    const negative = screen.getByText("-₹784.00");
    expect(negative.className).toContain("text-brand-red");
  });

  it("prints dates and moments as the owner's reports do", () => {
    expect(formatCell("2026-08-25", "date")).toBe("25/08/2026");
    expect(formatCell("2026-08-25T10:42:43Z", "datetime", "Asia/Kolkata")).toBe("25/08/2026 04:12:43 PM");
    expect(formatCell("Total", "date")).toBe("Total");
    render(<ReportView doc={DOC} />);
    expect(screen.getByText("25/08/2026")).toBeDefined();
  });

  it("puts grouped columns under one heading that spans them", () => {
    render(<ReportView doc={DOC} />);
    const group = screen.getByRole("columnheader", { name: "CGST @2.5%" });
    expect(group.getAttribute("colspan")).toBe("2");
    expect(screen.getByRole("columnheader", { name: "Net Amt." })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Date" }).getAttribute("rowspan")).toBe("2");
  });

  it("rules a total off from the rows above it", () => {
    render(<ReportView doc={DOC} />);
    const totalRow = screen.getByText("₹4,200.50").closest("tr")!;
    expect(totalRow.className).toContain("border-dashed");
    expect(totalRow.className).toContain("font-semibold");
  });

  it("still prints a section with nothing in it, and says why", () => {
    render(<ReportView doc={DOC} />);
    const band = screen.getByRole("columnheader", { name: "Cancellations" });
    const body = band.closest("tbody")!;
    expect(within(body).getByText("No bill was cancelled on this day.")).toBeDefined();
  });

  it("prints the footnotes the accountant reads", () => {
    render(<ReportView doc={DOC} />);
    expect(screen.getByText("* Bill numbers are contiguous per day.")).toBeDefined();
  });
});
