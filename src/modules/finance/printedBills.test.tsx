import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { BillPrint } from "./flows/BillPrint";
import { FolioPanel } from "./flows/FolioPanel";
import InvoicePage from "./pages/Invoice";
import VatBillPage from "./pages/VatBill";
import type { StayBill } from "./data/bill";
import type { InvoiceDetail, VatBillDetail } from "./data/billing";

/* ══════════════════════════════════════════════════════════════════
   THE PRINTED BILLS - QA FI-8, FI-9, FI-16, the print samples, round E
   (28 September)

   The interim bill: one figure, no round-off (D27-126), and a Print. The
   hotel's place once on the interim bill and the VAT bill, as the tax
   invoice already did. A function's invoice names s.12(3)(c).
   ══════════════════════════════════════════════════════════════════ */

const HOTEL = {
  name: "5 Elements Akkalkot", phone: null, gstin: "27AAAAA0000A1Z5",
  address: "Near Swami Samarth Temple, Akkalkot, Solapur District, Maharashtra 413216",
  city: "Akkalkot", state: "MH",
};

const BILL: StayBill = {
  hotel: HOTEL,
  stay: { reference: "FH-TEST-1", guest: "A Guest", checkIn: "2026-08-24", checkOut: "2026-08-26", room: "208" },
  lines: [{ date: "2026-08-24", description: "Room 208", category: "room", amount: 5864, tax: 293.2,
            rate: 5, billTo: "guest", company: null }],
  taxes: [{ rate: 5, taxable: 5864, cgst: 146.6, sgst: 146.6 }], vat: [],
  net: 5864, tax: 293.2, total: 6157.2, rounded: 6157, roundOff: -0.2, paid: 0, balance: 6157.2,
};

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the interim bill (FI-9, FI-16)", () => {
  it("prints the exact total, the outstanding's figure, and no round-off", () => {
    render(<BillPrint bill={BILL} title="Interim bill" />);
    const page = document.querySelector("[data-bill-print]")!;
    expect(page.textContent).not.toMatch(/Round off/);
    expect(page.textContent).not.toMatch(/6,157\.00/);
    expect(screen.getAllByText("₹6,157.20").length).toBe(2);   // Total and Outstanding
  });

  it("names the town and state once", () => {
    render(<BillPrint bill={BILL} title="Interim bill" />);
    const page = document.querySelector("[data-bill-print]")!;
    expect(page.textContent).toMatch(/Maharashtra 413216 · GSTIN/);
    expect(page.textContent).not.toMatch(/Akkalkot, MH/);
  });
});

describe("the interim bill's Print (FI-8)", () => {
  it("opens the bill's own page, which prints without the screen behind it", async () => {
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string) =>
      (url.endsWith("/bill") ? BILL : url.endsWith("/postings") ? [] : new Promise(() => {})) as never);
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const stay = { id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
      roomNumber: "208", status: "in-house" } as unknown as Stay;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><FolioPanel hotelId="5EL" stay={stay} businessDate="2026-08-25" /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Interim bill/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findAllByText("₹6,157.20");
    fireEvent.click(within(dialog).getByRole("button", { name: /Print/ }));
    expect(opened).toHaveBeenCalledWith("/h/5EL/stays/stay-1/bill", "_blank", "noopener");
  });
});

const INVOICE: InvoiceDetail = {
  number: "5EL/2026-27/00009", finYear: "2026-27", issuedAt: "25 Aug 2026, 11:00", issuedBy: null,
  businessDate: "2026-08-25",
  supplier: { name: "5 Elements Akkalkot", address: null, city: null, state: null, gstin: "27AAAAA0000A1Z5" },
  recipient: { name: "A Host", gstin: null, address: null },
  placeOfSupply: "MH", sacCode: "997212", lines: [], taxableValue: 1000,
  cgst: { rate: 9, amount: 90 }, sgst: { rate: 9, amount: 90 }, taxTotal: 180, total: 1180,
  creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null,
};

const VAT: VatBillDetail = {
  number: "VAT/5EL/2026-27/0001", finYear: "2026-27", issuedAt: "25 Aug 2026, 11:00", issuedBy: null,
  businessDate: "2026-08-25",
  supplier: { name: "5 Elements Akkalkot", address: HOTEL.address, city: "Akkalkot", state: "MH" },
  recipient: "A Guest", invoice: null, order: null,
  lines: [{ description: "Beer", qty: 1, amount: 500 }],
  discount: 0, taxableValue: 500, vatRate: 10, vatTotal: 50, total: 550,
  cancelsNumber: null, reason: null, cancelledBy: null,
};

function open(path: string, answer: unknown) {
  vi.spyOn(apiModule, "api").mockImplementation(async () => answer as never);
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

describe("the VAT bill (the print samples)", () => {
  it("names the town and state once", async () => {
    open(`/h/5EL/invoices/vat/${VAT.number}`, VAT);
    await screen.findAllByText(/Beer/);
    expect(document.body.textContent).toMatch(/Maharashtra 413216/);
    expect(document.body.textContent).not.toMatch(/413216, Akkalkot, MH/);
  });
});

describe("a function's tax invoice (round E)", () => {
  it("names s.12(3)(c), not the accommodation's s.12(3)(b)", async () => {
    open(`/h/5EL/invoices/doc/${INVOICE.number}`, INVOICE);
    const line = await screen.findByText(/IGST Act/);
    expect(line.textContent).toMatch(/s\.12\(3\)\(c\)/);
  });
});
