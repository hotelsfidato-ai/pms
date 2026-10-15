import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import BillPage from "@/modules/pos/pages/Bill";

/* ══════════════════════════════════════════════════════════════════
   THE FSSAI LICENCE NUMBER ON FOOD BILLS (the audit's A16; the owner,
   26 September): on every restaurant bill - a dash until the hotel has
   typed it. The invoice's half is src/modules/finance/invoiceFssai.test.tsx,
   the server's api/test/modules/admin/fssai.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const FSSAI = "12345678901234";

const order = (hotelFssai: string | null) => ({
  id: "o-1", orderNo: "12", outlet: "REST", outletName: "Restaurant", hotelName: "Test Hotel",
  hotelCity: null, hotelGstin: null, hotelFssai, table: "T1", status: "settled",
  businessDate: "2026-09-22", paymentMethod: "cash", openedBy: "Waiter", settledBy: null,
  eventTitle: null, net: 1000, discount: 0, gross: 1050, roundOff: 0, payable: 1050,
  taxes: [{ scheme: "gst", rate: 5, tax: 50 }],
  lines: [{ id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 1000, taxRate: 5, taxScheme: "gst",
    note: null, voided: false, kotStatus: "served", addedBy: "Waiter", parentLineId: null,
    isAddon: false, variationId: null }],
});

function open(path: string, route: string, element: React.ReactElement, answer: unknown) {
  vi.spyOn(apiModule, "api").mockImplementation(async () => answer as never);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the FSSAI licence number", () => {
  it("is on every restaurant bill", async () => {
    open("/pos/5EL/bill/o-1", "/pos/:code/bill/:id", <BillPage />, order(FSSAI));
    expect((await screen.findByText(`FSSAI licence ${FSSAI}`)).hasAttribute("data-bill-fssai")).toBe(true);
  });

  it("is a dash on a restaurant bill until the hotel types it", async () => {
    open("/pos/5EL/bill/o-1", "/pos/:code/bill/:id", <BillPage />, order(null));
    expect(await screen.findByText("FSSAI licence -")).toBeTruthy();
  });
});
