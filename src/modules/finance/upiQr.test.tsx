import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { BillPrint, proformaOf } from "./flows/BillPrint";
import { InvoiceSheet } from "./pages/Invoice";
import { upiLink, loadUpiQr, type Upi } from "./flows/UpiQr";
import type { StayBill } from "./data/bill";

/* THE UPI QR ON AN UNPAID BILL (D27-396 wave 4): the NPCI link, exact; and
   no QR - and no empty space - with no UPI ID, nothing due, a paid bill, a
   credit note or a cancelled invoice. The restaurant's slip: pos/upiQr.test.tsx. */

const upi: Upi = { id: "fidato.5el@okaxis", payee: "Fidato Hotels & Resorts" };

describe("the UPI link (NPCI's upi://pay)", () => {
  it("is exact, each value URL-encoded, the amount with two decimals", () => {
    expect(upiLink(upi, 9650.5, "Stay FH-2611/0001"))
      .toBe("upi://pay?pa=fidato.5el%40okaxis&pn=Fidato%20Hotels%20%26%20Resorts&am=9650.50&cu=INR&tn=Stay%20FH-2611%2F0001");
  });
});

const bill = (over: Partial<StayBill> = {}): StayBill => ({
  hotel: { name: "Riverside Test Hotel", address: "1 Ghat Road", city: "Akkalkot",
           state: "Maharashtra", phone: null, gstin: "27TESTB1234F1Z5" },
  stay: { reference: "FH-TEST-0001", guest: "A Guest", checkIn: "2026-09-20",
          checkOut: "2026-09-22", room: "204" },
  lines: [{ date: "2026-09-20", description: "Room 204", category: "room", amount: 8000,
            tax: 400, rate: 5, billTo: "guest", company: null }],
  taxes: [{ rate: 5, taxable: 8000, cgst: 200, sgst: 200 }],
  vat: [],
  net: 8000, tax: 400, total: 8400, rounded: 8400, roundOff: 0, paid: 400, balance: 8000,
  upi,
  ...over,
});
const qr = () => document.querySelector("[data-upi-qr]");

beforeAll(() => loadUpiQr());

describe("the proforma bill", () => {
  it("prints the QR for the balance due, as the bill prints it", () => {
    render(<BillPrint bill={bill()} />);
    expect(qr()?.textContent).toContain("Scan with any UPI app to pay ₹8,000.00");
    expect(qr()?.textContent).toContain("fidato.5el@okaxis");
    expect(qr()?.querySelector("svg path")?.getAttribute("d")).toMatch(/^M\d/);
  });

  it("counts tonight's night, which the balance due includes", () => {
    render(<BillPrint bill={bill({ tonight: { description: "Room 204", amount: 4000, tax: 200, rate: 5 } })} />);
    expect(qr()?.textContent).toContain("₹12,200.00");
  });

  it("no UPI ID set: no QR", () => {
    render(<BillPrint bill={bill({ upi: null })} />);
    expect(qr()).toBeNull();
  });

  it("nothing due, or overpaid: no QR", () => {
    render(<BillPrint bill={bill({ paid: 8400, balance: 0 })} />);
    expect(qr()).toBeNull();
    render(<BillPrint bill={bill({ paid: 9000, balance: -600 })} />);
    expect(qr()).toBeNull();
  });
});

describe("the tax invoice", () => {
  const invoice = (over: object = {}) => ({ ...proformaOf(bill()).data, number: "5EL/26-27/0001", ...over });
  const sheet = (data: ReturnType<typeof invoice>) => render(
    <MemoryRouter><InvoiceSheet data={data} hotelId="5el" test={false} group={{ name: null, logo: null }} /></MemoryRouter>);

  it("owed: the QR for its balance", () => {
    sheet(invoice({ payments: [{ date: "2026-09-21", description: "Received - Cash", amount: 400 }] }));
    expect(qr()?.textContent).toContain("₹8,000.00");
  });

  it("settled: no QR", () => {
    sheet(invoice({ payments: [{ date: "2026-09-21", description: "Received - Cash", amount: 8400 }] }));
    expect(qr()).toBeNull();
  });

  it("a credit note, or an invoice a credit note cancelled: no QR", () => {
    sheet(invoice({ creditsInvoiceId: "i-1", creditsNumber: "5EL/26-27/0000" }));
    expect(qr()).toBeNull();
    sheet(invoice({ creditedBy: "5EL/26-27/0002" }));
    expect(qr()).toBeNull();
  });
});
