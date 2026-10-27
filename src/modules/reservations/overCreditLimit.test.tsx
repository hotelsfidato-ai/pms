import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AGRA_HOTEL, startSignedIn } from "@/test/app";
import BookingPage from "@/modules/reservations/pages/BookingPage";

/* ══════════════════════════════════════════════════════════════════
   A COMPANY OVER ITS CREDIT LIMIT, ON NEW BOOKING (the owner's D27-275)

   The server refuses with the sentence and `needs: "credit-limit"`. The
   page says it under the buttons; the owner, an administrator or the GM
   gets "Allow, with reason", which books again sending the reason.
   Reception is told who can. The rule itself: api/test/modules/finance/
   creditLimit.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const SAID = "Tata Motors is over its credit limit by ₹2,150.00.";
const posted: Array<Record<string, unknown>> = [];

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST" && path.endsWith("/bookings")) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push(body);
      if (!body["overLimitReason"]) {
        throw Object.assign(new ApiError(409, SAID), { body: { ok: false, reason: SAID, needs: "credit-limit" } });
      }
      return {
        ok: true, groupId: null, rooms: 1, guest: "Anna Smith", status: "confirmed",
        bookings: [{ id: "r-1", reference: "FH-5EL-2608-0002", roomType: "Deluxe", rate: 3000 }],
        nightly: 3000,
      } as never;
    }
    if (path.includes("/booking-sources")) {
      return [{ id: "src-1", name: "Phone", kind: "direct", channelCode: null,
                isActive: true, commissionPct: null, bookings: 0 }] as never;
    }
    if (path.includes("/inventory")) {
      return { from: "2026-08-25", to: "2026-08-26", restrictions: [],
               cells: [{ roomTypeId: "rt-1", roomType: "Deluxe", date: "2026-08-25",
                         sellable: 5, occupied: 0, sold: 0, available: 5 }] } as never;
    }
    if (path.includes("/contract-price")) {
      return { total: 3000, unpriced: null, note: null,
               nights: [{ night: "2026-08-25", total: 3000, unpriced: null }], contract: null } as never;
    }
    if (path.includes("/tariff")) {
      return { roomType: "Deluxe", total: 3000, unpriced: null,
               nights: [{ night: "2026-08-25", total: 3000, unpriced: null }] } as never;
    }
    if (path.includes("/billing-companies")) return [{ id: "co-1", name: "Tata Motors", gstin: null }] as never;
    if (path.includes("/tax/room/rate")) return { kind: "room", rate: 5, scheme: "gst" } as never;
    if (path.endsWith("/modules")) return { modules: [] } as never;
    if (path.endsWith("/inclusions")) return { inclusions: [] } as never;
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const as = (role: string) => useSession.setState((s) => ({
  scope: { ...s.scope!, hotels: [{ hotelId: AGRA_HOTEL, role }] },
}));

/** A booking billed to Tata Motors, saved. */
const bookForTheCompany = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><BookingPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText(/₹3,000\.00 a night/);
  fireEvent.change(screen.getByLabelText((t) => t === "Full name" || t === "Full name*",
    { selector: "input" }), { target: { value: "Anna Smith" } });
  fireEvent.change(screen.getByLabelText(/Booking source/, { selector: "select" }), { target: { value: "src-1" } });
  fireEvent.click(screen.getByRole("tab", { name: "Company" }));
  await screen.findByRole("option", { name: "Tata Motors" });
  fireEvent.change(screen.getByLabelText(/^Company/, { selector: "select" }), { target: { value: "co-1" } });
  const save = screen.getByRole("button", { name: "Save booking" });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  await screen.findByText(SAID);
};

describe("a booking over the company's credit limit", () => {
  it("tells reception, and who can allow it", async () => {
    await bookForTheCompany();
    expect(screen.getByText("The owner, an administrator or the general manager can allow it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow, with reason" })).toBeNull();
  });

  it("lets the GM book it with a reason, which is sent", async () => {
    as("gm");
    await bookForTheCompany();
    const allow = screen.getByRole("button", { name: "Allow, with reason" });
    expect((allow as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why it is allowed"), { target: { value: "Cleared by the owner" } });
    fireEvent.click(allow);
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toMatchObject({ companyId: "co-1", overLimitReason: "Cleared by the owner" });
  });
});
