import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { TooltipProvider, useToastStore } from "@/components/ui";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import { mayReach } from "@/components/app/navigation";
import { SETTINGS_PAGES, addressOf } from "@/components/app/settingsConsole";
import BackfillPage from "@/modules/admin/backfill/BackfillPage";
import { daySummary, totalOf } from "@/modules/admin/backfill/summary";
import type { BackfillView, BackfillStay, BackfillBill, BackfillCash } from "@/modules/admin/data/backfill";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → BACKFILL DATA, the screen's half (the owner's D27-398)

   Three tabs and the day-by-day summary; who reaches it (the owner, an
   Admin and the GM in Settings, the Accountant read-only at its own
   address, reception nowhere); a dash for every figure nobody typed; the
   send tick greyed with the reason when sending is not set up. The server's
   half is api/test/modules/admin/backfill.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const trail = { enteredBy: "Asha GM", enteredAt: "2026-11-07", changedBy: null, changedAt: null,
  changeReason: null, removedBy: null, removedAt: null, removedReason: null };

const stay = (over: Partial<BackfillStay> = {}): BackfillStay => ({
  id: "s1", guestId: "g1", guestName: "Ravi Kumar", phone: "9811100398", email: null, nationality: "IN",
  idType: "driving_licence", idNumber: "DL0420110012345", visaNumber: null, formCReference: null,
  roomId: "r1", room: "101", arrival: "2026-10-29", departure: "2026-10-31", adults: 2, children: 0,
  rate: 3000, roomCharges: 6000, gst: 720, otherCharges: null, otherChargesFor: null,
  paid: 6720, paidBy: "Cash", billNumber: "H-42", sendBill: false, message: null, ...trail, ...over,
});
const bill = (over: Partial<BackfillBill> = {}): BackfillBill => ({
  id: "b1", outletId: "o1", outlet: "Restaurant", billDate: "2026-10-30", billNumber: "R-7",
  amount: 1000, gst: 50, total: 1050, paidBy: "UPI", note: null, ...trail, ...over,
});
const cashLine = (over: Partial<BackfillCash> = {}): BackfillCash => ({
  id: "c1", cashDate: "2026-10-30", direction: "out", amount: 500, purpose: "Plumber", person: "Ramesh", ...trail, ...over,
});

const VIEW: BackfillView = {
  firstDay: "2026-11-01", today: "2026-11-07", mayWrite: true, showsId: true,
  sending: { ok: false, reason: "Sending is not set up yet." },
  rooms: [{ id: "r1", number: "101" }], outlets: [{ id: "o1", name: "Restaurant" }], methods: ["Cash", "UPI"],
  stays: [stay(), stay({ id: "s2", guestName: "No Figures", room: "101", arrival: "2026-10-25", departure: "2026-10-26",
    rate: null, roomCharges: null, gst: null, paid: null, paidBy: null, billNumber: null })],
  bills: [bill()], cash: [cashLine()],
};

function as(role: Role) {
  signedIn({
    scope: { staffId: "33333333-3333-3333-3333-333333333333", email: "x@fidato.in", fullName: "X",
             isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }] },
  });
  useUi.setState({ hotelId: "AGR" });
}

function serve(view: BackfillView) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
    if (path === "/api/hotels/AGR/backfill") return view as never;
    if (path.includes("/guests/returning")) return { matches: [] } as never;
    return new Promise(() => {}) as never;
  });
}

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TooltipProvider><MemoryRouter><BackfillPage /></MemoryRouter></TooltipProvider>
  </QueryClientProvider>,
);
const tab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole("tab", { name }));

beforeEach(() => { as("gm"); useToastStore.setState({ toasts: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("who reaches it", () => {
  it("is a Settings page for the owner, an Admin and the GM, and not for reception or the accountant there", () => {
    const page = SETTINGS_PAGES.find((p) => p.slug === "backfill-data")!;
    expect(addressOf(page)).toBe("/settings/property/backfill-data");
    for (const role of ["owner", "admin", "gm"] as const) expect(mayReach(role, addressOf(page)), role).toBe(true);
    for (const role of ["front_desk", "finance", "hotel_manager"] as const) expect(mayReach(role, addressOf(page)), role).toBe(false);
  });

  it("is the accountant's to read at its own address - and nobody else's there", () => {
    expect(mayReach("finance", "/h/AGR/backfill")).toBe(true);
    for (const role of ["front_desk", "hotel_manager", "read_only", "gm"] as const) {
      expect(mayReach(role, "/h/AGR/backfill"), role).toBe(false);
    }
  });
});

describe("the page", () => {
  it("has the three tabs and the summary, with the first day said", async () => {
    serve(VIEW);
    show();
    expect(await screen.findByText(/First day in the system: 1 Nov 2026\./)).toBeTruthy();
    for (const name of [/^Stays/, /^Restaurant bills/, /^Cash/, /^Day by day/]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    }
    expect(screen.getAllByText("Ravi Kumar").length).toBeGreaterThan(0);
    tab(/^Restaurant bills/);
    expect((await screen.findAllByText("R-7")).length).toBeGreaterThan(0);
    tab(/^Cash/);
    expect((await screen.findAllByText("Plumber")).length).toBeGreaterThan(0);
    tab(/^Day by day/);
    expect((await screen.findAllByText("Total")).length).toBeGreaterThan(0);
  });

  it("shows a dash for every figure nobody typed, never a zero", async () => {
    serve(VIEW);
    show();
    const row = (await screen.findAllByText("No Figures")).map((e) => e.closest("tr")).find(Boolean)!;
    expect(within(row).queryByText(/₹\s?0/)).toBeNull();
    expect(within(row).getAllByText("-").length).toBeGreaterThanOrEqual(2);
  });

  it("greys the send tick with the reason when sending is not set up", async () => {
    serve(VIEW);
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Add a stay/ }));
    const tick = await screen.findByRole("checkbox", { name: "Send the guest their bill and thank-you" });
    expect(tick.getAttribute("aria-disabled") === "true" || (tick as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Sending is not set up yet.")).toBeTruthy();
  });

  it("is read-only for the accountant: Add is disabled, with the reason", async () => {
    as("finance");
    serve({ ...VIEW, mayWrite: false, showsId: false });
    show();
    const add = await screen.findByRole("button", { name: /Add a stay/ });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/Only the owner, an administrator or the general manager enters and corrects these\./).length)
      .toBeGreaterThan(0);
  });
});

describe("the day-by-day summary", () => {
  it("counts each night sold, puts a stay's money on its last night, and leaves removed lines out", () => {
    const rows = daySummary(
      [stay(), stay({ id: "gone", arrival: "2026-10-30", departure: "2026-10-31", removedAt: "x", roomCharges: 999 })],
      [bill()], [cashLine(), cashLine({ id: "c2", direction: "in", amount: 200 })]);
    expect(rows.map((r) => [r.date, r.roomsSold, r.roomCharges])).toEqual([
      ["2026-10-29", 1, null],
      ["2026-10-30", 1, 6000],
    ]);
    const last = rows[1]!;
    expect([last.gst, last.restaurantSales, last.restaurantGst, last.cashIn, last.cashOut])
      .toEqual([720, 1000, 50, 200, 500]);
    expect(last.payments).toEqual({ Cash: 6720, UPI: 1050 });
    expect(totalOf(rows)).toMatchObject({ roomsSold: 2, roomCharges: 6000, otherCharges: null });
  });
});
