import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { toast } from "@/components/ui";
import { HOTEL, startSignedIn } from "@/test/app";
import type { Order } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import TillPage from "@/modules/pos/pages/Till";
import TerminalPage from "@/modules/pos/pages/Terminal";

/* ══════════════════════════════════════════════════════════════════
   REPRINT AT THE STATION, FROM THE PAD, THE TILL AND THE TERMINAL
   (the owner's D27-329 (2) and (5))

   Reprint asks the server, which queues the slip for the computer that
   prints that KOT's kind; nothing prints on this device. The screen says
   where it went, says plainly when that computer is offline (it prints
   when it is back), and gives the server's sentence when there is none.
   The Till and the Terminal list an open order's KOTs with Reprint, as
   the order pad does. The station's half is KotStation.test.tsx; the
   server's, api/test/modules/pos/kotReprint.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const API = `/api/hotels/${HOTEL}`;
type Call = { key: string; body: unknown };

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
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const answer = routes[key];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer(body) as never;
  });
  return calls;
}

function show(element: ReactElement, path: string, route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const line = (id: string, name: string, kotNo: number | null, kind: string | null) => ({
  id, name, qty: 1, unitPrice: 300, taxRate: 5, note: null, voided: false,
  kotStatus: kotNo === null ? "pending" : "sent", addedBy: "Ravi", parentLineId: null,
  isAddon: false, variationId: null, numberedAddons: null, extra: null, kotNo,
  kotKind: kind ? { id: `k-${kind.toLowerCase()}`, name: kind } : null,
});
const ORDER = {
  id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Restaurant", hotelName: "5 Elements",
  hotelCity: null, hotelGstin: null, hotelFssai: null, table: "T4", status: "open",
  businessDate: "2026-08-25", paymentMethod: null, openedBy: "Ravi", settledBy: null,
  eventId: null, eventTitle: null, tenders: [], abandonedReason: null, discount: 0, roundOff: 0,
  net: 900, taxable: 900, tax: 45, gross: 945, payable: 945, billsPrinted: 0,
  lines: [line("l-1", "Kingfisher 650", 3, "Bar"), line("l-2", "Paneer Tikka", 3, "Kitchen"),
          line("l-3", "Dal Tadka", null, null)],
} as unknown as Order;
const SENT = (online: boolean) => () =>
  ({ ok: true, station: { name: "Bar PC", online, seenAt: "2026-08-25T13:35:00.000Z" } });

function pad(reprint: (body: unknown) => unknown) {
  const calls = server({
    [`GET ${API}/till/menu`]: () => ({ categories: [] }),
    [`GET ${API}/till/numbered-addons`]: () => ({ addons: [] }),
    [`GET ${API}/till/orders/o-5`]: () => ORDER,
    [`POST ${API}/till/orders/o-5/kot/3/reprint`]: reprint,
  });
  show(
    <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-4" tableLabel="Table 4" orderId="o-5"
              open onOpenChange={() => {}} onSent={() => {}} />,
    `/pos/${HOTEL}/tables`, "/pos/:code/tables");
  return calls;
}

describe("Reprint goes to the station (D27-329 (2))", () => {
  it("asks for that KOT's kind, prints nothing here, and says where it went", async () => {
    const said = vi.spyOn(toast, "success");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const calls = pad(SENT(true));
    const list = await screen.findByRole("list", { name: "KOTs sent" });
    fireEvent.click(within(list).getByRole("button", { name: "Reprint KOT 3 · Bar" }));
    await vi.waitFor(() => expect(said).toHaveBeenCalledWith(
      "KOT 3 · Bar sent to Bar PC", "It prints there, marked REPRINT."));
    expect(calls.find((c) => c.key === `POST ${API}/till/orders/o-5/kot/3/reprint`)?.body)
      .toEqual({ kind: "k-bar" });
    expect(print).not.toHaveBeenCalled();
  });

  it("says plainly when that computer is offline: the reprint waits there", async () => {
    const warned = vi.spyOn(toast, "error");
    pad(SENT(false));
    fireEvent.click(await screen.findByRole("button", { name: "Reprint KOT 3 · Bar" }));
    await vi.waitFor(() => expect(warned).toHaveBeenCalledWith(
      "Bar PC is offline",
      expect.stringMatching(/^KOT 3 · Bar waits there and prints when it is back\. Not seen since /)));
  });

  it("gives the server's sentence when no computer prints that KOT", async () => {
    const warned = vi.spyOn(toast, "error");
    const reason = "No computer prints Bar KOTs, so the reprint has nowhere to print. Choose one in Restaurant setup - KOT section.";
    pad(() => { throw new ApiError(409, reason, { ok: false, reason }); });
    fireEvent.click(await screen.findByRole("button", { name: "Reprint KOT 3 · Bar" }));
    await vi.waitFor(() => expect(warned).toHaveBeenCalledWith("Not reprinted", reason));
  });
});

describe("Reprint on the Till and the Terminal (D27-329 (5))", () => {
  it("the Till lists an open order's KOTs, each with Reprint, sent to the station", async () => {
    const said = vi.spyOn(toast, "success");
    const calls = server({
      [`GET ${API}/till/menu`]: () => ({ categories: [] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [] }),
      [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
      [`GET ${API}/till/orders/o-5`]: () => ORDER,
      [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
      [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
      [`POST ${API}/till/orders/o-5/kot/3/reprint`]: SENT(true),
    });
    show(<TillPage />, `/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till");
    const list = await screen.findByRole("list", { name: "KOTs sent" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent?.replace("Reprint", "").trim()))
      .toEqual(["KOT 3 · Bar", "KOT 3 · Kitchen"]);
    fireEvent.click(within(list).getByRole("button", { name: "Reprint KOT 3 · Kitchen" }));
    await vi.waitFor(() => expect(calls.find((c) => c.key.endsWith("/kot/3/reprint"))?.body)
      .toEqual({ kind: "k-kitchen" }));
    await vi.waitFor(() => expect(said).toHaveBeenCalled());
  });

  it("the Terminal the same, for the open order", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    const calls = server({
      [`GET ${API}/pos/outlets`]: () => [{ code: "REST", name: "Fidato Restaurant",
        category: "food", hasKey: false, isActive: true, bills: 0 }],
      [`GET ${API}/till/menu`]: () => ({ categories: [] }),
      [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [{
        id: "o-5", orderNo: "20260825-5", outlet: "REST", table: "T4", status: "open",
        businessDate: "2026-08-25", gross: 945, paymentMethod: null,
        openedAt: "2026-08-25T19:00", lines: 3 }] }),
      [`GET ${API}/till/orders/o-5`]: () => ORDER,
      [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
      [`POST ${API}/till/orders/o-5/kot/3/reprint`]: SENT(true),
    });
    show(<TerminalPage />, `/pos/${HOTEL}/terminal`, "/pos/:code/terminal");
    fireEvent.click(await screen.findByRole("button", { name: /20260825-5/ }));
    const list = await screen.findByRole("list", { name: "KOTs sent" });
    fireEvent.click(within(list).getByRole("button", { name: "Reprint KOT 3 · Bar" }));
    await vi.waitFor(() => expect(calls.find((c) => c.key.endsWith("/kot/3/reprint"))?.body)
      .toEqual({ kind: "k-bar" }));
  });

  it("not for a settled order: its KOTs are the kitchen's past", async () => {
    server({
      [`GET ${API}/till/menu`]: () => ({ categories: [] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [] }),
      [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
      [`GET ${API}/till/orders/o-5`]: () => ({ ...ORDER, status: "settled", paymentMethod: "upi" }),
      [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
      [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    });
    show(<TillPage />, `/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till");
    await screen.findByRole("button", { name: /Print the bill/ });
    expect(screen.queryByRole("list", { name: "KOTs sent" })).toBeNull();
  });
});
