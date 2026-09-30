import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { useSession } from "@/lib/session";
import { HOTEL, startSignedIn } from "@/test/app";
import type { DayEnd, MenuCategory, MenuItem, Order } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import MenuPage from "@/modules/pos/pages/Menu";
import DayEndPage from "@/modules/pos/pages/DayEnd";
import TerminalPage from "@/modules/pos/pages/Terminal";
import TillPage from "@/modules/pos/pages/Till";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S ANSWERS OF 17 SEPTEMBER, FOR THE RESTAURANT

   D17-18  Tables opens the kitchen slip on every send, like the Terminal
           (POS-5) - RETIRED by D27-161: only the KOT station prints now
           (below, with D27-166, the Till's Send to the kitchen).
   D17-19  On/off switches for add-ons on the Menu screen, like dishes
           have (POS-2).
   D17-20  Close restaurant day prints "Tuesday, 25 August 2026" with the
           hotel's name, the button included (POS-7).

   Each was run against the code before the change and seen to fail
   there (the POS CHANGELOG, 17 September).
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

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

/** Answers each request by method and path; anything unlisted is a
    fault. Every request is kept, so a test can ask what was sent. */
function server(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(
    async (url: string, init?: RequestInit) => {
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
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

const dish = (over: Partial<MenuItem>): MenuItem => ({
  id: "i-1", name: "Paneer Tikka", price: 320, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false,
  offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  variations: [], addonGroups: [],
  ...over,
});

/* ── D27-159 · only the KOT station prints a KOT ──────────────────
   D17-18 had Tables and the Terminal open the kitchen slip on every
   send, and POS-10 offered it again when the browser refused; both were
   retired by D27-161. The station prints (KotStation.test.tsx). */

const MENU = `/api/hotels/${HOTEL}/till/menu`;
const BATCH = `/api/hotels/${HOTEL}/till/orders/batch`;

const AN_ORDER = { id: "o-9", orderNo: "12", lines: [] } as unknown as Order;

async function sendARound(answer: (body: unknown) => unknown) {
  const calls = server({
    [`GET ${MENU}`]: () => ({
      categories: [{
        id: "c-1", name: "Starters", prepMinutes: null, course: null,
        items: [dish({})],
      }] satisfies MenuCategory[],
    }),
    [`POST ${BATCH}`]: answer,
  });
  const opened = vi.spyOn(window, "open").mockReturnValue({} as Window);
  const sent = vi.fn();

  renderAt(`/h/${HOTEL}/floor`, "/h/:code/floor", (
    <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
              open onOpenChange={() => {}} onSent={sent} />
  ));

  /* The pad reads any draft kept on the device first, and a dish tapped
     before that finishes would be wiped by it. The test browser keeps
     no drafts, so the pad says "not saved" once it has looked. */
  await screen.findByText("not saved");
  fireEvent.click(await screen.findByRole("button", { name: /Paneer Tikka/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await vi.waitFor(() => expect(sent).toHaveBeenCalled());

  return { calls, opened };
}

const PENDING_ORDER = {
  ...AN_ORDER, id: "o-5", orderNo: "20260825-5", outlet: "REST",
  status: "open", table: "4", gross: 320, payable: 320, tenders: [],
  paymentMethod: null, abandonedReason: null, eventId: null,
  discount: 0, roundOff: 0,
  lines: [{
    id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5,
    note: null, voided: false, kotStatus: "pending", addedBy: "Owner",
    parentLineId: null, isAddon: false, variationId: null,
  }],
};

/** The till's reads for one open order with a dish not yet sent. */
function tillWithAnUnsentDish() {
  return server({
    [`GET /api/hotels/${HOTEL}/pos/outlets`]: () => [{
      code: "REST", name: "Fidato Restaurant", category: "food",
      hasKey: false, isActive: true, bills: 0,
    }],
    [`GET ${MENU}`]: () => ({ categories: [] }),
    [`GET /api/hotels/${HOTEL}/till/orders`]: () => ({
      businessDate: "2026-08-25",
      orders: [{ id: "o-5", orderNo: "20260825-5", outlet: "REST", table: "4",
                 status: "open", businessDate: "2026-08-25", gross: 320,
                 paymentMethod: null, openedAt: "2026-08-25T19:00", lines: 1 }],
    }),
    [`GET /api/hotels/${HOTEL}/till/orders/o-5`]: () => PENDING_ORDER,
    [`GET /api/hotels/${HOTEL}/till/rooms`]: () => [],
    [`POST /api/hotels/${HOTEL}/till/orders/o-5/kot`]: () =>
      ({ ...PENDING_ORDER, ok: true, kotNo: 5 }),
  });
}

describe("a send opens no kitchen slip on this device (D27-159)", () => {
  it("Tables: the round reaches the kitchen and no tab opens", async () => {
    const { calls, opened } = await sendARound(
      () => ({ ...AN_ORDER, ok: true, opened: true, sent: 1, kotNo: 7 }));

    expect(calls.some((c) => c.path === BATCH && c.method === "POST")).toBe(true);
    expect(opened).not.toHaveBeenCalled();
  });

  it("the Terminal: the order reaches the kitchen and no tab opens", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    const calls = tillWithAnUnsentDish();
    const opened = vi.spyOn(window, "open").mockReturnValue({} as Window);
    renderAt(`/h/${HOTEL}/till/terminal`, "/h/:code/till/terminal", <TerminalPage />);

    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Send to the kitchen/ }));

    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("/o-5/kot"))).toBe(true));
    expect(opened).not.toHaveBeenCalled();
  });
});

/* ── D27-166 · the Till sends to the kitchen ──────────────────────── */

describe("the Till's Send to the kitchen (D27-166)", () => {
  it("sends the order's unsent dishes, as the Terminal does", async () => {
    const calls = tillWithAnUnsentDish();
    renderAt(`/h/${HOTEL}/till?order=o-5`, "/h/:code/till", <TillPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Send to the kitchen/ }));

    await vi.waitFor(() => expect(calls.filter((c) =>
      c.method === "POST" && c.path === `/api/hotels/${HOTEL}/till/orders/o-5/kot`)).toHaveLength(1));
  });
});

/* ── D17-19 · add-on switches on the Menu screen ─────────────────── */

const PROMOTIONS = `/api/hotels/${HOTEL}/till/promotions`;
const SIDES = {
  id: "g-1", label: "Sides", minSelect: 0, maxSelect: 4,
  addons: [
    { id: "a-1", label: "Onions", price: 25, offUntil: null },
    { id: "a-2", label: "Curd", price: 25,
      offUntil: new Date(Date.now() + 2 * 3600_000).toISOString() },
  ],
};

function menuWithSides() {
  return server({
    [`GET ${MENU}`]: () => ({
      categories: [{
        id: "c-1", name: "Starters", prepMinutes: null, course: null,
        items: [
          dish({ id: "i-1", name: "Bhaaji Pau", addonGroups: [SIDES] }),
          dish({ id: "i-2", name: "Misal Pav", addonGroups: [SIDES] }),
          dish({ id: "i-3", name: "Paneer Tikka" }),
        ],
      }] satisfies MenuCategory[],
    }),
    [`GET ${PROMOTIONS}`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    [`POST /api/hotels/${HOTEL}/till/addons/a-1/off`]: () => ({ ok: true }),
    [`POST /api/hotels/${HOTEL}/till/addons/a-2/on`]: () => ({ ok: true }),
  });
}

const menuAt = () => renderAt(`/h/${HOTEL}/menu`, "/h/:code/menu", <MenuPage />);

describe("the Menu screen's add-ons (D17-19)", () => {
  it("switches an add-on off for a while, through its own route", async () => {
    const calls = menuWithSides();
    menuAt();

    /* Listed under each dish that offers it — twice here, one group. */
    const offs = await screen.findAllByRole("button", { name: "Out of stock: Onions" });
    expect(offs).toHaveLength(2);
    fireEvent.click(offs[0]!);

    const dialog = await screen.findByRole("dialog");
    /* It goes off on every dish with the group, and the dialog says so. */
    expect(within(dialog).getByText(/every dish that offers it: Bhaaji Pau, Misal Pav/))
      .toBeTruthy();
    /* The database keeps no reason for an add-on, so none is asked for. */
    expect(within(dialog).queryByLabelText(/Why/)).toBeNull();

    const menuReads = calls.filter((c) => c.path === MENU).length;
    fireEvent.click(within(dialog).getByRole("button", { name: "2 hours" }));
    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/till/addons/a-1/off")),
    ).toMatchObject({ method: "POST", body: { until: "2h" } }));
    /* And the screen finishes the act: the dialog closes and the menu is
       read again, so the row shows "Off till …". A first version posted
       the switch and left the dialog standing (caught by the type check). */
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await vi.waitFor(() => expect(
      calls.filter((c) => c.path === MENU).length).toBeGreaterThan(menuReads));
  });

  it("puts an add-on that is off back on", async () => {
    const calls = menuWithSides();
    menuAt();

    const back = await screen.findAllByRole("button", { name: /put back Curd$/ });
    fireEvent.click(back[0]!);
    await vi.waitFor(() => expect(
      calls.some((c) => c.method === "POST"
        && c.path === `/api/hotels/${HOTEL}/till/addons/a-2/on`),
    ).toBe(true));
  });

  it("still asks why when a dish is switched off", async () => {
    menuWithSides();
    menuAt();

    fireEvent.click(await screen.findByRole("button", { name: "Out of stock: Paneer Tikka" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Why/)).toBeTruthy();
  });
});

/* ── D17-20 · Close restaurant day ──────────────────────────────── */

const DAY_END = `/api/hotels/${HOTEL}/till/day-end`;

const A_DAY: DayEnd = {
  outlet: { code: "REST", name: "Fidato Restaurant" },
  businessDate: "2026-08-25",
  summary: {
    settledOrders: 0, settledValue: 0, abandonedOrders: 0, abandonedValue: 0,
    compOrders: 0, discountGiven: 0, byMethod: {},
  },
  blockers: [],
  movements: [],
  cash: {
    opening: 0, expected: 0, counted: 0, variance: 0,
    varianceReason: null, denominations: [],
  },
  closedAt: null,
  closedBy: null, opened: true,
};

/** The session's hotel list, with this property in it by name. */
function atFiveElements() {
  const agra = useSession.getState().hotels[0]!;
  useSession.setState({
    hotels: [
      agra,
      { ...agra, id: "33333333-3333-3333-3333-333333333333",
        code: HOTEL, name: "5 Elements Akkalkot", city: "Akkalkot",
        businessDate: "2026-08-25" },
    ],
  });
}

const dayEndAt = () =>
  renderAt(`/h/${HOTEL}/till/day-end`, "/h/:code/till/day-end", <DayEndPage />);

describe("Close restaurant day (D17-20)", () => {
  it("names the hotel and the day in words on the close button", async () => {
    atFiveElements();
    server({ [`GET ${DAY_END}`]: () => A_DAY });
    dayEndAt();

    expect(await screen.findByText(
      "5 Elements Akkalkot · Fidato Restaurant · Tuesday, 25 August 2026"))
      .toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Finalize/ }));
    expect(screen.getByRole("button", {
      name: "Close Tuesday, 25 August 2026 · 5 Elements Akkalkot",
    })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/2026-08-25/);
  });

  it("says which hotel's day is closed once it is", async () => {
    atFiveElements();
    server({
      [`GET ${DAY_END}`]: () => ({
        ...A_DAY, closedAt: "25 Aug, 23:40", closedBy: "A. Cashier",
      }),
    });
    dayEndAt();

    fireEvent.click(await screen.findByRole("button", { name: /Finalize/ }));
    expect(screen.getByText(
      "Tuesday, 25 August 2026 · 5 Elements Akkalkot is closed")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/2026-08-25/);
  });

  it("never names another hotel: the page's own code when the name is not known", async () => {
    /* The signed-in session knows only Fidato Agra. The page is 5EL's. */
    server({ [`GET ${DAY_END}`]: () => A_DAY });
    dayEndAt();

    fireEvent.click(await screen.findByRole("button", { name: /Finalize/ }));
    expect(screen.getByRole("button", {
      name: `Close Tuesday, 25 August 2026 · ${HOTEL}`,
    })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Fidato Agra/);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S ANSWERS OF 21 SEPTEMBER — variations and add-ons

   D21-40  "Add variation" on each dish: a name and a price; renamed,
           repriced, removed. Removing the LAST asks for the dish's own
           price (the owner, the same day).
   D21-41  An add-on group made once, offered on many dishes, saying how
           many a guest may choose - held to on the pad.
   D21-42  "Preferences" at 0: never a default. Since D27-192 (Q6) a 0 is
           ticked Free, and Save waits for a figure or the tick.
   D27-192 The variation form: types (Size, Quantity, an Option with its
           heading), names filled in never prices, one save for the set;
           emptying it asks for the dish's own price (D21-40's rule).
   And the Terminal opens the same dish dialog, with a dash on a sized
   dish's tile (the owner, 21 September).
   ══════════════════════════════════════════════════════════════════ */

const GROUPS = `/api/hotels/${HOTEL}/till/menu/addon-groups`;
const OIL = { id: "v-1", label: "Oil", price: 300 };

function menuWithVariation() {
  return server({
    [`GET ${MENU}`]: () => ({
      categories: [{
        id: "c-1", name: "Starters", prepMinutes: null, course: null,
        items: [
          dish({ id: "i-1", name: "Bhaaji Pau", variations: [OIL] }),
          dish({ id: "i-3", name: "Paneer Tikka" }),
        ],
      }] satisfies MenuCategory[],
    }),
    [`GET ${PROMOTIONS}`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    [`GET ${GROUPS}`]: () => ({ groups: [{
      id: "g-9", label: "Preferences", minSelect: 0, maxSelect: null,
      itemIds: ["i-1"], addons: [],
    }] }),
    [`PUT /api/hotels/${HOTEL}/till/menu/items/i-3/variations`]: () => ({ ok: true }),
    [`PUT /api/hotels/${HOTEL}/till/menu/items/i-1/variations`]: () => ({ ok: true }),
    [`POST ${GROUPS}/g-9/addons`]: () => ({ ok: true, id: "a-9" }),
  });
}

describe("variations and add-ons on the Menu screen (D21-40 to 42)", () => {
  it("the form: Size fills in names, never prices; Save waits for a price or Free", async () => {
    const calls = menuWithVariation();
    menuAt();

    fireEvent.click(await screen.findByRole("button", { name: "Add variation to Paneer Tikka" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add a type" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Size" }));
    const name = (k: number) => within(dialog).getByLabelText(`Type 1, choice ${k}`) as HTMLInputElement;
    const price = (k: number) =>
      within(dialog).getByLabelText(`Price of type 1, choice ${k}`) as HTMLInputElement;
    expect([1, 2, 3].map((k) => [name(k).value, price(k).value]))
      .toEqual([["Small", ""], ["Medium", ""], ["Large", ""]]);

    /* A name and no price: nothing to save. A blank is not zero. */
    const save = within(dialog).getByRole("button", { name: "Save" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove type 1, choice 3" }));
    fireEvent.change(price(1), { target: { value: "180" } });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(dialog).getAllByRole("checkbox", { name: "Free" })[1]!);
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);

    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/items/i-3/variations")),
    ).toMatchObject({ method: "PUT", body: { types: [{ kind: "size", choices: [
      { label: "Small", price: "180", free: false },
      { label: "Medium", price: "", free: true },
    ] }] } }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a carried-over type must be picked, and an Option needs its heading", async () => {
    const calls = menuWithVariation();
    menuAt();

    fireEvent.click(await screen.findByRole("button", { name: "Change variations of Bhaaji Pau" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Pick Size, Quantity or Option/)).toBeTruthy();
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Option" }));
    expect(save.hasAttribute("disabled"), "an Option saved with no heading").toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Heading/), { target: { value: "Fat" } });
    fireEvent.click(save);

    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/items/i-1/variations")),
    ).toMatchObject({ method: "PUT", body: { types: [{ kind: "option", heading: "Fat",
      choices: [{ id: "v-1", label: "Oil", price: "300", free: false }] }] } }));
  });

  it("shows a dash, not the dish's own price, for a dish sold by variation", async () => {
    menuWithVariation();
    menuAt();
    const slot = await screen.findByTitle("Sold by variation - each has its own price");
    expect(slot.textContent).toBe("-");
  });

  it("asks for the dish's price when every type is removed", async () => {
    const calls = menuWithVariation();
    menuAt();

    fireEvent.click(await screen.findByRole("button", { name: "Change variations of Bhaaji Pau" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove type" }));
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Price of Bhaaji Pau/), { target: { value: "300" } });
    fireEvent.click(save);

    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/items/i-1/variations")),
    ).toMatchObject({ method: "PUT", body: { types: [], dishPrice: "300", dishFree: false } }));
  });

  it("adds a Preference only once it is priced or ticked Free (D27-192)", async () => {
    const calls = menuWithVariation();
    menuAt();

    expect(await screen.findByText("On Bhaaji Pau")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Add option/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Option/), { target: { value: "No onion" } });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Free" }));
    fireEvent.click(save);
    await vi.waitFor(() => expect(
      calls.find((c) => c.path === `${GROUPS}/g-9/addons`),
    ).toMatchObject({ method: "POST", body: { label: "No onion", price: "", free: true } }));
  });
});

describe("the dish dialog holds a waiter to the group's rule (D21-41)", () => {
  const BREAD = {
    id: "g-2", label: "Choice of bread", minSelect: 1, maxSelect: 2,
    addons: ["Naan", "Roti", "Kulcha"].map((label, i) =>
      ({ id: `b-${i}`, label, price: 20, offUntil: null })),
  };

  it("waits for the required choice and stops at the most allowed", async () => {
    const calls = server({
      [`GET ${MENU}`]: () => ({
        categories: [{
          id: "c-1", name: "Mains", prepMinutes: null, course: null,
          items: [dish({ id: "i-5", name: "Dal", addonGroups: [BREAD] })],
        }] satisfies MenuCategory[],
      }),
    });
    renderAt(`/h/${HOTEL}/floor`, "/h/:code/floor", (
      <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
                open onOpenChange={() => {}} onSent={() => {}} />
    ));

    fireEvent.click(await screen.findByRole("button", { name: /Dal/ }));
    const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
    expect(within(dialog).getByText("choose 1 to 2")).toBeTruthy();

    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add.hasAttribute("disabled")).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /Naan/ }));
    expect(add.hasAttribute("disabled")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: /Roti/ }));
    /* Two is the most: the third waits until one is taken back. */
    expect(within(dialog).getByRole("button", { name: /Kulcha/ }).hasAttribute("disabled"))
      .toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("the Terminal rings a dish sold by variation (the owner, 21 Sep)", () => {
  it("opens the dish dialog, with a dash on the tile, and sends the variation", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    const ORDER = {
      ...AN_ORDER, id: "o-5", orderNo: "20260825-5", outlet: "REST",
      status: "open", table: "4", gross: 0, payable: 0, tenders: [],
      paymentMethod: null, abandonedReason: null, lines: [],
    };
    const calls = server({
      [`GET /api/hotels/${HOTEL}/pos/outlets`]: () => [{
        code: "REST", name: "Restaurant", category: "food",
        hasKey: false, isActive: true, bills: 0,
      }],
      [`GET ${MENU}`]: () => ({
        categories: [{
          id: "c-1", name: "Mains", prepMinutes: null, course: null,
          items: [dish({ id: "i-7", name: "Chicken Biryani", price: 250,
            variations: [{ id: "v-h", label: "Half", price: 180 },
                         { id: "v-f", label: "Full", price: 320 }] })],
        }] satisfies MenuCategory[],
      }),
      [`GET /api/hotels/${HOTEL}/till/orders`]: () => ({
        businessDate: "2026-08-25",
        orders: [{ id: "o-5", orderNo: "20260825-5", outlet: "REST", table: "4",
                   status: "open", businessDate: "2026-08-25", gross: 0,
                   paymentMethod: null, openedAt: "2026-08-25T19:00", lines: 0 }],
      }),
      [`GET /api/hotels/${HOTEL}/till/orders/o-5`]: () => ORDER,
      [`POST /api/hotels/${HOTEL}/till/orders/o-5/lines`]: () => ({ ...ORDER, ok: true }),
    });
    renderAt(`/h/${HOTEL}/till/terminal`, "/h/:code/till/terminal", <TerminalPage />);

    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    const tile = await screen.findByRole("button", { name: /^Chicken Biryani/ });
    /* No ₹250 anywhere on it: that column is on no menu. */
    expect(tile.textContent).not.toMatch(/250/);
    expect(tile.textContent).toMatch(/-$/);

    /* Live once the order has loaded. */
    await vi.waitFor(() => expect(tile.hasAttribute("disabled")).toBe(false));
    fireEvent.click(tile);
    const dialog = await screen.findByRole("dialog");
    expect(calls.some((c) => c.path.endsWith("/o-5/lines"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: /Half/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/o-5/lines")),
    ).toMatchObject({ method: "POST", body: { itemId: "i-7", variationId: "v-h" } }));
  });
});

/* ── D21-94 · the GST a dish shows (POS-15) ─────────────────────────
   The server sends the rate the till rings a dish at - its own, else
   its section's - and null when none is set (api/test/modules/pos/
   menuTaxRate.test.ts holds that side). These hold the screens to it:
   null is a dash, never "0%" or a bare "%", and a real 0% stays 0%. */

describe("a dish's GST reads its section's rate, or a dash (D21-94, POS-15)", () => {
  const RATES = {
    categories: [{
      id: "c-1", name: "Mains", prepMinutes: null, course: null,
      items: [
        dish({ id: "i-1", name: "Follows Dish", price: 200, taxRate: 5 }),
        dish({ id: "i-2", name: "Unset Dish", price: 200, taxRate: null }),
        dish({ id: "i-3", name: "Nought Dish", price: 200, taxRate: 0 }),
      ],
    }] satisfies MenuCategory[],
  };
  const ORDER = {
    ...AN_ORDER, id: "o-5", orderNo: "20260825-5", outlet: "REST",
    status: "open", table: "4", gross: 0, payable: 0, tenders: [],
    paymentMethod: null, abandonedReason: null, lines: [],
  };
  const ORDERS = {
    businessDate: "2026-08-25",
    orders: [{ id: "o-5", orderNo: "20260825-5", outlet: "REST", table: "4",
               status: "open", businessDate: "2026-08-25", gross: 0,
               paymentMethod: null, openedAt: "2026-08-25T19:00", lines: 0 }],
  };
  const text = async (role: "row" | "tile", name: string) => role === "row"
    ? (await screen.findByText(name)).closest("li")!.textContent
    : (await screen.findByRole("button", { name: new RegExp(`^${name}`) })).textContent;

  it("on the Menu screen", async () => {
    server({
      [`GET ${MENU}`]: () => RATES,
      [`GET ${PROMOTIONS}`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    });
    menuAt();
    expect(await text("row", "Follows Dish")).toMatch(/^Follows Dish5%₹/);
    expect(await text("row", "Unset Dish")).toMatch(/^Unset Dish-₹/);
    expect(await text("row", "Nought Dish")).toMatch(/^Nought Dish0%₹/);
  });

  it("on the Terminal's tiles", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    server({
      [`GET /api/hotels/${HOTEL}/pos/outlets`]: () => [{
        code: "REST", name: "Restaurant", category: "food",
        hasKey: false, isActive: true, bills: 0,
      }],
      [`GET ${MENU}`]: () => RATES,
      [`GET /api/hotels/${HOTEL}/till/orders`]: () => ORDERS,
      [`GET /api/hotels/${HOTEL}/till/orders/o-5`]: () => ORDER,
    });
    renderAt(`/h/${HOTEL}/till/terminal`, "/h/:code/till/terminal", <TerminalPage />);
    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    expect(await text("tile", "Follows Dish")).toMatch(/^Follows Dish5%₹/);
    expect(await text("tile", "Unset Dish")).toMatch(/^Unset Dish-₹/);
    expect(await text("tile", "Nought Dish")).toMatch(/^Nought Dish0%₹/);
  });

  it("on the Till's tiles", async () => {
    server({
      [`GET /api/hotels/${HOTEL}/till/orders`]: () => ORDERS,
      [`GET ${MENU}`]: () => RATES,
      [`GET /api/hotels/${HOTEL}/till/orders/o-5`]: () => ORDER,
      [`GET /api/hotels/${HOTEL}/till/rooms`]: () => ({ rooms: [] }),
      [`GET ${PROMOTIONS}`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    });
    renderAt(`/h/${HOTEL}/till?order=o-5`, "/h/:code/till", <TillPage />);
    /* The Till prints the price first and the rate under it. */
    expect(await text("tile", "Follows Dish")).toMatch(/₹200 ?5%$/);
    expect(await text("tile", "Unset Dish")).toMatch(/₹200 ?-$/);
    expect(await text("tile", "Nought Dish")).toMatch(/₹200 ?0%$/);
  });
});

/* ── D22-4 · a section's tax heading on the Menu screen ─────────────
   Set only by re-importing until 23 September. Alcohol is offered only
   where the property serves it (D21-90, D22-46); the server refuses it
   otherwise (api/test/modules/pos/sectionHeading.test.ts). */

describe("the tax heading on each menu section (D22-4)", () => {
  const menuServing = (alcohol: boolean) => server({
    [`GET ${MENU}`]: () => ({
      categories: [
        { id: "c-1", name: "Mains", taxKind: "restaurant", prepMinutes: null,
          course: null, items: [] },
        { id: "c-2", name: "Spirits", taxKind: null, prepMinutes: null,
          course: null, items: [] },
      ] satisfies MenuCategory[],
    }),
    [`GET ${PROMOTIONS}`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    [`GET /api/hotels/${HOTEL}/modules`]: () => ({
      modules: [{ module: "alcohol", enabled: alcohol }],
    }),
    [`POST /api/hotels/${HOTEL}/till/menu/categories/c-2/tax-kind`]: () => ({ ok: true }),
  });
  const picker = (name: string) =>
    screen.findByRole("combobox", { name: `Tax heading for ${name}` }) as Promise<HTMLSelectElement>;
  /** What a person can choose: the options not disabled. */
  const offers = (select: HTMLSelectElement) =>
    [...select.options].filter((o) => !o.disabled).map((o) => o.value);

  it("shows each section's heading and sets it through the section's route", async () => {
    const calls = menuServing(false);
    menuAt();
    expect((await picker("Mains")).value).toBe("restaurant");
    const spirits = await picker("Spirits");
    /* A section with none says so, and "Not set" cannot be chosen. */
    expect(spirits.selectedOptions[0]!.textContent).toBe("Not set");
    expect(offers(spirits)).not.toContain("");

    fireEvent.change(spirits, { target: { value: "bar" } });
    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/categories/c-2/tax-kind")),
    ).toMatchObject({ method: "POST", body: { kind: "bar" } }));
  });

  it("offers Alcohol only where the property serves it", async () => {
    const calls = menuServing(false);
    menuAt();
    const spirits = await picker("Spirits");
    /* Asked, and answered "off" - not merely not yet answered. */
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("/modules"))).toBe(true));
    expect(offers(spirits)).not.toContain("alcohol");
  });

  it("offers Alcohol where it does", async () => {
    menuServing(true);
    menuAt();
    const spirits = await picker("Spirits");
    await vi.waitFor(() => expect(offers(spirits)).toContain("alcohol"));
  });
});
