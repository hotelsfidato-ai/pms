import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";
import { AGRA_HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import type { AriState, ChannelBooking, SuContent, SuStatus } from "./data/su";

/* ══════════════════════════════════════════════════════════════════
   THE CHANNEL MANAGER PAGE — who sees the SU setup (D17-66)

   The setup (SU login, the hotel on SU, room types, meal plans, Send to SU,
   rooms left and prices) is the owner's and an administrator's, D17-85. A GM
   still opens the page - it is in their Coming soon section - and sees what the
   connection is, but not the setup, and the screen never asks the server for
   it: the server would refuse them anyway.

   The data is stood in for: nothing here reaches SU or the API.
   ══════════════════════════════════════════════════════════════════ */

const status: SuStatus = {
  configured: false, environment: null,
  missing: ["SU_ENVIRONMENT", "SU_CLIENT_ID", "SU_CLIENT_SECRET"],
  reason: "SU is not set up on this server yet. The owner adds SU_ENVIRONMENT, SU_CLIENT_ID, SU_CLIENT_SECRET to the server's settings file.",
  lastLogin: null, loginsThisHour: null, loginsPerHour: 30,
};

const content: SuContent = {
  hotel: { code: "AGR", name: "Fidato Agra", addressLine: null, city: "Agra", phone: null, email: null, currency: "INR" },
  channel: null,
  roomTypes: [{ id: "rt-1", code: "DLX", name: "Deluxe", maxOccupancy: 3, rackRate: null, rooms: 4, mapping: null }],
  mealPlans: [{ code: "EP", name: "European Plan", includes: "Room only", mapping: null }],
  switchedOn: false,
  problems: ["The hotel's SU details have not been entered yet: its SU hotel id, postcode, country, position and a contact's name."],
  su: { configured: false, environment: null },
  suRoomTypes: [{ code: 7, name: "Triple" }],
  suMealPlans: [{ code: 15, name: "Room only" }],
};

const availability: AriState = { pushes: [], policy: { sendRackRate: false, closeUnpriced: true } };

/* One booking SU pushed and the PMS refused: the owner sees why, and that no
   card detail was kept (D17-80, D17-83). */
const pushed: ChannelBooking[] = [{
  id: "1", suBookingId: "6026344507_AGR", channel: "Booking.com", status: "new",
  arrival: "2026-11-02", departure: "2026-11-04", guestName: "Asha Rao", rooms: 1,
  currency: "INR", total: "10080.00", commission: "450.00",
  outcome: "refused_no_room",
  reason: "No Deluxe is free for these nights, so no booking was made.",
  receivedAt: "2026-09-18T04:30:00.000Z", acknowledged: true, handled: false,
  cardFieldsRemoved: 3,
}];
const getSuContent = vi.fn(async () => content);

vi.mock("@/modules/channel-manager/data/su", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/channel-manager/data/su")>();
  return {
    ...actual,
    getSuStatus: async () => status,
    getSuAvailability: async () => availability,
    getChannelBookings: async () => ({ bookings: pushed }),
    getSuContent: (...a: unknown[]) => getSuContent(...(a as [])),
  };
});

beforeEach(() => {
  startSignedIn();
  getSuContent.mockClear();
});

const as = (role: "owner" | "admin" | "gm") => {
  if (role === "owner") {
    signedIn({
      scope: {
        staffId: "33333333-3333-3333-3333-333333333333", email: "owner@fidato.in",
        fullName: "Test Owner", isGroupAdmin: true, hotels: [],
      },
    });
  } else {
    signedIn({
      scope: {
        staffId: "44444444-4444-4444-4444-444444444444",
        email: role === "admin" ? "admin@fidato.in" : "gm@fidato.in",
        fullName: role === "admin" ? "Test Administrator" : "Test Manager",
        isGroupAdmin: false,
        hotels: [{ hotelId: AGRA_HOTEL, role }],
      },
    });
  }
  go("/h/AGR/channels");
};

describe("the channel manager page", () => {
  it("shows the owner the SU setup, with nothing sendable while SU is not set up", async () => {
    as("owner");
    render(<App />);

    expect(await screen.findByText("This hotel on SU")).toBeTruthy();
    expect(screen.getByText(status.reason!)).toBeTruthy();
    expect(screen.getByText(content.problems[0]!)).toBeTruthy();
    /* The rack rate nobody set is a hyphen, never ₹0. */
    expect(screen.getByText(/rack rate -/)).toBeTruthy();
    const send = screen.getByRole("button", { name: /Send to SU/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("shows an administrator the setup too (D17-85)", async () => {
    as("admin");
    render(<App />);
    expect(await screen.findByText("This hotel on SU")).toBeTruthy();
    expect(screen.getByText("Rooms left, prices and closures")).toBeTruthy();
  });

  it("shows a refused booking with its reason, and that no card detail was kept", async () => {
    as("owner");
    render(<App />);
    expect(await screen.findByText("Bookings from the booking sites")).toBeTruthy();
    expect(screen.getByText("Refused: no room free")).toBeTruthy();
    expect(screen.getByText(pushed[0]!.reason!)).toBeTruthy();
    expect(screen.getByText(/card details were not kept/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /I have dealt with this/ })).toBeTruthy();
  });

  it("shows a GM what the connection is, without the setup, and never asks for it", async () => {
    as("gm");
    render(<App />);

    expect(await screen.findByText("What it still needs before it goes live")).toBeTruthy();
    expect(screen.queryByText("This hotel on SU")).toBeNull();
    expect(getSuContent).not.toHaveBeenCalled();
  });
});
