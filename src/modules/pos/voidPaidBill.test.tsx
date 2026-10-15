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
   A PAID BILL VOIDED, ON THE SCREENS (the owner's D27-324 (1))

   The owner, an administrator or the GM voids a paid restaurant bill
   with a reason; nobody else sees the button. A bill charged to a room
   shows the button switched off with the sentence. Card or UPI asks the
   refund's reference next. The bill prints VOID, and Close restaurant
   day lists it. The server's half: api/test/modules/pos/voidPaidBill.test.ts.
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

const paid = (over: Partial<Order> = {}): Order => ({
  id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
  hotelName: "5 Elements Akkalkot", hotelCity: null, hotelGstin: null,
  table: "4", status: "settled", businessDate: "2026-08-25", paymentMethod: "cash",
  openedBy: "Owner", settledBy: "Owner", settledAt: "25 Aug, 20:10", abandonedReason: null,
  ticketId: null, eventId: null, eventTitle: null,
  lines: [{
    id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5,
    note: null, voided: false, kotStatus: "sent", addedBy: "Owner",
    parentLineId: null, isAddon: false, variationId: null,
  }],
  net: 320, discount: 0, discountType: null, discountValue: null,
  discountReason: null, promotionId: null, promotionName: null,
  taxable: 320, tax: 16, taxes: [{ scheme: "gst", rate: 5, tax: 16 }], gross: 336, roundOff: 0, payable: 336,
  tenders: [{ id: "t-1", method: "cash", amount: 336, tendered: null, change: null,
              reference: null, takenBy: "Owner" }],
  covers: null, waiter: null, orderType: "dine_in", customerName: null,
  customerPhone: null, customerAddress: null, customerLocality: null, heldAt: null,
  ...over,
});

const voided = (over: Partial<Order> = {}) => paid({
  status: "void", voidedBy: "Hotel Manager GM", voidedAt: "20:31",
  voidReason: "Billed to the wrong table", voidReference: null, ...over,
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

describe("the Till - voiding a paid bill", () => {
  it("the GM voids a cash bill with a reason: told the cash goes back out of the restaurant's tin", async () => {
    as("gm");
    let now = paid();
    const calls = tillWith(() => now, {
      [`POST ${API}/till/orders/o-5/void`]: () => { now = voided(); return { ok: true, ...now }; },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Void this paid bill" }));
    expect(await screen.findByText(/₹336\.00 in cash goes back to the guest out of the restaurant's tin/))
      .toBeTruthy();
    expect(screen.getByText(/The kitchen's KOTs stay as they are/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Why is it being voided?"),
      { target: { value: "Billed to the wrong table" } });
    fireEvent.click(screen.getByRole("button", { name: "Void the bill" }));

    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/void")))
      .toMatchObject({ method: "POST", body: { reason: "Billed to the wrong table" } }));
    expect(await screen.findByText(/VOID - Billed to the wrong table\. Voided by Hotel Manager GM at 20:31\./))
      .toBeTruthy();
    expect(screen.queryByRole("button", { name: "Void this paid bill" }), "void for good").toBeNull();
  });

  it("a UPI bill asks the refund's reference next, and sends both", async () => {
    as("owner");
    const calls = tillWith(() => paid({ paymentMethod: "upi", tenders: [
      { id: "t-1", method: "upi", amount: 336, tendered: null, change: null, reference: null, takenBy: "Owner" },
    ] }), {
      [`POST ${API}/till/orders/o-5/void`]: () => ({ ok: true, ...voided({ voidReference: "UPI 77" }) }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Void this paid bill" }));
    fireEvent.change(await screen.findByLabelText("Why is it being voided?"),
      { target: { value: "Paid twice" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const reference = await screen.findByLabelText(/The refund's reference/) as HTMLTextAreaElement;
    expect(reference.value, "the reason must not stand as the reference").toBe("");
    expect((screen.getByRole("button", { name: "Void the bill" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reference, { target: { value: "UPI 77" } });
    fireEvent.click(screen.getByRole("button", { name: "Void the bill" }));
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/void")))
      .toMatchObject({ body: { reason: "Paid twice", reference: "UPI 77" } }));
  });

  it("a bill charged to a room: the button is off, and says where to reverse it", async () => {
    as("gm");
    tillWith(() => paid({ paymentMethod: "room", room: "201", tenders: [] }));
    const button = await screen.findByRole("button", { name: "Void this paid bill" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This bill went to room 201 - reverse it on the guest's bill.")).toBeTruthy();
  });

  it("a waiter, reception or the hotel manager never sees it", async () => {
    for (const role of ["pos", "front_desk", "hotel_manager"] as Role[]) {
      as(role);
      tillWith(() => paid());
      await screen.findByRole("button", { name: "Print the bill" });
      expect(screen.queryByRole("button", { name: "Void this paid bill" }), role).toBeNull();
      document.body.innerHTML = "";
      vi.restoreAllMocks();
    }
  });
});

describe("the printed bill of a voided bill", () => {
  it("says VOID at its head and why, who and when", () => {
    render(<BillSlip order={voided()} heading="void" />);
    expect(screen.getByText("Bill · VOID")).toBeTruthy();
    expect(screen.getByText("VOID - Billed to the wrong table")).toBeTruthy();
    expect(screen.getByText(/Voided by Hotel Manager GM at 20:31/)).toBeTruthy();
    expect(screen.queryByText(/^Paid by/)).toBeNull();
  });
});

describe("Close restaurant day - the voided bills", () => {
  it("lists who, when, why and how much; their cash went back out of the tin", async () => {
    as("gm");
    const day: DayEnd = {
      outlet: { code: "REST", name: "Fidato Restaurant" }, businessDate: "2026-08-25",
      summary: { settledOrders: 1, settledValue: 500, abandonedOrders: 0, abandonedValue: 0,
                 compOrders: 0, discountGiven: 0, byMethod: { cash: 500 } },
      blockers: [], struck: [],
      voided: [{ orderNo: "20260825-5", table: "4", outlet: "Fidato Restaurant", amount: 336,
                 method: "cash", cash: 336, reason: "Billed to the wrong table", reference: null,
                 by: "Hotel Manager GM", at: "20:31" }],
      movements: [],
      cash: { opening: 0, expected: 836, counted: null, variance: null, waiting: 0,
              varianceReason: null, denominations: [] },
      opened: true, closedAt: null, closedBy: null,
    };
    server({
      [`GET ${API}/till/day-end`]: () => day,
      [`GET ${API}/till/access`]: () => ({ ok: true }),
    });
    renderAt(`/pos/${HOTEL}/day-end`, "/pos/:code/day-end", <DayEndPage />);

    expect(await screen.findByText("Paid bills voided")).toBeTruthy();
    expect(screen.getByText("20260825-5 · 4 - Billed to the wrong table")).toBeTruthy();
    expect(screen.getByText(/Hotel Manager GM · 20:31 · Cash/)).toBeTruthy();
    expect(screen.getByText(/Their cash went back to the guest out of this tin/)).toBeTruthy();
  });
});
