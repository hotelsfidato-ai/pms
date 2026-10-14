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
   THE CHECK IN WINDOW LISTS EVERY ROOM TYPE (the owner's D27-330 (1))

   It listed the booked type and a room Assign room had already given, so
   an upgrade at the desk meant Assign room first. Now every type is there,
   the booked type's rooms first, each other type marked "(different type)"
   as D27-328 marks it; choosing one checks the guest in as that upgrade
   does (the server takes it since FD-34, the booked rate stays).
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-2608-0001", guest: "Asha Kulkarni",
  roomNumber: "204", roomType: "Superior", ratePlan: "CP", arrival: "2026-08-25",
  departure: "2026-08-27", nights: 2, adults: 2, children: 0, status: "due-in",
  nationality: "IN",
} as unknown as Stay;

const room = (number: string, type: string, status = "clean") =>
  ({ number, type, status, floor: 1, maxOccupancy: 2, rackRate: null, blocks: [] });

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation((async (url: string) =>
    String(url).endsWith("/rooms")
      ? [room("101", "Deluxe"), room("204", "Superior"), room("302", "Suite"), room("205", "Superior")]
      : []) as never);
  vi.spyOn(operations, "checkInAllowed").mockResolvedValue({ allowed: true });
  vi.spyOn(operations, "earlyArrival").mockResolvedValue({
    isEarly: false, checkInTime: "14:00", checkOutTime: "11:00", charge: null,
    lateCharge: null, mayWaive: false,
  } as never);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the Check in window's rooms", () => {
  it("lists every type, the booked type first, the others marked, and checks in to one", async () => {
    const checkIn = vi.spyOn(operations, "checkIn").mockResolvedValue({ ok: true, data: STAY });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-08-25" /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
    await screen.findByText("Room 204");
    fireEvent.click(screen.getByRole("button", { name: "Change room" }));

    const listed = screen.getAllByRole("button").map((b) => b.textContent ?? "")
      .filter((t) => /^\d{3}/.test(t));
    expect(listed.map((t) => t.slice(0, 3))).toEqual(["204", "205", "101", "302"]);
    expect(listed[0]).not.toContain("different type");
    expect(listed[2]).toContain("Deluxe (different type)");
    expect(listed[3]).toContain("Suite (different type)");

    fireEvent.click(screen.getByRole("button", { name: /^302/ }));
    fireEvent.change(screen.getByLabelText(/Reason for skipping/), { target: { value: "Scanner offline" } });
    const buttons = screen.getAllByRole("button", { name: /Check in/ });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    expect(checkIn.mock.calls[0]![2]).toMatchObject({ roomNumber: "302" });
  });
});
