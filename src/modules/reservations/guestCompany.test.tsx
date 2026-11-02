import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { useSession } from "@/lib/session";
import NewBookingPage from "@/modules/reservations/pages/BookingPage";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S COMPANY ON NEW BOOKING (the owner's D27-371, 27 October)

   Salutation beside Full name at the top of the Guest card; Company name,
   GSTIN and Company address under it, all optional; a GSTIN with a wrong
   check digit is refused on the screen with the server's own sentence
   (validate.ts). Proved on what Save booking sends. The invoice and the
   GST register: api/test/modules/reservations/guestCompany.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const posted: Array<Record<string, unknown>> = [];

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return {
        ok: true, groupId: null, rooms: 1, guest: "Anna Smith", status: "confirmed",
        bookings: [{ id: "r-1", reference: "FH-5EL-2608-0002", roomType: "Deluxe", rate: 3000 }],
        nightly: 3000,
      } as never;
    }
    if (path.includes("/booking-sources")) {
      return [{ id: "src-1", name: "Phone", kind: "direct", channelCode: null,
                isActive: true, commissionPct: null, bookings: 0 }] as never;
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
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const input = (label: string) =>
  screen.getByLabelText<HTMLInputElement>((t) => t === label || t === `${label}*`, { selector: "input" });
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });

const open = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><NewBookingPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Guest" });
  await screen.findByRole("option", { name: "Phone" });
  fireEvent.change(screen.getByLabelText(/Booking source/, { selector: "select" }), { target: { value: "src-1" } });
};

const companyGuest = () => fireEvent.click(screen.getByRole("tab", { name: /^Company guest/ }));

const save = async () => {
  const button = await screen.findByRole("button", { name: "Save booking" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(posted).toHaveLength(1));
  return posted[0]!;
};

describe("New booking's Guest card (D27-371)", () => {
  it("has Salutation beside Full name, and no 'Guest or company' or Title anywhere", async () => {
    await open();
    const salutation = screen.getByLabelText("Salutation", { selector: "select" });
    const fullName = input("Full name");
    /* Side by side, Salutation first. */
    expect(salutation.compareDocumentPosition(fullName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(salutation.closest(".grid")).toBe(fullName.closest(".grid"));
    expect(screen.queryByText("Guest or company")).toBeNull();
    expect(screen.queryByLabelText(/^Title$/)).toBeNull();
    /* D27-392: a normal guest, the default, has no company fields; a company
       guest has them, the name and GSTIN required. */
    expect(screen.queryByText("Company name")).toBeNull();
    companyGuest();
    for (const [label, required] of [["Company name", true], ["GSTIN", true], ["Company address", false]] as const) {
      expect(screen.getByText(label).textContent).toBe(required ? `${label}*` : label);
    }
  });

  it("books without a company, and sends nothing for one", async () => {
    await open();
    type("Full name", "Anna Smith");
    const body = await save();
    expect(body).not.toHaveProperty("guestCompany");
    expect(body).not.toHaveProperty("companyId");
  });

  it("refuses a GSTIN whose check digit is wrong, on the screen, and sends the right one", async () => {
    await open();
    type("Full name", "Anna Smith");
    companyGuest();
    type("Company name", "Acme Traders");
    /* The GST pattern is right; the 15th character is not. */
    type("GSTIN", "27aapfu0939f1zw");
    const sentence = "That GSTIN is not right - a character is mistyped. Check it against the company's GST certificate.";
    expect((await screen.findAllByText(sentence)).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Save booking" }) as HTMLButtonElement).disabled).toBe(true);

    type("GSTIN", "27AAPFU0939F1ZV");
    type("Company address", "4 Park Street, Pune");
    expect(screen.queryByText(sentence)).toBeNull();
    const body = await save();
    expect(body["guestCompany"]).toEqual({
      name: "Acme Traders", gstin: "27AAPFU0939F1ZV", address: "4 Park Street, Pune",
    });
    /* The guest pays: nothing turns this into Bill to company. */
    expect(body).not.toHaveProperty("companyId");
  });
});

/** The api mock above, with one more answer in front of it. */
const answer = (match: (path: string) => boolean, body: unknown) => {
  const base = vi.mocked(apiModule.api).getMockImplementation()!;
  vi.mocked(apiModule.api).mockImplementation(async (path: string, init?: RequestInit) =>
    !init?.method && match(path) ? body as never : base(path, init));
};

describe("D27-372: the Company section's switch, and a returning guest's last company", () => {
  it("hides the three company fields when Settings' Company section is off, and sends none", async () => {
    answer((p) => p.endsWith("/modules"), { modules: [{ module: "booking_company", enabled: false }] });
    await open();
    await waitFor(() => expect(screen.queryByText("Company name")).toBeNull());
    expect(screen.queryByText("GSTIN")).toBeNull();
    expect(screen.queryByText("Company address")).toBeNull();
    type("Full name", "Anna Smith");
    expect(await save()).not.toHaveProperty("guestCompany");
  });

  it("offers their last company once the clerk says Same person; one tap fills it, nothing by itself", async () => {
    answer((p) => p.includes("/guests/returning"), { matches: [{
      guestId: "g-anna", visits: 2, name: "Anna Smith", suggested: true, blacklisted: false, blacklistReason: null,
      lastCompany: { name: "Acme Traders", gstin: "27AAPFU0939F1ZV", address: "4 Park Street, Pune" },
    }] });
    await open();
    type("Full name", "Anna Smith");
    type("Phone", "9876543210");
    fireEvent.click(await screen.findByRole("button", { name: "Same person" }));
    expect(screen.queryByText("Company name"), "nothing fills by itself").toBeNull();
    expect(screen.getByText(/Last company/).textContent).toMatch(/Acme Traders · GSTIN 27AAPFU0939F1ZV/);

    fireEvent.click(screen.getByRole("button", { name: "Use this company" }));
    expect(input("Company name").value).toBe("Acme Traders");
    expect(input("GSTIN").value).toBe("27AAPFU0939F1ZV");
    expect(input("Company address").value).toBe("4 Park Street, Pune");
    expect(await save()).toMatchObject({
      guestId: "g-anna",
      guestCompany: { name: "Acme Traders", gstin: "27AAPFU0939F1ZV", address: "4 Park Street, Pune" },
    });
  });
});

describe("D27-392: Normal guest or Company guest, the GSTIN on Companies and agents, Business source", () => {
  const ON_LIST = { id: "co-1", name: "Agoda", kind: "travel_agent", gstin: "27AAPFU0939F1ZV",
    contactName: null, phone: null, email: null, addressLine: "4 Park Street", city: "Pune", state: null,
    pincode: "411001", creditAllowed: false, creditDays: null, creditLimit: null, contractName: null, contractTo: null };

  it("a GSTIN on the list says Found and fills the name and address; the Business source starts on it", async () => {
    answer((p) => p.endsWith("/company-records"), [ON_LIST]);
    await open();
    type("Full name", "Anna Smith");
    expect(screen.queryByLabelText("Business source", { selector: "select" }), "a normal guest is not asked").toBeNull();
    companyGuest();
    type("GSTIN", "27aapfu0939f1zv");
    expect(await screen.findByText("Found: Agoda, on Companies and agents.")).toBeTruthy();
    expect(input("Company name").value).toBe("Agoda");
    expect(input("Company address").value).toBe("4 Park Street, Pune, 411001");
    expect(await save()).toMatchObject({
      businessSource: "Agoda",
      guestCompany: { name: "Agoda", gstin: "27AAPFU0939F1ZV", address: "4 Park Street, Pune, 411001" },
    });
  });

  it("a GSTIN not on the list says saving adds it", async () => {
    answer((p) => p.endsWith("/company-records"), [ON_LIST]);
    await open();
    companyGuest();
    type("GSTIN", "07AAACF1234K1ZW");
    type("Company name", "Acme Traders");
    expect(await screen.findByText("This company is not on your list. Saving the booking adds it to Companies and agents."))
      .toBeTruthy();
  });

  it("with Business source required at the hotel, a normal guest saves without one and sends none", async () => {
    useSession.setState((s) => ({ hotels: s.hotels.map((h) =>
      ({ ...h, deskRules: { ...h.deskRules, requiredBookingFields: ["businessSource"] } as never })) }));
    await open();
    type("Full name", "Anna Smith");
    expect(await save()).not.toHaveProperty("businessSource");
  });
});
