import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn, signedIn, HOTEL } from "@/test/app";
import RatesPage from "@/modules/inventory/pages/Rates";

/* ══════════════════════════════════════════════════════════════════
   RATES (D27-188, D27-194) and the "Free" tick (D27-120)

   The add-ons are set once per hotel; a figure left empty is not set
   (a dash, not sold), and 0 is sent only with its Free tick - the
   server refuses it otherwise (api/test/modules/inventory/pricing.test.ts).
   Everyone who reads prices sees the screen; only the rate setters get
   anything to press.
   ══════════════════════════════════════════════════════════════════ */

const sent: Array<{ path: string; body: unknown }> = [];

const PRICING = {
  from: "2026-08-25", days: 14,
  basis: null,
  roomTypes: [{ id: "rt-1", code: "SUP", name: "Superior", category: null,
    baseOccupancy: 2, maxOccupancy: 3, rack: null, difference: null }],
  mealPlans: [{ code: "EP", name: "EP · Room only" }],
  addons: { CP: 500, MAP: null, AP: null, AI: null, double: null, extraAdult: null, extraChild: null },
  older: [],
  cells: [{ date: "2026-08-25", roomTypeId: "rt-1", mealPlan: "EP", price: 3000, covers: 1, source: "typed" }],
};

beforeEach(() => {
  startSignedIn();
  sent.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      sent.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true } as never;
    }
    if (path.includes("/inventory")) {
      return { from: "2026-08-25", to: "2026-09-07", cells: [], restrictions: [] } as never;
    }
    if (path.includes("/pricing")) return PRICING as never;
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ratesPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[`/h/${HOTEL}/rates`]}>
      <Routes><Route path="/h/:code/rates" element={<RatesPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);

const asOwner = () => signedIn({ scope: {
  staffId: "33333333-3333-3333-3333-333333333333", email: "owner@fidato.in",
  fullName: "Group Owner", isGroupAdmin: true, hotels: [],
} });

describe("Rates", () => {
  it("sends an add-on of 0 only with its Free tick", async () => {
    asOwner();
    ratesPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByLabelText("Double occupancy (the second guest)") as HTMLInputElement;
    /* Breakfast's tick comes first; double occupancy's is the fifth. */
    fireEvent.click(within(dialog).getAllByRole("checkbox", { name: "Free" })[4]!);
    expect(box.value).toBe("0");
    expect(box.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/pricing/addon`, body: { kind: "double", amount: 0, free: true } },
    ]));
  });

  it("shows reception the prices and gives them nothing to change", async () => {
    ratesPage();
    expect(await screen.findByText("How rates are built")).toBeTruthy();
    expect(screen.getByText("₹3,000")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Superior on/ })).toBeNull();
  });
});
