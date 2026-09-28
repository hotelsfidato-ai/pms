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
   screen reads that report now, and prints a dash for what it cannot know.
   ══════════════════════════════════════════════════════════════════ */

const REPORT = {
  report: "city-ledger", title: "City ledger",
  property: { code: "5EL", name: "5 Elements Akkalkot", address: null, gstin: null },
  orientation: "portrait", facts: [], footnotes: [],
  sections: [{
    key: "accounts", title: "City Ledger - Summary", columns: [],
    rows: [
      { kind: "row", cells: { account: "Agoda", contact: null, phone: null, opening: null, debit: 5999.7, credit: null, closing: null } },
      { kind: "total", cells: { account: "Total", contact: null, phone: null, opening: null, debit: 5999.7, credit: null, closing: null } },
    ],
  }],
};

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Company accounts (FI-2)", () => {
  it("shows the City ledger report's figure for each account, and a dash for what is not recorded", async () => {
    const asked = vi.spyOn(apiModule, "api").mockImplementation(async () => REPORT as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/h/5EL/city-ledger"]}>
          <Routes><Route path="/h/:code/city-ledger" element={<PropertyCityLedgerPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const agoda = (await screen.findAllByText("Agoda")).map((e) => e.closest("tr")).find(Boolean)!;
    expect(within(agoda).getByText("₹6,000")).toBeTruthy();
    expect(within(agoda).getAllByText("-")).toHaveLength(2);
    expect(String(asked.mock.calls[0]![0])).toMatch(/\/reports\/city-ledger/);
    expect(document.body.textContent).not.toMatch(/Total/);
  });
});
