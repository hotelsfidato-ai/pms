import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import { useToastStore } from "@/components/ui";
import { HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import InventoryPage from "@/modules/stores/pages/Inventory";
import type { KitchenSheet, Recipes } from "@/modules/stores/data/kitchen";

/* ══════════════════════════════════════════════════════════════════
   INVENTORY'S RESTAURANT TAB (the owner's D27-373, D27-374)

   Today's sheet: each item's day, below zero in red, the wastage with its
   reason, the closing count typed against the book. No kitchen store marked:
   whoever keeps it picks one. Recipes: the dishes with no recipe listed, a
   dish's ingredients edited and saved. The server's half:
   api/test/modules/stores/kitchenStock.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const sent = vi.hoisted(() => ({ counts: [] as unknown[], marked: [] as string[], recipes: [] as unknown[],
  noStore: false }));

const SHEET = (): KitchenSheet => ({
  businessDate: "2026-10-28", date: "2026-10-28", mayKeep: true, mayCount: !sent.noStore,
  store: sent.noStore ? null : { id: "kitchen", name: "Kitchen store", isActive: true },
  stores: [{ id: "kitchen", name: "Kitchen store" }, { id: "main", name: "Main store" }],
  items: [
    { id: "paneer", name: "Paneer", unit: "kg", opening: 1, received: 5, movedIn: 0, movedOut: 0, used: 0.3,
      wasted: 0.3, corrected: 0, closing: 5.4, onHand: 5.4, counted: null, countBook: null },
    { id: "kebab", name: "Kebab meat", unit: "kg", opening: 0, received: 0, movedIn: 0, movedOut: 0, used: 0,
      wasted: 0.08, corrected: 0, closing: -0.08, onHand: -0.08, counted: null, countBook: null },
  ],
  wasted: [{ item: "Paneer", unit: "kg", quantity: 0.2, note: "Struck after the KOT: dropped", reference: "Bill 12 KOT 3" }],
});

const RECIPES: Recipes = {
  store: { id: "kitchen", name: "Kitchen store" }, mayKeep: true,
  ingredients: [{ id: "paneer", name: "Paneer", unit: "kg" }, { id: "butter", name: "Butter", unit: "kg" }],
  owners: [
    { kind: "dish", itemId: "tikka", variationId: null, addonId: null, numberedAddonId: null, name: "Paneer Tikka",
      section: "Starters", lines: [{ stockItemId: "paneer", name: "Paneer", unit: "kg", quantity: 0.1 }] },
    { kind: "size", itemId: "tikka", variationId: "full", addonId: null, numberedAddonId: null, name: "Paneer Tikka (Full)",
      section: "Starters", lines: [] },
    { kind: "dish", itemId: "dal", variationId: null, addonId: null, numberedAddonId: null, name: "Dal",
      section: "Mains", lines: [] },
  ],
  withoutRecipe: [{ itemId: "dal", name: "Dal", section: "Mains" }],
};

vi.mock("@/modules/stores/data/kitchen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/stores/data/kitchen")>()),
  getKitchenSheet: async () => SHEET(),
  saveKitchenCount: async (_hotel: string, lines: unknown[]) => { sent.counts.push(lines); return { ok: true, recorded: 1, matched: 0 }; },
  markKitchenStore: async (_hotel: string, id: string) => { sent.marked.push(id); return { ok: true, store: "Kitchen store" }; },
  getRecipes: async () => RECIPES,
  saveRecipe: async (_hotel: string, owner: unknown, lines: unknown[]) => { sent.recipes.push({ owner, lines }); return { ok: true }; },
}));

function open(part = "") {
  startSignedIn();
  withDemoHotel();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/h/${HOTEL}/inventory?tab=restaurant${part}`]}>
        <Routes><Route path="/h/:code/inventory" element={<InventoryPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sent.counts = []; sent.marked = []; sent.recipes = []; sent.noStore = false;
  useToastStore.setState({ toasts: [] });
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});
afterEach(() => { vi.unstubAllGlobals(); try { localStorage.clear(); } catch { /* jsdom without storage */ } });

describe("Inventory, Restaurant (D27-373, D27-374)", () => {
  it("today's sheet: each item's day, below zero in red, the wastage's reason, the count against the book", async () => {
    open();
    await screen.findByText("Kebab meat");
    const sheet = document.querySelector("[data-kitchen-sheet]") as HTMLElement;
    const cells = (name: string) => [...within(sheet).getByText(name).closest("tr")!.querySelectorAll("td")]
      .slice(1, 9).map((td) => td.textContent);
    expect(cells("Paneer")).toEqual(["1", "5", "", "", "0.3", "0.3", "", "5.4"]);
    const below = sheet.querySelector("[data-closing=below-zero]") as HTMLElement;
    expect(below.textContent).toBe("-0.08");
    expect(below.className).toContain("text-brand-red-700");
    expect(screen.getByText("Paneer: 0.2 kg - Struck after the KOT: dropped (Bill 12 KOT 3)")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Counted, Paneer, kg"), { target: { value: "5.3" } });
    expect(within(sheet).getByText("-0.1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save the closing count (1)" }));
    await vi.waitFor(() => expect(sent.counts).toEqual([[{ itemId: "paneer", book: 5.4, counted: 5.3 }]]));
  });

  it("no kitchen store marked: the GM picks one", async () => {
    sent.noStore = true;
    open();
    await screen.findByText("No store is marked as the kitchen's yet, so a KOT takes nothing.");
    fireEvent.change(screen.getByLabelText("The kitchen's store"), { target: { value: "kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark it the kitchen's" }));
    await vi.waitFor(() => expect(sent.marked).toEqual(["kitchen"]));
  });

  it("recipes: the dishes with none listed; a dish's ingredients edited and saved", async () => {
    open("&part=recipes");
    const none = await screen.findByText("One dish has no recipe");
    expect(within(none.closest("[data-without-recipe]") as HTMLElement).getByText("Dal")).toBeTruthy();
    const list = document.querySelector("[data-recipes]") as HTMLElement;
    expect(within(list).getByText("Paneer 0.1 kg")).toBeTruthy();
    expect(within(list).getByText("Nothing extra")).toBeTruthy();

    const tikka = within(list).getByText("Paneer Tikka").closest("li") as HTMLElement;
    fireEvent.click(within(tikka).getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add an ingredient" }));
    fireEvent.change(screen.getByLabelText("Ingredient 2"), { target: { value: "butter" } });
    fireEvent.change(screen.getByLabelText("How much, ingredient 2"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(sent.recipes).toEqual([{
      owner: expect.objectContaining({ itemId: "tikka", variationId: null }),
      lines: [{ stockItemId: "paneer", quantity: 0.1 }, { stockItemId: "butter", quantity: 0.01 }],
    }]));
  });
});
