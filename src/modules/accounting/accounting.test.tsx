import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import App from "@/App";
import { go, startSignedIn, signedIn, AGRA_HOTEL, withDemoHotel } from "@/test/app";
import { useUi } from "@/lib/ui";
import { mayReach, navigationFor } from "@/components/app/navigation";
import { dayBookSheet, FORMATS, type DayBook } from "@/modules/accounting/data/accounting";
import * as apiModule from "@/lib/api";
import * as csvModule from "@/lib/csv";

/* ══════════════════════════════════════════════════════════════════
   ACCOUNTING EXPORT — the Tally export (D18-16)

   What is proved here is what a PERSON is left looking at, and what
   ends up in the FILE they hand their accountant:

     the file's last line agrees with the lines above it
     a day the night audit has not run is in the file, and says so
     all three formats are offered, and the two that cannot produce a
       file say why rather than sitting greyed out
     the button does not offer a file it cannot write
     the menu and the page agree about who may open it

   The figures themselves are the server's and are proved there
   (api/test/modules/accounting/dayBook.test.ts), against the Manager
   report's own numbers. Nothing here recomputes one.
   ══════════════════════════════════════════════════════════════════ */

const ALL_ON = { pos: true, banquet: true, reception_pos: true };

const control = vi.hoisted(() => ({ book: null as unknown }));

vi.mock("@/modules/accounting/data/accounting", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/accounting/data/accounting")>();
  return { ...actual, getDayBook: vi.fn(async () => control.book) };
});

/** Two days of the demo month: one the audit has closed, one it has not. */
const BOOK: DayBook = {
  property: {
    code: "5EL", name: "5 Elements Akkalkot",
    address: "Akkalkot, Solapur", gstin: "27AAAAA0000A1Z5",
  },
  currency: "INR",
  businessDate: "2026-08-25",
  from: "2026-08-24",
  to: "2026-08-25",
  days: [
    { date: "2026-08-24", room: 12000, roomTax: 1440, extra: 2500.5, food: 2000.25, otherExtra: 500.25, extraTax: 125.03,
      pos: 0, posTax: 0, discount: 1000, alcohol: 1200, vat: 120, sales: 14700.5, tax: 1565.03, receipt: 9000, companyReceipt: 0,
      closed: true },
    { date: "2026-08-25", room: 8000, roomTax: 960, extra: 400.25, food: 400.25, otherExtra: 0, extraTax: 20.01,
      pos: 640, posTax: 32, discount: 0, alcohol: 0, vat: 0, sales: 9040.25, tax: 1012.01, receipt: 5000, companyReceipt: 0,
      closed: false },
  ],
  total: {
    room: 20000, roomTax: 2400, extra: 2900.75, food: 2400.5, otherExtra: 500.25, extraTax: 145.04, pos: 640, posTax: 32,
    discount: 1000, alcohol: 1200, vat: 120, sales: 23740.75, tax: 2577.04, receipt: 14000, companyReceipt: 0,
  },
  openDays: ["2026-08-25"],
};

/** The general manager at the demo property - one of the three the
    brief names. `startSignedIn` seeds a receptionist at Agra. */
const asGm = () => {
  signedIn({
    scope: {
      staffId: "33333333-3333-3333-3333-333333333333",
      email: "gm@fidato.in", fullName: "The GM", isGroupAdmin: false,
      hotels: [{ hotelId: AGRA_HOTEL, role: "gm" }],
    },
  });
  withDemoHotel();
};

beforeEach(() => {
  startSignedIn(); withDemoHotel();
  control.book = BOOK;
});

/* ── The file ──────────────────────────────────────────────────────── */

describe("the day book, as the accountant opens it", () => {
  it("ends with a total that agrees with the lines above it", () => {
    const { headers, rows } = dayBookSheet(BOOK);
    expect(headers[0]).toBe("Date");

    const last = rows[rows.length - 1]!;
    expect(last[0]).toBe("Total");

    /* Column by column, in paise: the file's last line is the file's
       own arithmetic, not a second opinion from somewhere else. */
    const days = rows.slice(0, -1);
    for (let col = 1; col <= headers.length - 2; col += 1) {
      const summed = days.reduce((t, r) => t + Math.round((r[col] as number) * 100), 0);
      expect(Math.round((last[col] as number) * 100), `column ${headers[col]}`).toBe(summed);
    }
  });

  /* ACC-3: the one "Extra charges" column is two now, in both files. */
  it("splits the extras into food charged to a room and the other extras", () => {
    const { headers, rows } = dayBookSheet(BOOK);
    const at = (h: string) => headers.indexOf(h);
    expect(headers, "the old one number is gone").not.toContain("Extra charges");
    expect(headers.slice(at("Room tax"), at("Extra tax") + 1))
      .toEqual(["Room tax", "Food charged to a room", "Other extras", "Extra tax"]);
    const day = rows.find((r) => r[0] === "2026-08-24")!;
    expect([day[at("Food charged to a room")], day[at("Other extras")]]).toEqual([2000.25, 500.25]);
  });

  it("carries a day the night audit has not run, and says so", () => {
    const { headers, rows } = dayBookSheet(BOOK);
    expect(headers[headers.length - 1]).toBe("Night audit");

    const open = rows.find((r) => r[0] === "2026-08-25")!;
    expect(open[open.length - 1]).toBe("Not run");
    /* And it is NOT a blank row. A day quietly printed as nothing is
       the one an accountant files without noticing. */
    expect(open[1]).toBe(8000);

    expect(rows.find((r) => r[0] === "2026-08-24")!.slice(-1)[0]).toBe("Closed");
  });

  it("writes figures a spreadsheet can add up, not formatted money", () => {
    const { rows } = dayBookSheet(BOOK);
    /* "₹12,000.00" sums to nothing. Every money cell is a number. */
    for (const cell of rows[0]!.slice(1, -1)) expect(typeof cell).toBe("number");
  });

  /* D21-91, 22 September: alcohol's VAT is "kept out of the GST part of the
     accountant's export, with its own VAT ledger". The server takes it out
     of the GST figures; the file must give it columns of its own and name
     the tax column for what it now is. */
  it("gives alcohol and its VAT their own columns, apart from GST", () => {
    const { headers, rows } = dayBookSheet(BOOK);
    const at = (h: string) => headers.indexOf(h);
    expect(at("Alcohol")).toBeGreaterThan(0);
    expect(at("VAT")).toBeGreaterThan(0);
    expect(at("GST")).toBeGreaterThan(0);
    expect(headers, "no column is simply 'Tax' any more").not.toContain("Tax");

    const day = rows.find((r) => r[0] === "2026-08-24")!;
    expect(day[at("Alcohol")]).toBe(1200);
    expect(day[at("VAT")]).toBe(120);
    expect(day[at("GST")], "the VAT is not in the GST column").toBe(1565.03);
  });

  /* D24-24, the owner: what the restaurant took gets "Restaurant" and
     "Restaurant tax" after "Extra tax", in both files (one layout, sheet.ts). */
  it("gives the restaurant's takings their own two columns, after Extra tax", () => {
    const { headers, rows } = dayBookSheet(BOOK);
    const at = (h: string) => headers.indexOf(h);
    expect(headers.slice(at("Extra tax"), at("Extra tax") + 3))
      .toEqual(["Extra tax", "Restaurant", "Restaurant tax"]);
    const day = rows.find((r) => r[0] === "2026-08-25")!;
    expect([day[at("Restaurant")], day[at("Restaurant tax")]]).toEqual([640, 32]);
  });
});

/* ── The screen ────────────────────────────────────────────────────── */

describe("the export screen", () => {
  /* ⚠ EVERY TEST USES ITS OWN PROPERTY CODE. The application's query
     cache lives as long as this file (App.tsx makes it once, staleTime
     Infinity) and this screen's key is
     ["accounting-day-book", hotelId, from, to] - identical in every
     test unless the code differs. The nil-range test below read the
     FIRST test's cached book and failed on the full run; a code per
     test is one word and cannot go wrong. The same warning is written
     at the top of `src/modules/purchasing/purchasing.test.tsx`. */
  const open = (code: string) => {
    asGm();
    withDemoHotel(code);
    useUi.setState({ hotelId: code });
    go("/reports/accounting");
    return render(<App />);
  };

  it("offers every format the owner chose", async () => {
    open("FMT1");
    for (const f of FORMATS) {
      expect(await screen.findByText(f.label)).toBeTruthy();
    }
  });

  it("says why the two Tally formats produce nothing yet", async () => {
    open("FMT2");
    /* Not a greyed-out control with no explanation beside it: the
       reason is the owner's own - the ledger names in their books.
       BOTH of them say it, which is why this counts rather than
       finding one. A format that went quiet would pass a findByText. */
    const said = await screen.findAllByText(/ledger names in your books/i);
    expect(said).toHaveLength(FORMATS.filter((f) => f.blocked).length);
    expect(said).toHaveLength(2);
  });

  it("will not offer a file it cannot write", async () => {
    open("FMT3");
    /* Wait for the day book to arrive first. The button exists from the
       first paint and is correctly disabled until there is something to
       export - asserting on it before the read lands tests the loading
       state, not this one. */
    await screen.findByRole("table");
    const button = await screen.findByRole("button", { name: /export/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(await screen.findByRole("radio", { name: /Tally Prime/i }));
    const after = await screen.findByRole("button", { name: /export/i });
    expect((after as HTMLButtonElement).disabled).toBe(true);
  });

  /* D22-37, the owner: "both the CSV and a real .xlsx" - Excel is a choice
     of its own, and Export hands over the one chosen (24 September). */
  it("hands over the Excel workbook when Excel is chosen, and the CSV when it is not", async () => {
    const xlsx = vi.spyOn(apiModule, "downloadFile").mockResolvedValue("day-book.xlsx");
    const csv = vi.spyOn(csvModule, "downloadCsv").mockImplementation(() => {});
    try {
      open("XLS1");
      await screen.findByRole("table");
      fireEvent.click(await screen.findByRole("button", { name: /export/i }));
      expect(csv).toHaveBeenCalledTimes(1);
      expect(xlsx).not.toHaveBeenCalled();

      fireEvent.click(await screen.findByRole("radio", { name: /Day book \(Excel\)/ }));
      fireEvent.click(await screen.findByRole("button", { name: /export/i }));
      expect(xlsx).toHaveBeenCalledWith(
        "/api/hotels/5EL/accounting/day-book.xlsx?from=2026-08-24&to=2026-08-25");
      expect(csv).toHaveBeenCalledTimes(1);
    } finally {
      xlsx.mockRestore();
      csv.mockRestore();
    }
  });

  it("names the days the night audit has not closed", async () => {
    open("AUD1");
    expect(await screen.findByText(/night audit has not run/i)).toBeTruthy();
  });

  it("says which basis it counts, so the Lodging tax sheet is not a surprise", async () => {
    open("BAS1");
    /* ACC-6: the ledger by day here, the bills that were issued there.
       A month with a stay still in house does not tie out between the
       two, and both are right - the person exporting should meet that
       sentence here rather than from their accountant. */
    expect(await screen.findByText(/bills that were issued/i)).toBeTruthy();
  });

  /* ACC-3, the owner's D27-382: food has its own column, and the screen says
     what each of the two holds. */
  it("says what food charged to a room is, and what the other extras are", async () => {
    open("FOD1");
    expect(await screen.findByText(/Food charged to a room is food on a bill/i)).toBeTruthy();
  });

  it("says when a range holds nothing, rather than handing over a file of nil", async () => {
    /* ACC-8. `dailyFigures` returns a row for every day of the range
       whether or not anything happened, so the table is NEVER empty and
       a person could otherwise export a month of zeros without being
       told it was a month of zeros. */
    control.book = {
      ...BOOK,
      days: BOOK.days.map((d) => ({
        ...d, room: 0, roomTax: 0, extra: 0, food: 0, otherExtra: 0, extraTax: 0, pos: 0, posTax: 0,
        discount: 0, alcohol: 0, vat: 0, sales: 0, tax: 0, receipt: 0, companyReceipt: 0,
      })),
      total: {
        room: 0, roomTax: 0, extra: 0, food: 0, otherExtra: 0, extraTax: 0, pos: 0, posTax: 0,
        discount: 0, alcohol: 0, vat: 0, sales: 0, tax: 0, receipt: 0, companyReceipt: 0,
      },
    } satisfies DayBook;

    open("NIL1");
    expect(await screen.findByText(/Nothing was charged or received/i)).toBeTruthy();
    /* The rows are still there - the days are real, and so is the nil. */
    expect(within(await screen.findByRole("table")).getByText("24 Aug 2026")).toBeTruthy();
  });

  it("shows the range's totals", async () => {
    open("TOT1");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("24 Aug 2026")).toBeTruthy();
    expect(await screen.findByText("₹23,740.75")).toBeTruthy();
  });
});

/* ── Who may open it ───────────────────────────────────────────────── */

describe("who may open the export", () => {
  it("lets the owner, an administrator, the GM and the accountant in (D27-122)", () => {
    for (const role of ["owner", "admin", "gm", "finance"] as const) {
      expect(mayReach(role, "/reports/accounting"), role).toBe(true);
    }
  });

  it("keeps out everyone else, including roles that hold `report`", () => {
    /* A hotel manager, a revenue manager and finance all hold `report`
       in the matrix and are still not the three the brief names.
       Widening that is the owner's, in permissions.ts. */
    for (const role of ["hotel_manager", "revenue_manager", "front_desk", "housekeeping"] as const) {
      expect(mayReach(role, "/reports/accounting"), role).toBe(false);
    }
  });

  it("sits in Reports now, and is not marked Not built yet", () => {
    /* A service that is built cannot also be not built. The owner's own
       list of services not built yet (the Coming soon section until
       28 September, D27-87) is asserted whole in navigation.test.ts; this
       is the same fact from this service's side, so renaming the entry
       here cannot quietly leave it in two menus. */
    const menu = navigationFor("owner", "5EL", ALL_ON);
    const where = (label: string) =>
      menu.filter((s) => s.items.some((i) => i.label === label)).map((s) => s.label);

    expect(where("Accounting export")).toEqual(["Reports"]);

    const notBuilt = menu.flatMap((s) => s.items).filter((i) => i.notBuilt).map((i) => i.to);
    expect(notBuilt).not.toContain("/coming-soon/accounting");
    expect(menu.flatMap((s) => s.items).find((i) => i.label === "Accounting export")?.notBuilt).toBeUndefined();
  });
});
