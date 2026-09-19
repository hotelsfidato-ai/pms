import { describe, it, expect } from "vitest";
import {
  WINDOWS, counted, onTheBooksAWeekAgo, pickupOn, whyNoPickup, windowOpens,
  type Pickup, type PickupNight,
} from "./pickup";

/* ══════════════════════════════════════════════════════════════════
   WHEN A PICKUP FIGURE IS A FIGURE, AND WHEN IT IS A DASH

   The counting is SQL and is checked where it runs
   (`api/test/modules/revenue-management/pickup.test.ts`, against the
   reports service's own `sold`). What is checked here is the only
   judgement this service makes about those counts: whether it is
   entitled to print them at all.

   Both rules are silent when broken, which is why each has a test:

     a window that opens before this property's booking records do
     cannot tell "picked up in the last 30 days" from "every booking we
     have", so it is a dash and a sentence - never a zero, and never a
     number that reads like news (HANDOVER § 5, and the same shape as
     D17-93), and

     "a week ago" is derived from what is on the books TODAY, so it is
     null rather than nought when the records do not reach back a week.
   ══════════════════════════════════════════════════════════════════ */

const night = (over: Partial<PickupNight> = {}): PickupNight => ({
  date: "2026-09-26", sold: 9, last1: 1, last7: 4, last30: 7, ...over,
});

const pickup = (over: Partial<Pickup> = {}): Pickup => ({
  from: "2026-09-01", to: "2026-12-19",
  businessDate: "2026-09-19",
  recordsFrom: "2026-01-04",
  nights: [night()],
  ...over,
});

describe("the window a pickup figure covers", () => {
  it("opens on the business date itself for one day", () => {
    expect(windowOpens("2026-09-19", 1)).toBe("2026-09-19");
  });

  it("covers the business date and the six days before it for seven", () => {
    expect(windowOpens("2026-09-19", 7)).toBe("2026-09-13");
  });

  it("crosses a month end without help", () => {
    expect(windowOpens("2026-03-05", 30)).toBe("2026-02-04");
  });
});

describe("a figure nobody could tell from another figure is not shown", () => {
  it("counts every window when the records go back further", () => {
    const p = pickup();
    expect(WINDOWS.every((w) => counted(p, w))).toBe(true);
    expect(pickupOn(p, "2026-09-26"))
      .toEqual({ last1: 1, last7: 4, last30: 7 });
    expect(whyNoPickup(p)).toBeNull();
  });

  it("dashes only the windows that open before the records do", () => {
    /* Records begin six days before the property's own day: one day of
       pickup is a fact, thirty days is every booking it has. */
    const p = pickup({ recordsFrom: "2026-09-13" });
    expect(counted(p, 1)).toBe(true);
    expect(counted(p, 7)).toBe(true);
    expect(counted(p, 30)).toBe(false);
    expect(pickupOn(p, "2026-09-26"))
      .toEqual({ last1: 1, last7: 4, last30: null });
  });

  it("dashes all three when the property's own day is before its records", () => {
    /* The demo, and any property whose night audit is behind: the
       business date is 27 August and nothing was recorded until 14
       September, so every window opens before the first record. A zero
       here would read as "nothing was picked up", which is a different
       claim entirely. */
    const p = pickup({ businessDate: "2026-08-27", recordsFrom: "2026-09-14" });
    expect(pickupOn(p, "2026-09-26"))
      .toEqual({ last1: null, last7: null, last30: null });
    expect(whyNoPickup(p)).toContain("14 September 2026");
    expect(whyNoPickup(p)).toContain("27 August 2026");
  });

  it("says so when the property has no booking recorded at all", () => {
    const p = pickup({ recordsFrom: null, nights: [] });
    expect(pickupOn(p, "2026-09-26"))
      .toEqual({ last1: null, last7: null, last30: null });
    expect(whyNoPickup(p)).toContain("No booking has been recorded");
  });

  it("says so, rather than showing nothing, when pickup could not be read", () => {
    expect(pickupOn(null, "2026-09-26"))
      .toEqual({ last1: null, last7: null, last30: null });
    expect(whyNoPickup(null)).toContain("rather than guessed");
  });

  it("dashes a night the route did not answer for", () => {
    expect(pickupOn(pickup(), "2027-01-01"))
      .toEqual({ last1: null, last7: null, last30: null });
  });
});

describe("where this month stood a week ago", () => {
  const month = { from: "2026-09-01", to: "2026-09-30", roomsSold: 120 };

  it("is what is on the books now, less what was booked this week", () => {
    const p = pickup({
      nights: [
        night({ date: "2026-09-10", last7: 3 }),
        night({ date: "2026-09-26", last7: 4 }),
      ],
    });
    expect(onTheBooksAWeekAgo(month, p)).toBe(113);
  });

  it("ignores nights outside the month - pace is a month, not a window", () => {
    const p = pickup({
      nights: [
        night({ date: "2026-09-26", last7: 4 }),
        night({ date: "2026-10-02", last7: 50 }),
      ],
    });
    expect(onTheBooksAWeekAgo(month, p)).toBe(116);
  });

  it("is a dash, not a nought, when the records do not reach back a week", () => {
    expect(onTheBooksAWeekAgo(month, pickup({ recordsFrom: "2026-09-18" })))
      .toBeNull();
    expect(onTheBooksAWeekAgo(month, null)).toBeNull();
  });
});
