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
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
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

  it("opens nothing for a round held on the device — the kitchen does not have it", async () => {
    const { opened } = await sendARound(() => {
      throw new HeldError("Held until the connection is back.", "e-1", false);
    });
    expect(opened).not.toHaveBeenCalled();
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
