import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as operations from "@/modules/front-desk/data/operations";
import { startSignedIn } from "@/test/app";
import { CheckInFlow } from "@/modules/front-desk/flows/CheckInFlow";
import { toast } from "@/components/ui";
import { AmendStayFlow } from "@/modules/front-desk/flows/AmendStayFlow";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   ROUND D ON THE CHECK-IN (QA, 28 September), ON ONE PAGE (D27-163)

     FD-8  adults 0 was taken at step 1 and failed at the end as
           "Something went wrong"
     FD-2  Aadhaar "12ab" was carried to "Ready to check in"
     FD-3  the whole Aadhaar number was on the summary - the last four
           only, as everywhere (D21-18); the one page reads nothing back
     speed lane 6  Continue let the Room step through with no room, and
           the server answered "Choose a room." at the very end
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

describe("the check-in, on one page", () => {
  it("holds Check in for 0 adults and an Aadhaar that is not one, and reads the number back nowhere", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-08-25" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const cont = () => screen.getAllByRole("button", { name: /Check in/ }).at(-1) as HTMLButtonElement;
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
    await screen.findByText("Room 204");

    fireEvent.click(screen.getByRole("button", { name: "Change adults and children" }));
    fireEvent.change(screen.getByLabelText("Adults"), { target: { value: "0" } });
    expect(cont().disabled).toBe(true);
    expect(document.querySelector("[data-party-wrong]")?.textContent)
      .toBe("Adults is a whole number from 1 to 99.");
    fireEvent.change(screen.getByLabelText("Adults"), { target: { value: "2" } });

    fireEvent.change(screen.getByLabelText("Document"), { target: { value: "aadhaar" } });
    fireEvent.change(screen.getByLabelText(/^Number/), { target: { value: "12ab" } });
    expect(document.querySelector("[data-id-wrong]")?.textContent).toMatch(/12 digits/);
    expect(cont().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Number/), { target: { value: "234567890124" } });
    expect(cont().disabled).toBe(false);
    expect(document.body.textContent).not.toContain("234567890124");
  });

  it("holds Check in with 'Pick a room' until a clean room is chosen (speed lane 6)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CheckInFlow hotelId="5EL" stay={{ ...STAY, roomNumber: "" } as Stay} businessDate="2026-08-25" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const cont = () => screen.getAllByRole("button", { name: /Check in/ }).at(-1) as HTMLButtonElement;
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
    fireEvent.change(screen.getByLabelText(/Reason for skipping/), { target: { value: "Scanner offline" } });
    expect(cont().disabled).toBe(true);
    expect(document.querySelector("[data-checkin-blocked]")?.textContent).toBe("Pick a room.");

    fireEvent.click(await screen.findByText("204"));
    expect(cont().disabled).toBe(false);
    expect(document.querySelector("[data-checkin-blocked]")).toBeNull();
  });
});

/* THE OWNER'S D27-236 (2 October): the check-in laid out like New booking -
   the room given on one line with Change room, the grid only when needed;
   the party and the meal plan as they stand, each with Change. D27-242:
   an Indian guest whose ID this stay's own online check-in confirmed is not
   asked again; the server decides. */
describe("the check-in, laid out like New booking", () => {
  async function open() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CheckInFlow hotelId="5EL" stay={STAY} businessDate="2026-08-25" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
  }

  it("shows the given room on one line, and the rooms only after Change room", async () => {
    await open();
    expect((await screen.findByText("Room 204")).closest("[data-checkin-room]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^204/ })).toBeNull();
    expect(document.querySelector("[data-checkin-stay]")?.textContent).toContain("2 adults · 0 children");
    fireEvent.click(screen.getByRole("button", { name: "Change room" }));
    expect(screen.getByRole("button", { name: /^204/ })).toBeTruthy();
  });

  const express = () => vi.spyOn(operations, "expressCheckIn").mockResolvedValue({
    express: true, document: { type: "aadhaar", number: "••••••••9012" },
  });

  it("takes the ID confirmed online for this stay, and sends none", async () => {
    express();
    let sent: Parameters<typeof operations.checkIn>[2] | null = null;
    vi.spyOn(operations, "checkIn").mockImplementation(async (_h, _s, input) => {
      sent = input;
      return { ok: true, data: STAY };
    });
    await open();
    expect((await screen.findByText(/ID confirmed from online check-in/)).textContent)
      .toContain("Aadhaar ••••••••9012");
    expect(screen.queryByLabelText("Document")).toBeNull();
    const buttons = screen.getAllByRole("button", { name: /Check in/ });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.identity).toEqual({ nationality: "IN" });
    expect(sent!.idSkipReason).toBe("");
  });

  it("asks for the ID again on Use a different ID", async () => {
    express();
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Use a different ID" }));
    expect(screen.getByLabelText("Document")).toBeTruthy();
    expect(screen.queryByText(/ID confirmed from online check-in/)).toBeNull();
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

/* THE OWNER'S D27-328 (1), 15 October: Assign room gave a Deluxe room to a
   Superior booking, and the check-in pre-selected it without a word, then
   the server refused it. The room list marks "(different type)" as Assign
   room's does, the given room on its one line too, and the clerk is told
   once it is done, in Assign room's sentence. */
describe("an upgrade given by Assign room", () => {
  const UPGRADED = { ...STAY, roomNumber: "302" } as Stay;
  beforeEach(() => {
    vi.spyOn(operations, "assignableRooms").mockResolvedValue([
      { number: "302", type: "Deluxe", status: "clean", housekeeping: "clean", allowed: true },
      { number: "204", type: "Superior", status: "clean", housekeeping: "clean", allowed: true },
    ] as never);
  });

  it("marks the given room (different type), in the list too, and says so once checked in", async () => {
    const said = vi.spyOn(toast, "success");
    vi.spyOn(operations, "checkIn").mockResolvedValue(
      { ok: true, data: { ...UPGRADED, givenRoomType: "Deluxe" } as Stay });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CheckInFlow hotelId="5EL" stay={UPGRADED} businessDate="2026-08-25" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Check in/ }));
    const line = (await screen.findByText("Room 302")).closest("[data-checkin-room]")!;
    expect(line.textContent).toContain("Deluxe (different type)");

    fireEvent.click(screen.getByRole("button", { name: "Change room" }));
    expect(screen.getByRole("button", { name: /^302/ }).textContent).toContain("(different type)");
    expect(screen.getByRole("button", { name: /^204/ }).textContent).not.toContain("different type");
    fireEvent.click(screen.getByRole("button", { name: /^302/ }));

    fireEvent.change(screen.getByLabelText(/Reason for skipping/), { target: { value: "Scanner offline" } });
    const buttons = screen.getAllByRole("button", { name: /Check in/ });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(said).toHaveBeenCalled());
    expect(said.mock.calls[0]![1]).toContain("Note: Deluxe is not the room type they booked.");
  });
});
