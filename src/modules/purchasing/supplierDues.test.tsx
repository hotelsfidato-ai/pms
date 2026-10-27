import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import PurchasingPage from "@/modules/purchasing/pages/Purchasing";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING · SUPPLIER DUES, ON THE SCREEN (the owner's D27-370)

   The accountant, the GM, the owner and an Admin see the tab: each unpaid
   credit bill under its supplier, the supplier's total and the total owed,
   a bill past its due date in red; Record payment sends how, the reference
   and the date. The Inventory Manager has no such tab, even by its address.
   The server's half: api/test/modules/purchasing/supplierDues.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const paid = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("@/modules/purchasing/data/purchasing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/purchasing/data/purchasing")>()),
  getPurchasing: async () => ({
    me: { mayRaise: false, maySetRequesters: false }, stores: [], suppliers: [], items: [], requests: [] }),
  getSupplierDues: async () => ({
    today: "2026-10-27",
    bills: [
      { id: "s1", supplier: "Akkalkot Traders", billNo: "AT-771", billDate: "2026-09-18", amount: "3100.00",
        dueOn: "2026-10-18", from: { kind: "order", id: "o1", reference: "PO-5EL-2609-0001" } },
      { id: "s2", supplier: "Akkalkot Traders", billNo: "AT-802", billDate: "2026-10-20", amount: "900.50",
        dueOn: "2026-11-19", from: { kind: "order", id: "o2", reference: "PO-5EL-2610-0004" } },
      { id: "s3", supplier: "Bharat Wines", billNo: "B-312", billDate: "2026-10-21", amount: "8000.00",
        dueOn: "2026-11-20", from: { kind: "bar" } },
    ],
  }),
  paySupplierDue: async (_h: string, id: string, input: unknown) => { paid.calls.push({ id, ...(input as object) }); return { ok: true }; },
}));

function as(role: Role) {
  startSignedIn();
  const s = useSession.getState();
  useSession.setState({ scope: { ...s.scope!, hotels: [{ hotelId: AGRA_HOTEL, role }] } });
  withDemoHotel();
}

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/h/${HOTEL}/purchasing?tab=dues`]}>
        <Routes><Route path="/h/:code/purchasing" element={<PurchasingPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { paid.calls = []; vi.stubGlobal("fetch", () => new Promise(() => {})); });
afterEach(() => {
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

describe("Purchasing · Supplier dues (D27-370)", () => {
  it("the accountant sees each supplier's bills and totals, overdue in red, and records a payment", async () => {
    as("finance");
    open();
    expect((await screen.findByText(/Owed to suppliers/)).closest("[data-dues-total]")!.textContent)
      .toBe("Owed to suppliers: ₹12,000.50 · 3 bills");
    expect([...document.querySelectorAll("[data-supplier-total]")].map((e) => e.textContent))
      .toEqual(["₹4,000.50", "₹8,000.00"]);
    const late = document.querySelector("[data-bill='AT-771'] [data-overdue]")!;
    expect(late.textContent).toBe("18 Oct 2026 · overdue");
    expect(late.className).toContain("text-brand-red-700");
    expect(document.querySelector("[data-bill='AT-802'] [data-overdue]")).toBeNull();

    const row = document.querySelector("[data-bill='AT-771']") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Record payment" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark paid" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("How was it paid? Cash, cheque, bank or UPI.");
    fireEvent.change(within(dialog).getByLabelText("How"), { target: { value: "cheque" } });
    fireEvent.change(within(dialog).getByLabelText(/Reference/), { target: { value: "CHQ 004512" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark paid" }));
    await vi.waitFor(() => expect(paid.calls).toEqual([
      { id: "s1", method: "cheque", reference: "CHQ 004512", paidOn: "2026-10-27" }]));
  });

  it("the Inventory Manager has no Supplier dues tab, even by its address", async () => {
    as("stores");
    open();
    await screen.findByText("Nothing has been asked for yet");
    expect(screen.queryByRole("tab", { name: "Supplier dues" })).toBeNull();
    expect(screen.queryByText(/Owed to suppliers/)).toBeNull();
  });
});
