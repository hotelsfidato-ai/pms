import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import * as operations from "@/modules/front-desk/data/operations";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import { CheckInFlow } from "@/modules/front-desk/flows/CheckInFlow";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   AN EARLY ARRIVAL'S REASON REACHES THE SERVER (24 September, the owner)

   The Rate step asks "Why the room is being given early" and, for a
   manager, offers "Waive the charge" - and since 4 September neither was
   sent, so the server refused every check-in before the check-in hour
   ("An early arrival needs a reason") with the reason typed. Proved on
   what the Check in button sends.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-2608-5005", guest: "Lata Bhosale",
  roomNumber: "204", roomType: "Superior", ratePlan: "CP", arrival: "2026-08-25",
  departure: "2026-08-27", nights: 2, adults: 2, children: 0, status: "due-in",
} as unknown as Stay;

let sent: Parameters<typeof operations.checkIn>[2] | null = null;
/* What the server says of the person signed in (its own mayWaive). */
let serverMayWaive = false;

beforeEach(() => {
  startSignedIn();
  sent = null;
  serverMayWaive = false;
  /* Every screen read that is not the flow's own: nothing on file. */
  vi.spyOn(apiModule, "api").mockResolvedValue([] as never);
  vi.spyOn(operations, "checkInAllowed").mockResolvedValue({ allowed: true });
  vi.spyOn(operations, "earlyArrival").mockImplementation(async () => ({
    isEarly: true, checkInTime: "14:00", checkOutTime: "11:00", charge: 500, lateCharge: null,
    mayWaive: serverMayWaive,
  }));
  vi.spyOn(operations, "assignableRooms").mockResolvedValue([
    { number: "204", type: "Superior", status: "clean", housekeeping: "clean", allowed: true },
  ] as never);
  vi.spyOn(operations, "checkIn").mockImplementation(async (_h, _s, input) => {
    sent = input;
    return { ok: true, data: STAY };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function toRateStep() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-08-25" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
  await screen.findByText("204");
  fireEvent.change(screen.getByLabelText(/Reason for skipping/), { target: { value: "Scanner offline" } });
  fireEvent.change(await screen.findByLabelText(/Why the room is being given early/),
    { target: { value: "Overnight train" } });
}

async function checkInEarly({ waive, offers = false }: { waive: boolean; offers?: boolean }) {
  await toRateStep();
  if (waive) fireEvent.click(screen.getByLabelText(/Waive the charge/));
  if (offers) fireEvent.click(await screen.findByRole("switch", { name: /Guest agreed to offers/ }));
  const buttons = await screen.findAllByRole("button", { name: /Check in/ });
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(sent).not.toBeNull());
}

/* D25-39 (opt-in, the owner 26 September): asked at check-in, off until the
   guest says yes, and sent only then. */
describe("the guest's yes to offers at check-in", () => {
  it("is not sent as a yes when nobody ticked it", async () => {
    await checkInEarly({ waive: false });
    expect(sent).toMatchObject({ offersAgreed: false });
  });

  it("is sent when the guest said yes", async () => {
    await checkInEarly({ waive: false, offers: true });
    expect(sent).toMatchObject({ offersAgreed: true });
  });
});

describe("checking in before the property's check-in time", () => {
  it("sends the clerk's reason, and no waive", async () => {
    await checkInEarly({ waive: false });
    expect(sent).toMatchObject({ earlyReason: "Overnight train", waiveEarly: false });
  });

  it("sends a manager's waive with the reason", async () => {
    signedIn({ scope: {
      staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in",
      fullName: "Owner", isGroupAdmin: true, hotels: [],
    } });
    serverMayWaive = true;
    await checkInEarly({ waive: true });
    expect(sent).toMatchObject({ earlyReason: "Overnight train", waiveEarly: true });
  });

  /* Rule C (the owner, 24 September): the tick is offered to exactly those
     the server takes a waive from. A hotel's own administrator holds
     reservation: approve, which the screen used to ask, and the server's
     mayWaive (owner or GM there, or a group administrator) refuses them. */
  it("offers no waive to a hotel administrator the server would refuse", async () => {
    signedIn({ scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "admin@fidato.in",
      fullName: "Hotel Admin", isGroupAdmin: false,
      hotels: [{ hotelId: AGRA_HOTEL, role: "admin" }],
    } });
    await toRateStep();
    expect(screen.getByLabelText(/Why the room is being given early/)).toBeTruthy();
    expect(screen.queryByLabelText(/Waive the charge/)).toBeNull();
  });
});

/* D25-4 (the owner, 25 September): the ID step points the desk to Online
   check-in when THIS guest's details wait there, in a new tab. Drawn by
   online check-in's WaitingDetailsLink; this proves the check-in draws it. */
describe("the ID step, when the guest sent their details online", () => {
  it("points to Online check-in", async () => {
    vi.mocked(apiModule.api).mockImplementation(async (url: string) => (
      url === "/api/hotels/5EL/online-checkin"
        ? { waiting: [{ reference: STAY.reference }], requests: [], rooms: [] }
        : []) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/h/5EL/arrivals"]}>
          <Routes><Route path="/h/:code/arrivals"
            element={<CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-08-25" />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
    await screen.findByText("204");

    const link = await screen.findByRole("link", { name: "check them on Online check-in" });
    expect(link.getAttribute("href")).toBe("/h/5EL/online-checkin");
  });
});
