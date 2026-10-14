import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import * as refunds from "@/modules/finance/data/refunds";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   THE RECEIPT OUTLIVES THE CREDIT (D27-315 Part B, seen on screen 14 Oct)

   The refund brings the bill to ₹0. The Bill tab showed the refund step
   only while the bill was overpaid, so the step - and its "Print the
   refund receipt" - vanished the moment the refund landed.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-23", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

const BILL = { folioId: "folio-1", credit: 1116.05, notice: null,
  ways: [{ label: "UPI", kind: "upi", upTo: 1116.05 }] };
let balance = -1116.05;
let readsAtRefund = 0;

beforeEach(() => {
  startSignedIn();
  balance = -1116.05;
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
  vi.spyOn(postings, "getFolioBalance").mockImplementation(async () => balance as never);
  vi.spyOn(refunds, "getRefundOptions").mockImplementation(async () =>
    ({ may: true, ceiling: 20000, bills: balance < 0 ? [BILL] : [{ ...BILL, credit: 0, ways: [] }] }));
  vi.spyOn(refunds, "giveRefund").mockImplementation(async () => {
    balance = 0;
    readsAtRefund = vi.mocked(postings.getFolioBalance).mock.calls.length;
    return { ok: true, data: { id: "77" } };
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("after a refund brings the bill to ₹0", () => {
  it("still offers the refund receipt", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider><MemoryRouter>
          <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" />
        </MemoryRouter></TooltipProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Refund/ }));
    fireEvent.change(await screen.findByLabelText("Reference"), { target: { value: "UPI 99812" } });
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "Left a day early" } });
    fireEvent.click(screen.getByRole("button", { name: "Give refund" }));

    /* The bill read again at ₹0, and the page drawn from it. */
    await waitFor(() => expect(vi.mocked(postings.getFolioBalance).mock.calls.length).toBeGreaterThan(readsAtRefund));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Refund$/ })).toBeNull());
    const link = screen.getByRole("link", { name: /Print the refund receipt/ });
    expect(link.getAttribute("href")).toBe("/h/5EL/stays/stay-1/refunds/77");
  });
});
