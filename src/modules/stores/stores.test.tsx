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
  counted: [] as unknown[],
}));

vi.mock("@/modules/stores/data/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/stores/data/stores")>();
  const { ApiError } = await import("@/lib/api");
  const unreachable = () =>
    new ApiError(0, "Could not reach the server. Showing the last data received.");
  const item = (id: string, name: string, over: Record<string, unknown>) => ({
    id, name, unit: "piece", category: "Housekeeping", onHand: 0,
    levels: {}, lowIn: [], low: false, unitCost: null, value: null, byStore: {},
    cylinder: false, empties: 0, emptiesByStore: {}, cylindersOnDeposit: null,
    depositPerCylinder: null, depositHeld: null, inUse: null,
    lastMovement: null, movements: 0, isActive: true,
    crockery: false, heldIn: [], today: {}, lastCounted: {}, onOrder: {}, ...over,
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
      const day = { businessDate: "2026-08-25", people: [], inUse: [] };
      if (control.store === "empty") return { stores, items: [], outlets, ...day };
      return {
        stores,
        outlets,
        ...day,
        items: [
          item("towels", "Bath towel", {
            onHand: 58, unitCost: 310, value: 17980, byStore: { main: 50, kitchen: 8 },
            levels: { main: 20 }, lastMovement: "2026-08-25", movements: 3 }),
          item("rolls", "Toilet roll", {}),
          item("gas", "LPG cylinder", {
            category: "Kitchen", unit: "cylinder", onHand: 1, unitCost: 1850, value: 1850,
            byStore: { kitchen: 1 }, lastMovement: "2026-08-25", movements: 2,
            /* D25-18, D25-19: full and empty, and the deposit. */
            cylinder: true, empties: 1, emptiesByStore: { kitchen: 1 },
            levels: { kitchen: 2 }, lowIn: ["kitchen"], low: true,
            cylindersOnDeposit: 4, depositPerCylinder: 1700, depositHeld: 6800, inUse: 2 }),
        ],
      };
    },
    getStockHistory: async () => {
      if (control.history === "unreachable") throw unreachable();
      const row = (over: Record<string, unknown>) => ({
        date: "2026-08-25", unitCost: null, supplier: null, reference: null, note: null,
        outlet: null, who: null, store: "Main store", fromStore: null, toStore: null,
        isReversal: false, reversesKind: null, reversed: false, empty: false, ...over,
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
      return { ok: true, id: "98", onHand: 56, onHandHere: 48, emptiesHere: null,
               store: "Main store", unit: "piece", name: "Bath towel" };
    },
    reverseStockMovement: async (_hotel: string, id: string) => {
      control.reversed.push(id);
      return { ok: true, id: "99" };
    },
    saveStockCount: async (_hotel: string, input: unknown) => {
      control.counted.push(input);
      return { ok: true, recorded: 1, matched: 0, store: "Main store" };
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
  control.recorded.splice(0);
  control.counted.splice(0);
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
    /* On the item: the "Received today" tile above is a filter, not a change. */
    expect(within(card("Bath towel")).queryByRole("button", { name: /Receive/ })).toBeNull();
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

  it("D22-20 · an issue must say where it went, and the history names the outlet", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    fireEvent.click(within(card("Bath towel")).getByRole("button", { name: /Issue/ }));
    const dialog = await screen.findByRole("dialog");
    const outlet = within(dialog).getByLabelText(/Which outlet/) as HTMLSelectElement;
    fireEvent.change(within(dialog).getByLabelText(/How many/), { target: { value: "2" } });
    /* Nothing is chosen for them (the owner, 24 September). */
    const issue = within(dialog).getByRole("button", { name: "Issue" }) as HTMLButtonElement;
    expect(outlet.value).toBe("");
    expect(issue.disabled).toBe(true);
    fireEvent.change(outlet, { target: { value: "rest" } });
    expect(issue.disabled).toBe(false);
    fireEvent.click(issue);
    await waitFor(() => expect(control.recorded).toHaveLength(1));
    expect(control.recorded[0]).toMatchObject({ kind: "issue", quantity: 2, outletId: "rest" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(within(await openMore("Bath towel")).getByRole("menuitem", { name: /History/ }));
    const history = await screen.findByRole("dialog");
    expect(await within(history).findByText(/to Fidato Restaurant/)).toBeTruthy();
    fireEvent.keyDown(history, { key: "Escape" });
  });

  it("D22-20 · Not an outlet is an answer, sent as none", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    fireEvent.click(within(card("Bath towel")).getByRole("button", { name: /Issue/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/How many/), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText(/Which outlet/), { target: { value: "none" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue" }));
    await waitFor(() => expect(control.recorded).toHaveLength(1));
    expect(control.recorded[0]).toMatchObject({ kind: "issue", quantity: 1, outletId: null });
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
it("D25-14, D27-242 Q2 · below level names the store, what is there and the level, on the card - never an item with no level", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    /* The Below level tile replaced the yellow list; its card says it. */
    const lines = [...document.querySelectorAll("[data-below-list]")];
    expect(lines.map((l) => l.textContent)).toEqual(["Kitchen store: 1 cylinder, level 2"]);
    expect(within(card("LPG cylinder")).getByText("Kitchen store: 1 cylinder, level 2")).toBeTruthy();
    expect(within(card("Bath towel")).getByText(/Warn at Main 20/)).toBeTruthy();
    expect(within(card("Toilet roll")).getByText(/No level set/)).toBeTruthy();
  });

  it("D25-18 · a cylinder shows full, empty and the deposit, and its issue asks how many empties came back", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("LPG cylinder");

    const gas = within(card("LPG cylinder"));
    expect(gas.getByText("Full")).toBeTruthy();
    expect(gas.getByText("Empty")).toBeTruthy();
    expect(card("LPG cylinder").querySelector("[data-deposit-line]")!.textContent)
      .toBe("On deposit 4 · ₹1,700 each · ₹6,800 held · 2 in use at the kitchen");

    fireEvent.click(gas.getByRole("button", { name: /Issue/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Which store/), { target: { value: "kitchen" } });
    fireEvent.change(within(dialog).getByLabelText(/How many/), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText(/Which outlet/), { target: { value: "none" } });
    const issue = within(dialog).getByRole("button", { name: "Issue" }) as HTMLButtonElement;
    /* Never assumed: nothing is sent until the empties are typed (0 is an answer). */
    expect(issue.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Empties back from the kitchen/), { target: { value: "0" } });
    expect(issue.disabled).toBe(false);
    fireEvent.click(issue);
    await waitFor(() => expect(control.recorded).toHaveLength(1));
    expect(control.recorded[0]).toMatchObject({ kind: "issue", quantity: 1, emptiesBack: 0 });
  });

  it("D25-16, 17 · the count sheet shows the book only once a count is typed, and sends only what was counted", async () => {
    as("stores");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Count a store/ }));

    await screen.findByRole("button", { name: "Save the count" });
    const sheet = document.querySelector("[data-count-sheet]") as HTMLElement;
    /* The paper and a blank line show no book figure, and no verdict (D25-16). */
    expect(sheet.textContent).not.toMatch(/Book|50/);
    expect(sheet.querySelectorAll("[role=status]")).toHaveLength(0);
    expect(within(sheet).getByLabelText("Counted, LPG cylinder - empty, in cylinder")).toBeTruthy();

    fireEvent.change(within(sheet).getByLabelText("Counted, Bath towel, in piece"), { target: { value: "47" } });
    expect(within(sheet).getByText("Book 50 piece · 3 fewer")).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText("Why, Bath towel"), { target: { value: "laundry" } });

    const save = screen.getByRole("button", { name: "Save the count" });
    expect(save.getAttribute("data-variant")).toBe("primary");
    fireEvent.click(save);
    await waitFor(() => expect(control.counted).toHaveLength(1));
    /* The Main store, and only the line that was counted - a blank is never a zero. */
    expect(control.counted[0]).toEqual({
      locationId: "main",
      lines: [{ itemId: "towels", empty: false, book: 50, counted: 47, reason: "laundry" }],
    });
  });

  it("D25-13 · the kitchen manager sets no level and counts no store", async () => {
    as("kitchen_manager");
    render(<App />);
    await screen.findByText("Bath towel");

    expect(screen.queryByRole("button", { name: /Count a store/ })).toBeNull();
    const menu = await openMore("Bath towel");
    expect(within(menu).queryByRole("menuitem", { name: /Set levels/ })).toBeNull();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /Add an item/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Warn me below/)).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
  });
});
