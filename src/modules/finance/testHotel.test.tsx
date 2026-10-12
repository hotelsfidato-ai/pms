import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, TEST_HOTEL, startSignedIn, withDemoHotel, withTestHotel } from "@/test/app";
import { NOTHING_SENT, TEST_DOCUMENT } from "@/lib/testHotel";
import { BillPrint } from "./flows/BillPrint";
import InvoicePage from "./pages/Invoice";
import VatBillPage from "./pages/VatBill";
import type { StayBill } from "./data/bill";
import type { InvoiceDetail, VatBillDetail } from "./data/billing";

/* ══════════════════════════════════════════════════════════════════
   FINANCE'S PAPER IN A TEST HOTEL (the owner's D27-296 (8))

   The bill (the folio's print, the interim bill, the desk's dialog), the
   tax invoice and credit note, and the VAT bill: TEST · NOT VALID large
   across them, and no GSTIN - neither the hotel's nor a company's. A real
   hotel's are exactly what they were: the snapshots were taken from the
   code before test hotels existed. The tax invoice's Send is off, with
   the sentence.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const HOTEL_GSTIN = "27ABCDE1234F1Z5";
const COMPANY_GSTIN = "27PQRSX9876K1Z2";

const bill: StayBill = {
  hotel: { name: "5 Elements Akkalkot", address: "1 Ghat Road", city: "Akkalkot",
           state: "Maharashtra", phone: null, gstin: HOTEL_GSTIN },
  stay: { reference: "FH-0001", guest: "A Guest", checkIn: "2026-08-23",
          checkOut: "2026-08-25", room: "204" },
  lines: [{ date: "2026-08-23", description: "Room 204", category: "room", amount: 4000,
            tax: 200, rate: 5, billTo: "guest", company: null }],
  taxes: [{ rate: 5, taxable: 4000, cgst: 100, sgst: 100 }],
  vat: [],
  net: 4000, tax: 200, total: 4200, rounded: 4200, roundOff: 0, paid: 0, balance: 4200,
};

const invoice = (number: string): InvoiceDetail => ({
  number, finYear: "2026-27", issuedAt: "25 Aug 2026, 11:00", issuedBy: "Asha",
  businessDate: "2026-08-25",
  supplier: { name: "5 Elements Akkalkot", address: "1 Ghat Road", city: "Akkalkot",
              state: "MH", gstin: HOTEL_GSTIN, fssai: null },
  recipient: { name: "Acme Travels", gstin: COMPANY_GSTIN, address: "2 Market Road" },
  placeOfSupply: "MH", sacCode: "996311",
  lines: [{ description: "Room 204", category: "room", amount: 4000, taxRate: 5, taxAmount: 200,
            date: "2026-08-23" }],
  taxableValue: 4000, cgst: { rate: 2.5, amount: 100 }, sgst: { rate: 2.5, amount: 100 },
  taxTotal: 200, total: 4200,
  creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null, vatBill: null,
});

const vatBill = (number: string): VatBillDetail => ({
  number, finYear: "2026-27", issuedAt: "25 Aug 2026, 11:00", issuedBy: null,
  businessDate: "2026-08-25",
  supplier: { name: "5 Elements Akkalkot", address: null, city: null, state: null },
  recipient: "A Guest", invoice: null, order: null,
  lines: [{ description: "Restaurant (VAT 10%)", qty: null, amount: 500 }],
  discount: 0, taxableValue: 500, vatRate: 10, vatTotal: 50, total: 550,
  cancelsNumber: null, reason: null, cancelledBy: null,
});

function open(path: string, answers: { invoice?: InvoiceDetail; vat?: VatBillDetail }) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    const p = url.split("?")[0]!;
    if (p.endsWith("/group")) return { name: "Fidato Hotels", logo: null, hotelLogo: null } as never;
    if (p.endsWith("/guest-messages")) {
      return { connected: true, notConnected: null, onlineCheckIn: true, messages: [], unreachable: [] } as never;
    }
    if (p.includes("/invoices/") && answers.invoice) return answers.invoice as never;
    if (p.includes("/vat-bills/") && answers.vat) return answers.vat as never;
    throw new ApiError(404, "Not found.");
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/h/:code/invoices/doc/*" element={<InvoicePage />} />
          <Route path="/h/:code/invoices/vat/*" element={<VatBillPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The paper: DocPage's sheet, once the group's name is on it. */
async function paper(): Promise<string> {
  await screen.findByText("by Fidato Hotels");
  return document.querySelector("article")!.outerHTML;
}

beforeEach(() => { startSignedIn(); withDemoHotel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a real hotel's finance paper is unchanged", () => {
  it("the bill, byte for byte", async () => {
    const { container } = render(<BillPrint bill={bill} title="Interim bill" group={{ name: "Fidato Hotels", logo: null }} />);
    await expect(container.innerHTML).toMatchFileSnapshot("./__snapshots__/testHotel.real-bill.html");
    expect(container.textContent).toContain(HOTEL_GSTIN);
  });

  it("the tax invoice, byte for byte", async () => {
    open(`/h/${HOTEL}/invoices/doc/5EL/2026-27/00012`, { invoice: invoice("5EL/2026-27/00012") });
    await expect(await paper()).toMatchFileSnapshot("./__snapshots__/testHotel.real-invoice.html");
    expect(document.querySelector("article")!.textContent).toContain(HOTEL_GSTIN);
  });

  it("the VAT bill, byte for byte", async () => {
    open(`/h/${HOTEL}/invoices/vat/VAT/5EL/2026-27/0001`, { vat: vatBill("VAT/5EL/2026-27/0001") });
    await expect(await paper()).toMatchFileSnapshot("./__snapshots__/testHotel.real-vat-bill.html");
  });
});

describe("a test hotel's finance paper", () => {
  beforeEach(() => withTestHotel());

  it("the bill says TEST · NOT VALID large, and carries no GSTIN", () => {
    const { container } = render(<BillPrint bill={bill} title="Interim bill" />);
    expect(container.querySelector("[data-test-document]")?.textContent).toBe(TEST_DOCUMENT);
    expect(container.textContent).not.toContain("GSTIN");
    expect(container.textContent).not.toContain(HOTEL_GSTIN);
    expect(container.querySelector("[data-bill-gstin]")).toBeNull();
    /* Still the bill: the place, the stay, the figures. */
    expect(container.textContent).toContain("1 Ghat Road");
    expect(container.textContent).toContain("FH-0001");
  });

  it("the tax invoice says TEST · NOT VALID large, and carries no GSTIN, the hotel's or the company's", async () => {
    open(`/h/${TEST_HOTEL}/invoices/doc/TEST/2026-27/00001`, { invoice: invoice("TEST/2026-27/00001") });
    await paper();
    const sheet = document.querySelector("article")!;
    expect(sheet.querySelector("[data-test-document]")?.textContent).toBe(TEST_DOCUMENT);
    expect(sheet.textContent).not.toContain("GSTIN");
    expect(sheet.textContent).not.toContain(HOTEL_GSTIN);
    expect(sheet.textContent).not.toContain(COMPANY_GSTIN);
    expect(sheet.textContent).toContain("Acme Travels");
  });

  it("a credit note too", async () => {
    open(`/h/${TEST_HOTEL}/invoices/doc/TEST/2026-27/00002`, { invoice: {
      ...invoice("TEST/2026-27/00002"), creditsInvoiceId: "i-1", creditsNumber: "TEST/2026-27/00001", reason: "Wrong room",
    } });
    await paper();
    const sheet = document.querySelector("article")!;
    expect(screen.getByText("Credit Note")).toBeTruthy();
    expect(sheet.querySelector("[data-test-document]")?.textContent).toBe(TEST_DOCUMENT);
    expect(sheet.textContent).not.toContain("GSTIN");
  });

  it("the VAT bill says TEST · NOT VALID large", async () => {
    open(`/h/${TEST_HOTEL}/invoices/vat/VAT/TEST/2026-27/0001`, { vat: vatBill("VAT/TEST/2026-27/0001") });
    await paper();
    expect(document.querySelector("article [data-test-document]")?.textContent).toBe(TEST_DOCUMENT);
  });

  it("the tax invoice's Send is off, with the sentence", async () => {
    open(`/h/${TEST_HOTEL}/invoices/doc/TEST/2026-27/00001`, { invoice: invoice("TEST/2026-27/00001") });
    await paper();
    /* `connected` is true: it is the test hotel that stops it, not the sender. */
    expect(await screen.findByText(NOTHING_SENT)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send invoice" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("and is on, as before, in a real hotel", async () => {
    withDemoHotel();
    open(`/h/${HOTEL}/invoices/doc/5EL/2026-27/00012`, { invoice: invoice("5EL/2026-27/00012") });
    await paper();
    await vi.waitFor(() =>
      expect((screen.getByRole("button", { name: "Send invoice" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(NOTHING_SENT)).toBeNull();
  });
});
