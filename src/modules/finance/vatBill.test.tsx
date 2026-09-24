import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import { CreditNoteFlow } from "./flows/CreditNoteFlow";
import InvoicePage from "./pages/Invoice";
import VatBillPage from "./pages/VatBill";
import type { InvoiceDetail, VatBillDetail } from "./data/billing";

/* ══════════════════════════════════════════════════════════════════
   D22-44, THE OWNER: a separate VAT bill for alcohol. The GST invoice names
   the VAT bill and the VAT bill names the GST invoice - or, at the
   restaurant, the bill it was paid on. Cancelled like a credit note, by the
   owner, an administrator, the GM and the accountant.
   ══════════════════════════════════════════════════════════════════ */

const INVOICE = "5EL/2026-27/00012";
const VAT = "VAT/5EL/2026-27/0001";

const invoice: InvoiceDetail = {
  number: INVOICE, finYear: "2026-27", issuedAt: "23 Sep 2026, 11:00", issuedBy: null,
  businessDate: "2026-09-23",
  supplier: { name: "Riverside Test Hotel", address: null, city: null, state: null, gstin: null },
  recipient: { name: "A Guest", gstin: null, address: null },
  placeOfSupply: "MH", sacCode: "996311", lines: [], taxableValue: 1000,
  cgst: { rate: 2.5, amount: 25 }, sgst: { rate: 2.5, amount: 25 }, taxTotal: 50, total: 1050,
  creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null, vatBill: VAT,
};

const vatBill = (over: Partial<VatBillDetail> = {}): VatBillDetail => ({
  number: VAT, finYear: "2026-27", issuedAt: "23 Sep 2026, 11:00", issuedBy: null,
  businessDate: "2026-09-23",
  supplier: { name: "Riverside Test Hotel", address: null, city: null, state: null },
  recipient: "A Guest", invoice: INVOICE, order: null,
  lines: [{ description: "Restaurant - 20260923-4 (VAT 10%)", qty: null, amount: 500 }],
  discount: 0, taxableValue: 500, vatRate: 10, vatTotal: 50, total: 550,
  cancelsNumber: null, reason: null, cancelledBy: null, ...over,
});

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

beforeEach(startSignedIn);
afterEach(() => { vi.restoreAllMocks(); });

describe("D22-44 - the two documents name each other", () => {
  it("the GST invoice names its VAT bill", async () => {
    open(`/h/5EL/invoices/doc/${INVOICE}`, invoice);
    const line = await screen.findByText(VAT);
    expect(line.closest("[data-invoice-vat-bill]")).toBeTruthy();
    expect(line.getAttribute("href")).toBe(`/h/5EL/invoices/vat/${VAT}`);
  });

  it("the VAT bill names the GST invoice it was issued with, and taxes as VAT alone", async () => {
    open(`/h/5EL/invoices/vat/${VAT}`, vatBill());
    const named = await screen.findByText(INVOICE);
    expect(named.getAttribute("href")).toBe(`/h/5EL/invoices/doc/${INVOICE}`);
    expect(screen.getByText("VAT bill")).toBeTruthy();
    expect(screen.getByText("VAT @ 10%")).toBeTruthy();
    expect(screen.queryByText(/CGST|SGST/)).toBeNull();
  });

  it("a restaurant's VAT bill names the restaurant bill it was paid on", async () => {
    open(`/h/5EL/invoices/vat/${VAT}`, vatBill({ invoice: null, order: "20260923-4" }));
    const names = await screen.findByText("20260923-4");
    expect(names.closest("[data-vat-bill-names]")!.textContent).toContain("Restaurant bill");
  });
});

const as = (role: Role) => signedIn({
  scope: {
    staffId: "22222222-2222-2222-2222-222222222222",
    email: "someone@fidato.in", fullName: "Someone", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

const draw = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <CreditNoteFlow hotelId="AGR" number={VAT} total="₹550.00" vat />
  </QueryClientProvider>,
);

describe("D22-44 - who may cancel a VAT bill", () => {
  it.each(["finance", "gm", "admin", "owner"] as const)("%s may", (role) => {
    as(role);
    draw();
    const button = screen.getByRole("button", { name: /Cancel this VAT bill/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it.each(["front_desk", "hotel_manager"] as const)("%s sees the button disabled, with who may", (role) => {
    as(role);
    draw();
    const button = screen.getByRole("button", { name: /Cancel this VAT bill/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/^Cancelling a VAT bill is for the owner/)).toBeTruthy();
  });
});
