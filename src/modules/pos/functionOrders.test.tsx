import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { DayEnd, MenuCategory, MenuItem, Order } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import TerminalPage from "@/modules/pos/pages/Terminal";
import TillPage from "@/modules/pos/pages/Till";
import DayEndPage from "@/modules/pos/pages/DayEnd";

/* ══════════════════════════════════════════════════════════════════
   A RESTAURANT ORDER ON A BANQUET FUNCTION'S BILL — D17-21, the screens

   The owner, 17 September: staff attach an order to a function when
   ordering — on Tables, the Terminal and the Till — and such an order is
   paid on the function's bill only. The list of functions is the banquet
   service's (through its front door); the server's own tests prove the
   rule (api/test/modules/pos/functionOrders.test.ts). These prove what a
   person is offered.
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
}

const API = `/api/hotels/${HOTEL}`;
const ATTACHABLE = `${API}/banquet/attachable`;
const WEDDING = {
  id: "e-1", reference: "BQ-1", title: "Sharma wedding", venueName: "Lawn",
  hostName: "Mr Sharma", startsAt: "2026-08-25T18:00", endsAt: "2026-08-25T23:00",
};
const functionsOn = () => ({
  enabled: true, businessDate: "2026-08-25", functions: [WEDDING],
});

const dish: MenuItem = {
  id: "i-1", name: "Paneer Tikka", price: 320, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false,
  offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  variations: [], addonGroups: [],
};
const MENU = { categories: [{ id: "c-1", name: "Starters", prepMinutes: null, course: null, items: [dish] }] satisfies MenuCategory[] };

const anOrder = (over: Partial<Order> = {}): Order => ({
  id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
  hotelName: "5 Elements Akkalkot", hotelCity: null, hotelGstin: null,
  table: "4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
  openedBy: "Owner", settledBy: null, settledAt: null, abandonedReason: null,
  ticketId: null, eventId: null, eventTitle: null,
  lines: [{
    id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5,
    note: null, voided: false, kotStatus: "sent", addedBy: "Owner",
    parentLineId: null, isAddon: false, variationId: null,
  }],
  net: 320, discount: 0, discountType: null, discountValue: null,
  discountReason: null, promotionId: null, promotionName: null,
  taxable: 320, tax: 16, gross: 336, roundOff: 0, payable: 336, tenders: [],
  covers: null, waiter: null, orderType: "dine_in", customerName: null,
  customerPhone: null, customerAddress: null, customerLocality: null, heldAt: null,
  ...over,
});

/* ── Tables ─────────────────────────────────────────────────────── */

async function padWith(attachable: () => unknown) {
  const calls = server({
    [`GET ${API}/till/menu`]: () => MENU,
    [`GET ${ATTACHABLE}`]: attachable,
    [`POST ${API}/till/orders/batch`]: () =>
      ({ ...anOrder({ id: "o-9" }), ok: true, opened: true, sent: 1, kotNo: 7 }),
  });
  vi.spyOn(window, "open").mockReturnValue({} as Window);
  const sent = vi.fn();
  renderAt(`/h/${HOTEL}/floor`, "/h/:code/floor", (
    <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
              open onOpenChange={() => {}} onSent={sent} />
  ));
  await screen.findByText("not saved");
  return { calls, sent };
}

describe("Tables - a function chosen when ordering", () => {
  it("sends the chosen function with the round", async () => {
    const { calls, sent } = await padWith(functionsOn);

    fireEvent.change(await screen.findByLabelText("Banquet function"),
      { target: { value: "e-1" } });
    fireEvent.click(await screen.findByRole("button", { name: /Paneer Tikka/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());

    expect(calls.find((c) => c.path.endsWith("/till/orders/batch"))?.body)
      .toMatchObject({ eventId: "e-1" });
  });

  it("sends no function at all when none was chosen", async () => {
    const { calls, sent } = await padWith(functionsOn);
    await screen.findByLabelText("Banquet function");
    fireEvent.click(await screen.findByRole("button", { name: /Paneer Tikka/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());

    const body = calls.find((c) => c.path.endsWith("/till/orders/batch"))?.body as object;
    expect("eventId" in body).toBe(false);
  });

  it("offers no function box where there is no function today", async () => {
    await padWith(() => ({ enabled: true, businessDate: "2026-08-25", functions: [] }));
    await screen.findByRole("button", { name: /Paneer Tikka/ });
    expect(screen.queryByLabelText("Banquet function")).toBeNull();
  });

  it("offers none at a property with no banquet hall", async () => {
    await padWith(() => ({ enabled: false, businessDate: "2026-08-25", functions: [] }));
    await screen.findByRole("button", { name: /Paneer Tikka/ });
    expect(screen.queryByLabelText("Banquet function")).toBeNull();
  });
});

/* ── The Terminal ───────────────────────────────────────────────── */

function terminalWith(order: Order) {
  localStorage.setItem("fidato.terminal-outlet", "REST");
  const calls = server({
    [`GET ${API}/pos/outlets`]: () => [{
      code: "REST", name: "Fidato Restaurant", category: "food",
      hasKey: false, isActive: true, bills: 0,
    }],
    [`GET ${API}/till/menu`]: () => ({ categories: [] }),
    [`GET ${API}/till/orders`]: () => ({
      businessDate: "2026-08-25",
      orders: [{ id: order.id, orderNo: order.orderNo, outlet: "REST", table: "4",
                 status: "open", businessDate: "2026-08-25", gross: 336,
                 paymentMethod: null, openedAt: "2026-08-25T19:00", lines: 1 }],
    }),
    [`GET ${API}/till/orders/o-5`]: () => order,
    [`GET ${ATTACHABLE}`]: functionsOn,
    [`PATCH ${API}/till/orders/o-5`]: (b) => ({
      ...order, ok: true,
      eventId: (b as { eventId: string | null }).eventId,
      eventTitle: (b as { eventId: string | null }).eventId ? "Sharma wedding" : null,
    }),
    [`POST ${API}/till/orders/o-5/settle`]: () =>
      ({ ...order, ok: true, status: "settled", paymentMethod: "function" }),
  });
  renderAt(`/h/${HOTEL}/till/terminal`, "/h/:code/till/terminal", <TerminalPage />);
  return calls;
}

describe("the Terminal - an order on a function", () => {
  it("is settled to the function, and the other ways are switched off with the reason", async () => {
    const calls = terminalWith(anOrder({ eventId: "e-1", eventTitle: "Sharma wedding" }));
    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));

    const charge = await screen.findByRole("button", { name: "Charge to Sharma wedding" });
    expect(screen.getByText(/This order is on Sharma wedding's bill/)).toBeTruthy();
    for (const name of ["Cash", "Card", "UPI", "Charge to a room"]) {
      expect((screen.getByRole("button", { name: new RegExp(`^${name}$`) }) as HTMLButtonElement)
        .disabled, name).toBe(true);
    }

    fireEvent.click(charge);
    await vi.waitFor(() => expect(
      calls.find((c) => c.path.endsWith("/settle"))?.body,
    ).toMatchObject({ method: "function" }));
  });

  it("puts an open order on a function from the order itself", async () => {
    const calls = terminalWith(anOrder());
    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    expect(screen.queryByRole("button", { name: /Charge to Sharma wedding/ })).toBeNull();

    fireEvent.change(await screen.findByLabelText("Banquet function"),
      { target: { value: "e-1" } });
    await vi.waitFor(() => expect(
      calls.find((c) => c.method === "PATCH")?.body,
    ).toEqual({ eventId: "e-1" }));
  });
});

/* ── The Till ───────────────────────────────────────────────────── */

describe("the Till - an order on a function", () => {
  it("offers Charge to the function, and switches off room, cash, card, UPI and Part", async () => {
    const order = anOrder({ eventId: "e-1", eventTitle: "Sharma wedding" });
    server({
      [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
      [`GET ${API}/till/menu`]: () => ({ categories: [] }),
      [`GET ${API}/till/orders/o-5`]: () => order,
      [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
      [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
      [`GET ${ATTACHABLE}`]: functionsOn,
    });
    renderAt(`/h/${HOTEL}/till?order=o-5`, "/h/:code/till", <TillPage />);

    const charge = await screen.findByRole("button", { name: "Charge to Sharma wedding" });
    expect(charge.getAttribute("data-variant")).toBe("primary");
    for (const name of [/^Cash$/, /^Card$/, /^UPI$/, /^Charge to room$/, /Part - pay two ways/]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
        String(name)).toBe(true);
    }
    expect(within(charge.parentElement!).getByText(/the host pays for it there/)).toBeTruthy();
  });
});

/* ── Close restaurant day ───────────────────────────────────────── */

describe("Close restaurant day - a bill on a function", () => {
  it("is listed as To a function, not as money in the tin", async () => {
    const day: DayEnd = {
      outlet: { code: "REST", name: "Fidato Restaurant" },
      businessDate: "2026-08-25",
      summary: {
        settledOrders: 1, settledValue: 336, abandonedOrders: 0, abandonedValue: 0,
        compOrders: 0, discountGiven: 0, byMethod: { function: 336 },
      },
      blockers: [], movements: [],
      cash: { opening: 0, expected: 0, counted: null, variance: null,
              varianceReason: null, denominations: [] },
      closedAt: null, closedBy: null,
    };
    server({ [`GET ${API}/till/day-end`]: () => day });
    renderAt(`/h/${HOTEL}/till/day-end`, "/h/:code/till/day-end", <DayEndPage />);

    expect(await screen.findByText("To a function")).toBeTruthy();
    expect(screen.getByText(/the host pays for it on the function's bill/)).toBeTruthy();
    expect(screen.queryByText(/^function$/)).toBeNull();
  });
});
