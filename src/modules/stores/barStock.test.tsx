import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import { useSession } from "@/lib/session";
import { useToastStore } from "@/components/ui";
import type { Role } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import BarStockPage from "@/modules/stores/pages/BarStock";
import StoresPage from "@/modules/stores/pages/Stores";
import type { BarSheet, SheetDrink } from "@/modules/stores/data/barSheet";

/* ══════════════════════════════════════════════════════════════════
   BAR STOCK ON THE SCREENS (the owner's D27-354)

   Today's sheet, like the paper register: opening, received, total, the
   sells split NIP / 30 / 60 / 90 ml and ml, closing, rate, amount; the bar
   manager types the closing count - NIPs and the open one's ml - and sees
   the difference before saving. Or simple, the owner's setting. Set up:
   what each drink takes, the suggestions used in one press, only what
   changed saved. The Store's count still takes bottles and ml. The
   server's half: api/test/modules/stores/barStock.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const sent = vi.hoisted(() => ({ pours: [] as unknown[], counts: [] as unknown[], storeCounts: [] as unknown[],
  format: "paper" as "paper" | "simple" }));

const drink = (over: Partial<SheetDrink>): SheetDrink => ({
  id: "d", name: "", unit: "bottle", sizeMl: 180, poured: true, opening: 0, received: 0, sold: 0, other: 0,
  corrected: 0, closing: 0, sell: { nip: 0, p30: 0, p60: 0, p90: 0, ml: 0 }, counted: null, countBook: null,
  rate: null, amount: null, onHand: 0, ...over,
});

/* Imperial Blue: 10 NIPs opened, 48 came; 2 NIPs, three 30s, two 60s and a
   90 sold - 300 ml of pegs - leaving 54 + 60 ml. A beer, in its count. */
const SHEET = (): BarSheet => ({
  store: { id: "bar", name: "Bar store", isActive: true }, businessDate: "2026-10-21", date: "2026-10-21",
  format: sent.format, mayCount: true, maySetFormat: false,
  groups: [{ section: "Deluxe Whisky", drinks: [
    drink({ id: "d-blue", name: "Imperial Blue 180 ml", opening: 10, received: 48, sold: 3.667, closing: 54.333,
            sell: { nip: 2, p30: 3, p60: 2, p90: 1, ml: 300 }, rate: 900, amount: 3360, onHand: 54.333 }),
  ] }, { section: "Beer", drinks: [
    drink({ id: "d-kf", name: "Kingfisher Strong 650 ml", sizeMl: 650, poured: false, opening: 12, received: 24,
            sold: 7, closing: 29, sell: { nip: 7, p30: 0, p60: 0, p90: 0, ml: 0 }, rate: 270, amount: 1890, onHand: 29 }),
  ] }],
});

vi.mock("@/modules/stores/data/barSheet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/stores/data/barSheet")>()),
  getBarSheet: async () => SHEET(),
  saveBarCount: async (_hotel: string, lines: unknown[]) => { sent.counts.push(lines); return { ok: true, recorded: 2, matched: 0 }; },
}));

vi.mock("@/modules/stores/data/barPours", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/stores/data/barPours")>()),
  getBarPours: async () => ({
    store: { id: "bar", name: "Bar store", isActive: true },
    drinks: [{ id: "d-blue", name: "Imperial Blue 180 ml", unit: "bottle", sizeMl: 180, onHand: 54.333 }],
    dishes: [
      { itemId: "i-blue", item: "Imperial Blue", category: "Deluxe Whisky", variationId: "v-60", size: "60 ml",
        pour: null, proposed: { stockItemId: "d-blue", ml: 60, units: null } },
      { itemId: "i-blue", item: "Imperial Blue", category: "Deluxe Whisky", variationId: "v-nip", size: "NIP",
        pour: null, proposed: { stockItemId: "d-blue", ml: null, units: 1 } },
      { itemId: "i-blue", item: "Imperial Blue", category: "Deluxe Whisky", variationId: "v-30", size: "30 ml",
        pour: { stockItemId: "d-blue", ml: 30, units: null }, proposed: null },
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
    sent.storeCounts.push(input);
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
const BAR = (part = "") => renderAt(`/pos/${HOTEL}/bar-stock${part}`, "/pos/:code/bar-stock", <BarStockPage />);

beforeEach(() => {
  sent.pours = []; sent.counts = []; sent.storeCounts = []; sent.format = "paper";
  useToastStore.setState({ toasts: [] });
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});
afterEach(() => { vi.unstubAllGlobals(); try { localStorage.clear(); } catch { /* jsdom without storage */ } });

describe("today's sheet (D27-354)", () => {
  it("like the paper register: NIP and ml, the sells by size, rate and amount; the bar manager counts", async () => {
    as("bar");
    BAR();
    await screen.findByText("Imperial Blue 180 ml");
    const sheet = document.querySelector("[data-bar-sheet=paper]") as HTMLElement;
    const row = (name: string) => [...within(sheet).getByText(name).closest("tr")!.querySelectorAll("td")]
      .slice(0, 15).map((td) => td.textContent);
    expect(row("Imperial Blue 180 ml")).toEqual(
      ["Imperial Blue 180 ml", "10", "", "48", "58", "", "2", "3", "2", "1", "300", "54", "60", "₹900", "₹3,360"]);
    expect(row("Kingfisher Strong 650 ml")).toEqual(
      ["Kingfisher Strong 650 ml", "12", "", "24", "36", "", "7", "", "", "", "", "29", "", "₹270", "₹1,890"]);
    expect(within(sheet).getByText("Beer")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Counted, Imperial Blue 180 ml, NIPs"), { target: { value: "54" } });
    fireEvent.change(screen.getByLabelText("Counted, Imperial Blue 180 ml, ml in the open one"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Counted, Kingfisher Strong 650 ml"), { target: { value: "28" } });
    expect(within(sheet).getByText("-30 ml")).toBeTruthy();
    expect(within(sheet).getByText("-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save the count (2)" }));
    await vi.waitFor(() => expect(sent.counts).toEqual([[
      { itemId: "d-blue", book: 54.333, counted: 54.167 },
      { itemId: "d-kf", book: 29, counted: 28 },
    ]]));
  });

  it("an open bottle's ml must be under its size: nothing is sent", async () => {
    as("bar");
    BAR();
    fireEvent.change(await screen.findByLabelText("Counted, Imperial Blue 180 ml, NIPs"), { target: { value: "54" } });
    fireEvent.change(screen.getByLabelText("Counted, Imperial Blue 180 ml, ml in the open one"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the count (1)" }));
    await vi.waitFor(() => expect(useToastStore.getState().toasts.map((t) => `${t.title}: ${t.description}`))
      .toContain("Not saved: Imperial Blue 180 ml: whole NIPs, and the open one's ml under 180."));
    expect(sent.counts).toEqual([]);
  });

  it("simple, when the owner's setting says so: opening, received, sold, closing in NIPs and ml", async () => {
    as("bar");
    sent.format = "simple";
    BAR();
    await screen.findByText("Imperial Blue 180 ml");
    const sheet = document.querySelector("[data-bar-sheet=simple]") as HTMLElement;
    const cells = [...within(sheet).getByText("Imperial Blue 180 ml").closest("tr")!.querySelectorAll("td")]
      .slice(0, 5).map((td) => td.textContent);
    expect(cells).toEqual(["Imperial Blue 180 ml", "10", "48", "3 + 120 ml", "54 + 60 ml"]);
  });
});

describe("set up (D27-354)", () => {
  it("the GM uses the two suggestions in one press and saves only them", async () => {
    as("gm");
    BAR("?part=setup");
    fireEvent.click(await screen.findByRole("button", { name: "Use the 2 suggestions" }));
    expect((screen.getByLabelText("How much, Imperial Blue 60 ml") as HTMLInputElement).value).toBe("60");
    fireEvent.click(screen.getByRole("button", { name: "Save 2" }));
    await vi.waitFor(() => expect(sent.pours).toEqual([[
      { itemId: "i-blue", variationId: "v-60", stockItemId: "d-blue", ml: 60, units: null },
      { itemId: "i-blue", variationId: "v-nip", stockItemId: "d-blue", ml: null, units: 1 },
    ]]));
  });

  it("the bar manager reads what each drink takes and how the sheet looks, and changes neither", async () => {
    as("bar");
    BAR("?part=setup");
    const select = await screen.findByLabelText("Poured from, Imperial Blue 30 ml") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    expect(await screen.findByText("Set by the owner, an Admin or the GM.")).toBeTruthy();
  });
});

describe("the Store's count of the bar (D27-354)", () => {
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
    await vi.waitFor(() => expect(sent.storeCounts).toEqual([{
      locationId: "bar", lines: [{ itemId: "d-750", empty: false, book: 5.84, counted: 5.8 }] }]));
  });
});
