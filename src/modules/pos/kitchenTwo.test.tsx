import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { Order } from "@/modules/pos/data/till";
import KitchenPage from "@/modules/pos/pages/Kitchen";
import FloorPage from "@/modules/pos/pages/Floor";
import TerminalPage from "@/modules/pos/pages/Terminal";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN'S TWO BUTTONS, AND READY FOR THE WAITER (D27-221, D27-222)

   The Kitchen: Ordered (Start) and On the fire (Ready), and nothing
   after Ready. The waiter: a Ready dish on the Terminal's bill with its
   Taken, and "2 ready" on the table's tile on Tables, one tap for all.
   The server's half is api/test/modules/pos/kitchenTwo.test.ts.
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

const kitchenLine = (id: string, status: string) => ({
  id, orderNo: "20260825-5", table: "AC7", orderType: "dine_in", outlet: "REST",
  name: `Dish ${id}`, qty: 1, note: null, status, waitedSeconds: 60,
  prepMinutes: null, course: null, cancelled: false,
});

describe("the Kitchen: two buttons, Start and Ready", () => {
  it("has Ordered and On the fire, and nothing after Ready", async () => {
    server({ [`GET ${API}/kitchen`]: () => ({ lines: [kitchenLine("l-1", "sent"), kitchenLine("l-2", "preparing")] }) });
    renderAt(`/pos/${HOTEL}/kitchen`, "/pos/:code/kitchen", <KitchenPage />);

    expect(await screen.findByRole("heading", { name: "Ordered" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "On the fire" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "At the pass" }), "a third column").toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ready" })).toBeTruthy();
    expect(screen.queryByText("Picked up")).toBeNull();
  });
});

describe("the Terminal: a Ready dish, and Taken", () => {
  it("reads Ready beside the dish, and Taken serves it", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    const order = {
      id: "o-5", orderNo: "20260825-5", outlet: "REST", table: "AC7", status: "open",
      businessDate: "2026-08-25", paymentMethod: null, openedBy: "Owner", eventId: null,
      eventTitle: null, tenders: [], abandonedReason: null, discount: 0, roundOff: 0,
      net: 320, taxable: 320, tax: 16, gross: 336, payable: 336,
      lines: [{ id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5, note: null,
        voided: false, kotStatus: "ready", addedBy: "Owner", parentLineId: null,
        isAddon: false, variationId: null }],
    } as unknown as Order;
    const calls = server({
      [`GET ${API}/pos/outlets`]: () => [{ code: "REST", name: "Fidato Restaurant",
        category: "food", hasKey: false, isActive: true, bills: 0 }],
      [`GET ${API}/till/menu`]: () => ({ categories: [] }),
      [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [{
        id: "o-5", orderNo: "20260825-5", outlet: "REST", table: "AC7", status: "open",
        businessDate: "2026-08-25", gross: 336, paymentMethod: null,
        openedAt: "2026-08-25T19:00", lines: 1 }] }),
      [`GET ${API}/till/orders/o-5`]: () => order,
      [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
      [`POST ${API}/till/orders/o-5/taken`]: () => ({ ...order, ok: true }),
    });
    renderAt(`/pos/${HOTEL}/terminal`, "/pos/:code/terminal", <TerminalPage />);

    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.queryByText("at the pass")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Taken: Paneer Tikka" }));
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/taken")))
      .toMatchObject({ method: "POST", body: { lineIds: ["l-1"] } }));
  });
});

describe("Tables: the table's ready dishes, one tap for all", () => {
  it("shows \"2 ready\" on the tile, and one tap takes them", async () => {
    const calls = server({
      [`GET ${API}/till/floor`]: () => ({
        outlet: { code: "REST", name: "Fidato Restaurant", closedUntil: null, closedReason: null },
        sections: [{ id: "s-1", name: "A/C", tables: [{
          id: "t-7", label: "AC7", seats: 4, row: 1, col: 1, orderId: "o-5", orderNo: "20260825-5",
          state: "kot", minutes: 12, payable: 1050, ready: 2, readyIds: ["l-1", "l-2"],
        }] }],
      }),
      [`GET ${API}/till/access`]: () => ({ ok: true }),
      [`POST ${API}/till/orders/o-5/taken`]: () => ({ ok: true, id: "o-5", lines: [] }),
    });
    renderAt(`/pos/${HOTEL}/tables`, "/pos/:code/tables", <FloorPage />);

    const badge = await screen.findByRole("button", { name: "Taken: the 2 ready at AC7" });
    expect(badge.textContent).toBe("2 ready");
    fireEvent.click(badge);
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/taken")))
      .toMatchObject({ method: "POST", body: { lineIds: ["l-1", "l-2"] } }));
  });
});
