import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "@/App";
import { go, startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   CRS BOOKINGS - what a person is left looking at (D27-168, D27-171)

     a change made in the CRS stands as a note with Done, and Done names
       that CRS booking and nothing else
     the connection card is the owner's and an administrator's only
     a hotel whose CRS login is missing says so, rather than an empty list
       reading as "no bookings"

   ⚠ Every test uses its own property code: the query cache outlives a test.
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({
  settingsPresent: true,
  done: [] as string[],
}));

vi.mock("@/modules/crs/data/crs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/crs/data/crs")>();
  return {
    ...actual,
    getCrsBookings: async () => ({
      connection: {
        settingsPresent: control.settingsPresent, mapped: true, on: true,
        lastReadAt: "2026-09-29T06:00:00.000Z", lastError: null,
      },
      bookings: [{
        crsId: "crsDocA1", crsReference: "FH-2026-00042",
        salesperson: "Priya Sales", company: "Acme Travels", guestName: "Asha Rao",
        checkIn: "2026-10-20", checkOut: "2026-10-22", crsStatus: "confirmed",
        outcome: "booked", reason: null, readAt: "2026-09-29T06:00:00.000Z",
        changeNote: "The CRS dates are now 21 Oct 2026 to 23 Oct 2026 (were 20 Oct 2026 to 22 Oct 2026).",
        changedAt: "2026-09-29T07:00:00.000Z", changeDone: false,
        answer: null, answerError: null,
        bookings: [{ id: "r1", reference: "FH-5EL-2609-0101", status: "tentative" }],
      }],
    }),
    markCrsNoteDone: async (_code: string, crsId: string) => {
      control.done.push(crsId);
      return { ok: true as const };
    },
    getCrsSetup: async () => ({
      crsHotelId: "crsHotel5EL", bookingSourceId: null, isOn: false, connectedAt: null,
      readsAs: null, roomTypes: [], hotelRoomTypes: [], sources: [],
    }),
  };
});

const as = (role: string) => signedIn({
  scope: {
    staffId: "66666666-6666-6666-6666-666666666666",
    email: "crs-test@fidato.in", fullName: "CRS Test", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

beforeEach(() => {
  startSignedIn();
  control.settingsPresent = true;
  control.done = [];
});

describe("CRS bookings", () => {
  it("shows a change made in the CRS as a note, and Done marks that booking", async () => {
    as("front_desk");
    go("/h/CR1/crs-bookings");
    render(<App />);

    expect((await screen.findAllByText(/The CRS dates are now 21 Oct 2026/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("FH-2026-00042").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Done" })[0]!);
    await waitFor(() => expect(control.done).toEqual(["crsDocA1"]));
  });

  it("shows the connection card to an administrator and not to the desk", async () => {
    as("admin");
    go("/h/CR2/crs-bookings");
    const { unmount } = render(<App />);
    expect(await screen.findByText("Connection to the CRS")).toBeTruthy();
    unmount();

    as("front_desk");
    go("/h/CR3/crs-bookings");
    render(<App />);
    expect((await screen.findAllByText(/The CRS dates are now/)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Connection to the CRS")).toBeNull();
  });

  it("says nothing is read while the CRS login is missing", async () => {
    as("front_desk");
    control.settingsPresent = false;
    go("/h/CR4/crs-bookings");
    render(<App />);
    expect(await screen.findByText(/The CRS login is not in the server's settings yet/)).toBeTruthy();
  });
});
