import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api";
import { useUi } from "@/lib/ui";
import { TooltipProvider } from "@/components/ui";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import { mayReach } from "@/components/app/navigation";
import { SETTINGS_PAGES, addressOf } from "@/components/app/settingsConsole";
import OldDataPage from "@/modules/admin/oldData/OldDataPage";
import type { ImportsView } from "@/modules/admin/data/oldSystem";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → BRING IN OLD DATA, the screen's half (D27-383 item 7)

   Who reaches it (the owner and an Admin; not the GM, not reception), the
   server's refusal said in its words, a booking brought in with no rate a
   dash - never ₹0 - and what each import brought in, with Undo while it
   stands. The server's half, every refusal and the all-or-nothing save, is
   api/test/modules/admin/oldSystem.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const VIEW: ImportsView = {
  may: true, businessDate: "2026-11-07", firstDay: "2026-11-07", voucherOn: true,
  imports: [
    { id: "i2", kind: "bookings", system: "IDS", fileName: "ids-reservations.csv", rowsIn: 6, rowsRefused: 2,
      refused: [{ line: 4, reason: "This hotel has no room type \"Suite\": Superior, Deluxe." }, { line: 7, reason: "In the house today" }],
      madeAt: "2026-11-07T09:15:43Z", madeBy: "Group Owner", undoneAt: null, undoneBy: null,
      guests: 2, filled: 0, bookings: 1, stays: 1, advances: 1 },
    { id: "i1", kind: "guests", system: "IDS", fileName: "ids-guests.csv", rowsIn: 3, rowsRefused: 0, refused: [],
      madeAt: "2026-11-07T09:14:46Z", madeBy: "Group Owner", undoneAt: "2026-11-07T09:14:56Z", undoneBy: "Group Owner",
      guests: 3, filled: 0, bookings: 0, stays: 0, advances: 0 },
  ],
  noRate: [{ id: "r1", reference: "FH-AGR-2611-5032", guest: "Meera Iyer", arrival: "2026-11-25", roomType: "Deluxe" }],
};

function as(role: Role) {
  signedIn({
    scope: { staffId: "33333333-3333-3333-3333-333333333333", email: "x@fidato.in", fullName: "X",
             isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }] },
  });
  useUi.setState({ hotelId: "AGR" });
}

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TooltipProvider><MemoryRouter><OldDataPage /></MemoryRouter></TooltipProvider>
  </QueryClientProvider>,
);

beforeEach(() => as("owner"));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("who reaches it", () => {
  it("is a Settings page for the owner and an Admin, not the GM or reception", () => {
    const page = SETTINGS_PAGES.find((p) => p.slug === "old-data")!;
    expect(addressOf(page)).toBe("/settings/property/old-data");
    for (const role of ["owner", "admin"] as const) expect(mayReach(role, addressOf(page)), role).toBe(true);
    for (const role of ["gm", "front_desk", "finance"] as const) expect(mayReach(role, addressOf(page)), role).toBe(false);
  });

  it("says the server's refusal in its words", async () => {
    vi.spyOn(apiModule, "api").mockRejectedValue(new ApiError(403, "Forbidden",
      { ok: false, reason: "Bringing in an old system's guests and bookings is for the owner or an administrator. Ask one of them." }));
    show();
    expect(await screen.findByText(/is for the owner or an administrator/)).toBeTruthy();
    expect(screen.queryByText("Choose the file")).toBeNull();
  });
});

describe("the page", () => {
  beforeEach(() => {
    vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
      if (path === "/api/hotels/AGR/imports") return VIEW as never;
      return new Promise(() => {}) as never;
    });
  });

  it("lists a booking brought in with no rate as a dash, never ₹0", async () => {
    show();
    const row = (await screen.findAllByText("Meera Iyer")).map((e) => e.closest("tr")).find(Boolean)!;
    expect(within(row).getByText("-")).toBeTruthy();
    expect(within(row).queryByText(/₹/)).toBeNull();
  });

  it("lists each import with who, rows in and refused, and Undo only while it stands", async () => {
    show();
    const live = (await screen.findAllByText("ids-reservations.csv")).map((e) => e.closest("tr")).find(Boolean)!;
    expect(within(live).getByText("Group Owner")).toBeTruthy();
    expect(within(live).getByText("6")).toBeTruthy();
    expect(within(live).getByRole("button", { name: "2" })).toBeTruthy();
    expect(within(live).getByText("2 guests, 1 booking, 1 past stay, 1 advance")).toBeTruthy();
    expect(within(live).getByRole("button", { name: /Undo/ })).toBeTruthy();
    const gone = screen.getAllByText("ids-guests.csv").map((e) => e.closest("tr")).find(Boolean)!;
    expect(within(gone).queryByRole("button", { name: /Undo/ })).toBeNull();
    expect(within(gone).getByText(/Undone 7 Nov 2026 by Group Owner/)).toBeTruthy();
  });

  it("warns that a booking's voucher goes to its guest, as every booking's does", async () => {
    show();
    (await screen.findByRole("tab", { name: "Bookings and past stays" })).click();
    expect(await screen.findByText(/sent the hotel.s voucher, as every booking is/)).toBeTruthy();
  });
});
