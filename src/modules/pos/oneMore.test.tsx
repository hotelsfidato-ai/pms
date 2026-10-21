import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { MenuItem, Order } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import TillPage from "@/modules/pos/pages/Till";

/* ══════════════════════════════════════════════════════════════════
   + ON A DISH (the owner's D27-349; the teams' feedback of 18 October)

   On the Till, + raises the dish's count; on a dish the kitchen has, the
   server puts one more of it, same choices, on a new line for the next
   Send (api/test/modules/pos/sameDish.test.ts holds that half). On the
   waiter's pad, + under "Already sent" puts one more of the sent dish -
   its note and numbered add-ons with it - on this round, sent with Send.
   Customise is an icon now, still named for the dish.
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

const thali: MenuItem = {
  id: "i-7", name: "Veg Thali", price: 300, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false, offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  variations: [], addonGroups: [],
};
const ORDER = {
  id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
  table: "4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
  openedBy: "Owner", eventId: null, eventTitle: null, tenders: [],
  abandonedReason: null, discount: 0, roundOff: 0, net: 420, taxable: 420,
  tax: 21, gross: 441, payable: 441,
  lines: [
    { id: "l-2", name: "Veg Thali with Kebab", qty: 1, unitPrice: 420, taxRate: 5,
      note: "less spicy", voided: false, kotStatus: "sent", addedBy: "Owner",
      parentLineId: null, isAddon: false, variationId: null, extra: null,
      itemId: "i-7", addonId: null, moreChoiceIds: [],
      numberedAddons: { dish: "Veg Thali", base: 300,
        addons: [{ id: "na-2", number: 2, name: "Kebab", price: 120, qty: 1 }] } },
  ],
} as unknown as Order;

function server(order: Order = ORDER) {
  const calls: Call[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const routes: Record<string, () => unknown> = {
      [`GET ${API}/pos/outlets`]: () => [{ code: "REST", name: "Fidato Restaurant",
        category: "food", hasKey: false, isActive: true, bills: 0 }],
      [`GET ${API}/till/menu`]: () => ({ categories: [{
        id: "c-1", name: "Main course", prepMinutes: null, course: null, items: [thali] }] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [] }),
      [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
      [`GET ${API}/till/orders/o-5`]: () => order,
      [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
      [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
      [`POST ${API}/till/orders/o-5/lines/l-2/qty`]: () => ({ ...ORDER, ok: true }),
      [`POST ${API}/till/orders/o-5/lines/b-2/qty`]: () => ({ ...order, ok: true }),
      [`POST ${API}/till/orders/batch`]: () => ({ id: "o-5", orderNo: "12", lines: [], ok: true, opened: false, sent: 1, kotNo: 15 }),
    };
    const answer = routes[`${method} ${path}`];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer() as never;
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

describe("+ on a dish", () => {
  it("two rounds of one beer show once, 2×, and + adds to the newest round's line (D27-353)", async () => {
    const beer = (id: string, kotStatus: string) => ({ ...ORDER.lines[0]!, id, name: "Kingfisher Strong",
      unitPrice: 270, note: null, numberedAddons: null, itemId: "i-kf", kotStatus });
    const calls = server({ ...ORDER, lines: [beer("b-1", "sent"), beer("b-2", "sent")] } as unknown as Order);
    renderAt(`/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till", <TillPage />);
    const more = await screen.findAllByRole("button", { name: "One more Kingfisher Strong" });
    expect(more, "one line, not two").toHaveLength(1);
    expect(screen.getByText("2×")).toBeTruthy();
    fireEvent.click(more[0]!);
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/qty")))
      .toMatchObject({ path: `${API}/till/orders/o-5/lines/b-2/qty`, body: { qty: 2 } }));
  });

  it("on the Till: one more of a dish the kitchen has, asked of the server", async () => {
    const calls = server();
    renderAt(`/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till", <TillPage />);
    const more = await screen.findByRole("button", { name: "One more Veg Thali with Kebab" });
    expect(screen.getByRole("button", { name: "Customise Veg Thali with Kebab" }).textContent,
      "Customise is an icon").toBe("");
    fireEvent.click(more);
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/lines/l-2/qty"))?.body)
      .toEqual({ qty: 2 }));
  });

  it("on the waiter's pad: one more of a sent dish, with its note and add-ons, goes with Send", async () => {
    const calls = server();
    const sent = vi.fn();
    renderAt(`/pos/${HOTEL}/tables`, "/pos/:code/tables", (
      <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-4" tableLabel="Table 4" orderId="o-5"
                open onOpenChange={() => {}} onSent={sent} />
    ));
    await screen.findByText("Already sent");
    fireEvent.click(await screen.findByRole("button", { name: "One more Veg Thali with Kebab" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      orderId: "o-5",
      lines: [{ itemId: "i-7", qty: 1, note: "less spicy", numberedAddons: [{ id: "na-2", qty: 1 }] }],
    });
  });
});
