import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillPrint } from "./flows/BillPrint";
import type { StayBill } from "./data/bill";

/* The desk's printed bill, 21 September: it printed the demo's made-up
   GSTIN (27AAAAA0000A1Z5) at every hotel and "CGST 2.5% / SGST 2.5%" on
   every bill. It now draws what app.stay_bill answers (migration 123) and
   computes nothing; these pin that it prints what it is given. */

const bill = (over: Partial<StayBill> = {}): StayBill => ({
  hotel: { name: "Riverside Test Hotel", address: "1 Ghat Road", city: "Akkalkot",
           state: "Maharashtra", phone: null, gstin: "27TESTB1234F1Z5" },
  stay: { reference: "FH-TEST-0001", guest: "A Guest", checkIn: "2026-09-20",
          checkOut: "2026-09-22", room: "204" },
  lines: [
    { date: "2026-09-20", description: "Room 204", category: "room", amount: 8000,
      tax: 1440, rate: 18, billTo: "guest", company: null },
    { date: "2026-09-20", description: "Laundry", category: "laundry", amount: 200,
      tax: 10, rate: 5, billTo: "guest", company: null },
  ],
  taxes: [
    { rate: 5, taxable: 200, cgst: 5, sgst: 5 },
    { rate: 18, taxable: 8000, cgst: 720, sgst: 720 },
  ],
  vat: [],
  net: 8200, tax: 1450, total: 9650, rounded: 9650, roundOff: 0, paid: 0, balance: 9650,
  ...over,
});

describe("the printed bill", () => {
  it("prints the hotel's own name and GSTIN, never the demo's", () => {
    render(<BillPrint bill={bill()} title="Tax Invoice" />);
    expect(screen.getByText("Riverside Test Hotel")).toBeDefined();
    expect(document.querySelector("[data-bill-gstin]")?.textContent).toBe("27TESTB1234F1Z5");
    expect(document.body.textContent).not.toContain("27AAAAA0000A1Z5");
    expect(document.body.textContent).not.toContain("Fidato");
  });

  it("prints a dash where the hotel has set no GSTIN", () => {
    render(<BillPrint bill={bill({ hotel: { ...bill().hotel, gstin: null } })} title="Tax Invoice" />);
    expect(document.querySelector("[data-bill-gstin]")?.textContent).toBe("-");
  });

  it("prints one CGST and SGST pair per rate, each half of it", () => {
    render(<BillPrint bill={bill()} title="Tax Invoice" />);
    expect(screen.getByText("CGST 9%")).toBeDefined();
    expect(screen.getByText("SGST 9%")).toBeDefined();
    expect(screen.getByText("CGST 2.5%")).toBeDefined();
    expect(document.querySelectorAll("[data-bill-tax-rate]").length).toBe(2);
  });

  it("prints no tax rows for a bill with no taxed line", () => {
    render(<BillPrint bill={bill({ taxes: [] })} title="Tax Invoice" />);
    expect(screen.queryByText(/CGST/)).toBeNull();
  });

  /* D21-91: alcohol is "one 'VAT 10%' line on the bill, never split into
     CGST/SGST". The rate is whatever app.stay_bill answers - 10 here is the
     fixture's, not a figure the component knows. */
  it("prints VAT on alcohol as one line, never as a CGST and SGST pair", () => {
    render(<BillPrint bill={bill({
      taxes: [],
      vat: [{ rate: 10, taxable: 1500, vat: 150 }],
    })} title="Tax Invoice" />);
    expect(screen.getByText("VAT 10%")).toBeDefined();
    expect(document.querySelectorAll("[data-bill-vat-rate]").length).toBe(1);
    expect(screen.queryByText(/CGST/)).toBeNull();
    expect(screen.queryByText(/SGST/)).toBeNull();
    expect(screen.queryByText("CGST 5%")).toBeNull();
  });
});
