import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import type { FloorTable, Order } from "@/modules/pos/data/till";
import TillPage from "@/modules/pos/pages/Till";

/* ══════════════════════════════════════════════════════════════════
   TABLE SHIFTING ON THE TILL (the owner's D27-370)

   Two separate buttons on an open dine-in bill, for whoever takes orders:
   "Move to another table" offers the free tables of its section; "Join
   another table" offers the tables of its section with an open bill, and
   says it cannot be undone before it is done. The server's half:
   api/test/modules/pos/tableMoves.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const API = `/api/hotels/${HOTEL}`;
type Call = { path: string; method: string; body: unknown };

function as(role: Role) {
  startSignedIn();
  const s = useSession.getState();
  useSession.setState({ scope: { ...s.scope!, hotels: [{ hotelId: AGRA_HOTEL, role }] } });
  withDemoHotel();
}

beforeEach(() => { vi.stubGlobal("fetch", () => new Promise(() => {})); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

const open = (over: Partial<Order> = {}): Order => ({
  id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
  hotelName: "5 Elements Akkalkot", hotelCity: null, hotelGstin: null,
  table: "T4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
  openedBy: "Owner", settledBy: null, settledAt: null, abandonedReason: null,
  ticketId: null, eventId: null, eventTitle: null,
  lines: [{
    id: "l-1", name: "Paneer Tikka", qty: 2, unitPrice: 320, taxRate: 5,
    note: null, voided: false, kotStatus: "sent", addedBy: "Owner",
    parentLineId: null, isAddon: false, variationId: null,
  }],
  net: 640, discount: 0, discountType: null, discountValue: null,
  discountReason: null, promotionId: null, promotionName: null,
  taxable: 640, tax: 32, taxes: [{ scheme: "gst", rate: 5, tax: 32 }], gross: 672, roundOff: 0, payable: 672,
  tenders: [],
  covers: null, waiter: null, orderType: "dine_in", customerName: null,
  customerPhone: null, customerAddress: null, customerLocality: null, heldAt: null,
  ...over,
});

const t = (id: string, state: FloorTable["state"], orderId: string | null = null): FloorTable => ({
  id, label: id, seats: 4, row: 0, col: 0, orderId, orderNo: orderId ? `bill-${orderId}` : null,
  state, minutes: orderId ? 10 : null, payable: null, ready: 0, readyIds: [],
});

const floor = {
  outlet: { code: "REST", name: "Fidato Restaurant", closedUntil: null, closedReason: null },
  parcels: [],
  sections: [
    { id: "s-ac", name: "A/C", tables: [
      t("T4", "kot", "o-5"), t("T5", "running", "o-6"), t("T6", "blank"), t("T7", "paid", "o-7"),
    ] },
    { id: "s-bar", name: "Bar", tables: [t("B1", "blank"), t("B2", "running", "o-8")] },
  ],
};

function tillWith(order: () => Order, extra: Record<string, (body: unknown) => unknown> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, (body: unknown) => unknown> = {
    [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
    [`GET ${API}/till/menu`]: () => ({ categories: [] }),
    [`GET ${API}/till/orders/o-5`]: order,
    [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
    [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    [`GET ${API}/till/floor`]: () => floor,
    ...extra,
  };
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const answer = routes[`${method} ${path}`];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer(body) as never;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/pos/${HOTEL}/till?order=o-5`]}>
        <Routes><Route path="/pos/:code/till" element={<TillPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe("the Till - table shifting (D27-370)", () => {
  it("a waiter moves the bill to a free table of its section, and the move is kept", async () => {
    as("pos");
    let now = open();
    const calls = tillWith(() => now, {
      [`POST ${API}/till/orders/o-5/move`]: () => {
        now = open({ table: "T6", moves: [{ from: "T4", to: "T6", joined: false, by: "Waiter", at: "20:15" }] });
        return { ok: true, ...now };
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Move to another table" }));
    expect(await screen.findByText(/The bill and its KOTs go with it/)).toBeTruthy();
    /* Only the free tables of A/C: not T5 (a bill on it), T7 (not cleared) or the bar's B1. */
    for (const busy of ["T5", "T7", "B1"]) expect(screen.queryByRole("button", { name: busy }), busy).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "T6" }));
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/move")))
      .toMatchObject({ method: "POST", body: { tableId: "T6" } }));
    expect(await screen.findByText("Moved from T4 to T6 by Waiter at 20:15.")).toBeTruthy();
  });

  it("joining says it cannot be undone before it is done", async () => {
    as("bar");
    const calls = tillWith(() => open(), {
      [`POST ${API}/till/orders/o-5/join`]: () => ({ ok: true, ...open() }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Join another table" }));
    /* Only A/C's tables with an open bill: T5, not the paid T7 nor the bar's B2. */
    expect(screen.queryByRole("button", { name: /^T7/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^B2/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "T5 · bill-o-6" }));
    expect(await screen.findByText(/This cannot be undone\./)).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith("/join")), "nothing joined before the yes").toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/join")))
      .toMatchObject({ method: "POST", body: { tableId: "T5" } }));
  });

  it("a parcel has neither button", async () => {
    as("pos");
    tillWith(() => open({ orderType: "takeaway", table: "Parcel · Ravi" }));
    await screen.findByRole("button", { name: "Close unpaid" });
    expect(screen.queryByRole("button", { name: "Move to another table" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Join another table" })).toBeNull();
  });
});
