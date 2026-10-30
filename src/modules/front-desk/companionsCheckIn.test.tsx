import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as operations from "@/modules/front-desk/data/operations";
import { startSignedIn } from "@/test/app";
import { CheckInFlow } from "@/modules/front-desk/flows/CheckInFlow";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   CHECK-IN IS NEVER BLOCKED (the owner's D27-382, GUE-6)

   Guests' StayCompanions sits on the check-in window. An adult missing is
   a warning, each person is saved on their own call, and the check-in's
   call knows nothing of them. The block itself is tested in the guests
   service (companions.test.tsx), the server in companions.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-2609-0001", guest: "Lead Guest", roomNumber: "204",
  roomType: "Superior", ratePlan: "CP", arrival: "2026-09-27", departure: "2026-09-29", nights: 2,
  adults: 2, children: 0, status: "due-in", nationality: "IN",
} as unknown as Stay;

let sent: { path: string; method: string }[] = [];
let body: Parameters<typeof operations.checkIn>[2] | null = null;

beforeEach(() => {
  startSignedIn();
  sent = [];
  body = null;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (init.method) {
      sent.push({ path, method: init.method });
      return { ok: true } as never;
    }
    return (path.endsWith("/companions")
      ? { adults: 2, recorded: 1, lead: "Lead Guest", leadNationality: "IN", open: true, companions: [] }
      : []) as never;
  });
  vi.spyOn(operations, "checkInAllowed").mockResolvedValue({ allowed: true });
  vi.spyOn(operations, "earlyArrival").mockResolvedValue({
    isEarly: false, checkInTime: "14:00", checkOutTime: "11:00", charge: null,
    lateCharge: null, mayWaive: false,
  } as never);
  vi.spyOn(operations, "assignableRooms").mockResolvedValue([
    { number: "204", type: "Superior", status: "clean", housekeeping: "clean", allowed: true },
  ] as never);
  vi.spyOn(operations, "checkIn").mockImplementation(async (_h, _s, input) => {
    body = input;
    return { ok: true, data: STAY };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("checking in with an adult not recorded", () => {
  it("is never held up, and the check-in's own call knows nothing of them", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-09-27" /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
    expect(await screen.findByText("2 adults, 1 recorded")).toBeTruthy();
    await screen.findByText("Room 204");

    /* The window over the window: saved on its own, and the check-in stays open. */
    fireEvent.click(screen.getByRole("button", { name: "Add an adult" }));
    const inner = await screen.findByRole("dialog", { name: "Add an adult" });
    fireEvent.change(within(inner).getByLabelText(/^Full name/), { target: { value: "Asha Rao" } });
    fireEvent.click(within(inner).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: "POST", path: "/api/hotels/5EL/stays/stay-1/companions" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add an adult" })).toBeNull());
    expect(screen.getByText("Room 204")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Document/), { target: { value: "passport" } });
    fireEvent.change(screen.getByLabelText(/^Number/), { target: { value: "A1234567" } });

    const go = screen.getAllByRole("button", { name: /Check in/ }).at(-1) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    await waitFor(() => expect(body).not.toBeNull());
    expect(JSON.stringify(body)).not.toMatch(/companion/i);
  });
});
