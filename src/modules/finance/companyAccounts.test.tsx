import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { PropertyCityLedgerPage } from "./pages/Billing";

/* ══════════════════════════════════════════════════════════════════
   ONE FIGURE FOR AGODA - QA FI-2, the owner's D27-127 (28 September)

   Company accounts showed Agoda owing nothing (its stays' charges less every
   payment) while the City ledger report showed ₹5,999.70 sent to it. The
   screen reads that report now. Since D27-239 the report carries what each
   account paid, so Opening, Received and Balance are figures, not dashes.
   ══════════════════════════════════════════════════════════════════ */

const PAID = { businessDate: "2026-08-25", methods: { bank_transfer: "Bank transfer" }, accounts: [], payments: [] };

const REPORT = {
  report: "city-ledger", title: "City ledger",
  property: { code: "5EL", name: "5 Elements Akkalkot", address: null, gstin: null },
  orientation: "portrait", facts: [], footnotes: [],
  sections: [{
    key: "accounts", title: "City Ledger - Summary", columns: [],
    rows: [
      { kind: "row", cells: { account: "Agoda", contact: null, phone: null, opening: 1000, debit: 5999.7, credit: 2500, closing: 4499.7 } },
      { kind: "total", cells: { account: "Total", contact: null, phone: null, opening: 1000, debit: 5999.7, credit: 2500, closing: 4499.7 } },
    ],
  }],
};

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Company accounts (FI-2)", () => {
  it("shows the City ledger report's figures for each account: what it owed, was sent, paid and owes (D27-239)", async () => {
    const asked = vi.spyOn(apiModule, "api").mockImplementation(async (path: string) =>
      (String(path).includes("/company-payments") ? PAID : REPORT) as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/h/5EL/city-ledger"]}>
          <Routes><Route path="/h/:code/city-ledger" element={<PropertyCityLedgerPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const agoda = (await screen.findAllByText("Agoda")).map((e) => e.closest("tr")).find(Boolean)!;
    expect(within(agoda).getByText("₹6,000")).toBeTruthy();
    expect(within(agoda).getByText("₹2,500")).toBeTruthy();
    expect(within(agoda).getByText("₹4,500")).toBeTruthy();
    expect(within(agoda).queryAllByText("-")).toHaveLength(0);
    expect(asked.mock.calls.some(([path]) => /\/reports\/city-ledger/.test(String(path)))).toBe(true);
    expect(document.body.textContent).not.toMatch(/Total/);
  });
});
