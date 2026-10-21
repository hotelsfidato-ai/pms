import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import type { DayEnd, Order } from "@/modules/pos/data/till";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import TillPage from "@/modules/pos/pages/Till";
import DayEndPage from "@/modules/pos/pages/DayEnd";

/* ══════════════════════════════════════════════════════════════════
   NC, A BILL GIVEN FREE, ON THE SCREENS (the owner's D27-351)

   The owner, an administrator or the GM gives an open bill NC with a
   reason; nobody else sees the button. It prints at once: the dishes, no
   prices, "NC · No charge", the reason and who approved it. Close
   restaurant day lists it, with no value. The server's half:
   api/test/modules/pos/noCharge.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const API = `/api/hotels/${HOTEL}`;
type Call = { path: string; method: string; body: unknown };

/** Signed in at the demo hotel as `role`. */
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

const open = (over: Partial<Order> = {}): Order => ({
  id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
  hotelName: "5 Elements Akkalkot", hotelCity: null, hotelGstin: null,
  table: "4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
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

const given = (over: Partial<Order> = {}) => open({
  status: "no_charge", ncBy: "Hotel Manager GM", ncAt: "21:05", ncReason: "Owner's guests", ...over,
});

function tillWith(order: () => Order, extra: Record<string, (body: unknown) => unknown> = {}) {
  const calls = server({
    [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
    [`GET ${API}/till/menu`]: () => ({ categories: [] }),
    [`GET ${API}/till/orders/o-5`]: order,
    [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
    [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    ...extra,
  });
  renderAt(`/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till", <TillPage />);
  return calls;
}

describe("the Till - NC, no charge", () => {
  it("the GM gives an open bill NC with a reason, and the NC bill is printed at once", async () => {
    as("gm");
    let now = open();
    const calls = tillWith(() => now, {
      [`POST ${API}/till/orders/o-5/no-charge`]: () => { now = given(); return { ok: true, ...now }; },
      [`POST ${API}/till/orders/o-5/bill-print`]: () => ({ ok: true, heading: "nc", jobId: "j-1",
        sentTo: { name: "BAR PC", online: true } }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "No charge (NC)" }));
    expect(await screen.findByText(/prints the dishes with no prices, marked NC/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Why is it no charge?"), { target: { value: "Owner's guests" } });
    fireEvent.click(screen.getByRole("button", { name: "Give NC" }));

    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/no-charge")))
      .toMatchObject({ method: "POST", body: { reason: "Owner's guests" } }));
    expect(await screen.findByText("NC · No charge - Owner's guests. Approved by Hotel Manager GM at 21:05."))
      .toBeTruthy();
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("/bill-print"))).toBe(true));
    expect(screen.getByText("NC · No charge"), "no value: the total says NC").toBeTruthy();
    expect(screen.queryByRole("button", { name: "No charge (NC)" }), "NC for good").toBeNull();
  });

  it("a waiter, reception or the hotel manager never sees it", async () => {
    for (const role of ["pos", "front_desk", "hotel_manager"] as Role[]) {
      as(role);
      tillWith(() => open());
      await screen.findByRole("button", { name: "Close unpaid" });
      expect(screen.queryByRole("button", { name: "No charge (NC)" }), role).toBeNull();
      document.body.innerHTML = "";
      vi.restoreAllMocks();
    }
  });
});

describe("the Till - a discount is the GM's (D27-352)", () => {
  it("the GM, the owner and an administrator see Discount; a waiter, the bar and the hotel manager do not", async () => {
    for (const [role, sees] of [["gm", true], ["owner", true], ["admin", true],
                                ["pos", false], ["bar", false], ["hotel_manager", false]] as [Role, boolean][]) {
      as(role);
      tillWith(() => open());
      await screen.findByRole("button", { name: "Close unpaid" });
      expect(Boolean(screen.queryByRole("button", { name: "Discount" })), role).toBe(sees);
      document.body.innerHTML = "";
      vi.restoreAllMocks();
    }
  });
});

describe("the printed NC bill", () => {
  it("lists the dishes with no prices, says NC at its head, and why and who approved it", () => {
    const { container } = render(<BillSlip order={given()} heading="nc" />);
    expect(screen.getByText("NC · No charge")).toBeTruthy();
    expect(screen.getByText("Paneer Tikka")).toBeTruthy();
    expect(screen.getByText("NC · No charge - Owner's guests")).toBeTruthy();
    expect(screen.getByText("Approved by Hotel Manager GM at 21:05")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text, "no price, no tax, no total").not.toMatch(/320|640|672|Rate|Amount|GRAND TOTAL|CGST|Paid by/);
  });
});

describe("Close restaurant day - the NC bills", () => {
  it("lists who approved, when and why, with no value", async () => {
    as("gm");
    const day: DayEnd = {
      outlet: { code: "REST", name: "Fidato Restaurant" }, businessDate: "2026-08-25",
      summary: { settledOrders: 0, settledValue: 0, abandonedOrders: 0, abandonedValue: 0,
                 compOrders: 0, discountGiven: 0, byMethod: {} },
      blockers: [], struck: [], voided: [],
      noCharge: [{ orderNo: "20260825-5", table: "4", outlet: "Fidato Restaurant",
                   reason: "Owner's guests", by: "Hotel Manager GM", at: "21:05" }],
      movements: [],
      cash: { opening: 0, expected: 0, counted: null, variance: null, waiting: 0,
              varianceReason: null, denominations: [] },
      opened: true, closedAt: null, closedBy: null,
    };
    server({
      [`GET ${API}/till/day-end`]: () => day,
      [`GET ${API}/till/access`]: () => ({ ok: true }),
    });
    renderAt(`/pos/${HOTEL}/day-end`, "/pos/:code/day-end", <DayEndPage />);

    expect(await screen.findByText("No charge (NC)")).toBeTruthy();
    expect(screen.getByText("20260825-5 · 4 - Owner's guests")).toBeTruthy();
    expect(screen.getByText("Approved by Hotel Manager GM · 21:05")).toBeTruthy();
  });
});
