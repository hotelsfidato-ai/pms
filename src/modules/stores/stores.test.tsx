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
  recorded: [] as unknown[],
  reversed: [] as string[],
}));

vi.mock("@/modules/stores/data/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/stores/data/stores")>();
  const { ApiError } = await import("@/lib/api");
  const unreachable = () =>
    new ApiError(0, "Could not reach the server. Showing the last data received.");
  const item = (id: string, name: string, over: Record<string, unknown>) => ({
    id, name, unit: "piece", category: "Housekeeping", onHand: 0,
    reorderLevel: null, low: false, unitCost: null, value: null, byStore: {},
    lastMovement: null, movements: 0, isActive: true, ...over,
  });
  /* The three stores every hotel has (104), the Main store first. */
  const stores = [
    { id: "main", name: "Main store", isActive: true, isMain: true },
    { id: "kitchen", name: "Kitchen store", isActive: true, isMain: false },
    { id: "bar", name: "Bar store", isActive: true, isMain: false },
  ];
  const outlets = [{ id: "rest", name: "Fidato Restaurant" }];
  return {
    ...actual,
    getStore: async () => {
      if (control.store === "unreachable") throw unreachable();
      if (control.store === "empty") return { stores, items: [], outlets };
      return {
        stores,
        outlets,
        items: [
          item("towels", "Bath towel", {
            onHand: 58, unitCost: 310, value: 17980, byStore: { main: 50, kitchen: 8 },
            lastMovement: "2026-08-25", movements: 3 }),
          item("rolls", "Toilet roll", {}),
          item("gas", "LPG cylinder", {
            category: "Kitchen", unit: "cylinder", onHand: 1, unitCost: 1850, value: 1850,
            byStore: { kitchen: 1 }, lastMovement: "2026-08-25", movements: 2 }),
        ],
      };
    },
    getStockHistory: async () => {
      if (control.history === "unreachable") throw unreachable();
      const row = (over: Record<string, unknown>) => ({
        date: "2026-08-25", unitCost: null, supplier: null, reference: null, note: null,
        outlet: null, who: null, store: "Main store", fromStore: null, toStore: null,
        isReversal: false, reversesKind: null, reversed: false, ...over,
      });
      return [
        row({ id: "4", kind: "transfer", quantity: 8, store: "Kitchen store",
              fromStore: "Main store", toStore: "Kitchen store" }),
        row({ id: "3", kind: "adjustment", quantity: 2, who: "Test Store",
              isReversal: true, reversesKind: "issue" }),
        row({ id: "2", kind: "issue", quantity: -2, note: "Room 204", reversed: true,
            outlet: "Fidato Restaurant" }),
        row({ id: "1", kind: "receipt", quantity: 60, unitCost: 310,
              supplier: "Solapur Textiles", reference: "INV-2231" }),
      ];
    },
    addStockItem: async (_hotel: string, input: unknown) => {
      control.added.push(input);
      control.store = "items";
      return { ok: true, id: "new" };
    },
    recordStockMovement: async (_hotel: string, input: unknown) => {
      control.recorded.push(input);
      return { ok: true, id: "98", onHand: 56, onHandHere: 48, store: "Main store",
               unit: "piece", name: "Bath towel" };
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
    for (const name of [/Waste/, /Return to supplier/, /Move to another store/, /Correct the count/, /History/]) {
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
    /* A move between stores is one line, naming both (106). */
    expect(within(history).getByText("Moved from Main store to Kitchen store")).toBeTruthy();

    fireEvent.click(within(history).getByRole("button", { name: "Undo this delivery" }));
    expect(await screen.findByText("Undo this delivery of 60 piece?")).toBeTruthy();
    expect(control.reversed).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Undo delivery" }));
    await waitFor(() => expect(control.reversed).toEqual(["1"]));
  });

  it("106 · all stores together shows what each store holds; one store shows only its own", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    const towels = within(card("Bath towel"));
    expect(towels.getByText("Main 50 · Kitchen 8 · Bar -")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Store"), { target: { value: "bar" } });
    await waitFor(() => expect(within(card("Bath towel")).getByText("In Bar store")).toBeTruthy());
    /* Nothing of it in the Bar store: a dash, never a zero. */
    expect(within(card("Bath towel")).queryByText("Main 50 · Kitchen 8 · Bar -")).toBeNull();
    expect(within(card("Bath towel")).getByText(/Nothing in Bar store to issue/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Store"), { target: { value: "__all-stores" } });
    await waitFor(() => expect(within(card("Bath towel")).getByText("On hand")).toBeTruthy());
  });

  it("D17-48 · no long dash anywhere a person reads on the Store", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");
    const LONG_DASH = String.fromCharCode(0x2014);
    expect(document.querySelector("main")!.textContent).not.toContain(LONG_DASH);

    fireEvent.click(within(card("Bath towel")).getByRole("button", { name: /Receive/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toContain(LONG_DASH);
    fireEvent.keyDown(dialog, { key: "Escape" });
  });

  it("D22-20 · an issue records the outlet it went to, and the history names it", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    fireEvent.click(within(card("Bath towel")).getByRole("button", { name: /Issue/ }));
    const dialog = await screen.findByRole("dialog");
    const outlet = within(dialog).getByLabelText(/Which outlet/) as HTMLSelectElement;
    expect(outlet.value).toBe("");
    fireEvent.change(outlet, { target: { value: "rest" } });
    fireEvent.change(within(dialog).getByLabelText(/How many/), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue" }));
    await waitFor(() => expect(control.recorded).toHaveLength(1));
    expect(control.recorded[0]).toMatchObject({ kind: "issue", quantity: 2, outletId: "rest" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(within(await openMore("Bath towel")).getByRole("menuitem", { name: /History/ }));
    const history = await screen.findByRole("dialog");
    expect(await within(history).findByText(/to Fidato Restaurant/)).toBeTruthy();
    fireEvent.keyDown(history, { key: "Escape" });
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
