import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import App from "@/App";
import { HOTEL, go, startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   THE STORE — STO-2, 3, 5, 6, 7, 8 and 10, the owner's answers of 16 September

   The store's reads are switched per test; the writes are spies. The role
   comes from the signed-in scope, so each test says who is looking.

   ⚠ ORDER MATTERS IN THIS FILE. The application's query cache lives as long
   as the file does (App.tsx creates it once, staleTime Infinity), so the
   first test is the only one that meets a store that has never loaded —
   which is exactly the case STO-2 is about. It walks failed → empty → an
   item added, and leaves the three items below cached for the rest.
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({
  store: "items" as "items" | "empty" | "unreachable",
  history: "rows" as "rows" | "unreachable",
  added: [] as unknown[],
  reversed: [] as string[],
}));

vi.mock("@/modules/stores/data/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/stores/data/stores")>();
  const { ApiError } = await import("@/lib/api");
  const unreachable = () =>
    new ApiError(0, "Could not reach the server. Showing the last data received.");
  const item = (id: string, name: string, over: Record<string, unknown>) => ({
    id, name, unit: "piece", category: "Housekeeping", onHand: 0,
    reorderLevel: null, low: false, unitCost: null, value: null,
    lastMovement: null, movements: 0, isActive: true, ...over,
  });
  return {
    ...actual,
    getStore: async () => {
      if (control.store === "unreachable") throw unreachable();
      if (control.store === "empty") return [];
      return [
        item("towels", "Bath towel", {
          onHand: 58, unitCost: 310, value: 17980, lastMovement: "2026-08-25", movements: 3 }),
        item("rolls", "Toilet roll", {}),
        item("gas", "LPG cylinder", {
          category: "Kitchen", unit: "cylinder", onHand: 1, unitCost: 1850, value: 1850,
          lastMovement: "2026-08-25", movements: 2 }),
      ];
    },
    getStockHistory: async () => {
      if (control.history === "unreachable") throw unreachable();
      return [
        { id: "3", date: "2026-08-25", kind: "adjustment", quantity: 2, unitCost: null,
          supplier: null, reference: null, note: null, outlet: null, who: "Test Store",
          isReversal: true, reversesKind: "issue", reversed: false },
        { id: "2", date: "2026-08-25", kind: "issue", quantity: -2, unitCost: null,
          supplier: null, reference: null, note: "Room 204", outlet: null, who: null,
          isReversal: false, reversesKind: null, reversed: true },
        { id: "1", date: "2026-08-25", kind: "receipt", quantity: 60, unitCost: 310,
          supplier: "Solapur Textiles", reference: "INV-2231", note: null, outlet: null,
          who: null, isReversal: false, reversesKind: null, reversed: false },
      ];
    },
    addStockItem: async (_hotel: string, input: unknown) => {
      control.added.push(input);
      control.store = "items";
      return { ok: true, id: "new" };
    },
    reverseStockMovement: async (_hotel: string, id: string) => {
      control.reversed.push(id);
      return { ok: true, id: "99" };
    },
  };
});

const as = (role: string) => signedIn({
  scope: {
    staffId: "33333333-3333-3333-3333-333333333333",
    email: "store-test@fidato.in", fullName: "Store Test", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

const card = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

const openMore = async (name: string) => {
  const trigger = within(card(name)).getByRole("button", { name: /More/ });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findByRole("menu");
};

beforeEach(() => {
  startSignedIn();
  go(`/h/${HOTEL}/stores`);
  control.history = "rows";
  control.reversed.splice(0);
});

describe("the Store", () => {
  it("STO-2 · says a store that could not be read did not load — never that it is empty", async () => {
    as("stores");
    control.store = "unreachable";
    render(<App />);

    expect(await screen.findByText("The store did not load")).toBeTruthy();
    expect(screen.getByText(/no store from earlier to show/)).toBeTruthy();
    expect(screen.queryByText("Nothing in the store yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add the first" })).toBeNull();

    /* The line comes back and the store really is empty: now it says so,
       and adding the first is the main action (STO-8). */
    control.store = "empty";
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    const first = await screen.findByRole("button", { name: "Add the first" });
    expect(screen.queryByText("The store did not load")).toBeNull();
    expect(first.getAttribute("data-variant")).toBe("primary");

    /* STO-10 · "Where it belongs" starts on nothing, and Add waits for it. */
    fireEvent.click(first);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/What is it/), { target: { value: "Bath towel" } });
    fireEvent.change(within(dialog).getByLabelText(/Counted in/), { target: { value: "piece" } });
    const add = within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement;
    const where = within(dialog).getByLabelText(/Where it belongs/) as HTMLSelectElement;
    expect(where.value).toBe("");
    expect(add.disabled).toBe(true);

    fireEvent.change(where, { target: { value: "Housekeeping" } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);

    await waitFor(() => expect(control.added).toHaveLength(1));
    expect(control.added[0]).toMatchObject({ name: "Bath towel", category: "Housekeeping" });
    expect(await screen.findByText("Bath towel")).toBeTruthy();
  });

  it("STO-8 · Add an item is the one main action", async () => {
    as("stores");
    render(<App />);
    const add = await screen.findByRole("button", { name: /Add an item/ });
    expect(add.getAttribute("data-variant")).toBe("primary");
  });

  it("STO-5 and 7 · Receive · Issue · More, with a word on every act and a reason on the greyed ones", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    const towels = within(card("Bath towel"));
    expect(towels.getByRole("button", { name: /Receive/ })).toBeTruthy();
    expect(towels.getByRole("button", { name: /Issue/ })).toBeTruthy();

    const menu = await openMore("Bath towel");
    for (const name of [/Waste/, /Return to supplier/, /Correct the count/, /History/]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeTruthy();
    }
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    /* Nothing on hand: Issue greyed, and the card says why. */
    const rolls = within(card("Toilet roll"));
    expect((rolls.getByRole("button", { name: /Issue/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(rolls.getByText(/Nothing on hand to issue/)).toBeTruthy();
  });

  it("STO-1 · the kitchen manager may not correct a count or undo", async () => {
    as("kitchen_manager");
    render(<App />);
    await screen.findByText("Bath towel");

    const menu = await openMore("Bath towel");
    expect(within(menu).queryByRole("menuitem", { name: /Correct the count/ })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /History/ }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Undoing a movement is for the Inventory Manager/)).toBeTruthy();
    expect(within(dialog).queryAllByRole("button", { name: /^Undo this/ })).toHaveLength(0);
  });

  it("STO-1 · a look-only person gets one sentence and History, and no change buttons", async () => {
    as("housekeeping");
    render(<App />);
    await screen.findByText("Bath towel");

    expect(screen.getByText(/You can see the store\. Receiving, issuing and adding items is for the Inventory Manager/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add an item/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Receive/ })).toBeNull();
    expect(within(card("Bath towel")).getByRole("button", { name: "History" })).toBeTruthy();
  });

  it("STO-6 · undo asks first, and an undo says what it undid", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    fireEvent.click(within(await openMore("Bath towel")).getByRole("menuitem", { name: /History/ }));
    const history = await screen.findByRole("dialog");
    expect(await within(history).findByText("Undo of an issue")).toBeTruthy();

    fireEvent.click(within(history).getByRole("button", { name: "Undo this delivery" }));
    expect(await screen.findByText("Undo this delivery of 60 piece?")).toBeTruthy();
    expect(control.reversed).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Undo delivery" }));
    await waitFor(() => expect(control.reversed).toEqual(["1"]));
  });

  it("STO-2 · a history that could not be read says so", async () => {
    as("stores");
    control.history = "unreachable";
    render(<App />);
    await screen.findByText("LPG cylinder");

    fireEvent.click(within(await openMore("LPG cylinder")).getByRole("menuitem", { name: /History/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("The history did not load")).toBeTruthy();
    expect(within(dialog).queryByText("Nothing has moved yet")).toBeNull();
  });
});
