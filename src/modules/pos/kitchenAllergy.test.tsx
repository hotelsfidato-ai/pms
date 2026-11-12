import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import { KOT_TODAY, type Docket } from "@/modules/pos/data/till";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";
import KitchenPage from "@/modules/pos/pages/Kitchen";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN SCREEN'S COUNT, AND THE GUEST'S ALLERGY (D27-396)

   "1 dish working", never "1 dishes"; a room-service ticket whose
   in-house guest has an allergy says so in red, and the KOT prints it
   boxed whatever its design shows. The server's half is
   api/test/modules/pos/kotAllergy.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const API = `/api/hotels/${HOTEL}`;

beforeEach(() => {
  startSignedIn();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

const line = (id: string, allergy: string | null = null) => ({
  id, orderNo: "20260825-5", table: "Room 204", orderType: "room_service", outlet: "REST",
  name: `Dish ${id}`, qty: 1, note: null, status: "sent", waitedSeconds: 60,
  prepMinutes: null, course: null, cancelled: false, allergy,
});

function kitchen(lines: unknown[]) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url.split("?")[0] === `${API}/kitchen`) return { lines } as never;
    throw new apiModule.ApiError(500, "Request failed (500).");
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/pos/${HOTEL}/kitchen`]}>
        <Routes><Route path="/pos/:code/kitchen" element={<KitchenPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the Kitchen screen's count", () => {
  it("says 1 dish working for one, and dishes for more", async () => {
    kitchen([line("l-1")]);
    expect(await screen.findByText(/^1 dish working/)).toBeTruthy();
  });

  it("says 2 dishes working for two", async () => {
    kitchen([line("l-1"), line("l-2")]);
    expect(await screen.findByText(/^2 dishes working/)).toBeTruthy();
  });
});

describe("the in-house guest's allergy reaches the kitchen", () => {
  it("is on the Kitchen screen's ticket, in red, and only on the ticket that has one", async () => {
    kitchen([line("l-1", "Peanuts"), line("l-2")]);
    const said = await screen.findByText("ALLERGY: Peanuts");
    expect(said.className).toContain("text-brand-red-700");
    expect(document.querySelectorAll("[data-kitchen-allergy]")).toHaveLength(1);
  });

  it("is printed on the KOT, boxed, even with every line of the design switched off", () => {
    const d: Docket = {
      kotNo: 7, orderNo: "20260825-5", table: "Room 204", orderType: "room_service", outlet: "Restaurant",
      hotel: "5 Elements", sentAt: "25/08/26 19:05", allergy: "Peanuts",
      lines: [{ id: "l-1", parentId: null, name: "Veg Thali", qty: 1, note: null, isAddon: false }],
    };
    const off = { ...KOT_TODAY, show: { waiter: false, covers: false, time: false, kind: false, notes: false, orderNo: false } };
    render(<DocketSlip d={d} design={off} />);
    expect(screen.getByText("ALLERGY: Peanuts").hasAttribute("data-kot-allergy")).toBe(true);
  });

  it("is not on a KOT whose guest has none", () => {
    const d: Docket = {
      kotNo: 8, orderNo: "20260825-6", table: "AC4", orderType: "dine_in", outlet: "Restaurant",
      hotel: "5 Elements", sentAt: "25/08/26 19:05",
      lines: [{ id: "l-1", parentId: null, name: "Veg Thali", qty: 1, note: null, isAddon: false }],
    };
    render(<DocketSlip d={d} />);
    expect(document.querySelector("[data-kot-allergy]")).toBeNull();
  });
});
