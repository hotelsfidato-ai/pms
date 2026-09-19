import { describe, it, expect } from "vitest";
import {
  THRESHOLDS, aheadBy, comparable, datesAhead, nightsBetween,
  sameMonthLastYear, softestFirst, suggest, temperOf,
  type DateAhead, type OutlookDay,
} from "./outlook";
import { dateLong } from "@/lib/format";
import type { PeriodStatistics } from "@/data/repositories/types";

/* ══════════════════════════════════════════════════════════════════
   WHAT THIS SERVICE SAYS, AND WHAT IT REFUSES TO SAY

   Two rules are worth a test each, because breaking either is silent:

     a suggestion never names a price (D18-15 - the moment it does,
     this service is setting a rate with extra steps), and

     a month the property could not have traded in has NO comparison,
     not a zero (the brief, and the owner's standing rule about invented
     figures). 5 Elements opened in this system in August 2026, so for
     most of this year that is the branch that runs.
   ══════════════════════════════════════════════════════════════════ */

const day = (over: Partial<DateAhead> = {}): DateAhead => ({
  date: "2026-09-26", available: 17, sold: 6, occupancyPct: 35.29,
  left: 11, daysOut: 8, ...over,
});

const month = (over: Partial<PeriodStatistics> = {}): PeriodStatistics => ({
  from: "2026-09-01", to: "2026-09-30",
  availableRoomNights: 510, roomsSold: 204, occupancyPct: 40,
  adr: 3178.63, revpar: 1271.45, roomRevenue: 648_440.52, ...over,
});

describe("how a night is filling", () => {
  it("calls a close-in, lightly booked night soft", () => {
    expect(temperOf(day({ daysOut: 4, occupancyPct: 35 }))).toBe("soft");
  });

  it("does not call a far-off night soft - there is still time", () => {
    expect(temperOf(day({ daysOut: THRESHOLDS.closeInDays + 1, occupancyPct: 10 })))
      .toBe("steady");
  });

  it("calls a nearly full night strong, however far off", () => {
    expect(temperOf(day({ daysOut: 60, occupancyPct: 92 }))).toBe("strong");
  });

  it("says nothing about a night with no rooms to sell", () => {
    /* Every room blocked: 0% of nothing is not a soft date, it is a
       closed one, and "consider a lower rate" would be nonsense. */
    expect(temperOf(day({ available: 0, sold: 0, occupancyPct: 0, left: 0 })))
      .toBe("steady");
    expect(suggest(day({ available: 0, sold: 0, occupancyPct: 0, left: 0 })))
      .toBeNull();
  });
});

describe("the sentence, and its reason", () => {
  it("suggests considering a lower rate on a soft night, with the figures", () => {
    const s = suggest(day({ date: "2026-09-26", daysOut: 4, occupancyPct: 35, left: 11 }))!;
    expect(s.temper).toBe("soft");
    expect(s.text).toContain("Consider a lower rate");
    expect(s.reason).toBe("4 days out, 35% sold, 11 of 17 rooms left.");
  });

  it("suggests holding or raising when a night is filling well", () => {
    const s = suggest(day({ occupancyPct: 92, sold: 16, left: 1 }))!;
    expect(s.temper).toBe("strong");
    expect(s.text).toContain("holding or raising");
  });

  it("says tonight and tomorrow in words, not as a number of days", () => {
    expect(suggest(day({ daysOut: 0, occupancyPct: 20 }))!.reason).toContain("tonight,");
    expect(suggest(day({ daysOut: 1, occupancyPct: 20 }))!.reason).toContain("tomorrow,");
  });

  it("NEVER names a price - the one rule this service has", () => {
    /* D18-15. A suggestion that carried a figure would be this service
       setting a rate, which is exactly what it may not do. Rupees, a
       currency word, or any figure at all in the sentence would be one. */
    for (const d of [
      day({ daysOut: 0, occupancyPct: 5 }),
      day({ daysOut: 3, occupancyPct: 35 }),
      day({ daysOut: 40, occupancyPct: 95 }),
    ]) {
      const s = suggest(d)!;
      expect(s.text, s.text).not.toMatch(/₹|\bINR\b|\brupee/i);
      /* The only figures in the sentence are the ones in the date it
         names. Take the date out and no digit may be left - a price, a
         percentage or a room count in there would each fail this. */
      expect(s.text.replace(dateLong(d.date), ""), s.text).not.toMatch(/\d/);
    }
  });

  it("uses no long dash anywhere a person reads it (D17-48)", () => {
    for (const d of [day({ occupancyPct: 20 }), day({ occupancyPct: 95 })]) {
      const s = suggest(d)!;
      expect(`${s.text} ${s.reason}`).not.toContain("\u2014");
    }
  });
});

describe("the window ahead", () => {
  const rows: OutlookDay[] = [
    { date: "2026-09-17", available: 17, sold: 17, occupancyPct: 100 },
    { date: "2026-09-18", available: 17, sold: 3, occupancyPct: 17.65 },
    { date: "2026-09-20", available: 17, sold: 1, occupancyPct: 5.88 },
  ];

  it("drops nights before the property's own business date", () => {
    expect(datesAhead(rows, "2026-09-18").map((d) => d.date))
      .toEqual(["2026-09-18", "2026-09-20"]);
  });

  it("counts rooms left and nights out from the property's day", () => {
    const [today, later] = datesAhead(rows, "2026-09-18");
    expect(today).toMatchObject({ left: 14, daysOut: 0 });
    expect(later).toMatchObject({ left: 16, daysOut: 2 });
  });

  it("never shows a negative number of rooms left", () => {
    /* A type can be oversold deliberately - every hotel does it - and
       "-2 rooms left" is not a sentence anybody acts on. */
    const [over] = datesAhead(
      [{ date: "2026-09-18", available: 17, sold: 19, occupancyPct: 111.76 }],
      "2026-09-18",
    );
    expect(over!.left).toBe(0);
  });

  it("puts the softest night first, then the nearest", () => {
    expect(softestFirst(datesAhead(rows, "2026-09-18")).map((d) => d.date))
      .toEqual(["2026-09-20", "2026-09-18"]);
  });

  it("counts whole days across a month end and a leap day", () => {
    expect(nightsBetween("2026-09-30", "2026-10-01")).toBe(1);
    expect(nightsBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("pace, against the same month last year", () => {
  it("compares when the property was trading", () => {
    expect(aheadBy({ now: month({ occupancyPct: 40 }),
                     lastYear: month({ occupancyPct: 31.5 }) })).toBe(8.5);
  });

  it("has NO comparison when the property had nothing to sell", () => {
    /* Not 40 points ahead of nothing, and not 0% last year: no
       comparison at all, which the screen says in words. */
    const none = month({ availableRoomNights: 0, roomsSold: 0, occupancyPct: 0 });
    expect(comparable(none)).toBeNull();
    expect(aheadBy({ now: month(), lastYear: none })).toBeNull();
    expect(aheadBy({ now: month(), lastYear: null })).toBeNull();
  });

  it("takes the same month a year back, and February's real length", () => {
    expect(sameMonthLastYear("2026-09-01")).toEqual({ from: "2025-09-01", to: "2025-09-30" });
    expect(sameMonthLastYear("2025-02-01")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});
