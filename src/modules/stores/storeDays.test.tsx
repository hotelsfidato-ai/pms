import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import App from "@/App";
import { HOTEL, go, startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";
import { STOCK_REPORT_ROLES } from "@/modules/stores/lib/reports";

/* ══════════════════════════════════════════════════════════════════
   THE STORE LIKE THE CALENDAR (D27-238; the owner's answers D27-242)

   The tiles count and filter; a delivery records its GST (the amount filled
   from the rate, claimable asked); crockery breaks with who; the Reports menu
   for the seven roles of D27-240; the fourteen days, +in over -out, the
   footer, and by outlet a dash for sales to a role that reads no reports.
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({ recorded: [] as unknown[] }));

vi.mock("@/modules/stores/data/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/stores/data/stores")>();
  const item = (id: string, name: string, over: Record<string, unknown>) => ({
    id, name, unit: "piece", category: "Housekeeping", onHand: 0,
    levels: {}, lowIn: [], low: false, unitCost: null, value: null, byStore: {},
    cylinder: false, empties: 0, emptiesByStore: {}, cylindersOnDeposit: null,
    depositPerCylinder: null, depositHeld: null, inUse: null,
    lastMovement: null, movements: 0, isActive: true,
    crockery: false, heldIn: [], today: {}, lastCounted: {}, onOrder: {}, ...over,
  });
  const stores = [
    { id: "main", name: "Main store", isActive: true, isMain: true },
    { id: "kitchen", name: "Kitchen store", isActive: true, isMain: false },
  ];
  return {
    ...actual,
    getStore: async () => ({
      stores,
      outlets: [{ id: "rest", name: "Fidato Restaurant" }],
      businessDate: "2026-08-25",
      people: [{ id: "p1", name: "Ravi Waiter" }],
      inUse: [{ id: "dining", name: "Dining room", kind: "restaurant", isActive: true }],
      items: [
        /* Received today, valued, counted this month. */
        item("towels", "Bath towel", {
          onHand: 50, unitCost: 310, value: 15500, byStore: { main: 50 }, heldIn: ["main"],
          today: { receipt: ["main"] }, lastCounted: { main: "2026-08-20" }, movements: 3,
          lastMovement: "2026-08-25" }),
        /* Had some, holds none, and some is on order. */
        item("soap", "Soap bar", { heldIn: ["main"], onOrder: { main: 40 }, movements: 2 }),
        /* Held, never priced, never counted, and below its level. */
        item("salt", "Salt", {
          category: "Kitchen", onHand: 6, byStore: { kitchen: 6 }, heldIn: ["kitchen"],
          levels: { kitchen: 10 }, lowIn: ["kitchen"], low: true, movements: 1 }),
        /* Crockery, in use at the dining room. */
        item("plate", "Dinner plate", {
          category: "Restaurant", crockery: true, onHand: 30, unitCost: 150, value: 4500,
          byStore: { main: 18, dining: 12 }, heldIn: ["main", "dining"],
          lastCounted: { main: "2026-08-20", dining: "2026-08-20" }, movements: 4 }),
      ],
    }),
    getStoreDays: async () => ({
      today: "2026-08-25",
      days: Array.from({ length: 14 }, (_, k) => `2026-08-${String(12 + k).padStart(2, "0")}`),
      rows: [
        { itemId: "towels", placeId: "main", date: "2026-08-25", kind: "receipt", outletId: null, quantity: 10, value: 3100 },
        { itemId: "towels", placeId: "main", date: "2026-08-25", kind: "issue", outletId: "rest", quantity: -2, value: 620 },
        { itemId: "towels", placeId: "main", date: "2026-08-24", kind: "wastage", outletId: null, quantity: -1, value: null },
      ],
      occupied: { "2026-08-25": 21 },
      sales: null,
      foodCostBasis: "before_gst",
    }),
    recordStockMovement: async (_hotel: string, input: unknown) => {
      control.recorded.push(input);
      return { ok: true, id: "98", onHand: 50, onHandHere: 50, emptiesHere: null,
               store: "Main store", unit: "piece", name: "Bath towel" };
    },
  };
});

const as = (role: string) => signedIn({
  scope: {
    staffId: "33333333-3333-3333-3333-333333333333",
    email: "store-days@fidato.in", fullName: "Store Days", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});
const card = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
const tile = (key: string) => document.querySelector(`[data-store-tile="${key}"]`) as HTMLElement;

beforeEach(() => {
  startSignedIn();
  go(`/h/${HOTEL}/stores`);
  control.recorded.splice(0);
});

describe("the Store's tiles (D27-238, D27-242 Q3)", () => {
  it("count what answers each one, and a tap shows only those", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    const counts = Object.fromEntries([...document.querySelectorAll("[data-store-tile]")]
      .map((t) => [t.getAttribute("data-store-tile"), t.querySelector("b")!.textContent]));
    expect(counts).toEqual({
      below: "1", runOut: "1", received: "1", issued: "0", wasted: "0",
      awaiting: "1", notValued: "1", notCounted: "1",
    });

    fireEvent.click(tile("runOut"));
    await waitFor(() => expect(screen.queryByText("Bath towel")).toBeNull());
    expect(screen.getByText("Soap bar")).toBeTruthy();
    fireEvent.click(tile("runOut"));
    expect(await screen.findByText("Bath towel")).toBeTruthy();
  });
});

describe("a delivery's GST, an issue's department, a breakage's who (D27-238, Q6, Q8, Q10)", () => {
  it("fills the GST amount from the rate, asks whether it can be claimed, and sends all three", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");

    fireEvent.click(within(card("Bath towel")).getByRole("button", { name: /Receive/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/How many/), { target: { value: "10" } });
    fireEvent.change(within(dialog).getByLabelText(/before GST/), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText(/GST rate/), { target: { value: "5" } });
    expect((within(dialog).getByLabelText(/GST amount/) as HTMLInputElement).value).toBe("50.00");
    const receive = within(dialog).getByRole("button", { name: "Receive" }) as HTMLButtonElement;
    expect(receive.disabled, "claimable not said yet").toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/claimed/), { target: { value: "no" } });
    fireEvent.change(within(dialog).getByLabelText(/Use by/), { target: { value: "2027-01-31" } });
    fireEvent.click(receive);
    await waitFor(() => expect(control.recorded).toHaveLength(1));
    expect(control.recorded[0]).toMatchObject({
      kind: "receipt", quantity: 10, unitCost: 100,
      gstRate: 5, gstAmount: 50, gstClaimable: false, expiresOn: "2027-01-31",
    });
  });

  it("sends an issue's department as typed", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Bath towel");
    fireEvent.click(within(card("Bath towel")).getByRole("button", { name: /Issue/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/How many/), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/Which outlet/), { target: { value: "none" } });
    fireEvent.change(within(dialog).getByLabelText(/Department/), { target: { value: " Front Office " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue" }));
    await waitFor(() => expect(control.recorded).toHaveLength(1));
    expect(control.recorded[0]).toMatchObject({ kind: "issue", department: "Front Office" });
  });

  it("breaks crockery where it is in use, and asks who - Not known is an answer", async () => {
    as("stores");
    render(<App />);
    await screen.findByText("Dinner plate");
    const trigger = within(card("Dinner plate")).getByRole("button", { name: /More/ });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Broken/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Where it broke/), { target: { value: "dining" } });
    fireEvent.change(within(dialog).getByLabelText(/How many/), { target: { value: "2" } });
    const record = within(dialog).getByRole("button", { name: "Record breakage" }) as HTMLButtonElement;
    expect(record.disabled, "who is asked every time").toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Who broke it/), { target: { value: "not-known" } });
    fireEvent.click(record);
    await waitFor(() => expect(control.recorded).toHaveLength(1));
    expect(control.recorded[0]).toMatchObject({ kind: "breakage", locationId: "dining", quantity: 2, brokenBy: null });
  });
});

describe("the Reports menu (D27-240)", () => {
  it("is pinned to the seven roles, and shown to the Inventory Manager but not the kitchen manager", async () => {
    expect([...STOCK_REPORT_ROLES].sort()).toEqual(
      ["admin", "finance", "gm", "hotel_manager", "owner", "read_only", "stores"]);
    as("stores");
    const { unmount } = render(<App />);
    await screen.findByText("Bath towel");
    expect(screen.getByRole("button", { name: /Reports/ })).toBeTruthy();
    unmount();
    as("kitchen_manager");
    render(<App />);
    await screen.findByText("Bath towel");
    expect(screen.queryByRole("button", { name: /Reports/ })).toBeNull();
  });
});

describe("the fourteen days (D27-238, D27-242 Q1, Q4)", () => {
  it("shows +in over -out, blank when nothing moved; the footer in rupees; and by outlet no sales without reports", async () => {
    as("stores");
    go(`/h/${HOTEL}/stores/days`);
    render(<App />);
    const grid = await screen.findByText("Bath towel").then(() => document.querySelector("[data-store-days]") as HTMLElement);

    const row = grid.querySelector('[data-item-row="Bath towel"]') as HTMLElement;
    const cells = [...row.children].slice(1).map((c) => c.textContent);
    expect(cells.at(-1)).toBe("+10-2");          // today: 10 in, 2 out
    expect(cells.at(-2)).toBe("-1");             // yesterday's waste
    expect(cells.slice(0, 12).every((t) => t === "")).toBe(true);

    const footer = grid.querySelector("[data-days-footer]") as HTMLElement;
    const line = (label: string) => [...footer.children]
      .find((r) => r.firstElementChild!.textContent === label)!;
    const lastOf = (label: string) => [...line(label).children].at(-1)!.textContent;
    expect(lastOf("Received ₹")).toBe("3.1k");
    expect(lastOf("Issued ₹")).toBe("620");
    expect(lastOf("Occupied rooms")).toBe("21");
    /* Yesterday's waste had no value: a dash, never a part. */
    expect([...line("Wasted ₹").children].at(-2)!.textContent).toBe("-");

    fireEvent.click(screen.getByRole("tab", { name: "Outlet" }));
    const outlet = await waitFor(() => grid.querySelector('[data-outlet-row="Fidato Restaurant"]') as HTMLElement);
    /* Issued 620 today; sales and the % are a dash for a role that reads no reports. */
    expect([...outlet.children].at(-1)!.textContent).toBe("620--");
  });
});
