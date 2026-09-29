import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import BookingPage from "@/modules/reservations/pages/BookingPage";

/* ══════════════════════════════════════════════════════════════════
   A BOOKING NAMING A COMPANY IS PRICED BY ITS CONTRACT (D27-184)

   The calendar says 3,000; the company's contract says 2,500. Once the
   company is chosen, the line's price is the contract's, asked of
   contract-price with the company, and the desk reads the contract's name.
   Without the change the page keeps asking /tariff and shows 3,000.
   ══════════════════════════════════════════════════════════════════ */

const asked: string[] = [];

beforeEach(() => {
  startSignedIn();
  asked.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.includes("/booking-sources")) {
      return [{ id: "src-1", name: "Phone", kind: "direct", channelCode: null, isActive: true,
                commissionPct: null, bookings: 0 }] as never;
    }
    if (path.includes("/inventory")) {
      return { from: "2026-08-25", to: "2026-08-26", restrictions: [],
               cells: [{ roomTypeId: "rt-1", roomType: "Deluxe", date: "2026-08-25",
                         sellable: 5, occupied: 0, sold: 0, available: 5 }] } as never;
    }
    if (path.includes("/contract-price")) {
      return { total: 2500, unpriced: null, note: null,
               nights: [{ night: "2026-08-25", total: 2500, unpriced: null }],
               contract: { id: "k-1", name: "Tata Motors 2026-27" } } as never;
    }
    if (path.includes("/tariff")) {
      return { roomType: "Deluxe", total: 3000, unpriced: null,
               nights: [{ night: "2026-08-25", total: 3000, unpriced: null }] } as never;
    }
    if (path.includes("/billing-companies")) return [{ id: "co-1", name: "Tata Motors", gstin: null }] as never;
    if (path.includes("/tax/room/rate")) return { kind: "room", rate: 5, scheme: "gst" } as never;
    if (path.endsWith("/modules")) return { modules: [] } as never;
    if (path.endsWith("/inclusions")) return { inclusions: [] } as never;
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the company's contract prices the booking", () => {
  it("asks contract-price with the company and shows the contract's name and price", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><BookingPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText(/₹3,000\.00 a night/);
    expect(document.querySelector("[data-contract-line]")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Company" }));
    fireEvent.change(await screen.findByLabelText(/^Company/, { selector: "select" }),
      { target: { value: "co-1" } });

    await screen.findByText(/₹2,500\.00 a night/);
    expect(document.querySelector("[data-contract-line]")?.textContent)
      .toBe("Contract: Tata Motors 2026-27");
    await waitFor(() =>
      expect(asked.some((p) => p.includes("/contract-price?") && p.includes("companyId=co-1"))).toBe(true));
  });
});
