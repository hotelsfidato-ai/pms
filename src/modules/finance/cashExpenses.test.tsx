import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import CashieringPage from "./pages/Cashiering";

/* ══════════════════════════════════════════════════════════════════
   A PAID-OUT WAITS FOR A YES - the owner's D27-242

   The drawer had ₹1,000; ₹200 was paid out for a taxi and waits for the
   GM's or the owner's yes, so Expected stays ₹1,000. Counted ₹800: the
   ₹200 short is the waiting paid-out, so the close asks no reason.
   ══════════════════════════════════════════════════════════════════ */

const DRAWER = {
  businessDate: "2026-08-25", waiting: 0, colleagues: [], previous: null,
  shift: {
    id: "s1", openedAt: "2026-08-25T09:00:00Z", opening: 0, receipts: [],
    movements: [
      { id: "m1", kind: "top_up", amount: 1000, reason: "Change from the safe", recordedBy: "Test Reception", at: "09:05", approval: null },
      { id: "m2", kind: "expense", amount: 200, reason: "Taxi", recordedBy: "Test Reception", at: "10:00", approval: "pending" },
    ],
    expected: 1000, counted: 800, variance: -200, waiting: 200, varianceReason: null,
    denominations: [{ value: 500, count: 1 }, { value: 100, count: 3 }],
  },
};

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Cashiering: a paid-out waiting for a yes (D27-242)", () => {
  it("is not taken off the drawer, and explains the shortage at the close", async () => {
    vi.spyOn(apiModule, "api").mockResolvedValue(DRAWER as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/h/5EL/cashiering"]}>
          <Routes><Route path="/h/:code/cashiering" element={<CashieringPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Waiting for a yes - not taken off the drawer yet")).toBeTruthy();
    expect(screen.getByText("Paid out, waiting for a yes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Close and hand over/ }));
    expect((await screen.findAllByText(/of it is paid out and waiting for a yes/)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Why")).toBeNull();
  });
});
