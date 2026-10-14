import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import App from "@/App";
import DashboardPage from "@/modules/reports/pages/Dashboard";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, HOTEL, go, startSignedIn, signedIn, withDemoHotel } from "@/test/app";
import { flatNavigationFor, sidebarFor } from "@/components/app/navigation";
import type { Role } from "@/lib/permissions";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE DASHBOARD AS SKETCHED (the owner's D27-243, 2 October)

   Today's four tiles lead and open their lists; colours say what staff
   must do; "ARR" on the screen; the nights ahead; the amount departing
   guests still owe, only to whoever sees money; and every property on a
   screen of its own, "All properties", for the owner.
   Real figures only: a figure the system does not hold is a dash.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(() => { startSignedIn(); withDemoHotel(); });

const as = (role: Role) => signedIn({
  scope: {
    staffId: "22222222-2222-2222-2222-222222222222", email: "x@fidato.in", fullName: "X",
    isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

/** The Dashboard alone, with a cache of its own: the app keeps one cache
    for every test in a file, so a read made by an earlier render would
    never be asked again. */
const renderDashboard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><DashboardPage /></MemoryRouter>
  </QueryClientProvider>,
);

/** Every request the screen makes, and an answer for the ones named. */
function spyApi(answers: Record<string, unknown> = {}) {
  const real = apiModule.api;
  const asked: string[] = [];
  const spy = vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
    asked.push(url);
    const hit = Object.keys(answers).find((k) => url.startsWith(k));
    return hit ? Promise.resolve(answers[hit]) : real(url, init);
  }) as typeof real);
  return { asked, spy };
}

describe("D27-243 - today's work leads the Dashboard", () => {
  it("four tiles, each opening its list, before Occupancy; Today's run and the small counts are gone", async () => {
    render(<App />);
    const main = await screen.findByRole("main");
    const work = await within(main).findByRole("region", { name: "Today's work" });
    const href = (name: RegExp) => within(work).getByRole("link", { name }).getAttribute("href");
    expect(href(/^Arrivals/)).toBe(`/h/${HOTEL}/arrivals`);
    expect(href(/^Due out/)).toBe(`/h/${HOTEL}/in-house/due-out`);
    expect(href(/^In house/)).toBe(`/h/${HOTEL}/in-house`);
    expect(href(/^Needs cleaning/)).toBe(`/h/${HOTEL}/housekeeping`);
    /* First on the page: before the Occupancy anchor. */
    const occupancy = within(main).getAllByText("Occupancy")[0]!;
    expect(work.compareDocumentPosition(occupancy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(main).queryByText("Today's run")).toBeNull();
    expect(within(main).queryByRole("link", { name: /^Empty/ })).toBeNull();
    expect(within(main).queryByRole("link", { name: /^Out of service/ })).toBeNull();
  });

  it("says ARR on the screen, not ADR", async () => {
    render(<App />);
    const main = await screen.findByRole("main");
    expect(await within(main).findByText("Average rate (ARR)")).toBeTruthy();
    expect(within(main).queryByText("Average rate (ADR)")).toBeNull();
  });
});

describe("D27-243 - what departing guests still owe, on the Due out tile", () => {
  const OWED = { date: "2026-08-25", leaving: 3, owing: 2, owed: 9870 };

  it("shows the amount, and turns the tile orange, for whoever sees money", async () => {
    as("front_desk");
    const { asked, spy } = spyApi({ [`/api/hotels/${HOTEL}/due-out`]: OWED });
    try {
      renderDashboard();
      const work = await screen.findByRole("region", { name: "Today's work" });
      const tile = within(work).getByRole("link", { name: /^Due out/ });
      await waitFor(() => expect(tile.textContent).toContain("₹9,870"));
      expect(tile.textContent).toContain("2 owe");
      expect(tile.getAttribute("data-state")).toBe("now");
      expect(asked.some((u) => u.startsWith(`/api/hotels/${HOTEL}/due-out`))).toBe(true);
    } finally { spy.mockRestore(); }
  });

  it("is not asked for, and not shown, for a role that does not see money", async () => {
    as("revenue_manager");
    const { asked, spy } = spyApi({ [`/api/hotels/${HOTEL}/due-out`]: OWED });
    try {
      renderDashboard();
      const work = await screen.findByRole("region", { name: "Today's work" });
      const tile = within(work).getByRole("link", { name: /^Due out/ });
      expect(tile.textContent).not.toContain("₹");
      expect(asked.some((u) => u.includes("/due-out"))).toBe(false);
    } finally { spy.mockRestore(); }
  });
});

/* It read every booking ever made three times (its board, the board's open
   bills, today's work) - 793 rows and ~3.5 s each on the demo. */
describe("D27-316 (1) - the Dashboard reads only its day's bookings", () => {
  it("asks for the day's board, never every booking", async () => {
    const { asked, spy } = spyApi();
    try {
      renderDashboard();
      const stays = () => asked.filter((u) => u.split("?")[0]!.endsWith("/stays"));
      await waitFor(() => expect(stays().length).toBeGreaterThanOrEqual(2));
      expect(stays().filter((u) => !u.includes("?from=")), "a read of every booking").toEqual([]);
      expect(stays()).toContain(`/api/hotels/${HOTEL}/stays?from=2026-08-25&to=2026-08-25&board=1`);
    } finally { spy.mockRestore(); }
  });
});

/* The City ledger has real company payments since migration 189 (the cash
   lane, D27-239): the tile reads the Manager report's Closing Balance and
   Payment Received, and no longer says it "shows a dash". */
describe("D27-239 - the City ledger tile reads company payments", () => {
  it("shows the closing balance and what companies paid today", async () => {
    const doc = { sections: [{ key: "city-ledger", rows: [
      { kind: "row", cells: { label: "Payment Received", today: 15000, ptd: 40000, ytd: 90000 } },
      { kind: "total", cells: { label: "Closing Balance", today: 52000, ptd: null, ytd: null } },
    ] }] };
    const { spy } = spyApi({ [`/api/hotels/${HOTEL}/reports/manager`]: doc });
    try {
      renderDashboard();
      /* The Money tile, not the quick report's link of the same name. */
      const tile = (await screen.findAllByText("City ledger")).find((e) => !e.closest("a"))!.closest("div.grid") as HTMLElement;
      await waitFor(() => expect(tile.textContent).toContain("₹52,000"));
      expect(tile.textContent).toContain("Paid today ₹15,000");
      expect(tile.textContent).not.toMatch(/shows a dash/i);
    } finally { spy.mockRestore(); }
  });
});

describe("D27-243 - the nights ahead", () => {
  it("asks for tonight and the 13 nights after it, and shows a dash for a night with no figures", async () => {
    const { asked, spy } = spyApi();
    try {
      renderDashboard();
      const nights = await screen.findByRole("list", { name: /nights ahead/i });
      await waitFor(() => expect(asked).toContainEqual(
        expect.stringMatching(new RegExp(`^/api/hotels/${HOTEL}/statistics/daily\\?from=2026-08-25&to=2026-09-07`))));
      const items = within(nights).getAllByRole("listitem");
      expect(items).toHaveLength(14);
      /* Tonight is the fixture's 25 August; 26 August onwards the fixture
         holds no figures: a dash, never 0%. */
      expect(items[0]!.textContent).toMatch(/Tonight/);
      expect(items[0]!.textContent).toMatch(/\d+%/);
      expect(items[1]!.textContent).not.toMatch(/0%/);
      expect(items[1]!.textContent).toContain("-");
    } finally { spy.mockRestore(); }
  });
});

describe("D27-243 - All properties, for the owner", () => {
  it("is a menu entry under Across properties for the owner, not for a GM or the desk", () => {
    const across = (role: Role) => sidebarFor(role, HOTEL).find((s) => s.key === "across-properties")?.items.map((i) => i.label) ?? [];
    expect(across("owner")).toContain("All properties");
    expect(across("gm")).not.toContain("All properties");
    expect(flatNavigationFor("front_desk", HOTEL).map((i) => i.label)).not.toContain("All properties");
  });

  it("left the Dashboard: no every-property table at its foot", async () => {
    const hotel = (code: string, name: string) => ({
      id: code, code, name, city: "", state: "", gstin: null, timezone: "Asia/Kolkata",
      currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", businessDate: "2026-08-25",
    });
    signedIn({ hotels: [hotel(HOTEL, "5 Elements"), hotel("AGR", "Fidato Agra")] });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Every property" })).toBeNull();
  });

  it("reads each property on its own day, and compares with last year only where there was one", async () => {
    const hotel = (code: string, name: string, businessDate: string) => ({
      id: code, code, name, city: "", state: "", gstin: null, timezone: "Asia/Kolkata",
      currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", businessDate,
    });
    signedIn({
      scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in", fullName: "Owner",
        isGroupAdmin: true, hotels: [] },
      hotels: [hotel(HOTEL, "5 Elements", "2026-08-25"), hotel("AGR", "Fidato Agra", "2026-08-24")],
    });
    const stats = (sold: number, revenue: number) => ({
      from: "", to: "", availableRoomNights: 100, roomsSold: sold, occupancyPct: sold, adr: sold ? revenue / sold : 0,
      revpar: revenue / 100, roomRevenue: revenue,
    });
    const real = apiModule.api;
    const asked: string[] = [];
    const spy = vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
      asked.push(url);
      if (url.startsWith("/api/hotels/AGR/statistics/period")) {
        /* Agra had a last year (2025); 5 Elements did not. */
        return Promise.resolve(url.includes("from=2025-") ? stats(40, 120000) : stats(50, 150000));
      }
      if (url.startsWith(`/api/hotels/${HOTEL}/statistics/period`) && url.includes("from=2025-")) {
        return Promise.resolve(stats(0, 0));
      }
      if (url.includes("/notifications")) return Promise.resolve([]);
      return real(url, init);
    }) as typeof real);
    try {
      go("/all-properties");
      render(<App />);
      expect(await screen.findByRole("heading", { level: 1, name: "All properties" })).toBeTruthy();
      await waitFor(() => {
        expect(asked).toContainEqual(expect.stringMatching(/^\/api\/hotels\/AGR\/statistics\/period\?from=2026-08-01&to=2026-08-24/));
        expect(asked).toContainEqual(expect.stringMatching(new RegExp(`^/api/hotels/${HOTEL}/statistics/period\\?from=2026-08-01&to=2026-08-25`)));
      });
      const main = screen.getByRole("main");
      expect(await within(main).findAllByText("Fidato Agra")).not.toHaveLength(0);
      expect(within(main).getAllByText("No last year yet").length).toBeGreaterThan(0);
      /* The group's comparison counts the one property that had a last year, and says so. */
      expect(within(main).getByText(/1 of 2 properties/)).toBeTruthy();
    } finally { spy.mockRestore(); }
  });

  /* The front-desk lane's rule (D27-237), not a second one: the server's
     own date per property, `today`, against its business date. */
  it("puts a property whose business date is behind first in Needs you", async () => {
    const hotel = (code: string, name: string, businessDate: string, today: string) => ({
      id: code, code, name, city: "", state: "", gstin: null, timezone: "Asia/Kolkata",
      currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", businessDate, today,
    });
    signedIn({
      scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in", fullName: "Owner",
        isGroupAdmin: true, hotels: [] },
      hotels: [hotel(HOTEL, "5 Elements", "2026-08-25", "2026-08-25"), hotel("AGR", "Fidato Agra", "2026-08-22", "2026-08-25")],
    });
    const real = apiModule.api;
    const spy = vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) =>
      url.includes("/notifications") ? Promise.resolve([]) : real(url, init)) as typeof real);
    try {
      go("/all-properties");
      render(<App />);
      const needs = await screen.findByRole("region", { name: "Needs you" });
      const line = await within(needs).findByText(/Fidato Agra: business date/);
      expect(line.textContent).toMatch(/3 days behind today/);
      expect(within(needs).queryByText(/5 Elements: business date/)).toBeNull();
    } finally { spy.mockRestore(); }
  });
});

/* A FRESH SYSTEM, NO PROPERTY AT ALL (the owner's D27-248, 3 October). The
   Dashboard threw on the missing business date (a blank page) and Properties
   hid its form, since "admin" was read off a list that is empty until the
   first property exists. Both seen in the browser on an emptied copy. */
describe("a fresh system with no property", () => {
  const owner = () => signedIn({
    scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in", fullName: "Owner",
      isGroupAdmin: true, hotels: [] },
    hotels: [],
  });

  it("the Dashboard says to add one, and nothing is asked of a hotel", async () => {
    owner();
    const real = apiModule.api;
    const asked: string[] = [];
    const spy = vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
      asked.push(url);
      return real(url, init);
    }) as typeof real);
    try {
      go("/");
      render(<App />);
      expect(await screen.findByText("No property yet")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Add a property" }).getAttribute("href")).toBe("/admin/properties");
      expect(asked.filter((u) => u.startsWith("/api/hotels/"))).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it("Properties offers a group admin the form, though the admin list is empty", async () => {
    owner();
    const real = apiModule.api;
    const spy = vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) =>
      url === "/api/admin/hotels" ? Promise.resolve({ hotels: [] }) : real(url, init)) as typeof real);
    try {
      go("/properties");
      render(<App />);
      expect(await screen.findByRole("button", { name: "Create the property" })).toBeTruthy();
    } finally { spy.mockRestore(); }
  });
});

/* The owner's D27-326 (1), FD-32's note: the API says "void", which StayStatus
   does not name, so the tile's `!== "cancelled"` counted a voided booking as
   an arrival - checked in, as it was not "due-in". */
describe("D27-326 (1) - a voided booking is not one of today's arrivals", () => {
  it("is not counted on the Arrivals tile", async () => {
    const tile = async (extra: Stay[]) => {
      const real = apiModule.api;
      const spy = vi.spyOn(apiModule, "api").mockImplementation((async (url: string, init?: RequestInit) => {
        const answer = await real(url, init);
        return url.split("?")[0]!.endsWith("/stays") ? [...(answer as Stay[]), ...extra] : answer;
      }) as typeof real);
      try {
        renderDashboard();
        const work = await screen.findByRole("region", { name: "Today's work" });
        const link = within(work).getByRole("link", { name: /^Arrivals/ });
        await waitFor(() => expect(link.textContent).toMatch(/still to arrive|checked in|None today/));
        return link.textContent;
      } finally { spy.mockRestore(); cleanup(); }
    };
    const without = await tile([]);
    const [base] = await apiModule.api<Stay[]>(`/api/hotels/${HOTEL}/stays?from=2026-08-25&to=2026-08-25`);
    const voided = { ...base!, id: "stay-voided", guest: "Voided Twice", roomNumber: "VOID",
      arrival: "2026-08-25", departure: "2026-08-27", status: "void" as Stay["status"] };
    expect(await tile([voided])).toBe(without);
  });
});
