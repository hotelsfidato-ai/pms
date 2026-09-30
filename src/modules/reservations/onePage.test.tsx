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
/** Every read the page asked for, by path. */
const asked: string[] = [];
let modules: Record<string, boolean> = {};
let refuseCheckIn = false;

beforeEach(() => {
  startSignedIn();
  calls.length = 0;
  asked.length = 0;
  modules = {};
  refuseCheckIn = false;
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
    asked.push(path);
    /* What the server says before anybody's first cash of the day (D27-200). */
    if (path.endsWith("/cashier-shift")) {
      return { businessDate: "2026-08-25", shift: null, waiting: 0, colleagues: [], previous: null } as never;
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
    if (path.includes("/tax/room/before-gst")) {
      const gross = Number(new URL(path, "http://x").searchParams.get("gross"));
      return (gross === 4000 ? { ok: true, pre: 3809.52, rate: 5, total: 4000 }
        : gross === 3000 ? { ok: true, pre: 2857.14, rate: 5, total: 3000 }
        : gross === 502 ? { ok: true, pre: 478.09, rate: 5, total: 501.99 }
        : { ok: false, reason: "An inclusive rate between ₹7,875 and ₹8,850 can't be split under the GST slab: type ₹7,875 or less, or more than ₹8,850." }) as never;
    }
    /* The accounts report keys a row by a slug of its name, and two names can
       share one: the demo had "Walk-In" and "Walk-in", both `walk-in`. */
    if (path.endsWith("/companies")) {
      return [
        { id: "walk-in", name: "Walk-In", kind: "Corporate", bookings: 117, roomNights: 0, revenue: 0, openBalance: 0, commissionPct: null },
        { id: "walk-in", name: "Walk-in", kind: "Corporate", bookings: 18, roomNights: 0, revenue: 0, openBalance: 0, commissionPct: null },
      ] as never;
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

  /* D27-200: the hold of D27-193 went. A receptionist's drawer opens by itself
     on the first cash, so a cash advance with no drawer open is simply taken. */
  it("in cash with no drawer open, is taken and reaches the bill", async () => {
    open();
    await screen.findByRole("heading", { name: "Guest" });
    type(/^Guest or company/, "Anna Smith");
    pick(/^Booking source/, "src-1");
    type(/^Amount/, "2000");
    /* The summary has taken the advance in: the page has settled. It neither
       asks whether a drawer is open nor holds the buttons when none is. */
    await screen.findByText("- ₹2,000.00");
    await new Promise((r) => setTimeout(r, 50));
    expect(asked.filter((path) => path.endsWith("/cashier-shift"))).toEqual([]);
    expect(document.body.textContent).not.toContain("Cash goes into your open drawer");
    expect(button("Save booking").disabled).toBe(false);
    fireEvent.click(button("Save booking"));

    await screen.findByText(/Advance of ₹2,000.00 taken/);
    expect(screen.queryByText(/Advance not taken/)).toBeNull();
    const paid = calls.find((c) => c.path.endsWith("/stays/r-1/payments"));
    expect(paid?.body).toMatchObject({ method: "Cash", amount: 2000, heldAsCredit: true });
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
/* D27-187, D27-195: Rate inclusive of GST, per room line, off by default. The
   split is the server's; the page shows it and sends the typed figure with the
   flag, and says what the server says of a figure it cannot split exactly. */
describe("a rate that includes GST", () => {
  /* A tick box beside the rate, not a sliding switch (D27-199). */
  const typeRate = async (rate: string | null) => {
    open();
    await screen.findByRole("heading", { name: "Guest" });
    type(/^Guest or company/, "Anna Smith");
    pick(/^Booking source/, "src-1");
    const tick = screen.getByRole("checkbox", { name: /Rate includes GST/ });
    expect(tick.getAttribute("aria-checked")).toBe("false");
    expect(tick.closest("[data-inclusive]")!.querySelector("input[type=number]"), "beside the rate").toBeTruthy();
    fireEvent.click(tick);
    if (rate !== null) type(/^Rate/, rate);
  };

  /* D27-199: with no rate typed, the list price is the all-in figure. The flag
     went only with a typed rate, so the tick was silently ignored. */
  it("splits the list price when no rate is typed, and sends the flag without a rate", async () => {
    await typeRate(null);
    await screen.findByText(/₹2,857\.14 a night/);
    await waitFor(() => expect(button("Save booking").disabled).toBe(false));
    fireEvent.click(button("Save booking"));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/bookings"))?.body)
      .toMatchObject({ lines: [expect.objectContaining({ rateIncludesGst: true })] }));
    const sent = (calls.find((c) => c.path.endsWith("/bookings"))!.body as { lines: object[] }).lines[0]!;
    expect(sent).not.toHaveProperty("agreedRate");
  });

  it("prices the line before GST and books the typed figure with the flag", async () => {
    await typeRate("4000");
    await screen.findByText(/₹3,809\.52 a night/);
    await waitFor(() => expect(button("Save booking").disabled).toBe(false));
    fireEvent.click(button("Save booking"));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/bookings"))?.body)
      .toMatchObject({ lines: [expect.objectContaining({ agreedRate: 4000, rateIncludesGst: true })] }));
  });

  it("says a figure cannot split exactly, and holds the buttons in the slab gap", async () => {
    await typeRate("502");
    await screen.findByText("₹502.00 can't split exactly: the bill will say ₹501.99 a night.",
      { selector: "[data-inclusive-note]" });
    type(/^Rate/, "8000");
    await screen.findByText(/can't be split under the GST slab/, { selector: "[data-inclusive-note]" });
    expect(button("Save booking").disabled).toBe(true);
  });
});

describe("the Business source list", () => {
  it("draws two accounts whose ids are the same slug without React's duplicate-key warning", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    open();
    await screen.findByRole("heading", { name: "Guest" });
    const list = screen.getByLabelText(/^Business source/, { selector: "select" }) as HTMLSelectElement;
    await waitFor(() => expect([...list.options].map((o) => o.text)).toEqual(["None", "Walk-In", "Walk-in"]));
    /* React logs it as a format string: "...the same key, `%s`". */
    const said = logged.mock.calls.map(([f, ...args]) =>
      args.reduce<string>((t, x) => t.replace("%s", String(x)), String(f)));
    expect(said.filter((m) => m.includes("two children with the same key"))).toEqual([]);
  });
});

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
