import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import { StayDrawer } from "@/modules/front-desk/flows/StayDrawer";
import type { Stay } from "@/data/repositories";

/* D27-168: the stay panel shows a booking's CRS facts (CrsFacts, the crs
   front door) - its CRS number, salesperson, company and any change made in
   the CRS since - and nothing at all for a booking the desk took.
   getCrsBookings is answered at the transport: mocking crs's data file from
   here would reach past its front door (boundaries.test.ts). */

const stay = (id: string) => ({
  id, hotelId: "5EL", reference: "FH-5EL-2610-0001", guest: "A Guest",
  roomNumber: "301", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-10-04", departure: "2026-10-05", nights: 1, adults: 2, children: 0,
  status: "due-in", isDayUse: false, isComplimentary: false,
  rackTariff: 3699, offeredTariff: 3699, isVip: false, isSingleLady: false, nationality: "IN",
}) as unknown as Stay;

const CRS_BOOKING = {
  crsId: "crsDocA1", crsReference: "FH-2026-00042",
  salesperson: "Priya Sales", company: "Acme Travels", guestName: "A Guest",
  checkIn: "2026-10-04", checkOut: "2026-10-05", crsStatus: "confirmed",
  outcome: "booked", reason: null, readAt: "2026-10-01T06:00:00.000Z",
  changeNote: "The CRS dates are now 5 Oct 2026 to 6 Oct 2026.",
  changedAt: "2026-10-02T07:00:00.000Z", changeDone: false,
  answer: null, answerError: null,
  bookings: [{ id: "crs-stay", reference: "FH-5EL-2610-0001", status: "confirmed" }],
};

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
    if (path.includes("/crs/bookings?reservation=")) {
      return {
        connection: { settingsPresent: true, mapped: true, on: true, lastReadAt: null, lastError: null },
        bookings: path.endsWith("=crs-stay") ? [CRS_BOOKING] : [],
      } as never;
    }
    return new Promise(() => {}) as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = (id: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>
          <StayDrawer hotelId="5EL" stay={stay(id)} businessDate="2026-10-04"
            status={{ tone: "info", label: "Due in" }} onClose={() => {}} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return client;
};

describe("the stay panel's CRS facts", () => {
  it("shows a CRS booking's number, salesperson, company and open change", async () => {
    open("crs-stay");
    expect(await screen.findByText("CRS FH-2026-00042")).toBeTruthy();
    expect(screen.getByText(/sold by Priya Sales/)).toBeTruthy();
    expect(screen.getByText(/Acme Travels/)).toBeTruthy();
    expect(screen.getByText("Changed in the CRS: The CRS dates are now 5 Oct 2026 to 6 Oct 2026."))
      .toBeTruthy();
  });

  it("draws nothing for a booking the desk took", async () => {
    const client = open("desk-stay");
    /* Wait for the answer, so "nothing" is not just "not loaded yet". */
    await waitFor(() =>
      expect(client.getQueryState(["crs-bookings", "5EL", "desk-stay"])?.status).toBe("success"));
    await act(async () => {});
    expect(screen.queryByText(/^CRS /)).toBeNull();
    expect(screen.queryByText(/Changed in the CRS/)).toBeNull();
  });
});
