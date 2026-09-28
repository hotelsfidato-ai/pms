import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn, HOTEL } from "@/test/app";
import RatePlansPage from "@/modules/inventory/pages/RatePlans";

/* ══════════════════════════════════════════════════════════════════
   X-1 · THE "FREE" TICK (the owner's D27-120), on the rack rate

   RT-1: "Superior is ₹0.00" was saved without a question. 0 is now sent
   only with the tick; the server refuses it otherwise
   (api/test/modules/inventory/zeroPrices.test.ts). The same tick sits
   beside every typed price: a season, the rate calendar, the pricing
   base, a dish, a delivery's cost, a purchase line, a laundry item.
   ══════════════════════════════════════════════════════════════════ */

const sent: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  startSignedIn();
  sent.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      sent.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true, roomType: "Superior" } as never;
    }
    return {
      businessDate: "2026-08-25", mealPlans: [], rates: [],
      roomTypes: [{ id: "rt-1", code: "SUP", name: "Superior", rooms: 10, maxOccupancy: 3, rackRate: 4099 }],
    } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the rack rate's Free tick", () => {
  it("sends 0 only with the tick", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/h/${HOTEL}/rate-plans`]}>
          <Routes><Route path="/h/:code/rate-plans" element={<RatePlansPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const box = await screen.findByLabelText("Rack rate for Superior") as HTMLInputElement;
    /* The rack row's tick comes first; the season form has its own. */
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Free" })[0]!);
    expect(box.value).toBe("0");
    expect(box.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/room-types/rt-1/rate`, body: { rate: 0, free: true } },
    ]));
  });
});
