import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { MenuItem, Order, NumberedAddon, Docket } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import TillPage from "@/modules/pos/pages/Till";
import TerminalPage from "@/modules/pos/pages/Terminal";
import MenuPage from "@/modules/pos/pages/Menu";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";
import { priceWithAddons, nameWithAddons, addonBreakdown } from "@/modules/pos/lib/pricing";

/* ══════════════════════════════════════════════════════════════════
   NUMBERED ADD-ONS ON THE SCREENS (the owner's D27-289)

   Customise beside a dish on the Tables pad, the Till and the Terminal;
   the dish stays ONE line, "Veg Biryani with add-on Kebab", with the
   breakdown under it; only before Send; the Menu's Add-ons tab, and the
   old add-on groups shown as "Sides"; the kitchen slip's "+ Kebab". The
   server's half is api/test/modules/pos/numberedAddons.test.ts, and the
   pad's arithmetic against the server's is padTotal.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const API = `/api/hotels/${HOTEL}`;
type Call = { path: string; method: string; body: unknown };

beforeEach(() => {
  startSignedIn();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

function server(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const answer = routes[`${method} ${path}`];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer(body) as never;
  });
  return calls;
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

const biryani: MenuItem = {
  id: "i-9", name: "Veg Biryani", price: 310, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false, offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  variations: [], addonGroups: [],
};

const addon = (over: Partial<NumberedAddon>): NumberedAddon => ({
  id: "na-2", number: 2, name: "Kebab", description: "Two pieces of seekh kebab",
  price: 120, free: false, isActive: true, offUntil: null, offReason: null, ...over,
});
const KEBAB = addon({});
const RAITA = addon({ id: "na-3", number: 3, name: "Raita", description: null, price: 40 });
const PICKLE = addon({ id: "na-4", number: 4, name: "Pickle", price: 15,
  offUntil: new Date(Date.now() + 3_600_000).toISOString(), offReason: "none left" });

const KEPT = {
  dish: "Veg Biryani", base: 310,
  addons: [{ id: "na-2", number: 2, name: "Kebab", price: 120, qty: 1 }],
};

/** One open order, o-5: a Biryani with Kebab not yet sent, and a sent Tikka. */
function anOrder() {
  const order = {
    id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
    table: "4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
    openedBy: "Owner", eventId: null, eventTitle: null, tenders: [],
    abandonedReason: null, discount: 0, roundOff: 0, net: 750, taxable: 750,
    tax: 38, gross: 788, payable: 788,
    lines: [
      { id: "l-1", name: "Veg Biryani with add-on Kebab", qty: 1, unitPrice: 430, taxRate: 5,
        note: null, voided: false, kotStatus: "pending", addedBy: "Owner",
        parentLineId: null, isAddon: false, variationId: null, numberedAddons: KEPT },
      { id: "l-2", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5,
        note: null, voided: false, kotStatus: "sent", addedBy: "Owner",
        parentLineId: null, isAddon: false, variationId: null, numberedAddons: null },
    ],
  } as unknown as Order;
  return server({
    [`GET ${API}/pos/outlets`]: () => [{ code: "REST", name: "Fidato Restaurant",
      category: "food", hasKey: false, isActive: true, bills: 0 }],
    [`GET ${API}/till/menu`]: () => ({ categories: [] }),
    [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB, RAITA, PICKLE] }),
    [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [{
      id: "o-5", orderNo: "20260825-5", outlet: "REST", table: "4", status: "open",
      businessDate: "2026-08-25", gross: 788, paymentMethod: null,
      openedAt: "2026-08-25T19:00", lines: 2 }] }),
    [`GET ${API}/till/orders/o-5`]: () => order,
    [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
    [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    [`POST ${API}/till/orders/o-5/lines/l-1/numbered-addons`]: () => ({ ...order, ok: true }),
  });
}

describe("the rules the pad shares with the server", () => {
  it("names, prices and breaks down a dish as the owner chose", () => {
    const chosen = [{ name: "Kebab", price: 120.5, qty: 2 }, { name: "Raita", price: 40, qty: 1 }];
    expect(nameWithAddons("Veg Biryani", [])).toBe("Veg Biryani");
    expect(nameWithAddons("Veg Biryani", [chosen[1]!])).toBe("Veg Biryani with add-on Raita");
    expect(nameWithAddons("Veg Biryani", chosen)).toBe("Veg Biryani with add-ons Kebab ×2, Raita");
    expect(priceWithAddons(310, chosen)).toBe(591);
    expect(addonBreakdown({ dish: "Veg Biryani", base: 310, addons: [{ name: "Kebab", price: 120, qty: 1 }] }))
      .toBe("Veg Biryani 310 · Kebab +120");
  });
});

describe("Tables: Customise on the pad", () => {
  it("adds Kebab by its number to the dish, as one line, and Send carries it", async () => {
    const calls = server({
      [`GET ${API}/till/menu`]: () => ({ categories: [{
        id: "c-1", name: "Main course", prepMinutes: null, course: null, items: [biryani] }] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB, RAITA, PICKLE] }),
      [`POST ${API}/till/orders/batch`]: () =>
        ({ id: "o-9", orderNo: "12", lines: [], ok: true, opened: true, sent: 1, kotNo: 7 }),
    });
    const sent = vi.fn();
    renderAt(`/pos/${HOTEL}/tables`, "/pos/:code/tables", (
      <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
                open onOpenChange={() => {}} onSent={sent} />
    ));
    fireEvent.click(await screen.findByRole("button", { name: /Veg Biryani/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Biryani" }));

    const panel = await screen.findByRole("dialog", { name: "Customise Veg Biryani" });
    expect(within(panel).getByRole("button", { name: /Add-on 4, Pickle/ }), "off today: shown, not tappable")
      .toHaveProperty("disabled", true);
    fireEvent.click(within(panel).getByRole("button", { name: /Add-on 2, Kebab/ }));
    expect(panel.textContent).toContain("Veg Biryani with add-on Kebab");
    expect(panel.textContent).toContain("₹430");
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));

    expect(await screen.findByText("Veg Biryani with add-on Kebab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      lines: [{ itemId: "i-9", qty: 1, numberedAddons: [{ id: "na-2", qty: 1 }] }],
    });
  });
});

describe("Tables: a list read before the add-on was made", () => {
  it("is asked again, so Customise offers the add-on (the owner: \"the options are not coming\")", async () => {
    server({
      [`GET ${API}/till/menu`]: () => ({ categories: [{
        id: "c-1", name: "Main course", prepMinutes: null, course: null, items: [biryani] }] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB] }),
    });
    /* This device read the list while it was empty - made on another device
       since - and the app trusts a read forever (staleTime Infinity). */
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["till-addons", HOTEL], []);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/pos/${HOTEL}/tables`]}>
          <Routes><Route path="/pos/:code/tables" element={
            <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
                      open onOpenChange={() => {}} onSent={() => {}} />
          } /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Veg Biryani/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Biryani" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Biryani" });
    expect(await within(panel).findByRole("button", { name: /Add-on 2, Kebab/ })).toBeTruthy();
    expect(panel.textContent).not.toContain("No add-ons yet");
  });
});

describe("the Till: Customise before Send, and the breakdown", () => {
  it("shows the dish's breakdown, folds add-ons into what the kitchen does not have yet, and saves the set", async () => {
    const calls = anOrder();
    renderAt(`/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till", <TillPage />);

    expect(await screen.findByText("Veg Biryani 310 · Kebab +120")).toBeTruthy();
    const customise = await screen.findByRole("button", { name: "Customise Veg Biryani with add-on Kebab" });
    /* D27-291: the kitchen has the Tikka, so Customise there adds lines of
       their own (customAddons.test.tsx) - it no longer hides. */
    fireEvent.click(screen.getByRole("button", { name: "Customise Paneer Tikka" }));
    expect(await screen.findByRole("dialog", { name: "Add to Paneer Tikka" }), "the kitchen has it").toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(customise);
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Biryani" });
    fireEvent.click(within(panel).getByRole("button", { name: /Add-on 3, Raita/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/numbered-addons") && c.method === "POST"))
      .toMatchObject({ body: { numberedAddons: [{ id: "na-2", qty: 1 }, { id: "na-3", qty: 1 }] } }));
  });
});

describe("a line of several: all of them, or just one (the owner's D27-290)", () => {
  const pad = (calls = server({
    [`GET ${API}/till/menu`]: () => ({ categories: [{
      id: "c-1", name: "Main course", prepMinutes: null, course: null, items: [biryani] }] }),
    [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB] }),
    [`POST ${API}/till/orders/batch`]: () =>
      ({ id: "o-9", orderNo: "12", lines: [], ok: true, opened: true, sent: 1, kotNo: 7 }),
  })) => {
    renderAt(`/pos/${HOTEL}/tables`, "/pos/:code/tables", (
      <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
                open onOpenChange={() => {}} onSent={() => {}} />
    ));
    return calls;
  };

  it("asks which - Done waits - and 'All 3' says it goes on each of the 3", async () => {
    pad();
    const tile = await screen.findByRole("button", { name: /Veg Biryani/ });
    for (let tap = 0; tap < 3; tap++) fireEvent.click(tile);
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Biryani" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Biryani" });
    fireEvent.click(await within(panel).findByRole("button", { name: /Add-on 2, Kebab/ }));
    expect(within(panel).getByRole("button", { name: "Done" }), "nothing chosen for them")
      .toHaveProperty("disabled", true);
    fireEvent.click(within(panel).getByRole("radio", { name: "All 3" }));
    expect(panel.textContent).toContain("On each of the 3: ₹430 each, ₹1,290 in all.");
    expect(within(panel).getByRole("button", { name: "Done" })).toHaveProperty("disabled", false);
  });

  it("'Just 1' splits one off: 2 plain and 1 with Kebab, and Send carries both", async () => {
    const calls = pad();
    const tile = await screen.findByRole("button", { name: /Veg Biryani/ });
    for (let tap = 0; tap < 3; tap++) fireEvent.click(tile);
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Biryani" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Biryani" });
    fireEvent.click(await within(panel).findByRole("button", { name: /Add-on 2, Kebab/ }));
    fireEvent.click(within(panel).getByRole("radio", { name: "Just 1" }));
    expect(panel.textContent).toContain("One of them, ₹430, as its own line; the other 2 stay as they are.");
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));

    expect(await screen.findByText("Veg Biryani with add-on Kebab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(calls.find((c) => c.method === "POST")).toBeTruthy());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ lines: [
      { itemId: "i-9", qty: 2 },
      { itemId: "i-9", qty: 1, numberedAddons: [{ id: "na-2", qty: 1 }] },
    ] });
  });

  it("the note stays until the next dish - not gone while the waiter looks up", async () => {
    /* The clock is faked BEFORE the tap, so a timer the pad sets on it is one
       this test can run out; faked after, a real timer is never reached and
       the test passes whatever the pad does (seen: it passed with the old
       8-second timer put back). */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      pad();
      fireEvent.click(await screen.findByRole("button", { name: /Veg Biryani/ }));
      expect((await screen.findByRole("status")).textContent).toContain("Veg Biryani added");
      act(() => { vi.advanceTimersByTime(9000); });
      expect(screen.queryByRole("status")?.textContent ?? "", "gone after 9 seconds")
        .toContain("Veg Biryani added");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a note after each tap names the dish and opens Customise on it", async () => {
    pad();
    fireEvent.click(await screen.findByRole("button", { name: /Veg Biryani/ }));
    const note = await screen.findByRole("status");
    expect(note.textContent).toContain("Veg Biryani added");
    fireEvent.click(within(note).getByRole("button", { name: "Customise" }));
    expect(await screen.findByRole("dialog", { name: "Customise Veg Biryani" })).toBeTruthy();
  });
});

describe("the menu, read again when an order screen opens (D27-290)", () => {
  it("shows a dish made on another device, though an older menu was saved here", async () => {
    server({
      [`GET ${API}/till/menu`]: () => ({ categories: [{
        id: "c-1", name: "Main course", prepMinutes: null, course: null,
        items: [biryani, { ...biryani, id: "i-10", name: "Mutton Biryani", price: 450 }] }] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [] }),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["till-menu", HOTEL], [{ id: "c-1", name: "Main course", prepMinutes: null,
      course: null, items: [biryani] }]);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/pos/${HOTEL}/tables`]}>
          <Routes><Route path="/pos/:code/tables" element={
            <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
                      open onOpenChange={() => {}} onSent={() => {}} />
          } /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: /Mutton Biryani/ })).toBeTruthy();
  });
});

describe("the Till: all, or just one", () => {
  const tillWith = (qty: number) => {
    const order = {
      id: "o-6", orderNo: "20260825-6", outlet: "REST", outletName: "Fidato Restaurant",
      table: "5", status: "open", businessDate: "2026-08-25", paymentMethod: null,
      openedBy: "Owner", eventId: null, eventTitle: null, tenders: [],
      abandonedReason: null, discount: 0, roundOff: 0, net: 310 * qty, taxable: 310 * qty,
      tax: 0, gross: 310 * qty, payable: 310 * qty,
      lines: [{ id: "l-9", name: "Veg Biryani", qty, unitPrice: 310, taxRate: 5, note: null,
        voided: false, kotStatus: "pending", addedBy: "Owner", parentLineId: null,
        isAddon: false, variationId: null, numberedAddons: null }],
    } as unknown as Order;
    const calls = server({
      [`GET ${API}/till/menu`]: () => ({ categories: [] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB] }),
      [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
      [`GET ${API}/till/orders/o-6`]: () => order,
      [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
      [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
      [`POST ${API}/till/orders/o-6/lines/l-9/numbered-addons`]: () => ({ ...order, ok: true }),
    });
    renderAt(`/pos/${HOTEL}/till?order=o-6`, "/pos/:code/till", <TillPage />);
    return calls;
  };
  const saved = (calls: Call[]) =>
    calls.find((c) => c.method === "POST" && c.path.endsWith("/l-9/numbered-addons"))?.body;

  it("on a line of 3, Just 1 sends just: 1 with the add-ons", async () => {
    const calls = tillWith(3);
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Biryani" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Biryani" });
    fireEvent.click(await within(panel).findByRole("button", { name: /Add-on 2, Kebab/ }));
    fireEvent.click(within(panel).getByRole("radio", { name: "Just 1" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await vi.waitFor(() => expect(saved(calls)).toEqual(
      { numberedAddons: [{ id: "na-2", qty: 1 }], just: 1 }));
  });

  it("on a line of 1, nothing to ask, and no just:", async () => {
    const calls = tillWith(1);
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Biryani" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Biryani" });
    expect(within(panel).queryByRole("radio", { name: /Just 1/ })).toBeNull();
    fireEvent.click(await within(panel).findByRole("button", { name: /Add-on 2, Kebab/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await vi.waitFor(() => expect(saved(calls)).toEqual({ numberedAddons: [{ id: "na-2", qty: 1 }] }));
  });
});

describe("the Terminal: Customise on every dish", () => {
  it("folds add-ons into the dish not yet sent, and adds lines of their own to the one the kitchen has (D27-291)", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    anOrder();
    renderAt(`/pos/${HOTEL}/terminal`, "/pos/:code/terminal", <TerminalPage />);
    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Biryani with add-on Kebab" }));
    expect(await screen.findByRole("dialog", { name: "Customise Veg Biryani" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Customise Paneer Tikka" }));
    expect(await screen.findByRole("dialog", { name: "Add to Paneer Tikka" })).toBeTruthy();
    expect(screen.getByText("Veg Biryani 310 · Kebab +120")).toBeTruthy();
  });
});

describe("the Menu: an Add-ons tab, and the old groups as Sides", () => {
  it("lists the add-ons by number on their own tab", async () => {
    server({
      [`GET ${API}/till/menu`]: () => ({ categories: [] }),
      [`GET ${API}/modules`]: () => ({ modules: {} }),
      [`GET ${API}/till/menu/addon-groups`]: () => ({ groups: [] }),
      [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB, RAITA, { ...RAITA, id: "na-8", number: 8, name: "Old chutney", isActive: false }] }),
    });
    renderAt(`/pos/${HOTEL}/menu`, "/pos/:code/menu", <MenuPage />);

    expect(await screen.findByRole("tab", { name: "Dishes" })).toBeTruthy();
    expect(screen.queryByText("Add-on groups"), "the old label").toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Add-ons" }));

    expect(await screen.findByText("Kebab")).toBeTruthy();
    expect(screen.getByText("Two pieces of seekh kebab")).toBeTruthy();
    expect(screen.getByText("+₹120.00")).toBeTruthy();
    expect(screen.getByText("Switched off")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bring back" })).toBeTruthy();
  });
});

describe("the kitchen slip", () => {
  it("prints the dish with + Kebab under it, and no price", () => {
    const d: Docket = {
      kotNo: 3, orderNo: "20260825-5", table: "AC3", orderType: "dine_in", outlet: "Fidato Restaurant",
      hotel: "5 Elements", sentAt: "25/08/26 19:05",
      lines: [{ id: "1", parentId: null, name: "Veg Biryani", qty: 1, note: null, isAddon: false,
                plus: [{ name: "Kebab", qty: 2 }] }],
    };
    render(<DocketSlip d={d} />);
    expect(screen.getByText("Veg Biryani")).toBeTruthy();
    expect(screen.getByText("+ Kebab ×2")).toBeTruthy();
    expect(document.body.textContent).not.toContain("₹");
  });
});
