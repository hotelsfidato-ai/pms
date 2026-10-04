import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { HOTEL, signedIn, startSignedIn } from "@/test/app";
import RatePlansPage from "@/modules/inventory/pages/RatePlans";
import MealPlansPage from "@/modules/inventory/pages/MealPlans";
import RatesPage from "@/modules/inventory/pages/Rates";

/* ══════════════════════════════════════════════════════════════════
   RATE PLANS AND MEAL PLANS (P3; D27-251, D27-258)

   The tree is drawn from the one pricing: the master (the base type on
   room only), the derived (a difference, or a meal add-on) and the
   independent (no difference: its own base on Rates). Off and who sells a
   plan are saved; meal plans by day; an independent type is typed on Rates.
   ══════════════════════════════════════════════════════════════════ */

const sent: { path: string; method: string; body: unknown }[] = [];
const PRICING = {
  from: "2026-08-25", days: 1,
  basis: { roomTypeId: "dlx", roomType: "Deluxe", mealPlan: "EP", mealPlanName: "Room only", setAt: "" },
  roomTypes: [
    { id: "dlx", code: "DLX", name: "Deluxe", category: null, baseOccupancy: 2, maxOccupancy: 3, rack: null, difference: null },
    { id: "sup", code: "SUP", name: "Superior", category: null, baseOccupancy: 2, maxOccupancy: 3, rack: null,
      difference: { amount: 700, unit: "rupees" } },
    { id: "fam", code: "FAM", name: "Family Suite", category: null, baseOccupancy: 2, maxOccupancy: 4, rack: null, difference: null },
  ],
  mealPlans: [], addons: { CP: 300, MAP: null, AP: null, AI: null, double: 0, extraAdult: 800, extraChild: 400 },
  older: [], cells: [],
};
const DAY = (ep: number | null, cp: number | null) =>
  ({ breakup: [{ date: "2026-08-25", guests: 2, EP: ep, CP: cp, MAP: null, AP: null, AI: null, extraAdult: 800, extraChild: 400 }] });

beforeEach(() => {
  startSignedIn();
  useUi.setState({ hotelId: HOTEL });
  signedIn({ scope: { staffId: "33333333-3333-3333-3333-333333333333", email: "owner@fidato.in",
    fullName: "Group Owner", isGroupAdmin: true, hotels: [] } });
  sent.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true } as never;
    }
    if (path.includes("/inventory")) return { from: "2026-08-25", to: "2026-08-25", cells: [], restrictions: [] } as never;
    if (path.includes("breakup=dlx")) return DAY(2500, 3100) as never;
    if (path.includes("breakup=sup")) return DAY(3200, 3800) as never;
    if (path.includes("breakup=fam")) return DAY(null, null) as never;
    if (path.includes("/pricing")) return PRICING as never;
    if (path.endsWith("/plan-settings")) {
      return { plans: [], mealDays: [{ mealPlan: "CP", breakfast: ["stay", "departure"], lunch: [], dinner: [] }] } as never;
    }
    if (path.endsWith("/booking-sources")) {
      return [{ id: "s-web", name: "fidatohotels.com", isActive: true }, { id: "s-agoda", name: "Agoda", isActive: true }] as never;
    }
    return [] as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const wrap = (el: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[`/h/${HOTEL}/x`]}><Routes><Route path="/h/:code/x" element={el} /></Routes></MemoryRouter>
  </QueryClientProvider>,
);
const row = async (name: string) => (await screen.findByText(name)).closest("li")!;

describe("the rate plan tree", () => {
  it("names each plan by itself and shows master, derived and independent with the offset from the master", async () => {
    wrap(<RatePlansPage />);
    const master = await row("Deluxe · Room only (EP)");
    expect(within(master).getByText("Master")).toBeTruthy();
    expect(within(master).getByText("₹2,500")).toBeTruthy();
    const sup = await row("Superior · Room only (EP)");
    expect(within(sup).getByText("Derived")).toBeTruthy();
    expect(within(sup).getByText("+₹700")).toBeTruthy();
    const fam = await row("Family Suite · Room only (EP)");
    expect(within(fam).getByText("Independent")).toBeTruthy();
    expect(within(fam).getByText("-"), "not priced is a dash").toBeTruthy();
    expect(screen.getAllByText(/· Breakfast \(CP\)$/)).toHaveLength(3);
    expect(screen.queryByText(/· MAP$/), "a meal plan not sold has no plans").toBeNull();
  });

  it("switches a plan off, and saves who sells it from the third step", async () => {
    wrap(<RatePlansPage />);
    const sup = await row("Superior · Breakfast (CP)");
    fireEvent.click(within(sup).getByRole("switch"));
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/plan-settings/sup/CP`, method: "PUT", body: { isActive: false } }]));

    fireEvent.click(within(sup).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Breakfast on stay-over and check-out days").length, "the meals by day").toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(await within(dialog).findByLabelText("Agoda"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: `/api/hotels/${HOTEL}/plan-settings/sup/CP`, method: "PUT", body: { sources: ["s-agoda"] } }));
  });
});

describe("meal plans by day", () => {
  it("saves the days each meal is served", async () => {
    wrap(<MealPlansPage />);
    fireEvent.click(await screen.findByLabelText("All inclusive (AI): dinner on the check-in day"));
    /* The fourth card: CP, MAP, AP, AI. */
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[3]!);
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/meal-days/AI`, method: "PUT", body: { breakfast: [], lunch: [], dinner: ["arrival"] } }]));
  });
});

describe("an independent type on Rates (D27-258 Q2)", () => {
  it("lets its own base be typed beside the master, and not a derived type's", async () => {
    wrap(<RatesPage />);
    await screen.findByText("How rates are built", {}, { timeout: 4000 });
    expect(screen.getAllByRole("button", { name: /^Family Suite on / }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Deluxe on / }).length, "the master").toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Superior on / }), "a derived type follows").toHaveLength(0);
  });
});
