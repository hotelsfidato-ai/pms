import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";
import { CompaniesPage } from "@/modules/guests/pages/Guests";

/* ══════════════════════════════════════════════════════════════════
   EDIT ON COMPANIES AND AGENTS (the owner's D27-382)

   Edit lived only inside a company's Contracts page. Now every company on
   the list has it, the same window, for the owner, an Admin and the GM -
   the server's rule on PATCH /companies/:id - and nobody else sees it. A
   booking source has no company record, so no Edit; a company with no
   booking here yet is on the list, or "Edit that company instead" would
   send the clerk nowhere.
   ══════════════════════════════════════════════════════════════════ */

const RECORD = {
  id: "11111111-1111-1111-1111-111111111111", name: "Tata Motors", kind: "corporate",
  gstin: "27AAPFU0939F1ZV", contactName: null, phone: null, email: null,
  addressLine: "1 Station Road", city: "Pune", state: "MH", pincode: "411001",
  creditAllowed: false, creditDays: null, creditLimit: null,
  contractName: null, contractTo: null,
};
const QUIET = { ...RECORD, id: "22222222-2222-2222-2222-222222222222", name: "No Bookings Ltd" };
const row = (name: string, kind: string, revenue: number) => ({
  id: name, name, kind, bookings: 3, roomNights: 5, revenue, openBalance: 0, commissionPct: null,
});

let sent: { path: string; method: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  startSignedIn();
  sent = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (init.method) {
      sent.push({ path, method: init.method, body: JSON.parse(String(init.body)) });
      return { ok: true, id: RECORD.id } as never;
    }
    if (path.endsWith("/company-records")) return [RECORD, QUIET] as never;
    if (path.endsWith("/companies")) {
      return [row("Tata Motors", "Corporate", 9000), row("Agoda", "OTA", 5000)] as never;
    }
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const as = (role: "gm" | "owner" | "admin" | "front_desk" | "hotel_manager") => signedIn({
  scope: {
    staffId: "33333333-3333-3333-3333-333333333333", email: "a@fidato.in", fullName: "A Person",
    isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

const open = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CompaniesPage /></MemoryRouter>
  </QueryClientProvider>,
);

describe("Edit on Companies and agents", () => {
  it("opens the same window on the whole record, and saves through PATCH", async () => {
    as("gm");
    open();
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit Tata Motors" }))[0]!);
    const name = await screen.findByLabelText(/^Name/, { selector: "input" }) as HTMLInputElement;
    expect(name.value).toBe("Tata Motors");
    expect((screen.getByLabelText(/^GSTIN/, { selector: "input" }) as HTMLInputElement).value)
      .toBe("27AAPFU0939F1ZV");

    fireEvent.change(name, { target: { value: "Tata Motors Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: "PATCH", path: expect.stringContaining(`/companies/${RECORD.id}`),
      body: { name: "Tata Motors Ltd", gstin: "27AAPFU0939F1ZV" },
    });
  });

  it("is on a company with no booking here, and not on a booking source", async () => {
    as("gm");
    open();
    expect((await screen.findAllByRole("button", { name: "Edit No Bookings Ltd" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Edit Tata Motors" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Edit Agoda" })).toBeNull();
    /* No booking: a dash, never ₹0. */
    const quiet = screen.getAllByText("No Bookings Ltd").map((n) => n.closest("tr")).find(Boolean)!;
    expect(quiet.textContent).not.toContain("₹0");
  });

  for (const role of ["gm", "owner", "admin"] as const) {
    it(`${role} sees it`, async () => {
      as(role);
      open();
      expect((await screen.findAllByRole("button", { name: "Edit Tata Motors" })).length).toBeGreaterThan(0);
    });
  }

  for (const role of ["front_desk", "hotel_manager"] as const) {
    it(`${role} does not`, async () => {
      as(role);
      open();
      await screen.findAllByText("Tata Motors");
      await screen.findAllByText("No Bookings Ltd");
      expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    });
  }
});
