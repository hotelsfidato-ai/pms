import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, type Column } from "./DataTable";

/* ══════════════════════════════════════════════════════════════════
   A PHONE LOSES NOTHING

   Below `sm` the table renders as one card per row (16 September,
   measured: six screens a receptionist uses put a table wider than a
   375px screen inside a sideways scroller). The risk that change
   introduces is a column quietly disappearing on the small screen —
   especially one marked `hideBelow`, which the table hides on purpose
   because it has no width for it. A card has the width, so it shows.

   These tests read the card markup, which renders alongside the table
   in the same tree; the breakpoint decides which one a person sees.
   ══════════════════════════════════════════════════════════════════ */

interface Row { id: string; guest: string; room: string; nights: number; source: string }

const ROWS: Row[] = [
  { id: "1", guest: "Ananya Bose", room: "201", nights: 2, source: "Booking.com" },
  { id: "2", guest: "Rekha Gaikwad", room: "305", nights: 1, source: "Walk-in" },
];

const COLUMNS: Column<Row>[] = [
  { key: "guest", header: "Guest", cell: (r) => r.guest, sortable: true },
  { key: "room", header: "Room", cell: (r) => r.room },
  { key: "nights", header: "Nights", cell: (r) => r.nights, numeric: true },
  /* The one the table hides on a narrow screen. */
  { key: "source", header: "Source", cell: (r) => r.source, hideBelow: "md" },
];

function renderTable(extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable<Row>
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.id}
      {...extra}
    />,
  );
}

describe("a row on a phone", () => {
  it("renders every row as a card as well as a table row", () => {
    const { container } = renderTable();
    const cards = container.querySelectorAll("div.sm\\:hidden li");
    expect(cards).toHaveLength(ROWS.length);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(ROWS.length);
  });

  it("keeps every column, including one the table hides on a narrow screen", () => {
    const { container } = renderTable();
    const card = container.querySelector("div.sm\\:hidden li")!;
    const labels = [...card.querySelectorAll("dt")].map((dt) => dt.textContent);

    /* The first column is the card's heading, the rest are labelled lines. */
    expect(card.querySelector("p")?.textContent).toBe("Ananya Bose");
    for (const col of COLUMNS.slice(1)) {
      expect(labels, `the card dropped ${String(col.header)}`).toContain(col.header);
    }
    expect(card.textContent).toContain("Booking.com");
  });

  it("offers sorting, which the card list would otherwise lose with the header row", () => {
    renderTable({ onSort: () => {}, sortBy: "guest", sortDir: "asc" });
    const select = screen.getByLabelText("Sort by") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Guest"]);
  });

  it("makes the whole card the target when a row opens something", () => {
    const { container } = renderTable({ onRowClick: () => {} });
    const button = container.querySelector("div.sm\\:hidden li button")!;
    expect(button).toBeTruthy();
    expect(button.className).toContain("min-h-11");
  });
});
