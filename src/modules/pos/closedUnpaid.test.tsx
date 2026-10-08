import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import FloorPage from "@/modules/pos/pages/Floor";

/* ══════════════════════════════════════════════════════════════════
   A BILL CLOSED UNPAID, ON TABLES (POS-33)

   The owner, 9 October: N2 closed unpaid ("ae") still showed green at
   ₹1,061, and nothing on Tables could clear it for the next guests.
   Their answer: a Clear button, as a paid table has. The tile says
   "Closed unpaid", carries no amount, takes no more rounds, and Clear
   frees it. The server's half is the POS-33 block in
   api/test/modules/pos/till.test.ts.
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

describe("Tables: a bill closed unpaid", () => {
  it("says Closed unpaid with no amount, takes no round, and Clear frees the table", async () => {
    const calls = server({
      [`GET ${API}/till/floor`]: () => ({
        outlet: { code: "REST", name: "Fidato Restaurant", closedUntil: null, closedReason: null },
        sections: [{ id: "s-1", name: "Non A/C", tables: [{
          id: "t-2", label: "N2", seats: 4, row: 0, col: 1, orderId: "o-5", orderNo: "DH-005",
          state: "closed", minutes: 38, payable: null, ready: 0, readyIds: [],
        }] }],
      }),
      [`GET ${API}/till/access`]: () => ({ ok: true }),
      [`POST ${API}/till/orders/o-5/clear`]: () => ({ ok: true, orderNo: "DH-005" }),
    });
    renderAt(`/pos/${HOTEL}/tables`, "/pos/:code/tables", <FloorPage />);

    const round = await screen.findByRole("button", { name: "Add a round to N2" });
    expect(round.textContent).toContain("Closed unpaid");
    expect(round.textContent, "no amount on a bill nobody is collecting").not.toContain("₹");
    expect((round as HTMLButtonElement).disabled, "a finished bill takes no more").toBe(true);
    expect(screen.queryByRole("button", { name: "Print the bill for N2" })).toBeNull();
    expect(screen.getByText("Closed unpaid - clear it"), "the legend names it").toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await vi.waitFor(() => expect(calls.find((c) => c.path.endsWith("/clear")))
      .toMatchObject({ method: "POST", path: `${API}/till/orders/o-5/clear` }));
  });
});
