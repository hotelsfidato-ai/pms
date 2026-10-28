import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useToastStore } from "@/components/ui/Toast";
import { startSignedIn } from "@/test/app";
import NewBookingPage from "@/modules/reservations/pages/BookingPage";

/* ══════════════════════════════════════════════════════════════════
   THE BOOKING FORM RECOGNISES A RETURNING GUEST (D21-20)

   A phone that is an earlier guest's suggests them - a name and "stayed
   with the group N times", nothing more (D21-13). "Same person" makes the
   booking theirs; the two ticks go with it (D21-72, D21-22). Proved on
   what Save booking sends (the one page, D27-163) and what the clerk is then told (root
   MEMORY 291). The server's half - checking the guest again, filling a
   blank, refusing a mismatch - is api/test/modules/guests/oneGuestOneRecord.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
let blacklisted = false;

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  blacklisted = false;
  useToastStore.setState({ toasts: [] });
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return {
        ok: true, groupId: null, rooms: 1, guest: "Rohit Deshpande",
        bookings: [{ reference: "FH-5EL-2608-0001", roomType: "Deluxe", rate: 3000 }], nightly: 3000,
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
    if (path.includes("/guests/returning")) {
      return { matches: [{ guestId: "g-rohit", visits: 2, name: "Rohit Deshpande",
                           suggested: true, blacklisted,
                           blacklistReason: blacklisted ? "Left without paying" : null }] } as never;
    }
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

describe("a booking for a returning guest", () => {
  it("suggests them from the phone, and 'Same person' books them, with the WhatsApp tick", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><NewBookingPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    /* The heading is drawn while the inventory loads; the form after it. */
    await screen.findByRole("heading", { name: "Guest" });
    type("Full name", "Rohit D");
    type("Phone", "+91 98765 43210");
    expect(await screen.findByText(/Stayed with the group 2 times/))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Same person" }));

    fireEvent.change(screen.getByLabelText(/Booking source/, { selector: "select" }),
      { target: { value: "src-1" } });
    fireEvent.click(screen.getByRole("switch", { name: /Guest agreed to WhatsApp/ }));

    const confirm = await screen.findByRole("button", { name: "Save booking" });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toMatchObject({
      guestId: "g-rohit", phone: "+91 98765 43210", whatsappAgreed: true, offersAgreed: false,
    });
    /* The Booked card (Phase 1) names whose booking it now is. */
    expect(await screen.findByText("Rohit Deshpande")).toBeTruthy();
  });

  /* The walk-in's own tests (walkInReturning, 21 September), kept when the
     walk-in became this page (D27-163). */
  const open = async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><NewBookingPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Guest" });
  };
  const save = () => screen.getByRole("button", { name: "Save booking" }) as HTMLButtonElement;

  it("'Not them' - and typing the phone again - leaves a new guest", async () => {
    await open();
    type("Full name", "Rohit D");
    type("Phone", "9876543210");
    fireEvent.click(await screen.findByRole("button", { name: "Same person" }));
    fireEvent.click(await screen.findByRole("button", { name: "Not them" }));
    type("Phone", "98765 43210");
    fireEvent.change(screen.getByLabelText(/Booking source/, { selector: "select" }),
      { target: { value: "src-1" } });
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).not.toHaveProperty("guestId");
    expect(posted[0]!.body).toMatchObject({ whatsappAgreed: false, offersAgreed: false });
  });

  it("warns of a blacklisted guest with the reason, and still lets the desk book them (D21-21)", async () => {
    blacklisted = true;
    await open();
    type("Full name", "Rohit D");
    type("Phone", "9876543210");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/blacklisted/);
    expect(alert.textContent).toMatch(/Left without paying/);
    fireEvent.change(screen.getByLabelText(/Booking source/, { selector: "select" }),
      { target: { value: "src-1" } });
    await waitFor(() => expect(save().disabled).toBe(false));
  });

  it("asks nothing of a number too short to be one, and says a phone that is not one (X-2)", async () => {
    await open();
    type("Phone", "98765");
    await new Promise((r) => setTimeout(r, 50));
    const asked = vi.mocked(apiModule.api).mock.calls.some(([p]) => String(p).includes("/returning"));
    expect(asked).toBe(false);

    type("Full name", "Asha K");
    type("Phone", "abc");
    fireEvent.change(screen.getByLabelText(/Booking source/, { selector: "select" }),
      { target: { value: "src-1" } });
    await waitFor(() => expect(document.querySelector("[data-booking-reasons]")?.textContent)
      .toMatch(/not a phone number/));
    expect(save().disabled).toBe(true);
  });
});
