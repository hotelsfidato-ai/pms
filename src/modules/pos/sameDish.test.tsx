import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { MenuItem, Order } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import TerminalPage from "@/modules/pos/pages/Terminal";
import TillPage from "@/modules/pos/pages/Till";

/* ══════════════════════════════════════════════════════════════════
   THE SAME DISH TWICE IS ONE LINE OF TWO (D27-189, D27-192)

   Tables' pad joined nothing: three taps were three lines of 1. The Till
   had no − at all. A side has no −/+ of its own - it follows its dish.
   The server's half is api/test/modules/pos/sameDish.test.ts.
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

const tikka: MenuItem = {
  id: "i-1", name: "Paneer Tikka", price: 320, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false, offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  variations: [], addonGroups: [],
};

const line = (over: Partial<Order["lines"][number]>): Order["lines"][number] => ({
  id: "l-1", name: "Paneer Tikka", qty: 2, unitPrice: 320, taxRate: 5,
  note: null, voided: false, kotStatus: "pending", addedBy: "Owner",
  parentLineId: null, isAddon: false, variationId: null, ...over,
});

/** One open order, o-5: Paneer Tikka x2 with a side of onions. */
function anOrder(kotStatus: string) {
  const order = {
    id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
    table: "4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
    openedBy: "Owner", eventId: null, eventTitle: null, tenders: [],
    abandonedReason: null, discount: 0, roundOff: 0, net: 690, taxable: 690,
    tax: 35, gross: 725, payable: 725,
    lines: [
      line({ kotStatus }),
      line({ id: "l-2", name: "Sides: Onions", unitPrice: 25, kotStatus,
             parentLineId: "l-1", isAddon: true }),
    ],
  } as unknown as Order;
  return server({
    [`GET ${API}/pos/outlets`]: () => [{ code: "REST", name: "Fidato Restaurant",
      category: "food", hasKey: false, isActive: true, bills: 0 }],
    [`GET ${API}/till/menu`]: () => ({ categories: [] }),
    [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [{
      id: "o-5", orderNo: "20260825-5", outlet: "REST", table: "4", status: "open",
      businessDate: "2026-08-25", gross: 725, paymentMethod: null,
      openedAt: "2026-08-25T19:00", lines: 2 }] }),
    [`GET ${API}/till/orders/o-5`]: () => order,
    [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
    [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    [`POST ${API}/till/orders/o-5/lines/l-1/qty`]: () => ({ ...order, ok: true }),
  });
}

describe("Tables: the pad", () => {
  it("three taps on a dish are one line of 3, and Send sends one line", async () => {
    const calls = server({
      [`GET ${API}/till/menu`]: () => ({ categories: [{
        id: "c-1", name: "Starters", prepMinutes: null, course: null, items: [tikka] }] }),
      [`POST ${API}/till/orders/batch`]: () =>
        ({ id: "o-9", orderNo: "12", lines: [], ok: true, opened: true, sent: 1, kotNo: 7 }),
    });
    const sent = vi.fn();
    renderAt(`/h/${HOTEL}/floor`, "/h/:code/floor", (
      <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
                open onOpenChange={() => {}} onSent={sent} />
    ));
    await screen.findByText("not saved");
    const tile = await screen.findByRole("button", { name: /Paneer Tikka/ });
    for (let tap = 0; tap < 3; tap++) fireEvent.click(tile);

    expect(screen.getAllByRole("button", { name: "One less Paneer Tikka" }),
      "each tap made its own line").toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject(
      { lines: [{ itemId: "i-1", qty: 3 }] });
  });
});

describe("the Till's −", () => {
  it("takes one off an unsent dish; its side has none of its own", async () => {
    const calls = anOrder("pending");
    renderAt(`/h/${HOTEL}/till?order=o-5`, "/h/:code/till", <TillPage />);

    fireEvent.click(await screen.findByRole("button", { name: "One fewer Paneer Tikka" }));
    expect(screen.queryByRole("button", { name: "One fewer Sides: Onions" })).toBeNull();
    await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST")).toEqual([
      { path: `${API}/till/orders/o-5/lines/l-1/qty`, method: "POST", body: { qty: 1 } }]));
  });

  it("asks why before one comes off a dish the kitchen has (D27-119)", async () => {
    const calls = anOrder("sent");
    renderAt(`/h/${HOTEL}/till?order=o-5`, "/h/:code/till", <TillPage />);

    fireEvent.click(await screen.findByRole("button", { name: "One fewer Paneer Tikka" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("Why is it coming off?");
    expect(calls.filter((c) => c.method === "POST"), "taken off without a reason").toEqual([]);
  });
});

describe("the Terminal", () => {
  it("a side follows its dish: no −/+ of its own", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    anOrder("pending");
    renderAt(`/h/${HOTEL}/till/terminal`, "/h/:code/till/terminal", <TerminalPage />);

    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    await screen.findByRole("button", { name: "One more Paneer Tikka" });
    expect(screen.queryByRole("button", { name: "One more Sides: Onions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "One fewer Sides: Onions" })).toBeNull();
  });
});
