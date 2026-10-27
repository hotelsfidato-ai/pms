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

   The Bar tab lists the bar's bills as printed; the owner, an
   administrator, the GM, the Inventory Manager and the bar manager see
   Record a bar bill, nobody else does. A bill is typed as printed: cases and
   loose bottles at a rate per case, handling, TCS and the printed total,
   which the screen checks against the lines; what is sent is what was
   typed. The server's half: api/test/modules/purchasing/barBills.test.ts.
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
    drinks: [{ id: "d-blue", name: "Imperial Blue 180 ml", unit: "bottle", sizeMl: 180, onHand: 6, perCase: 48 }],
  }),
  barBills: async () => [{
    id: "b-1", supplier: "Amit Traders", billNo: "A-1020", billDate: "2026-10-20", tpNo: "TP 88123",
    handling: 120, tcs: 95.5, total: 10215.5,
    recordedBy: "Store Keeper", recordedAt: "20 Oct, 18:05", photoId: null,
    credit: { dueOn: "2026-11-04", paidOn: null },
    lines: [{ item: "Imperial Blue 180 ml", unit: "bottle", sizeMl: 180, mrp: 190, perCase: 48, cases: 1,
              bottles: 12, ratePerCase: 8000, amount: 10000 }],
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
  it("the Inventory Manager sees the bills as printed and records one: the lines, handling and TCS checked against the total", async () => {
    as("stores");
    open();
    expect(await screen.findByText("Amit Traders · Bill A-1020")).toBeTruthy();
    expect(screen.getByText("Imperial Blue 180 ml · MRP ₹190.00")).toBeTruthy();
    expect(screen.getByText("₹10,215.50")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Record a bar bill" }));
    await screen.findByText("The drinks on the bill");
    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(field("Supplier"), { target: { value: "Bharat Wines" } });
    fireEvent.change(field("Bill number"), { target: { value: "B-311" } });
    fireEvent.change(field("Bill date"), { target: { value: "2026-10-21" } });
    fireEvent.change(field("T.P. number"), { target: { value: "TP 9001" } });
    /* A known drink: its bottles to a case come from its last bill. */
    fireEvent.change(screen.getByLabelText("Drink on line 1"), { target: { value: "d-blue" } });
    expect(field("Bottles to a case on line 1").value).toBe("48");
    fireEvent.change(field("Loose bottles on line 1"), { target: { value: "24" } });
    fireEvent.change(field("Rate per case on line 1"), { target: { value: "8000" } });
    /* Another drink, in cases. */
    fireEvent.click(screen.getByRole("button", { name: "Add a drink" }));
    fireEvent.change(screen.getByLabelText("Drink on line 2"), { target: { value: "new" } });
    fireEvent.change(field("New drink's name on line 2"), { target: { value: "Tuborg Strong 650 ml" } });
    fireEvent.change(field("Size in ml on line 2"), { target: { value: "650" } });
    fireEvent.change(field("Bottles to a case on line 2"), { target: { value: "12" } });
    fireEvent.change(field("Cases on line 2"), { target: { value: "2" } });
    fireEvent.change(field("MRP on line 2"), { target: { value: "160" } });
    fireEvent.change(field("Rate per case on line 2"), { target: { value: "1850" } });
    fireEvent.change(field("Handling charges, ₹"), { target: { value: "120" } });
    fireEvent.change(field("TCS, ₹"), { target: { value: "77.20" } });
    /* 4,000 + 3,700 + 120 + 77.20 = 7,897.20; the bill says 7,997.20. */
    fireEvent.change(field("Total, as printed, ₹"), { target: { value: "7997.20" } });
    const check = document.querySelector("[data-bill-check]")!;
    expect(check.textContent).toBe("The lines, handling and TCS make ₹7,897.20 · ₹100.00 less than the bill");
    fireEvent.change(field("Total, as printed, ₹"), { target: { value: "7897.20" } });
    expect(check.textContent).toBe("The lines, handling and TCS make ₹7,897.20 · matches the bill");
    fireEvent.click(screen.getByRole("button", { name: "Save the bill" }));

    await vi.waitFor(() => expect(sent.bills).toEqual([{
      supplier: "Bharat Wines", billNo: "B-311", billDate: "2026-10-21", tpNo: "TP 9001",
      handling: 120, tcs: 77.2, total: 7897.2,
      lines: [
        { itemId: "d-blue", perCase: 48, cases: 0, bottles: 24, ratePerCase: 8000, mrp: null },
        { newDrink: { name: "Tuborg Strong 650 ml", unit: "bottle", sizeMl: 650 },
          perCase: 12, cases: 2, bottles: 0, ratePerCase: 1850, mrp: 160 },
      ],
    }]));
  });

  it("a bar bill on credit carries its due date, and the list says it is not paid yet (D27-370)", async () => {
    as("stores");
    open();
    await screen.findByText("Amit Traders · Bill A-1020");
    expect(document.querySelector("[data-credit]")!.textContent).toBe("On credit, due 4 Nov 2026 - not paid yet");
    fireEvent.click(screen.getByRole("button", { name: "Record a bar bill" }));
    await screen.findByText("The drinks on the bill");
    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(field("Supplier"), { target: { value: "Bharat Wines" } });
    fireEvent.change(field("Bill number"), { target: { value: "B-312" } });
    fireEvent.change(field("Bill date"), { target: { value: "2026-10-21" } });
    fireEvent.change(screen.getByLabelText("Drink on line 1"), { target: { value: "d-blue" } });
    fireEvent.change(field("Cases on line 1"), { target: { value: "1" } });
    fireEvent.change(field("Rate per case on line 1"), { target: { value: "8000" } });
    fireEvent.change(field("Total, as printed, ₹"), { target: { value: "8000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /On credit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save the bill" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Pick the date the bill is due.");
    fireEvent.change(field("Due on"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the bill" }));
    await vi.waitFor(() => expect(sent.bills).toHaveLength(1));
    expect(sent.bills[0]).toMatchObject({ billNo: "B-312", total: 8000, dueOn: "2026-11-20" });
  });

  it("housekeeping and the hotel manager read the bills and do not see Record a bar bill", async () => {
    for (const role of ["housekeeping", "hotel_manager"] as Role[]) {
      as(role);
      open();
      await screen.findByText("Amit Traders · Bill A-1020");
      expect(screen.queryByRole("button", { name: "Record a bar bill" }), role).toBeNull();
      document.body.innerHTML = "";
    }
  });
});
