import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as operations from "@/modules/front-desk/data/operations";
import { startSignedIn } from "@/test/app";
import { CheckInFlow } from "@/modules/front-desk/flows/CheckInFlow";
import { AmendStayFlow } from "@/modules/front-desk/flows/AmendStayFlow";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   ROUND D ON THE CHECK-IN STEPS (QA, 28 September)

     FD-8  adults 0 was taken at step 1 and failed at the end as
           "Something went wrong"
     FD-2  Aadhaar "12ab" was carried to "Ready to check in"
     FD-3  the whole Aadhaar number was on the summary - the last four
           only, as everywhere (D21-18)
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-2608-0001", guest: "Asha Kulkarni",
  roomNumber: "204", roomType: "Superior", ratePlan: "CP", arrival: "2026-08-25",
  departure: "2026-08-27", nights: 2, adults: 2, children: 0, status: "due-in",
  nationality: "IN",
} as unknown as Stay;

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockResolvedValue([] as never);
  vi.spyOn(operations, "checkInAllowed").mockResolvedValue({ allowed: true });
  vi.spyOn(operations, "earlyArrival").mockResolvedValue({
    isEarly: false, checkInTime: "14:00", checkOutTime: "11:00", charge: null,
    lateCharge: null, mayWaive: false,
  } as never);
  vi.spyOn(operations, "assignableRooms").mockResolvedValue([
    { number: "204", type: "Superior", status: "clean", housekeeping: "clean", allowed: true },
  ] as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the check-in steps", () => {
  it("stops 0 adults on step 1, refuses an Aadhaar that is not one, and shows only its last four", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-08-25" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const cont = () => screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));

    fireEvent.change(screen.getByLabelText("Adults"), { target: { value: "0" } });
    expect(cont().disabled).toBe(true);
    expect(document.querySelector("[data-party-wrong]")?.textContent)
      .toBe("Adults is a whole number from 1 to 99.");
    fireEvent.change(screen.getByLabelText("Adults"), { target: { value: "2" } });
    fireEvent.click(cont());                                    // Guest
    await screen.findByText("204");
    fireEvent.click(cont());                                    // Room

    fireEvent.change(screen.getByLabelText("Document"), { target: { value: "aadhaar" } });
    fireEvent.change(screen.getByLabelText(/^Number/), { target: { value: "12ab" } });
    expect(document.querySelector("[data-id-wrong]")?.textContent).toMatch(/12 digits/);
    expect(cont().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Number/), { target: { value: "234567890124" } });
    expect(cont().disabled).toBe(false);
    fireEvent.click(cont());                                    // ID
    fireEvent.click(cont());                                    // Rate

    expect(screen.getByText(/Aadhaar ending 0124/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("234567890124");
  });
});

/* FD-4, FD-6, FD-9: Change dates or guests saved children -1, read a
   cleared arrival as "NaN nights", and had no length limit. */
describe("Change dates or guests", () => {
  it("says what is wrong and holds Save", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AmendStayFlow hotelId="5EL" stay={STAY} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    const said = () => document.querySelector("[data-amend-summary]")?.textContent;

    fireEvent.change(screen.getByLabelText("Children"), { target: { value: "-1" } });
    expect(said()).toBe("Children is a whole number from 0 to 99.");
    expect(save().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Children"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Arrival"), { target: { value: "" } });
    expect(said()).toBe("Choose a date.");
    expect(save().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Arrival"), { target: { value: "2026-08-25" } });
    fireEvent.change(screen.getByLabelText("Departure"), { target: { value: "2026-12-01" } });
    expect(said()).toMatch(/at most 90 nights/);
    expect(save().disabled).toBe(true);
  });
});
