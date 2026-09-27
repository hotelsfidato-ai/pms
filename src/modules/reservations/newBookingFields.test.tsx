import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import NewBookingPage from "@/modules/reservations/pages/NewBooking";

/* ══════════════════════════════════════════════════════════════════
   NEW BOOKING, PHASE 1 (D27-33) - what the form SENDS

   Every field the owner's screenshot records, proved on what the Confirm
   button sends (root MEMORY 329: a field a screen asks for is proved by
   what the button sends). The rules themselves are the server's -
   api/test/modules/reservations/newBooking.test.ts. Here: reception is not
   offered the complimentary tick, the tax from the tax card sits beside
   the rate, and a waiting booking is held, not booked.
   ══════════════════════════════════════════════════════════════════ */

const posted: Array<{ path: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return {
        ok: true, groupId: null, rooms: 1, guest: "Anna Smith", status: "tentative",
        bookings: [{ id: "r-1", reference: "FH-5EL-2608-0002", roomType: "Deluxe", rate: 2700 }],
        nightly: 2700,
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
    if (path.includes("/tariff")) {
      return { roomType: "Deluxe", total: 3000, unpriced: null,
               nights: [{ night: "2026-08-25", total: 3000, unpriced: null }] } as never;
    }
    if (path.includes("/tax/room/rate")) return { kind: "room", rate: 5, scheme: "gst" } as never;
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const type = (label: string, value: string) =>
  fireEvent.change(
    screen.getByLabelText((text) => text === label || text === `${label}*`, { selector: "input" }),
    { target: { value } });
const pick = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { selector: "select" }), { target: { value } });

describe("New booking's Phase 1 fields", () => {
  it("sends every one, shows the tax beside the rate, and holds a waiting booking", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><NewBookingPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("Who");
    pick(/^Title$/, "Ms");
    type("Guest or company", "Anna Smith");
    type("Email", "anna@example.test");
    type("Nationality", "gb");
    /* A foreigner's form is due at check-in: said at booking. */
    expect(screen.getByText(/A foreign guest/)).toBeTruthy();
    type("City", "Leeds");
    type("PIN code", "LS1 4AP");
    type("Expected check-out", "09:30");
    pick(/Booking source/, "src-1");
    pick(/Market segment/, "Leisure");
    fireEvent.click(screen.getByRole("tab", { name: "Waiting for the hotel" }));
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    /* Reception is not offered the gift (the owner, 27 September). */
    const comp = await screen.findByRole("checkbox", { name: /Complimentary/ });
    expect((comp as HTMLButtonElement).disabled).toBe(true);
    /* A waiting booking gets no room yet: the desk's assign refuses one. */
    expect(screen.queryByRole("combobox", { name: "Room" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Up to 10%" }));
    fireEvent.change(screen.getByLabelText("Discount percent"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "Returning family" } });

    /* ₹3,000 less 10% is ₹2,700; 5% of it is ₹135 - the tax card's rate. */
    expect(await screen.findByText(/₹2,700.00 a night \+ ₹135.00 tax \(5%\)/)).toBeTruthy();

    const hold = await screen.findByRole("button", { name: "Hold it, waiting for the hotel" });
    await waitFor(() => expect((hold as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(hold);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toMatchObject({
      title: "Ms", nationality: "GB", tentative: true, marketSegment: "Leisure",
      expectedDeparture: "09:30",
      discount: { percent: 10, reason: "Returning family" },
      address: { city: "Leeds", pincode: "LS1 4AP" },
      lines: [{ roomTypeId: "rt-1", rooms: 1 }],
    });
    expect(posted[0]!.body).not.toHaveProperty("companyId");
    expect(await screen.findByText("Held, waiting for the hotel")).toBeTruthy();
    /* Nothing goes to a guest while it waits: no link, no voucher. */
    expect(screen.queryByRole("button", { name: /Send voucher/ })).toBeNull();
  });
});
