import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api";
import { startSignedIn } from "@/test/app";
import BookingPage from "@/modules/reservations/pages/BookingPage";

/* ══════════════════════════════════════════════════════════════════
   ONE PAGE, THREE BUTTONS (D27-158, D27-163) - what the buttons SEND

   Every door is an existing one and its rules are the server's; here, what
   the page asks of them and in what order (root MEMORY 329):
     - Check in now is greyed with its reason until it can go - the arrival
       is today, one room, a clean room picked (the speed lane's finding 6),
       the ID recorded or its skip explained
     - Check in now is the booking, then front desk's check-in with the ID;
       a check-in refused leaves the booking standing, its room kept
     - an advance goes to the bill held as the guest's credit (D27-4)
     - a section switched off in Settings is not drawn
     - a walk-in opens on its room, today and the Walk-in source
   ══════════════════════════════════════════════════════════════════ */

const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
let modules: Record<string, boolean> = {};
let refuseCheckIn = false;
let drawerOpen = false;

beforeEach(() => {
  startSignedIn();
  calls.length = 0;
  modules = {};
  refuseCheckIn = false;
  drawerOpen = false;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (path.endsWith("/bookings")) {
        return {
          ok: true, groupId: null, rooms: 1, guest: "Anna Smith", status: "confirmed",
          bookings: [{ id: "r-1", reference: "FH-5EL-2608-0002", roomType: "Deluxe", rate: 3000 }],
          nightly: 3000,
        } as never;
      }
      if (path.endsWith("/check-in") && refuseCheckIn) {
        throw new ApiError(409, "That room has not been cleaned yet.");
      }
      if (path.endsWith("/assign")) {
        return { ok: true, room: "101", guest: "Anna Smith", typeChanged: false, typeName: "Deluxe" } as never;
      }
      return { ok: true } as never;
    }
    if (path.includes("/leads/tok-good/booking")) {
      return { name: "Meera Joshi", phone: "9812345678", bookingSourceId: "src-1",
               campaign: "Diwali 2026", channel: "Meta Ads" } as never;
    }
    if (path.includes("/leads/tok-gone/booking")) {
      throw new ApiError(404, "This lead has expired or was erased. Book it by hand.");
    }
    if (path.includes("/booking-sources")) {
      return [
        { id: "src-1", name: "Phone", kind: "direct", channelCode: null, isActive: true, commissionPct: null, bookings: 0 },
        { id: "src-w", name: "Walk-in", kind: "walk_in", channelCode: null, isActive: true, commissionPct: null, bookings: 0 },
      ] as never;
    }
    if (path.includes("/inventory")) {
      return { from: "2026-08-25", to: "2026-08-26", restrictions: [],
               cells: [{ roomTypeId: "rt-1", roomType: "Deluxe", date: "2026-08-25",
                         sellable: 5, occupied: 0, sold: 0, available: 5 }] } as never;
    }
    if (path.includes("/tariff")) {
      return { roomType: "Deluxe", total: 3000, unpriced: null,
               nights: [{ night: "2026-08-25", total: 3000, unpriced: null }] } as never;
    }
    if (path.includes("/tax/room/rate")) return { kind: "room", rate: 5, scheme: "gst" } as never;
    if (path.endsWith("/rooms")) {
      return [
        { number: "101", type: "Deluxe", floor: 1, status: "clean", maxOccupancy: 3, rackRate: 3000 },
        { number: "102", type: "Deluxe", floor: 1, status: "dirty", maxOccupancy: 3, rackRate: 3000 },
      ] as never;
    }
    if (path.endsWith("/modules")) {
      return { modules: Object.entries(modules).map(([module, enabled]) => ({ module, enabled })) } as never;
    }
    if (path.includes("/early-arrival")) {
      return { isEarly: false, checkInTime: "12:00", checkOutTime: "11:00", charge: null,
               lateCharge: null, mayWaive: false } as never;
    }
    if (path.endsWith("/cashier-shift")) {
      return { businessDate: "2026-08-25", shift: drawerOpen ? { id: "d-1" } : null,
               colleagues: [], previous: null } as never;
    }
    if (path.endsWith("/billing-companies")) {
      return [{ id: "co-1", name: "Tata Motors", gstin: "27AAACT2727Q1ZW" }] as never;
    }
    if (path.endsWith("/stays/r-1/postings")) return [] as never;
    if (path.includes("/guest-messages")) {
      return { messages: [], connected: false, notConnected: "Sending is not switched on." } as never;
    }
    if (path.endsWith("/stays/r-1")) return { id: "r-1", guest: "Kavya Rao", roomNumber: "101" } as never;
    if (path.includes("/stays/r-1")) return null as never;
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = (entry = "/") => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}><BookingPage /></MemoryRouter>
    </QueryClientProvider>,
  );
};
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { selector: "input" }), { target: { value } });
const pick = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { selector: "select" }), { target: { value } });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const reasons = () => document.querySelector("[data-booking-reasons]")?.textContent ?? "";

describe("Check in now", () => {
  it("is greyed with its reason until it can go: today, a clean room, the ID", async () => {
    open();
    await screen.findByRole("heading", { name: "Guest" });
    type(/^Guest or company/, "Anna Smith");
    pick(/^Booking source/, "src-1");
    await waitFor(() => expect(button("Save booking").disabled).toBe(false));

    expect(button("Check in now").disabled).toBe(true);
    expect(reasons()).toContain("Check in now: Pick a room.");
    expect(reasons()).toContain("Save and assign room: Pick a room.");

    pick(/^Room$/, "102");
    await waitFor(() => expect(reasons()).toContain("Room 102: Not cleaned yet."));
    expect(button("Save and assign room").disabled).toBe(false);

    pick(/^Room$/, "101");
    await waitFor(() => expect(reasons()).toContain("Record the ID document"));
    expect(button("Check in now").disabled).toBe(true);

    pick(/^Document/, "aadhaar");
    type(/^Number/, "12ab");
    expect(reasons()).toMatch(/12 digits/);
    type(/^Number/, "234567890124");
    await waitFor(() => expect(button("Check in now").disabled).toBe(false));

    /* Not today: the document is taken at check-in, and the button says so. */
    type(/^Arrival/, "2026-09-01");
    await waitFor(() => expect(reasons()).toContain("Check in now: Check in now is for an arrival today."));
    expect(button("Check in now").disabled).toBe(true);
  });

  it("books, then checks in through front desk's door with the ID; refused, the booking stands and its room is kept", async () => {
    refuseCheckIn = true;
    open();
    await screen.findByRole("heading", { name: "Guest" });
    type(/^Guest or company/, "Anna Smith");
    pick(/^Booking source/, "src-1");
    pick(/^Room$/, "101");
    await waitFor(() => expect(reasons()).toContain("Record the ID document"));
    type(/^Reason for skipping/, "Scanner offline");
    await waitFor(() => expect(button("Check in now").disabled).toBe(false));
    fireEvent.click(button("Check in now"));

    await screen.findByText(/Not checked in: That room has not been cleaned yet\./);
    expect(calls.map((c) => c.path.split("/").slice(-1)[0])).toEqual(["bookings", "check-in", "assign"]);
    expect(calls[1]!.path).toContain("/stays/r-1/check-in");
    expect(calls[1]!.body).toMatchObject({
      roomNumber: "101", adults: 2, children: 0, ratePlan: "EP", businessDate: "2026-08-25",
      identity: { nationality: "IN" }, idSkipReason: "Scanner offline",
    });
    expect(calls[2]!.body).toEqual({ roomNumber: "101" });
  });
});

describe("the advance", () => {
  it("goes to the bill after the booking, held as the guest's credit", async () => {
    open();
    await screen.findByRole("heading", { name: "Guest" });
    type(/^Guest or company/, "Anna Smith");
    pick(/^Booking source/, "src-1");
    type(/^Amount/, "2000");
    pick(/^Paid by/, "UPI");
    await waitFor(() => expect(button("Save booking").disabled).toBe(false));
    fireEvent.click(button("Save booking"));

    await screen.findByText(/Advance of ₹2,000.00 taken/);
    /* The check-in link beside the voucher (D27-105), for a guest not yet in. */
    expect(screen.getByRole("button", { name: /Send check-in link/ })).toBeTruthy();
    const paid = calls.find((c) => c.path.endsWith("/stays/r-1/payments"));
    expect(paid?.body).toMatchObject({ method: "UPI", amount: 2000, heldAsCredit: true });
  });

  it("View voucher on the Booked card opens the voucher PDF in a new tab, and sends nothing (D27-187)", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      { ok: true, blob: async () => new Blob(["%PDF-"], { type: "application/pdf" }) } as Response);
    URL.createObjectURL = vi.fn(() => "blob:voucher");
    open();
    await screen.findByRole("heading", { name: "Guest" });
    type(/^Guest or company/, "Anna Smith");
    pick(/^Booking source/, "src-1");
    await waitFor(() => expect(button("Save booking").disabled).toBe(false));
    fireEvent.click(button("Save booking"));

    fireEvent.click(await screen.findByRole("button", { name: /View voucher/ }));
    await waitFor(() => expect(tab.location.href).toBe("blob:voucher"));
    expect(String(fetched.mock.calls[0]![0])).toMatch(/\/api\/hotels\/5EL\/stays\/r-1\/voucher\.pdf$/);
    expect(calls.filter((c) => c.path.endsWith("/confirmation"))).toEqual([]);
  });

  it("in cash, holds the buttons until the clerk's own drawer is open (D27-118, D27-193)", async () => {
    open();
    await screen.findByRole("heading", { name: "Guest" });
    type(/^Guest or company/, "Anna Smith");
    pick(/^Booking source/, "src-1");
    type(/^Amount/, "2000");
    const said = "Cash goes into your open drawer: open it in Cashiering, or take it by card or UPI.";
    await screen.findByText(said, { selector: "[data-advance-problem]" });
    expect(button("Save booking").disabled).toBe(true);

    pick(/^Paid by/, "UPI");
    await waitFor(() => expect(button("Save booking").disabled).toBe(false));
    expect(screen.queryAllByText(said)).toEqual([]);
  });
});

describe("the Settings switches", () => {
  it("draw no section that is switched off, and the rest as they are", async () => {
    modules = { booking_notes: false, booking_company: true };
    open();
    await screen.findByRole("heading", { name: "Guest" });
    const folds = () => [...document.querySelectorAll("summary")].map((s) => s.textContent);
    await waitFor(() => expect(folds()).not.toContain("Notes"));
    /* GST folded into Company and Extras left the page (D27-187, D27-193). */
    expect(folds()).toEqual(["More about the guest", "Booking details", "Company"]);
  });

  it("show a company's GSTIN under the company picked, and call the tax GST", async () => {
    open();
    await screen.findByRole("heading", { name: "Guest" });
    fireEvent.click(screen.getByRole("tab", { name: "Company" }));
    await screen.findByRole("option", { name: "Tata Motors" });
    pick(/^Company/, "co-1");
    const gstin = await screen.findByText("27AAACT2727Q1ZW");
    expect(gstin.closest("details")?.querySelector("summary")?.textContent).toBe("Company");
    expect(screen.getByText("GST", { selector: "dt" })).toBeTruthy();
  });
});

/* "Book this lead" (D27-170): the leads view's token fills the guest, the
   channel and the campaign; an expired or erased one says so and leaves the
   page blank. */
describe("a lead", () => {
  it("fills the name, phone and source, and the booking keeps its campaign", async () => {
    open("/?lead=tok-good");
    await waitFor(() =>
      expect((screen.getByLabelText(/^Guest or company/, { selector: "input" }) as HTMLInputElement).value).toBe("Meera Joshi"));
    expect((screen.getByLabelText(/^Phone/, { selector: "input" }) as HTMLInputElement).value).toBe("9812345678");
    expect((screen.getByLabelText(/^Booking source/, { selector: "select" }) as HTMLSelectElement).value).toBe("src-1");
    await waitFor(() => expect(button("Save booking").disabled).toBe(false));
    fireEvent.click(button("Save booking"));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/bookings"))?.body)
      .toMatchObject({ guestName: "Meera Joshi", phone: "9812345678", campaign: "Diwali 2026" }));
  });

  it("gone: its sentence, and a blank page", async () => {
    open("/?lead=tok-gone");
    expect((await screen.findByText(/This lead has expired or was erased/)).closest("[data-lead-gone]")).toBeTruthy();
    expect((screen.getByLabelText(/^Guest or company/, { selector: "input" }) as HTMLInputElement).value).toBe("");
  });
});

describe("a walk-in", () => {
  it("opens on its room, today and the Walk-in source, and checks them in with the single-lady tick", async () => {
    open("/?room=101&date=2026-08-25");
    await screen.findByText(/A walk-in into room 101/);
    await waitFor(() =>
      expect((screen.getByLabelText(/^Room$/, { selector: "select" }) as HTMLSelectElement).value).toBe("101"));
    expect((screen.getByLabelText(/^Booking source/, { selector: "select" }) as HTMLSelectElement).value).toBe("src-w");
    expect(button("Check in now").className).toContain("bg-brand-orange");

    type(/^Guest or company/, "Kavya Rao");
    fireEvent.click(screen.getByRole("switch", { name: /Woman travelling alone/ }));
    type(/^Reason for skipping/, "Scanner offline");
    await waitFor(() => expect(button("Check in now").disabled).toBe(false));
    fireEvent.click(button("Check in now"));
    await screen.findByText(/In house, room 101/);
    expect(screen.queryByRole("button", { name: /Send check-in link/ })).toBeNull();
    expect(calls[0]!.body).toMatchObject({ bookingSourceId: "src-w", isSingleLady: true, checkIn: "2026-08-25" });
    expect(calls[1]!.path).toContain("/stays/r-1/check-in");
  });

  it("a later night of an empty room is a booking of that room, with no source chosen", async () => {
    open("/?room=101&date=2026-08-30");
    await waitFor(() =>
      expect((screen.getByLabelText(/^Room$/, { selector: "select" }) as HTMLSelectElement).value).toBe("101"));
    expect((screen.getByLabelText(/^Arrival/, { selector: "input" }) as HTMLInputElement).value).toBe("2026-08-30");
    expect((screen.getByLabelText(/^Booking source/, { selector: "select" }) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByText(/A walk-in into room/)).toBeNull();
    expect(button("Save booking").className).toContain("bg-brand-orange");
  });
});
