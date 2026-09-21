import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import * as draftModule from "@/lib/draft";
import { useSession } from "@/lib/session";
import { HOTEL, startSignedIn } from "@/test/app";
import type { DayEnd, MenuCategory, MenuItem, Order } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import MenuPage from "@/modules/pos/pages/Menu";
import DayEndPage from "@/modules/pos/pages/DayEnd";
import TerminalPage from "@/modules/pos/pages/Terminal";
import { SlipNotice, type BlockedSlip } from "@/modules/pos/components/SlipNotice";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S ANSWERS OF 17 SEPTEMBER, FOR THE RESTAURANT

   D17-18  Tables opens the kitchen slip on every send, like the Terminal
           (POS-5).
   D17-19  On/off switches for add-ons on the Menu screen, like dishes
           have (POS-2).
   D17-20  Close restaurant day prints "Tuesday, 25 August 2026" with the
           hotel's name, the button included (POS-7).

   Each was run against the code before the change and seen to fail
   there (the POS CHANGELOG, 17 September).
   ══════════════════════════════════════════════════════════════════ */

const { ApiError, HeldError } = apiModule;

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

/* ── D17-18 · the kitchen slip from Tables ──────────────────────── */

const MENU = `/api/hotels/${HOTEL}/till/menu`;
const BATCH = `/api/hotels/${HOTEL}/till/orders/batch`;

const AN_ORDER = { id: "o-9", orderNo: "12", lines: [] } as unknown as Order;

async function sendARound(
  answer: (body: unknown) => unknown,
  /** What the browser does with the new tab. Null is a refusal. */
  browser: () => Window | null = () => null,
  onSlipBlocked?: (slip: BlockedSlip) => void,
  /** Just before Send is pressed. */
  beforeSend?: () => void,
) {
  const calls = server({
    [`GET ${MENU}`]: () => ({
      categories: [{
        id: "c-1", name: "Starters", prepMinutes: null, course: null,
        items: [dish({})],
      }] satisfies MenuCategory[],
    }),
    [`POST ${BATCH}`]: answer,
  });
  const opened = vi.spyOn(window, "open").mockImplementation(browser);
  const sent = vi.fn();

  renderAt(`/h/${HOTEL}/floor`, "/h/:code/floor", (
    <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
              open onOpenChange={() => {}} onSent={sent}
              {...(onSlipBlocked ? { onSlipBlocked } : {})} />
  ));

  /* The pad reads any draft kept on the device first, and a dish tapped
     before that finishes would be wiped by it. The test browser keeps
     no drafts, so the pad says "not saved" once it has looked. */
  await screen.findByText("not saved");
  fireEvent.click(await screen.findByRole("button", { name: /Paneer Tikka/ }));
  beforeSend?.();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await vi.waitFor(() => expect(sent).toHaveBeenCalled());

  return { calls, opened };
}

describe("Tables sending a round (D17-18)", () => {
  it("opens the kitchen slip, as the Terminal does", async () => {
    const { calls, opened } = await sendARound(
      () => ({ ...AN_ORDER, ok: true, opened: true, sent: 1, kotNo: 7 }));

    expect(calls.some((c) => c.path === BATCH && c.method === "POST")).toBe(true);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(
      `/h/${HOTEL}/till/orders/o-9/kot/7`, "_blank");
  });

  it("opens nothing when nothing went to the kitchen", async () => {
    const { opened } = await sendARound(
      () => ({ ...AN_ORDER, ok: true, opened: false }));
    expect(opened).not.toHaveBeenCalled();
  });

  it("opens nothing for a round held on the device - the kitchen does not have it", async () => {
    const { opened } = await sendARound(() => {
      throw new HeldError("Held until the connection is back.", "e-1", false);
    });
    expect(opened).not.toHaveBeenCalled();
  });

  it("takes the sent round off the device BEFORE it opens the slip (POS-11)", async () => {
    /* Where the new tab replaces this page, whatever comes after the open
       never runs — and a sent round left on the device reads "not sent". */
    const order: string[] = [];
    vi.spyOn(draftModule, "clearDraft").mockImplementation(async () => {
      order.push("draft cleared");
    });
    const { opened } = await sendARound(
      () => ({ ...AN_ORDER, ok: true, opened: true, sent: 1, kotNo: 7 }),
      () => { order.push("slip opened"); return null; },
      undefined,
      /* The pad also clears an empty draft by itself as it opens, so only
         what happens from Send onward counts. A first version of this
         test counted that one and passed with the fault put back. */
      () => { order.length = 0; });

    expect(opened).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("draft cleared");
    expect(order.indexOf("slip opened")).toBeGreaterThan(0);
  });
});

/* ── POS-10 · the slip the browser would not open ───────────────── */

describe("a kitchen slip the browser refuses (POS-10)", () => {
  it("is handed to the screen under the pad, naming the order and the table", async () => {
    const blocked = vi.fn();
    await sendARound(
      () => ({ ...AN_ORDER, ok: true, opened: true, sent: 1, kotNo: 7 }),
      () => null,
      blocked);

    expect(blocked).toHaveBeenCalledWith({
      url: `/h/${HOTEL}/till/orders/o-9/kot/7`, what: "Order 7 for Table 7",
    });
  });

  it("is not reported when the slip opened", async () => {
    const blocked = vi.fn();
    await sendARound(
      () => ({ ...AN_ORDER, ok: true, opened: true, sent: 1, kotNo: 7 }),
      () => ({}) as Window,
      blocked);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("offers the slip on a new tap, and goes once it opens", async () => {
    const done = vi.fn();
    const opened = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(<SlipNotice slip={{ url: "/h/5EL/till/orders/o-9/kot/7", what: "Order 7 for AC2" }}
                       onDone={done} />);

    expect(screen.getByRole("alert").textContent)
      .toContain("Order 7 for AC2 is with the kitchen, but its slip did not open");
    fireEvent.click(screen.getByRole("button", { name: "Open the kitchen slip" }));
    expect(opened).toHaveBeenCalledWith("/h/5EL/till/orders/o-9/kot/7", "_blank");
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("says so when the browser refuses the new tap as well, and stays", async () => {
    const done = vi.fn();
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<SlipNotice slip={{ url: "/k", what: "Order 7" }} onDone={done} />);

    fireEvent.click(screen.getByRole("button", { name: "Open the kitchen slip" }));
    expect(screen.getByRole("alert").textContent)
      .toContain("allow pop-ups for this site");
    expect(done).not.toHaveBeenCalled();
  });

  it("shows on the Terminal when its send's slip is refused", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    const ORDER = {
      ...AN_ORDER, id: "o-5", orderNo: "20260825-5", outlet: "REST",
      status: "open", table: "4", gross: 320, payable: 320, tenders: [],
      paymentMethod: null, abandonedReason: null,
      lines: [{
        id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5,
        note: null, voided: false, kotStatus: "pending", addedBy: "Owner",
        parentLineId: null, isAddon: false, variationId: null,
      }],
    };
    server({
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
      [`GET /api/hotels/${HOTEL}/till/orders/o-5`]: () => ORDER,
      [`POST /api/hotels/${HOTEL}/till/orders/o-5/kot`]: () =>
        ({ ...ORDER, ok: true, kotNo: 5 }),
    });
    vi.spyOn(window, "open").mockReturnValue(null);
    renderAt(`/h/${HOTEL}/till/terminal`, "/h/:code/till/terminal", <TerminalPage />);

    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Send to the kitchen/ }));

    expect((await screen.findByRole("alert")).textContent)
      .toContain("Order 5 is with the kitchen, but its slip did not open");
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
  closedBy: null,
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
   D21-42  "Preferences" at 0: TYPED, never a default. Save waits for a
           figure; a typed "0" is sent as "0".
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
    [`POST /api/hotels/${HOTEL}/till/menu/items/i-3/variations`]: () => ({ ok: true, id: "v-2" }),
    [`POST /api/hotels/${HOTEL}/till/menu/variations/v-1/remove`]: () => ({ ok: true }),
    [`POST ${GROUPS}/g-9/addons`]: () => ({ ok: true, id: "a-9" }),
  });
}

describe("variations and add-ons on the Menu screen (D21-40 to 42)", () => {
  it("adds a variation only once a price is typed, and a typed 0 is kept", async () => {
    const calls = menuWithVariation();
    menuAt();

    fireEvent.click(await screen.findByRole("button", { name: "Add variation to Paneer Tikka" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Variation/), { target: { value: "Taster" } });

    /* A name and no price: nothing to save. A blank is not zero. */
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/Price/), { target: { value: "0" } });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);

    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/items/i-3/variations")),
    ).toMatchObject({ method: "POST", body: { label: "Taster", price: "0" } }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a dash, not the dish's own price, for a dish sold by variation", async () => {
    menuWithVariation();
    menuAt();
    const slot = await screen.findByTitle("Sold by variation - each has its own price");
    expect(slot.textContent).toBe("-");
  });

  it("asks for the dish's price before removing its last variation", async () => {
    const calls = menuWithVariation();
    menuAt();

    fireEvent.click(await screen.findByRole("button", { name: "Remove Bhaaji Pau Oil" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/sold at one price again\. What price\?/)).toBeTruthy();
    /* Nothing was removed on the tap alone. */
    expect(calls.some((c) => c.path.endsWith("/variations/v-1/remove"))).toBe(false);

    const remove = within(dialog).getByRole("button", { name: "Remove" });
    expect(remove.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Price of Bhaaji Pau/), { target: { value: "300" } });
    fireEvent.click(remove);

    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/variations/v-1/remove")),
    ).toMatchObject({ method: "POST", body: { dishPrice: "300" } }));
  });

  it("adds a Preference only once its price is typed - 0 included", async () => {
    const calls = menuWithVariation();
    menuAt();

    expect(await screen.findByText("On Bhaaji Pau")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Add option/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Option/), { target: { value: "No onion" } });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/Price/), { target: { value: "0" } });
    fireEvent.click(save);
    await vi.waitFor(() => expect(
      calls.find((c) => c.path === `${GROUPS}/g-9/addons`),
    ).toMatchObject({ method: "POST", body: { label: "No onion", price: "0" } }));
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
