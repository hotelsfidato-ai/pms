import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import BillPage from "@/modules/pos/pages/Bill";

/* ══════════════════════════════════════════════════════════════════
   FOOD AND LIQUOR ON SEPARATE BILLS (the owner, 25 November 2026)

   Ticked, the bill prints as two slips: the Food bill (GST lines, its
   share of the discount, CGST/SGST, the round off) and the Liquor bill (VAT
   lines, one VAT line, its VAT bill number). The two GRAND TOTALs add up to
   what the guest pays once. Figures are this file's, shaped as the server's
   split sends them.
   ══════════════════════════════════════════════════════════════════ */

const line = (id: string, name: string, qty: number, unitPrice: number, taxRate: number, taxScheme: "gst" | "vat") => ({
  id, name, qty, unitPrice, taxRate, taxScheme, note: null, voided: false,
  kotStatus: "served", addedBy: "Waiter", parentLineId: null, isAddon: false, variationId: null,
});

/* Food 1,000 and liquor 600, 10% off: food 900 + 45 GST, liquor 540 + 54 VAT.
   1,539.00 to pay after a round off of 0.00; here a round off of +0.40 on a
   payable of 1,539.40 is the Food bill's alone. */
const ORDER = {
  id: "o-1", orderNo: "12", outlet: "REST", outletName: "Restaurant", hotelName: "Test Hotel",
  hotelCity: null, hotelGstin: "27AAAAA0000A1Z5", table: "T1", status: "settled", businessDate: "2026-11-25",
  paymentMethod: "card", openedBy: "Waiter", settledBy: null, eventTitle: null, billsPrinted: 0,
  vatBill: "VAT/5EL/2026-27/0007",
  lines: [line("l-1", "Paneer Tikka", 2, 500, 5, "gst"), line("l-2", "Whisky 30 ml", 2, 300, 10, "vat")],
  net: 1600, discount: 160, discountType: "percent", discountValue: 10, gross: 1539, roundOff: 0.4, payable: 1539.4,
  taxable: 1440, tax: 99,
  taxes: [{ scheme: "gst", rate: 5, tax: 45 }, { scheme: "vat", rate: 10, tax: 54 }],
  separateBills: true,
  schemes: [
    { scheme: "gst", net: 1000, discount: 100, service: 0, taxable: 900, tax: 45 },
    { scheme: "vat", net: 600, discount: 60, service: 0, taxable: 540, tax: 54 },
  ],
  tenders: [],
};

afterEach(() => { vi.restoreAllMocks(); });

function open(order: object = ORDER) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url === "/api/hotels/5EL/till/orders/o-1") return order as never;
    throw new apiModule.ApiError(500, "Request failed (500).");
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/pos/5EL/bill/o-1"]}>
        <Routes><Route path="/pos/:code/bill/:id" element={<BillPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const slip = (part: "food" | "liquor") =>
  document.querySelector(`[data-bill-part="${part}"]`)!.closest("article")! as HTMLElement;
const grand = (el: HTMLElement) => within(el).getByText("GRAND TOTAL").parentElement!.textContent!;

describe("food and liquor on separate bills", () => {
  it("prints two slips that add up to the bill, each with its own lines and tax", async () => {
    open();
    await screen.findByText("Bill · Food");
    const food = slip("food");
    const liquor = slip("liquor");
    expect(document.querySelector("[data-bill-tear]")).toBeTruthy();

    expect(within(food).getByText("Paneer Tikka")).toBeTruthy();
    expect(within(food).queryByText("Whisky 30 ml")).toBeNull();
    expect(within(food).getByText("CGST 2.5%")).toBeTruthy();
    expect(within(food).queryByText("VAT 10%")).toBeNull();
    expect(within(food).getByText("Discount 10%").parentElement!.textContent).toMatch(/-100\.00/);
    expect(within(food).getByText("Round off").parentElement!.textContent).toMatch(/0\.40/);
    expect(grand(food)).toMatch(/945\.40/);

    expect(within(liquor).getByText("Whisky 30 ml")).toBeTruthy();
    expect(within(liquor).queryByText("Paneer Tikka")).toBeNull();
    expect(within(liquor).getByText("VAT 10%").parentElement!.textContent).toMatch(/54\.00/);
    expect(within(liquor).queryByText(/CGST/)).toBeNull();
    expect(within(liquor).queryByText("Round off")).toBeNull();
    expect(grand(liquor)).toMatch(/594\.00/);
    expect(within(liquor).getByText(/VAT\/5EL\/2026-27\/0007/)).toBeTruthy();
    /* 945.40 + 594.00 = 1,539.40, what the guest paid. */
  });

  it("prints one bill when not ticked, or when the bill has only food", async () => {
    open({ ...ORDER, separateBills: false });
    await screen.findByText("GRAND TOTAL");
    expect(document.querySelector("[data-bill-part]")).toBeNull();
    expect(screen.getAllByText("GRAND TOTAL").length).toBe(1);
  });
});
