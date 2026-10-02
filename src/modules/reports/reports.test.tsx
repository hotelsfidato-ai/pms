import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import App from "@/App";
import * as apiModule from "@/lib/api";
import { HOTEL, go, startSignedIn, signedIn } from "@/test/app";
import { BUSINESS_DATE, setBusinessDate } from "@/data/repositories/businessDate";

/* Reports' screens, rendered through the whole application — the shell,
   the session and the route included. Moved here from `src/App.test.tsx`
   when the screen tests were split by service; where every test starts
   is `src/test/app.ts`. */

beforeEach(startSignedIn);

/* "Group" became the Dashboard on 14 September, the owner's call: the
   numbers a hotel lives by, and quick reports. The table of every hotel
   moved to its own screen, All properties (the owner's D27-243). */
describe("the dashboard at /", () => {
  it("is called Dashboard and leads with the hotel's own numbers", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeDefined();
    expect(await screen.findByText("Occupancy")).toBeDefined();
    expect(await screen.findByText("Room revenue")).toBeDefined();
  });

  it("draws its loading figures without a <div> inside a <p> (30 September)", async () => {
    /* The tile figure's <p> held the Skeleton, a <div>: React logged it on
       every load of the Dashboard. */
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<App />);
      expect(await screen.findByText("Occupancy")).toBeDefined();
      /* React logs it as a format string: "%s cannot be a descendant of <%s>". */
      const said = logged.mock.calls.map(([f, ...args]) =>
        args.reduce<string>((s, a) => s.replace("%s", String(a)), String(f)));
      expect(said.join("\n")).not.toMatch(/cannot be a descendant of <p>/);
    } finally {
      logged.mockRestore();
    }
  });

  it("opens the list behind each count in the house", async () => {
    /* A count a clerk cannot follow is a number to read and nothing to
       do — each tile in "The house now" is the door to its list. */
    render(<App />);
    /* Inside the page, not the sidebar — the menu has an Arrivals link
       of its own. And for THE PROPERTY IN VIEW: the first version of
       the page settled on the first hotel in the list, and this found
       a tile pointing at AGR under a sidebar on 5EL. */
    const main = await screen.findByRole("main");
    const arrivals = await within(main).findByRole("link", { name: /Arrivals/ });
    expect(arrivals.getAttribute("href")).toBe(`/h/${HOTEL}/arrivals`);
  });

  it("says the figures did not load, rather than show a failure as dashes", async () => {
    /* A dash on this page means "a figure this system does not hold yet".
       A report that failed printed the same dashes and said nothing, so a
       server fault read as a business with no figures. */
    const real = apiModule.api;
    const spy = vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) =>
      url.includes("/reports/manager")
        ? Promise.reject(new apiModule.ApiError(500, "Request failed (500)."))
        : real(url, init)) as typeof real);
    try {
      render(<App />);
      expect(await screen.findByText("Today's figures did not load", {}, { timeout: 15000 })).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  }, 20000);

  it("All properties reads every property on its own day, not the day of the hotel in view", async () => {
    /* Agra is on 2 September; 5 Elements has not closed 25 August. The
       table read every row on the date of the hotel in view, so 5 Elements'
       month so far was asked for September. The table moved to All
       properties (D27-243), for the owner. */
    const hotel = (code: string, name: string, businessDate: string) => ({
      id: code, code, name, city: "", state: "", gstin: null, timezone: "Asia/Kolkata",
      currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", businessDate,
    });
    const before = BUSINESS_DATE;
    setBusinessDate("2026-09-02");
    signedIn({
      scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in", fullName: "Owner",
        isGroupAdmin: true, hotels: [] },
      hotels: [hotel(HOTEL, "5 Elements", "2026-08-25"), hotel("AGR", "Fidato Agra", "2026-09-02")],
    });
    const real = apiModule.api;
    const asked: string[] = [];
    const spy = vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
      asked.push(url);
      return real(url, init);
    }) as typeof real);
    try {
      go("/all-properties");
      render(<App />);
      await screen.findByRole("heading", { level: 1, name: "All properties" });
      await waitFor(() => expect(asked.filter((u) => u.startsWith(`/api/hotels/${HOTEL}/statistics/period`)))
        .toContainEqual(expect.stringMatching(/from=2026-08-01.*to=2026-08-25/)));
    } finally {
      spy.mockRestore();
      setBusinessDate(before);
    }
  }, 20000);
});
