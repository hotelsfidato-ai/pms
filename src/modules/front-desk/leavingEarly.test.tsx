import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import * as frontDesk from "@/modules/front-desk";
import { startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "@/modules/finance/flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   LEAVING EARLY (the owner's D27-315, Part A)

   Check out before the booked departure shows, in its one step, the nights
   not stayed and asks why; the reason goes with the check-out. The server
   refuses without it too (api/test/modules/front-desk/leavingEarly.test.ts).
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "Ravi Kumar",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-25", departure: "2026-09-29", nights: 4, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false, nationality: "IN",
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

let args: unknown[] | null = null;

beforeEach(() => {
  startSignedIn();
  args = null;
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(0 as never);
  vi.spyOn(frontDesk, "checkOut").mockImplementation(async (...a) => {
    args = a;
    return { ok: true, data: STAY };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function confirmStep() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-27" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const out = await waitFor(() => {
    const b = document.querySelector("[data-checkout]") as HTMLButtonElement | null;
    expect(b?.disabled).toBe(false);
    return b!;
  });
  fireEvent.click(out);
  return () => document.querySelector("[data-checkout-confirm]") as HTMLButtonElement;
}

describe("checking out before the booked departure", () => {
  it("shows the nights not stayed, waits for the reason, and sends it", async () => {
    vi.spyOn(frontDesk, "leavingEarly").mockResolvedValue({
      departure: "2026-09-29", today: "2026-09-27", newDeparture: "2026-09-27",
      nightsFreed: 2, bookingSite: true,
    });
    const confirm = await confirmStep();
    expect(await screen.findByText(/Nights not stayed/)).toBeTruthy();
    expect(screen.getByText(/they are not\s+charged and the room goes back on sale/)).toBeTruthy();
    expect(screen.getByText("Tell the booking site the guest left early.")).toBeTruthy();
    expect(confirm().disabled, "checked out early with no reason").toBe(true);

    fireEvent.change(screen.getByLabelText(/Why are they leaving early/),
      { target: { value: "Plans changed" } });
    await waitFor(() => expect(confirm().disabled).toBe(false));
    fireEvent.click(confirm());
    await waitFor(() =>
      expect(args).toEqual(["5EL", "stay-1", { earlyReason: "Plans changed" }, ""]));
  });

  it("on the departure date it is the plain question", async () => {
    vi.spyOn(frontDesk, "leavingEarly").mockResolvedValue(null);
    const confirm = await confirmStep();
    await waitFor(() => expect(confirm()).toBeTruthy());
    expect(screen.queryByText(/Nights not stayed/)).toBeNull();
    fireEvent.click(confirm());
    await waitFor(() => expect(args).toEqual(["5EL", "stay-1", undefined, ""]));
  });
});
