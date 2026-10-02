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
    baseOccupancy: 2, maxOccupancy: 3, rack: null, difference: null },
    /* Sleeps two: no third guest fits, so it has no "extra" rows (D27-206). */
    { id: "rt-2", code: "TWN", name: "Twin", category: null,
      baseOccupancy: 2, maxOccupancy: 2, rack: null, difference: null }],
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
      /* Rooms left under each base price (D27-237 5.2), from the read the
         Rooms left tab already makes. */
      return { from: "2026-08-25", to: "2026-09-07", restrictions: [], cells: [
        { roomTypeId: "rt-1", roomType: "Superior", date: "2026-08-25", sellable: 5, occupied: 2, sold: 2, available: 3 },
      ] } as never;
    }
    /* A room type's break-up rows (D27-206), asked for when its line opens.
       MAP is not set: null, a dash. */
    if (path.includes("breakup=")) {
      return { breakup: [{ date: "2026-08-25", guests: 2, EP: 3800, CP: 4800, MAP: null,
        AP: null, AI: null, extraAdult: 1000, extraChild: null }] } as never;
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

  it("shows every room type open with all its rows, a dash where an add-on is not set (D27-237 5.1)", async () => {
    ratesPage();
    const sup = await screen.findByRole("rowgroup", { name: "Superior" });
    /* Always open: nothing to open or close (replaces D27-206's "closed by default"). */
    expect(screen.queryByRole("button", { name: "Superior" })).toBeNull();
    const cp = within(sup).getByText("CP · 2 guests").closest("tr")!;
    /* The rows show "…" until their figures arrive. */
    expect(await within(cp).findByText("₹4,800"), "the server's figure, as sent").toBeTruthy();
    const map = within(sup).getByText("MAP · 2 guests").closest("tr")!;
    expect(within(map).getAllByText("-").length, "not set is a dash, never ₹0").toBeGreaterThan(0);
    expect(within(map).queryByText("₹0")).toBeNull();
    expect(within(within(sup).getByText("2 guests").closest("tr")!).getByText("₹3,800")).toBeTruthy();
    expect(within(within(sup).getByText("+ per extra adult").closest("tr")!).getByText("₹1,000")).toBeTruthy();

    /* Under the base, the rooms left that day (5.2); a dash where none is held. */
    const base = within(sup).getByText("Superior").closest("tr")!;
    expect(within(base).getByText("₹3,000")).toBeTruthy();
    expect(within(base).getByText("3 left")).toBeTruthy();

    /* Reception reads the rows and has nothing to press (D27-194, D27-206). */
    expect(screen.queryByRole("button", { name: "Set prices" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Superior on/ })).toBeNull();
    expect(screen.queryByText(/Tap any price/)).toBeNull();
  });

  it("shows no extra-guest rows for a room type no further guest fits in (D27-206)", async () => {
    ratesPage();
    const twin = await screen.findByRole("rowgroup", { name: "Twin" });
    expect(await within(twin).findByText("CP · 2 guests")).toBeTruthy();
    /* The hotel's figures exist (the read sends them), but a guest who can
       never be sold must not show one: the same rule as the dash. */
    expect(within(twin).queryByText("+ per extra adult")).toBeNull();
    expect(within(twin).queryByText("+ per extra child")).toBeNull();
  });

  it("puts How rates are built under the calendar, and Today back on the business date (D27-237 5.3)", async () => {
    ratesPage();
    const grid = await screen.findByRole("table");
    const setup = await screen.findByText("How rates are built");
    expect(grid.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING, "below the calendar").toBeTruthy();
    expect(screen.queryByRole("button", { name: "Today" }), "already on the business date").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next two weeks" }));
    fireEvent.click(await screen.findByRole("button", { name: "Today" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Today" })).toBeNull());
  });

  it("sets a base over a range from Set prices, the same call as a tapped price (D27-206)", async () => {
    asOwner();
    ratesPage();
    fireEvent.click(await screen.findByRole("button", { name: "Set prices" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(within(dialog).getByLabelText("Through"), { target: { value: "2026-09-10" } });
    fireEvent.change(within(dialog).getByLabelText("Base per night"), { target: { value: "3500" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Set base" }));
    /* Half-open: through the 10th ends on the 11th. */
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/pricing/base`,
        body: { roomTypeId: "rt-1", from: "2026-09-01", to: "2026-09-11", price: 3500 } },
    ]));
    expect(screen.getByText(/Tap any price to change it/)).toBeTruthy();
  });

  it("shows reception the prices and gives them nothing to change", async () => {
    ratesPage();
    expect(await screen.findByText("How rates are built")).toBeTruthy();
    expect(screen.getByText("₹3,000")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Superior on/ })).toBeNull();
  });
});
