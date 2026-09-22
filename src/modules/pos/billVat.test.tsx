import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import BillPage from "@/modules/pos/pages/Bill";

/* ══════════════════════════════════════════════════════════════════
   THE RESTAURANT'S PRINTED BILL - alcohol is VAT (D21-91)

   "One 'VAT 10%' line on the bill, never split into CGST/SGST." The bill
   grouped every line by rate and halved each rate into CGST and SGST, so a
   whisky at 10% VAT would have printed "CGST 5% / SGST 5%". It now keeps a
   line the till rang as VAT apart - and apart from a GST line at the same
   rate, which must not fold into it. The 10 is this file's, not a rate the
   page knows.
   ══════════════════════════════════════════════════════════════════ */

const line = (id: string, name: string, unitPrice: number, taxRate: number, taxScheme: "gst" | "vat") => ({
  id, name, qty: 1, unitPrice, taxRate, taxScheme, note: null, voided: false,
  kotStatus: "served", addedBy: "Waiter", parentLineId: null, isAddon: false, variationId: null,
});

const ORDER = {
  id: "o-1", orderNo: "12", outlet: "REST", outletName: "Restaurant", hotelName: "Test Hotel",
  hotelCity: null, hotelGstin: null, table: "T1", status: "settled", businessDate: "2026-09-22",
  paymentMethod: "cash", openedBy: "Waiter", settledBy: null, eventTitle: null,
  lines: [
    line("l-1", "Paneer Tikka", 1000, 5, "gst"),
    line("l-2", "Whisky 30 ml", 500, 10, "vat"),
    line("l-3", "Something at ten per cent GST", 200, 10, "gst"),
  ],
  net: 1700, gross: 1820,
};

afterEach(() => { vi.restoreAllMocks(); });

function open() {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url === "/api/hotels/5EL/till/orders/o-1") return ORDER as never;
    throw new apiModule.ApiError(500, "Request failed (500).");
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/h/5EL/till/bill/o-1"]}>
        <Routes><Route path="/h/:code/till/bill/:id" element={<BillPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the restaurant's printed bill", () => {
  it("prints VAT on alcohol as one line, never as a CGST and SGST pair", async () => {
    open();
    const vat = await screen.findByText("VAT 10%");
    expect(vat.parentElement?.textContent).toMatch(/50\.00/);
    /* The GST line at 10% keeps its own pair - 20 of tax, 10 and 10 - and
       the whisky's 50 is not in it. */
    expect(screen.getAllByText("CGST 5%").length).toBe(1);
    expect(screen.getByText("CGST 5%").parentElement?.textContent).toMatch(/10\.00/);
    expect(screen.getByText("CGST 2.5%")).toBeTruthy();
  });
});
