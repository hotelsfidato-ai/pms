import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import InvoicePage from "./pages/Invoice";
import type { InvoiceDetail } from "./data/billing";

/* The FSSAI licence number (the audit's A16; the owner, 26 September) on a
   stay's tax invoice when it carries food - restaurant, drinks or minibar -
   and not on one for the room alone. The restaurant bill's half is
   src/modules/pos/billFssai.test.tsx. */

const FSSAI = "12345678901234";

const invoice = (category: string): InvoiceDetail => ({
  number: "5EL/2026-27/00012", finYear: "2026-27", issuedAt: "23 Sep 2026, 11:00", issuedBy: null,
  businessDate: "2026-09-23",
  supplier: { name: "Test Hotel", address: null, city: null, state: null, gstin: null, fssai: FSSAI },
  recipient: { name: "A Guest", gstin: null, address: null },
  placeOfSupply: "MH", sacCode: "996311",
  lines: [{ description: "A line", category, amount: 1000, taxRate: 5, taxAmount: 50, date: "2026-09-23" }],
  taxableValue: 1000, cgst: { rate: 2.5, amount: 25 }, sgst: { rate: 2.5, amount: 25 },
  taxTotal: 50, total: 1050,
  creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null, vatBill: null,
});

function open(answer: InvoiceDetail) {
  vi.spyOn(apiModule, "api").mockImplementation(async () => answer as never);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/h/5EL/invoices/doc/x"]}>
        <Routes><Route path="/h/:code/invoices/doc/*" element={<InvoicePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the FSSAI licence number on a tax invoice", () => {
  it("is printed when the invoice carries food", async () => {
    open(invoice("food"));
    expect((await screen.findByText(FSSAI)).closest("[data-invoice-fssai]")).toBeTruthy();
  });

  it("is not printed on an invoice for the room alone", async () => {
    open(invoice("room"));
    await screen.findByText("A Guest");
    expect(document.querySelector("[data-invoice-fssai]")).toBeNull();
  });
});
