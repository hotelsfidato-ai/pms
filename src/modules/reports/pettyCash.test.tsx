import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { ROLES, can } from "@/lib/permissions";
import { mayReach } from "@/components/app/navigation";
import { startSignedIn } from "@/test/app";
import { BUSINESS_DATE } from "@/data/repositories";
import { monthOf } from "@/modules/reports/data/statistics";
import type { ReportDoc } from "@/modules/reports/data/document";
import { PettyCashPage } from "@/modules/reports/pages/Ledgers";

/* ══════════════════════════════════════════════════════════════════
   THE PETTY CASH REPORT ON SCREEN - the owner's D27-370

   The server's document drawn as every report is, for the month to the
   business date; read by who reads Cashier shift (`invoice`, D27-147).
   The figures are the server's: api/test/modules/finance/pettyCash.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const DOC: ReportDoc = {
  report: "petty-cash", title: "Petty cash",
  property: { code: "5EL", name: "5 Elements Akkalkot", address: null, gstin: null },
  orientation: "landscape",
  facts: [{ label: "From", value: "2026-08-01", kind: "date" }, { label: "To", value: "2026-08-25", kind: "date" }],
  sections: [{
    key: "by-day", title: "Expenses, by day",
    columns: [
      { key: "date", label: "Date", kind: "date" }, { key: "place", label: "Where", kind: "text" },
      { key: "category", label: "Category", kind: "text" }, { key: "reason", label: "What it was for", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" }, { key: "approval", label: "Approval", kind: "text" },
    ],
    rows: [
      { kind: "row", cells: { date: "2026-08-25", place: "Front desk", category: null, reason: "Old taxi", amount: 90, approval: "Not asked" } },
      { kind: "row", cells: { date: "2026-08-25", place: "Fidato Restaurant", category: "Kitchen", reason: "Vegetables", amount: 300, approval: "Waiting" } },
      { kind: "total", cells: { date: "Total", amount: 90 } },
    ],
  }],
  footnotes: [],
};

let asked: string[] = [];
beforeEach(() => {
  startSignedIn();
  asked = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => { asked.push(url); return DOC as never; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the Petty cash report (D27-370)", () => {
  it("asks the month to the business date, and draws both places with a dash for no category", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/reports/petty-cash"]}>
          <Routes><Route path="/reports/petty-cash" element={<PettyCashPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Vegetables")).toBeTruthy();
    expect(screen.getByText("Old taxi")).toBeTruthy();
    expect(screen.getByText("Front desk")).toBeTruthy();
    await waitFor(() => expect(asked).toContain(
      `/api/hotels/5EL/reports/petty-cash?asOn=${BUSINESS_DATE}&from=${monthOf(BUSINESS_DATE).from}`));
  });

  it("is reached by who reads Cashier shift, and not by the revenue manager", () => {
    for (const role of ROLES) {
      expect(mayReach(role, "/reports/petty-cash"), role).toBe(mayReach(role, "/reports/cashier-shift"));
    }
    expect(mayReach("revenue_manager", "/reports/petty-cash")).toBe(false);
    expect(mayReach("finance", "/reports/petty-cash")).toBe(can("finance", "view", "invoice"));
  });
});
