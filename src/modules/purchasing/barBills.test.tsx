import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import PurchasingPage from "@/modules/purchasing/pages/Purchasing";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING · BAR, ON THE SCREEN (the owner's D27-354)

   The Bar tab lists the bar's bills with their drinks; the owner, an
   administrator, the GM and the Inventory Manager see Record a bar bill,
   nobody else does. A drink the bar lacks is added on the bill, with its
   size; what is sent is what was typed. The server's half:
   api/test/modules/purchasing/barBills.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const sent = vi.hoisted(() => ({ bills: [] as unknown[] }));

vi.mock("@/modules/purchasing/data/purchasing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/purchasing/data/purchasing")>()),
  getPurchasing: async () => ({
    me: { mayRaise: false, maySetRequesters: false }, stores: [], suppliers: [], items: [], requests: [] }),
}));

vi.mock("@/modules/purchasing/data/barBills", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/purchasing/data/barBills")>()),
  barDrinks: async () => ({
    store: { id: "bar", name: "Bar store", isActive: true },
    drinks: [{ id: "d-blue", name: "Imperial Blue 750 ml", unit: "bottle", sizeMl: 750, onHand: 6 }],
  }),
  barBills: async () => [{
    id: "b-1", supplier: "Shah Wines", billNo: "W-1020", billDate: "2026-10-20",
    recordedBy: "Store Keeper", recordedAt: "20 Oct, 18:05", photoId: null,
    lines: [{ item: "Imperial Blue 750 ml", unit: "bottle", sizeMl: 750, quantity: 6, unitCost: 520 }],
  }],
  recordBarBill: async (_hotel: string, bill: unknown) => { sent.bills.push(bill); return { ok: true, id: "b-2" }; },
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
      <MemoryRouter initialEntries={[`/h/${HOTEL}/purchasing?tab=bar`]}>
        <Routes><Route path="/h/:code/purchasing" element={<PurchasingPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { sent.bills = []; vi.stubGlobal("fetch", () => new Promise(() => {})); });
afterEach(() => {
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

describe("Purchasing · Bar (D27-354)", () => {
  it("the Inventory Manager sees the bar's bills and records one, adding a drink with its size", async () => {
    as("stores");
    open();
    expect(await screen.findByText("Shah Wines · Bill W-1020")).toBeTruthy();
    expect(screen.getByText("Imperial Blue 750 ml")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Record a bar bill" }));
    await screen.findByText("The drinks on the bill");
    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(field("Supplier"), { target: { value: "Shah Wines" } });
    fireEvent.change(field("Bill number"), { target: { value: "W-1021" } });
    fireEvent.change(field("Bill date"), { target: { value: "2026-10-21" } });
    fireEvent.change(screen.getByLabelText("Drink on line 1"), { target: { value: "new" } });
    fireEvent.change(field("New drink's name on line 1"), { target: { value: "Kingfisher Strong 650 ml" } });
    fireEvent.change(field("Size in ml on line 1"), { target: { value: "650" } });
    fireEvent.change(field("How many on line 1"), { target: { value: "24" } });
    fireEvent.change(field("Cost of each on line 1"), { target: { value: "140" } });
    expect(screen.getByText("Total ₹3,360")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save the bill" }));

    await vi.waitFor(() => expect(sent.bills).toEqual([{
      supplier: "Shah Wines", billNo: "W-1021", billDate: "2026-10-21",
      lines: [{ newDrink: { name: "Kingfisher Strong 650 ml", unit: "bottle", sizeMl: 650 }, bottles: 24, costPerBottle: 140 }],
    }]));
  });

  it("housekeeping and the hotel manager read the bills and do not see Record a bar bill", async () => {
    for (const role of ["housekeeping", "hotel_manager"] as Role[]) {
      as(role);
      open();
      await screen.findByText("Shah Wines · Bill W-1020");
      expect(screen.queryByRole("button", { name: "Record a bar bill" }), role).toBeNull();
      document.body.innerHTML = "";
    }
  });
});
