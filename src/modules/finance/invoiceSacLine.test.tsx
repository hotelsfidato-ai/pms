import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import InvoicePage from "./pages/Invoice";
import type { InvoiceDetail } from "./data/billing";

/* A SAC on each line of a tax invoice (the owner's D27-258 Q6): the kind's
   own code as the invoice was issued, 996311 on a room line with none, a
   dash on anything else with none - never a guessed code. */
const line = (description: string, category: string, sac: string | null) =>
  ({ description, category, amount: 1000, taxRate: 5, taxAmount: 50, date: "2026-09-23", sac });
const INVOICE: InvoiceDetail = {
  number: "5EL/2026-27/00013", finYear: "2026-27", issuedAt: "23 Sep 2026, 11:00", issuedBy: null,
  businessDate: "2026-09-23",
  supplier: { name: "Test Hotel", address: null, city: null, state: null, gstin: null, fssai: null },
  recipient: { name: "A Guest", gstin: null, address: null },
  placeOfSupply: "MH", sacCode: "996311",
  lines: [line("Room night", "room", "996311"), line("Dinner", "food", "996331"), line("A drink", "beverage", null)],
  taxableValue: 3000, cgst: { rate: 2.5, amount: 75 }, sgst: { rate: 2.5, amount: 75 },
  taxTotal: 150, total: 3150,
  creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null, vatBill: null,
};

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a SAC on each invoice line", () => {
  it("prints each line's own code, and a dash where none was set", async () => {
    vi.spyOn(apiModule, "api").mockImplementation(async () => INVOICE as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/h/5EL/invoices/doc/x"]}>
          <Routes><Route path="/h/:code/invoices/doc/*" element={<InvoicePage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const row = async (d: string) => (await screen.findByText(d)).closest("tr")!;
    expect(within(await row("Dinner")).getByText("996331")).toBeTruthy();
    expect(within(await row("Room night")).getByText("996311")).toBeTruthy();
    expect(within(await row("A drink")).getByText("-")).toBeTruthy();
  });
});
