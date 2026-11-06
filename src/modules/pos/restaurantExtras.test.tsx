import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import type { Order } from "@/modules/pos/data/till";
import type { TableBookingList } from "@/modules/pos/data/tableBookings";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import { DishProfitTab } from "@/modules/pos/components/DishProfitTab";
import TillPage from "@/modules/pos/pages/Till";
import TableBookingsPage from "@/modules/pos/pages/TableBookings";

/* ══════════════════════════════════════════════════════════════════
   THE RESTAURANT'S FOUR, ON THE SCREENS (D27-383 item 9)

   Outside diners booked, arrived and seated; the voluntary service charge
   offered only where a rate is set and put on only with the guest's yes;
   the tip with the payment; a coupon typed from the guest's code; profit
   per dish with a dash, never a zero. The server's half:
   api/test/modules/pos/restaurantExtras.test.ts.
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

const bill = (over: Partial<Order> = {}): Order => ({
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
  serviceChargePct: null, serviceCharge: 0, serviceChargeOffered: 5, tip: null, tipMethod: null,
  ...over,
});

function tillWith(order: () => Order, extra: Record<string, (body: unknown) => unknown> = {}) {
  const calls = server({
    [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
    [`GET ${API}/till/menu`]: () => ({ categories: [] }),
    [`GET ${API}/till/orders/o-5`]: order,
    [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
    [`GET ${API}/till/promotions`]: () => ({ promotions: [
      { id: "p1", code: "HOUSE", name: "House guests", kind: "percent", value: 20, isActive: true, used: 0, coupon: null },
      { id: "p2", code: "DIWALI10", name: "Diwali", kind: "percent", value: 10, isActive: true, used: 0,
        coupon: { from: "2026-08-01", to: "2026-08-31", maxUses: 50, minBill: 500 } },
    ] }),
    ...extra,
  });
  renderAt(`/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till", <TillPage />);
  return calls;
}

describe("the voluntary service charge on the Till (264)", () => {
  it("is offered only where the GM set a rate", async () => {
    as("gm");
    tillWith(() => bill({ serviceChargeOffered: null }));
    await screen.findByRole("button", { name: "Round off" });
    expect(screen.queryByRole("button", { name: /Service charge/ })).toBeNull();
  });

  it("goes on only once the cashier says the guest agreed, and the bill says it is voluntary", async () => {
    as("pos");
    let now = bill();
    const calls = tillWith(() => now, {
      [`POST ${API}/till/orders/o-5/service-charge`]: () => {
        now = bill({ serviceChargePct: 5, serviceCharge: 32, taxable: 672, tax: 33.6, payable: 705.6 });
        return { ok: true, ...now };
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Service charge 5%, if the guest agrees" }));
    expect(await screen.findByText(/Only if the guest agrees to pay it\. By law it is never added by default/)).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "The guest agreed" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toEqual([
      { path: `${API}/till/orders/o-5/service-charge`, method: "POST", body: { on: true, agreed: true } },
    ]));
    expect(await screen.findByText("Service charge 5% (voluntary)")).toBeTruthy();
  });
});

describe("a tip on the Till (264)", () => {
  it("is sent with a cash payment, and the paid bill says it is not part of the bill", async () => {
    as("pos");
    const calls = tillWith(() => bill(), {
      [`POST ${API}/till/orders/o-5/settle`]: () => ({ ok: true, ...bill({ status: "settled", paymentMethod: "cash" }) }),
    });
    fireEvent.change(await screen.findByLabelText("Tip for the staff"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/settle"))?.body)
      .toMatchObject({ method: "cash", tip: 50 }));
  });

  it("prints below the payment, outside the GRAND TOTAL, with the service charge as voluntary", () => {
    render(<BillSlip order={bill({
      status: "settled", paymentMethod: "cash", serviceChargePct: 5, serviceCharge: 32,
      taxable: 672, tax: 33.6, taxes: [{ scheme: "gst", rate: 5, tax: 33.6 }], gross: 705.6, payable: 705.6,
      tip: 50, tipMethod: "cash",
    })} heading="bill" />);
    expect(screen.getByText("Service charge 5% (voluntary)")).toBeTruthy();
    expect(screen.getByText(/Tip for the staff 50\.00 by cash - not part of the bill/)).toBeTruthy();
    expect(screen.getByText("₹705.60")).toBeTruthy();
  });
});

describe("a coupon on the Till (265)", () => {
  it("is typed from the guest's code, never a button, and sent as the promotion's code", async () => {
    as("gm");
    const calls = tillWith(() => bill(), {
      [`POST ${API}/till/orders/o-5/promotion`]: () => ({ ok: true, ...bill({ discount: 64, couponCode: "DIWALI10" }) }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Discount" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("button", { name: /House guests/ });
    expect(within(dialog).queryByRole("button", { name: /Diwali/ })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Coupon code"), { target: { value: "diwali10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply coupon" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/promotion"))?.body).toEqual({ code: "DIWALI10" }));
  });
});

/* ── Table bookings for outside diners (263) ────────────────────────── */

const LIST: TableBookingList = {
  today: "2026-10-02",
  bookings: [
    { id: "x1", at: "2026-10-02T15:00:00Z", date: "2026-10-02", time: "20:30", party: 4, note: "Birthday",
      status: "confirmed", answer: null, table: null, outlet: "Fidato Restaurant", guest: "Rohan Mehta",
      reference: null, room: null, answeredBy: "Ravi", outside: true, phone: "98220 11223",
      section: { id: "s1", name: "Garden" }, arrivedAt: null, order: null },
    { id: "x2", at: "2026-10-02T14:00:00Z", date: "2026-10-02", time: "19:30", party: 2, note: null,
      status: "arrived", answer: null, table: null, outlet: "Fidato Restaurant", guest: "Asha Rao",
      reference: "FH-1", room: "203", answeredBy: "Ravi", arrivedAt: "19:25", order: null },
  ],
  tables: [{ id: "tb1", label: "G1", section: "Garden" }],
  sections: [{ id: "s1", name: "Garden" }],
};

describe("table bookings for outside diners", () => {
  it("books somebody not staying with what the server needs", async () => {
    as("pos");
    const calls = server({
      [`GET ${API}/table-bookings`]: () => LIST,
      [`POST ${API}/table-bookings`]: () => ({ ok: true, id: "x3" }),
    });
    renderAt(`/pos/${HOTEL}/table-bookings`, "/pos/:code/table-bookings", <TableBookingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New booking" }));
    const dialog = await screen.findByRole("dialog");
    const type = (label: RegExp, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    type(/^Name/, "Meera Iyer"); type(/^Phone/, "98765 43210"); type(/^People/, "3");
    type(/^Time/, "21:00"); type(/^Area/, "s1"); type(/^Note/, "Window");
    fireEvent.click(within(dialog).getByRole("button", { name: "Book the table" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Meera Iyer", phone: "98765 43210", party: 3, date: "2026-10-02", time: "21:00",
      tableId: null, sectionId: "s1", note: "Window",
    }));
  });

  it("shows an outside diner by phone, and on the night offers what each booking may do", async () => {
    as("pos");
    const calls = server({
      [`GET ${API}/table-bookings`]: () => LIST,
      [`POST ${API}/table-bookings/x2/seat`]: () => ({ ok: true, orderId: "o-9" }),
    });
    renderAt(`/pos/${HOTEL}/table-bookings`, "/pos/:code/table-bookings", <TableBookingsPage />);
    const outside = (await screen.findByText(/Rohan Mehta · 98220 11223/)).closest("div.space-y-2") as HTMLElement;
    expect(within(outside).getByText(/not staying/)).toBeTruthy();
    expect(within(outside).getByRole("button", { name: "Arrived" })).toBeTruthy();
    expect(within(outside).getByRole("button", { name: "No-show" })).toBeTruthy();
    /* Arrived: seat or cancel - never arrived again, never a no-show. */
    const arrived = screen.getByText(/Asha Rao · room 203/).closest("div.space-y-2") as HTMLElement;
    expect(within(arrived).queryByRole("button", { name: "Arrived" })).toBeNull();
    expect(within(arrived).queryByRole("button", { name: "No-show" })).toBeNull();
    fireEvent.click(within(arrived).getByRole("button", { name: "Seat" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByRole("button", { name: "Seat" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/^Table/), { target: { value: "tb1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Seat" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")).toEqual(
      { path: `${API}/table-bookings/x2/seat`, method: "POST", body: { tableId: "tb1" } }));
  });

  it("offers nothing to somebody who may not ring an order", async () => {
    as("read_only");
    server({ [`GET ${API}/table-bookings`]: () => LIST });
    renderAt(`/pos/${HOTEL}/table-bookings`, "/pos/:code/table-bookings", <TableBookingsPage />);
    await screen.findByText(/Rohan Mehta/);
    expect(screen.queryByRole("button", { name: /New booking|Seat|Arrived|No-show/ })).toBeNull();
  });
});

/* ── Profit per dish ────────────────────────────────────────────────── */

describe("profit per dish", () => {
  it("shows a dish's cost and margin, and a dash with the reason where there is no cost", async () => {
    as("gm");
    server({
      [`GET ${API}/till/dish-profit`]: () => ({
        from: "2026-08-01", to: "2026-08-25",
        dishes: [
          { itemId: "i1", variationId: null, section: "Starters", name: "Paneer Tikka", price: 320, cost: 66,
            margin: 254, marginPct: 79.4, noCost: null },
          { itemId: "i2", variationId: null, section: "Main course", name: "Dal Tadka", price: 260, cost: null,
            margin: null, marginPct: null, noCost: "an ingredient has no cost" },
        ],
        sold: [],
        totals: { sales: 0, costedSales: 0, cost: 0, margin: 0, uncostedSales: 0 },
      }),
    });
    renderAt(`/pos/${HOTEL}/menu`, "/pos/:code/menu", <DishProfitTab hotelId={HOTEL} />);
    /* The table's row (the list also draws a card for a phone). */
    const rowOf = async (name: string) =>
      (await screen.findAllByText(name)).map((e) => e.closest("tr")).find(Boolean) as HTMLElement;
    const row = await rowOf("Dal Tadka");
    expect(within(row).getByText("an ingredient has no cost")).toBeTruthy();
    expect(within(row).queryByText(/₹0/)).toBeNull();
    expect(within(row).getAllByText("-").length).toBeGreaterThanOrEqual(2);
    const tikka = await rowOf("Paneer Tikka");
    expect(within(tikka).getByText("₹66.00")).toBeTruthy();
    expect(within(tikka).getByText("79.4%")).toBeTruthy();
  });
});
