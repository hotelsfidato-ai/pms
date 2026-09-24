import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as operations from "@/modules/front-desk/data/operations";
import { signedIn, startSignedIn } from "@/test/app";
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

beforeEach(() => {
  startSignedIn();
  sent = null;
  /* Every screen read that is not the flow's own: nothing on file. */
  vi.spyOn(apiModule, "api").mockResolvedValue([] as never);
  vi.spyOn(operations, "checkInAllowed").mockResolvedValue({ allowed: true });
  vi.spyOn(operations, "earlyArrival").mockResolvedValue({
    isEarly: true, checkInTime: "14:00", checkOutTime: "11:00", charge: 500, lateCharge: null,
  });
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

async function checkInEarly({ waive }: { waive: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-08-25" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
  next();                                                   // Guest
  await screen.findByText("204");
  next();                                                   // Room
  fireEvent.change(screen.getByLabelText(/Reason for skipping/), { target: { value: "Scanner offline" } });
  next();                                                   // ID
  fireEvent.change(await screen.findByLabelText(/Why the room is being given early/),
    { target: { value: "Overnight train" } });
  if (waive) fireEvent.click(screen.getByLabelText(/Waive the charge/));
  next();                                                   // Rate
  const buttons = await screen.findAllByRole("button", { name: /Check in/ });
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(sent).not.toBeNull());
}

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
    await checkInEarly({ waive: true });
    expect(sent).toMatchObject({ earlyReason: "Overnight train", waiveEarly: true });
  });
});
