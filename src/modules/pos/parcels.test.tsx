import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import { HOTEL, startSignedIn } from "@/test/app";
import FloorPage from "@/modules/pos/pages/Floor";

/* ══════════════════════════════════════════════════════════════════
   PARCELS ON THE SCREEN (the owner's D27-359)

   Tables has New parcel - the customer's name is asked, a phone may be -
   and a Parcels section with each open parcel by its customer. The
   server's half: api/test/modules/pos/parcels.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const sent = vi.hoisted(() => ({ parcels: [] as unknown[] }));

vi.mock("@/modules/pos/data/till", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/pos/data/till")>()),
  getFloor: async () => ({
    outlet: { code: "REST", name: "Peshwa", closedUntil: null, closedReason: null },
    sections: [{ id: "s1", name: "A/C", tables: [{ id: "t1", label: "1", seats: 4, row: 0, col: 0,
      orderId: null, orderNo: null, state: "blank", minutes: null, payable: null }] }],
    parcels: [{ orderId: "o-1", orderNo: "20261022-4", name: "Rahul", phone: null, minutes: 12,
      payable: 777, ready: 0, readyIds: [] }],
  }),
  openParcel: async (_hotel: string, outlet: string, name: string, phone: string) => {
    sent.parcels.push({ outlet, name, phone });
    return { ok: true, order: { id: "o-2", orderNo: "20261022-5", table: `Parcel · ${name}`, lines: [] } };
  },
}));

beforeEach(() => { sent.parcels = []; startSignedIn(); vi.stubGlobal("fetch", () => new Promise(() => {})); });
afterEach(() => { vi.unstubAllGlobals(); try { localStorage.clear(); } catch { /* jsdom without storage */ } });

function tables() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/pos/${HOTEL}/tables`]}>
        <Routes><Route path="/pos/:code/tables" element={<FloorPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("parcels on Tables (D27-359)", () => {
  it("lists each open parcel by its customer, with how long and how much", async () => {
    tables();
    const section = (await screen.findByText("Parcels")).closest("section")!;
    expect(within(section).getByText("Rahul")).toBeTruthy();
    expect(within(section).getByText("12 min")).toBeTruthy();
    expect(within(section).getByText("₹777")).toBeTruthy();
  });

  it("New parcel asks the customer's name, then opens it with the phone", async () => {
    tables();
    fireEvent.click(await screen.findByRole("button", { name: "New parcel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open the parcel" }));
    expect(await screen.findByText("Whose parcel is it? Type the customer's name.")).toBeTruthy();
    expect(sent.parcels).toEqual([]);
    fireEvent.change(screen.getByLabelText("Customer's name"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Open the parcel" }));
    await vi.waitFor(() => expect(sent.parcels).toEqual([{ outlet: "REST", name: "Asha", phone: "9876543210" }]));
  });
});
