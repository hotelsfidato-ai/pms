import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { Order } from "@/modules/pos/data/till";
import TillPage from "@/modules/pos/pages/Till";

/* ══════════════════════════════════════════════════════════════════
   AN EARLIER DAY'S BILL ON THE TILL (the team's feedback of 18 October,
   item 7a; the owner, 20 October)

   Found by its day or a part of its number, each row saying its day;
   opened, its Print the bill asks the server as today's bill does (the
   server prints it as BILL · DUPLICATE: api/test/modules/pos/kotSection.test.ts).
   ══════════════════════════════════════════════════════════════════ */

const API = `/api/hotels/${HOTEL}`;
const PAID = {
  id: "o-9", orderNo: "20260822-4", outlet: "REST", outletName: "Restaurant", hotelName: "5 Elements",
  hotelCity: null, hotelGstin: null, hotelFssai: null, table: "T2", status: "settled",
  businessDate: "2026-08-22", paymentMethod: "upi", openedBy: "Ravi", settledBy: "Ravi",
  eventId: null, eventTitle: null, tenders: [], abandonedReason: null, discount: 0, roundOff: 0,
  net: 320, taxable: 320, tax: 16, gross: 336, payable: 336, billsPrinted: 1,
  lines: [{ id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5, note: null, voided: false,
            kotStatus: "sent", addedBy: "Ravi", parentLineId: null, isAddon: false, variationId: null }],
} as unknown as Order;

const asked: string[] = [];
beforeEach(() => {
  startSignedIn();
  asked.length = 0;
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}`);
    const path = url.split("?")[0];
    if (path === `${API}/till/menu`) return { categories: [] } as never;
    if (path === `${API}/till/numbered-addons`) return { addons: [] } as never;
    if (path === `${API}/till/orders`) return { businessDate: "2026-08-25", orders: [] } as never;
    if (path === `${API}/till/bills`) {
      return { bills: [{ id: "o-9", orderNo: "20260822-4", outlet: "REST", table: "T2", status: "settled",
        businessDate: "2026-08-22", gross: 336, paymentMethod: "upi", openedAt: "20:15", lines: 1 }] } as never;
    }
    if (path === `${API}/till/orders/o-9`) return PAID as never;
    if (path === `${API}/till/rooms`) return { rooms: [] } as never;
    if (path === `${API}/till/promotions`) return { freehandCapPercent: 10, promotions: [] } as never;
    if (path === `${API}/till/orders/o-9/bill-print`) {
      return { ok: true, heading: "duplicate", sentTo: { name: "Bar PC", online: true }, jobId: "7" } as never;
    }
    return new Promise(() => {}) as never;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("an earlier day's bill on the Till", () => {
  it("finds it by a part of its number, says its day, opens it, and prints it again", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/pos/${HOTEL}/till`]}>
          <Routes><Route path="/pos/:code/till" element={<TillPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const card = await vi.waitFor(() => {
      const c = document.querySelector("[data-earlier-bills]");
      if (!c) throw new Error("no card yet");
      return c as HTMLElement;
    });
    await vi.waitFor(() =>
      expect(within(card).getByLabelText("Day").getAttribute("max"), "nothing after today").toBe("2026-08-25"));
    fireEvent.change(within(card).getByLabelText("Bill number"), { target: { value: "0822" } });
    const row = await within(card).findByRole("button", { name: /20260822-4/ });
    expect(row.textContent).toContain("22 Aug 2026");
    expect(asked).toContain(`GET ${API}/till/bills?no=0822`);

    fireEvent.click(row);
    const print = await screen.findByRole("button", { name: /Print the bill/ });
    fireEvent.click(print);
    await vi.waitFor(() => expect(asked).toContain(`POST ${API}/till/orders/o-9/bill-print`));
  });
});
