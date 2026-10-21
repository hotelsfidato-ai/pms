import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import InventoryPage from "@/modules/stores/pages/Inventory";
import StoresPage from "@/modules/stores/pages/Stores";

/* ══════════════════════════════════════════════════════════════════
   BAR STOCK ON THE SCREENS (the owner's D27-354)

   Inventory, Bar: each bar dish and size, what it takes, the suggestions
   from the names used in one press, and only what changed is saved; a
   reader sees it and cannot change it. The count: a drink is counted in
   full bottles and the ml of the open one, which make one figure. The
   server's half: api/test/modules/stores/barStock.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const sent = vi.hoisted(() => ({ pours: [] as unknown[], counts: [] as unknown[] }));

vi.mock("@/modules/stores/data/barPours", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/stores/data/barPours")>()),
  getBarPours: async () => ({
    store: { id: "bar", name: "Bar store", isActive: true },
    drinks: [
      { id: "d-750", name: "Imperial Blue 750 ml", unit: "bottle", sizeMl: 750, onHand: 5.84 },
      { id: "d-180", name: "Imperial Blue 180 ml", unit: "bottle", sizeMl: 180, onHand: 3 },
    ],
    dishes: [
      { itemId: "i-blue", item: "Imperial Blue", category: "Deluxe Whisky", variationId: "v-60", size: "60 ml",
        pour: null, proposed: { stockItemId: "d-750", ml: 60, units: null } },
      { itemId: "i-blue", item: "Imperial Blue", category: "Deluxe Whisky", variationId: "v-nip", size: "NIP",
        pour: null, proposed: { stockItemId: "d-180", ml: null, units: 1 } },
      { itemId: "i-blue", item: "Imperial Blue", category: "Deluxe Whisky", variationId: "v-30", size: "30 ml",
        pour: { stockItemId: "d-750", ml: 30, units: null }, proposed: null },
    ],
  }),
  saveBarPours: async (_hotel: string, pours: unknown[]) => { sent.pours.push(pours); return { ok: true }; },
}));

vi.mock("@/modules/stores/data/stores", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/stores/data/stores")>()),
  getStore: async () => ({
    businessDate: "2026-10-21", people: [], inUse: [], outlets: [],
    stores: [{ id: "main", name: "Main store", isActive: true, isMain: true },
             { id: "bar", name: "Bar store", isActive: true, isMain: false }],
    items: [{
      id: "d-750", name: "Imperial Blue 750 ml", unit: "bottle", category: "Bar", sizeMl: 750, onHand: 5.84,
      levels: {}, lowIn: [], low: false, unitCost: 520, value: 3036.8, byStore: { bar: 5.84 },
      cylinder: false, empties: 0, emptiesByStore: {}, cylindersOnDeposit: null, depositPerCylinder: null,
      depositHeld: null, inUse: null, lastMovement: "2026-10-21", movements: 2, isActive: true,
      crockery: false, heldIn: ["bar"], today: {}, lastCounted: {}, onOrder: {},
    }],
  }),
  saveStockCount: async (_hotel: string, input: unknown) => {
    sent.counts.push(input);
    return { ok: true, recorded: 1, matched: 0, store: "Bar store" };
  },
}));

function as(role: Role) {
  startSignedIn();
  const s = useSession.getState();
  useSession.setState({ scope: { ...s.scope!, hotels: [{ hotelId: AGRA_HOTEL, role }] } });
  withDemoHotel();
}

function renderAt(path: string, route: string, element: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { sent.pours = []; sent.counts = []; vi.stubGlobal("fetch", () => new Promise(() => {})); });
afterEach(() => { vi.unstubAllGlobals(); try { localStorage.clear(); } catch { /* jsdom without storage */ } });

describe("Inventory, Bar (D27-354)", () => {
  it("the GM uses the two suggestions in one press and saves only them", async () => {
    as("gm");
    renderAt(`/h/${HOTEL}/inventory`, "/h/:code/inventory", <InventoryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Use the 2 suggestions" }));
    expect((screen.getByLabelText("How much, Imperial Blue 60 ml") as HTMLInputElement).value).toBe("60");
    fireEvent.click(screen.getByRole("button", { name: "Save 2" }));
    await vi.waitFor(() => expect(sent.pours).toEqual([[
      { itemId: "i-blue", variationId: "v-60", stockItemId: "d-750", ml: 60, units: null },
      { itemId: "i-blue", variationId: "v-nip", stockItemId: "d-180", ml: null, units: 1 },
    ]]));
    expect(screen.getByRole("link", { name: "Count the bar" }).getAttribute("href"))
      .toBe(`/h/${HOTEL}/stores?store=bar&count=1`);
  });

  it("housekeeping reads what each drink takes and cannot change it", async () => {
    as("housekeeping");
    renderAt(`/h/${HOTEL}/inventory`, "/h/:code/inventory", <InventoryPage />);
    const select = await screen.findByLabelText("Poured from, Imperial Blue 30 ml") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});

describe("the count of the bar (D27-354)", () => {
  it("a drink is counted in full bottles and the ml of the open one, sent as one figure", async () => {
    as("stores");
    renderAt(`/h/${HOTEL}/stores?store=bar&count=1`, "/h/:code/stores", <StoresPage />);
    await screen.findByRole("button", { name: "Save the count" });
    const sheet = document.querySelector("[data-count-sheet]") as HTMLElement;
    fireEvent.change(within(sheet).getByLabelText("Counted, Imperial Blue 750 ml, in bottle"), { target: { value: "5" } });
    fireEvent.change(within(sheet).getByLabelText("Open bottle, Imperial Blue 750 ml, in ml"), { target: { value: "630" } });
    expect(within(sheet).getByText("Book 5 bottles + 630 ml · matches")).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText("Open bottle, Imperial Blue 750 ml, in ml"), { target: { value: "600" } });
    expect(within(sheet).getByText("Book 5 bottles + 630 ml · 0 bottles + 30 ml fewer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save the count" }));
    await vi.waitFor(() => expect(sent.counts).toEqual([{
      locationId: "bar", lines: [{ itemId: "d-750", empty: false, book: 5.84, counted: 5.8 }] }]));
  });
});
