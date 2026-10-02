import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as operations from "@/modules/front-desk/data/operations";
import { startSignedIn } from "@/test/app";
import { CheckInFlow } from "@/modules/front-desk/flows/CheckInFlow";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   A FOREIGN GUEST'S CHECK-IN (D27-25)

   Two ways a foreign guest used to miss the register: the dialog
   started at "IN" whatever the booking said, and sent the nationality
   only with a document - so an ID skipped for a reason left the guest
   Indian. And Form III's own questions must be answered before Check in
   goes (the owner, 27 September; one page since D27-163).
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-2609-0001", guest: "Ana Lima",
  roomNumber: "204", roomType: "Superior", ratePlan: "CP", arrival: "2026-09-27",
  departure: "2026-09-29", nights: 2, adults: 1, children: 0, status: "due-in",
  nationality: "BR",
} as unknown as Stay;

let sent: Parameters<typeof operations.checkIn>[2] | null = null;

beforeEach(() => {
  startSignedIn();
  sent = null;
  vi.spyOn(apiModule, "api").mockResolvedValue([] as never);
  vi.spyOn(operations, "checkInAllowed").mockResolvedValue({ allowed: true });
  vi.spyOn(operations, "earlyArrival").mockResolvedValue({
    isEarly: false, checkInTime: "14:00", checkOutTime: "11:00", charge: null,
    lateCharge: null, mayWaive: false,
  } as never);
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

describe("a foreign guest's check-in", () => {
  it("starts from the nationality on file, asks Form III, and sends both with the ID skipped", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-09-27" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
    await screen.findByText("Room 204");
    const go = () => screen.getAllByRole("button", { name: /Check in/ }).at(-1) as HTMLButtonElement;

    expect((screen.getByLabelText("Nationality") as HTMLInputElement).value).toBe("BR");
    fireEvent.change(screen.getByLabelText(/Reason for skipping/),
      { target: { value: "Passport at the bank" } });
    expect(go().disabled, "Form III's questions were not asked").toBe(true);
    expect(document.querySelector("[data-form-iii-needs]")?.textContent)
      .toMatch(/Form III still needs: Phone in India, Arrived from/);

    /* Starred, so the label reads "Phone in India*". */
    const type = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    type("Phone in India", "+91 98000 00001");
    type("Arrived from", "Delhi");
    type("Purpose of visit", "tourism");
    type("Previous place of stay", "Hotel in Delhi");
    expect(go().disabled).toBe(false);

    fireEvent.click(go());
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.identity).toEqual({ nationality: "BR" });
    expect(sent!.visit).toEqual({
      phoneInIndia: "+91 98000 00001", arrivedFrom: "Delhi", purpose: "tourism",
      previousStay: "Hotel in Delhi",
    });
  });
});
