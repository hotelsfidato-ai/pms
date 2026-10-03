import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as operations from "@/modules/front-desk/data/operations";
import { useSession } from "@/lib/session";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import { isWeekend } from "@/modules/front-desk/data/stayview";
import { deskGuestId } from "@/modules/guests";
import { FrontDeskRulesCard } from "@/modules/front-desk";
import { CheckInFlow } from "@/modules/front-desk/flows/CheckInFlow";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE FRONT DESK'S RULES, PER HOTEL (the owner's D27-243, D27-246)

   Set on Settings › Operations' "Front desk rules" card; the screens start
   on them: the weekend shaded (3.4), the ID's nationality and type (3.6),
   and the advance before check-in held on the check-in with the server's
   own figure (3.3), its "Prepaid on the booking site" tick for a booking
   site's booking.
   ══════════════════════════════════════════════════════════════════ */

const RULES: apiModule.DeskRules = {
  defaultPaymentMethod: "Cash", deskMayOverbook: true, advanceBeforeCheckIn: "first_night",
  weekendDays: [5, 6], defaultIdType: "aadhaar", defaultNationality: "IN", defaultTitle: null,
};

beforeEach(() => {
  startSignedIn();
  useSession.setState((s) => ({ hotels: s.hotels.map((h) => ({ ...h, deskRules: RULES })) }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the screens start on the hotel's rules", () => {
  it("shades the hotel's own weekend (3.4)", () => {
    expect(isWeekend("2026-10-02", RULES.weekendDays)).toBe(true);   // a Friday
    expect(isWeekend("2026-10-04", RULES.weekendDays)).toBe(false);  // a Sunday
    expect(isWeekend("2026-10-04")).toBe(true);                      // unset: Sat and Sun
  });

  it("starts the ID on the hotel's nationality and type - never an Aadhaar from abroad (3.6)", () => {
    expect(deskGuestId(RULES)).toMatchObject({ nationality: "IN", idType: "aadhaar" });
    expect(deskGuestId(RULES, "GB")).toMatchObject({ nationality: "GB", idType: "" });
  });
});

describe("the Front desk rules card", () => {
  it("shows the rules and saves a change", async () => {
    const save = vi.spyOn(operations, "saveDeskRules").mockResolvedValue({ ok: true });
    vi.spyOn(apiModule, "getSession").mockResolvedValue({ scope: null, hotels: [] } as never);
    render(<FrontDeskRulesCard hotelId="AGR" />);
    expect(document.querySelector("[data-desk-rules]")?.textContent).toContain("The first night");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![1]).toMatchObject({ weekendDays: [5, 6] });
    /* Set on Money › Payment methods since D27-259: shown, never sent. */
    expect(save.mock.calls[0]![1]).not.toHaveProperty("defaultPaymentMethod");
  });
});

describe("the advance before check-in, on the check-in (3.3, D27-246)", () => {
  const STAY = {
    id: "stay-1", hotelId: "5EL", reference: "FH-2608-0001", guest: "Asha Kulkarni",
    roomNumber: "204", roomType: "Superior", ratePlan: "CP", arrival: "2026-08-25",
    departure: "2026-08-27", nights: 2, adults: 2, children: 0, status: "due-in",
    nationality: "IN",
  } as unknown as Stay;

  it("holds Check in with the server's figure, and asks again when the prepaid tick changes", async () => {
    signedIn({ hotels: useSession.getState().hotels, hotelId: AGRA_HOTEL });
    vi.spyOn(apiModule, "api").mockResolvedValue([] as never);
    vi.spyOn(operations, "checkInAllowed").mockResolvedValue({ allowed: true });
    vi.spyOn(operations, "earlyArrival").mockResolvedValue({
      isEarly: false, checkInTime: "14:00", checkOutTime: "11:00", charge: null,
      lateCharge: null, mayWaive: false,
    } as never);
    vi.spyOn(operations, "assignableRooms").mockResolvedValue([
      { number: "204", type: "Superior", status: "clean", housekeeping: "clean", allowed: true },
    ] as never);
    const words = "An advance of ₹2,100 is owed before check-in (the first night ₹2,100, paid ₹0). Take it on the Bill tab.";
    const read = vi.spyOn(operations, "expressCheckIn").mockImplementation(async (_h, _s, prepaid) => ({
      express: false, bookingSite: true, prepaidOnSite: true,
      advance: prepaid === false ? { owed: 2100, words } : null,
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-08-25" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
    fireEvent.change(await screen.findByLabelText(/Reason for skipping/), { target: { value: "Scanner offline" } });
    const tick = await screen.findByRole("switch", { name: /Prepaid on the booking site/ });
    expect(document.querySelector("[data-checkin-blocked]")).toBeNull();

    fireEvent.click(tick);
    await waitFor(() => expect(read).toHaveBeenLastCalledWith("5EL", "stay-1", false));
    await waitFor(() => expect(document.querySelector("[data-checkin-blocked]")?.textContent).toBe(words));
  });
});
