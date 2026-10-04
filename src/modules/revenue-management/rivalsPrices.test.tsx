import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import * as apiModule from "@/lib/api";
import OutlookPage from "@/modules/revenue-management/pages/Outlook";

/* ══════════════════════════════════════════════════════════════════
   RIVALS' PRICES BESIDE EACH SUGGESTION (D27-269, D27-270)

   Read through market-rates' front door, one GET. A night nobody
   checked is a dash, never a nought; a checked one says the lowest, the
   middle, how many hotels and when, and opens to the list.
   ══════════════════════════════════════════════════════════════════ */

vi.mock("@/modules/revenue-management/data/outlook", () => ({
  WINDOW_NIGHTS: 90,
  /* One soft night two days out, so there is a suggestion to sit beside. */
  getOutlook: async () => ({
    today: "2026-10-05",
    days: [{ date: "2026-10-07", available: 18, sold: 2, occupancyPct: 11.1, left: 16, daysOut: 2 }],
  }),
  getPace: async () => null,
  getPickup: async () => null,
}));

function serve(nights: unknown[]) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url.startsWith("/api/hotels/5EL/market-rates?")) return { nights } as never;
    throw new apiModule.ApiError(500, `called ${url}`);
  });
}

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/h/5EL/revenue-outlook"]}>
        <Routes><Route path="/h/:code/revenue-outlook" element={<OutlookPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("rivals' prices beside each suggestion", () => {
  it("shows a dash for a night nobody checked, never a nought", async () => {
    const spy = serve([]);
    mount();
    expect(await screen.findByText("Nearby: -")).toBeTruthy();
    expect(spy.mock.calls[0]![0]).toBe("/api/hotels/5EL/market-rates?from=2026-10-05&to=2027-01-03");
    expect(spy.mock.calls.every((c) => !c[1]?.method || c[1].method === "GET")).toBe(true);
  });

  it("says the lowest, the middle, how many and when, and opens to the hotels", async () => {
    serve([{
      date: "2026-10-07", checkedAt: "2026-10-05T01:00:00.000Z",
      hotels: [
        { name: "Hotel Shivneri", price: 1800, source: null },
        { name: "Swami Samarth Residency", price: 2400, source: "Booking.com" },
        { name: "Hotel Gurukrupa", price: 3000, source: null },
      ],
    }]);
    mount();
    expect(await screen.findByText(
      "Nearby: lowest ₹1,800, middle ₹2,400 (3 hotels, checked 5 Oct 2026)")).toBeTruthy();
    expect(screen.getByText("Swami Samarth Residency")).toBeTruthy();
    expect(screen.getByText("₹2,400 on Booking.com")).toBeTruthy();
  });
});
