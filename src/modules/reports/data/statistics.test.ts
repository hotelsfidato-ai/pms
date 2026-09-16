import { describe, it, expect } from "vitest";
import { monthOf } from "@/modules/reports/data/statistics";

/* REP-1. The monthly reports asked for 1–31 August 2026 and printed
   "August 2026" in every month. monthOf() is where their month now comes
   from, so it is checked away from August: a different month, a
   different year, both Februaries, and the turn of the year. */

describe("the month a report is for", () => {
  it("is the month of the date it is given, not August 2026", () => {
    expect(monthOf("2027-05-10")).toEqual({
      from: "2027-05-01", to: "2027-05-31", name: "May", year: 2027,
    });
    expect(monthOf("2026-08-25")).toEqual({
      from: "2026-08-01", to: "2026-08-31", name: "August", year: 2026,
    });
  });

  it("ends on the month's own last day", () => {
    expect(monthOf("2027-02-10").to).toBe("2027-02-28");
    expect(monthOf("2028-02-10").to).toBe("2028-02-29");
    expect(monthOf("2026-09-16").to).toBe("2026-09-30");
    expect(monthOf("2026-12-31")).toEqual({
      from: "2026-12-01", to: "2026-12-31", name: "December", year: 2026,
    });
    expect(monthOf("2027-01-01")).toEqual({
      from: "2027-01-01", to: "2027-01-31", name: "January", year: 2027,
    });
  });
});
