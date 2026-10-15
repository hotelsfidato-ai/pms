import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { HOTEL, TEST_HOTEL, startSignedIn, withDemoHotel, withTestHotel } from "@/test/app";
import { TEST_DOCUMENT, TEST_STRIPE } from "@/lib/testHotel";
import type { Docket, Order } from "@/modules/pos/data/till";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";
import KitchenPage from "@/modules/pos/pages/Kitchen";
import TerminalPage from "@/modules/pos/pages/Terminal";

/* ══════════════════════════════════════════════════════════════════
   THE RESTAURANT IN A TEST HOTEL (the owner's D27-296 (8), (9))

   The Kitchen's wall screen and the Terminal cover the shell, so each
   carries the orange stripe itself. The bill and the KOT print in a test
   hotel with TEST · NOT VALID large on the paper and no GSTIN; a real
   hotel's paper is exactly what it was (the snapshots were taken from the
   code before test hotels existed).
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

beforeEach(() => {
  startSignedIn();
  withDemoHotel();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

const order = {
  id: "o-1", orderNo: "20260825-12", outlet: "REST", outletName: "Fidato Restaurant",
  hotelName: "5 Elements Akkalkot", hotelCity: "Akkalkot", hotelGstin: "27ABCDE1234F1Z5",
  hotelFssai: "12345678901234", table: "T1", status: "settled", businessDate: "2026-08-25",
  paymentMethod: "cash", openedBy: "Asha", settledBy: "Ravi", eventTitle: null,
  net: 1000, discount: 0, taxes: [{ scheme: "gst", rate: 5, tax: 50 }], gross: 1050, roundOff: 0, payable: 1050,
  lines: [{ id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 1000, taxRate: 5, taxScheme: "gst",
    note: null, voided: false, kotStatus: "served", addedBy: "Asha", parentLineId: null,
    isAddon: false, variationId: null }],
} as unknown as Order;

const docket: Docket = {
  kotNo: 3, orderNo: "20260825-12", table: "T1", orderType: "dine_in", outlet: "Fidato Restaurant",
  hotel: "5 Elements Akkalkot", sentAt: "25/08/26 19:05",
  lines: [{ id: "1", parentId: null, name: "Paneer Tikka", qty: 1, note: null, isAddon: false }],
};

describe("a real hotel's restaurant paper is unchanged", () => {
  it("the bill, byte for byte", async () => {
    const { container } = render(<BillSlip order={order} heading="bill" />);
    await expect(container.innerHTML).toMatchFileSnapshot("./__snapshots__/testHotel.real-bill.html");
    expect(container.textContent).toContain("GSTIN 27ABCDE1234F1Z5");
    expect(container.textContent).not.toContain(TEST_DOCUMENT);
  });

  it("the KOT, byte for byte", async () => {
    const { container } = render(<DocketSlip d={docket} />);
    await expect(container.innerHTML).toMatchFileSnapshot("./__snapshots__/testHotel.real-kot.html");
    expect(container.textContent).not.toContain(TEST_DOCUMENT);
  });
});

describe("a test hotel's restaurant paper", () => {
  beforeEach(() => withTestHotel());

  it.each(["interim", "bill", "duplicate"] as const)(
    "the %s bill says TEST · NOT VALID large, and carries no GSTIN", (heading) => {
      const { container } = render(<BillSlip order={order} heading={heading} />);
      const marks = container.querySelectorAll("[data-test-document]");
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0]!.textContent).toBe(TEST_DOCUMENT);
      expect(container.textContent).not.toContain("GSTIN");
      expect(container.textContent).not.toContain("27ABCDE1234F1Z5");
    });

  it("the KOT says TEST · NOT VALID large", () => {
    const { container } = render(<DocketSlip d={docket} />);
    expect(container.querySelector("[data-test-document]")?.textContent).toBe(TEST_DOCUMENT);
    /* Still the kitchen's paper: the dish and the number are there. */
    expect(screen.getByText("Paneer Tikka")).toBeTruthy();
    expect(screen.getByText("KOT - 3")).toBeTruthy();
  });
});

/* ── The full-screen pages ────────────────────────────────────────── */

function renderAt(path: string, route: string, element: ReactElement) {
  vi.spyOn(apiModule, "api").mockImplementation(async () => {
    throw new ApiError(500, "Request failed (500).");
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the stripe on the restaurant's full-screen pages", () => {
  it("is across the top of the Kitchen's wall screen in a test hotel", async () => {
    withTestHotel();
    renderAt(`/pos/${TEST_HOTEL}/kitchen`, "/pos/:code/kitchen", <KitchenPage />);
    const stripe = await screen.findByText(TEST_STRIPE);
    /* The first thing on the screen, above the Kitchen's own header. */
    expect(stripe.parentElement?.firstElementChild).toBe(stripe);
    expect(screen.getByRole("heading", { name: "Kitchen" })).toBeTruthy();
  });

  it("is across the top of the Terminal in a test hotel", async () => {
    withTestHotel();
    renderAt(`/pos/${TEST_HOTEL}/terminal`, "/pos/:code/terminal", <TerminalPage />);
    const stripe = await screen.findByText(TEST_STRIPE);
    expect(stripe.parentElement?.firstElementChild).toBe(stripe);
  });

  it("is on neither in a real hotel", async () => {
    useUi.setState({ hotelId: HOTEL });
    renderAt(`/pos/${HOTEL}/kitchen`, "/pos/:code/kitchen", <KitchenPage />);
    expect(await screen.findByRole("heading", { name: "Kitchen" })).toBeTruthy();
    cleanup();
    renderAt(`/pos/${HOTEL}/terminal`, "/pos/:code/terminal", <TerminalPage />);
    expect(await screen.findByText("Terminal")).toBeTruthy();
    expect(screen.queryByText(TEST_STRIPE)).toBeNull();
  });
});
