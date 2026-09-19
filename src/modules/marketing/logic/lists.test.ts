import { describe, it, expect } from "vitest";
import {
  EXPORT_HEADERS, aYearBefore, cameFrom, exportRows, mayBeWrittenTo,
  notReturnedInAYear, stayedTwice, type Addressable,
} from "./lists";
import { toCsv } from "@/lib/csv";

/* ══════════════════════════════════════════════════════════════════
   WHAT A MARKETING LIST MAY NOT CONTAIN

   Three things are worth a test each, because breaking any of them is
   silent - the list still renders, it is simply wrong about a person:

     nobody reaches a list without going through `mayBeWrittenTo`, which
     is the one gate the consent condition is added to when the master
     answers;

     a guest with a booking ahead is not somebody who has not returned,
     however long ago they last left; and

     a figure nobody has is a dash in the export, never a blank cell
     and never a zero.
   ══════════════════════════════════════════════════════════════════ */

const guest = (over: Partial<Addressable> = {}): Addressable => ({
  id: "meera rao", name: "Meera Rao", stays: 1,
  lastStay: "2026-08-12", nextStay: null,
  sources: ["Walk-in"], phone: "+91 98200 11111", email: null, ...over,
});

const ASON = "2026-09-19";

describe("who may be written to at all", () => {
  it("passes a guest with a telephone number", () => {
    expect(mayBeWrittenTo(guest())).toBe(true);
  });

  it("passes a guest with only an email address", () => {
    expect(mayBeWrittenTo(guest({ phone: null, email: "meera@example.in" })))
      .toBe(true);
  });

  it("refuses a guest with neither", () => {
    expect(mayBeWrittenTo(guest({ phone: null, email: null }))).toBe(false);
  });

  it("refuses a guest whose number is blank space", () => {
    /* The desk types a space into a field it cannot leave empty. */
    expect(mayBeWrittenTo(guest({ phone: "   ", email: null }))).toBe(false);
  });

  it("keeps every list behind it", () => {
    /* The gate is only a gate if nothing walks round it. A guest with
       no way to reach them qualifies for all three lists on every other
       count and appears on none. */
    const unreachable = guest({
      phone: null, email: null, stays: 4,
      lastStay: "2024-01-01", sources: ["Agoda"],
    });
    expect(stayedTwice([unreachable])).toEqual([]);
    expect(notReturnedInAYear([unreachable], ASON)).toEqual([]);
    expect(cameFrom([unreachable], "Agoda")).toEqual([]);
  });
});

describe("stayed twice", () => {
  it("takes a guest who has stayed twice", () => {
    expect(stayedTwice([guest({ stays: 2 })]).map((g) => g.name))
      .toEqual(["Meera Rao"]);
  });

  it("leaves a guest who has stayed once", () => {
    expect(stayedTwice([guest({ stays: 1 })])).toEqual([]);
  });
});

describe("not returned in a year", () => {
  it("takes a guest who left more than a year ago", () => {
    expect(notReturnedInAYear([guest({ lastStay: "2025-06-30" })], ASON))
      .toHaveLength(1);
  });

  it("leaves a guest who left within the year", () => {
    expect(notReturnedInAYear([guest({ lastStay: "2025-09-20" })], ASON))
      .toEqual([]);
  });

  it("leaves a guest who is arriving next month - they have returned", () => {
    expect(notReturnedInAYear(
      [guest({ lastStay: "2024-03-01", nextStay: "2026-10-04" })], ASON,
    )).toEqual([]);
  });

  it("leaves a guest who has never stayed", () => {
    /* A booking that has not happened yet has no last stay. "Has not
       returned" is about somebody who came once, not about somebody the
       hotel has never met. */
    expect(notReturnedInAYear([guest({ lastStay: null })], ASON)).toEqual([]);
  });

  it("takes a year off a date without building one", () => {
    expect(aYearBefore("2026-09-19")).toBe("2025-09-19");
    expect(aYearBefore("2028-02-29")).toBe("2027-02-29");
  });
});

describe("came from a booking site", () => {
  it("takes a guest who booked through that site", () => {
    expect(cameFrom([guest({ sources: ["Agoda", "Walk-in"] })], "Agoda"))
      .toHaveLength(1);
  });

  it("leaves a guest who booked through another", () => {
    expect(cameFrom([guest({ sources: ["Walk-in"] })], "Agoda")).toEqual([]);
  });
});

describe("the export", () => {
  it("shows a dash where the guest has no email, not a blank", () => {
    const [row] = exportRows([guest({ email: null })]);
    expect(row).toEqual([
      "Meera Rao", "+91 98200 11111", "-", 1, "2026-08-12", "Walk-in",
    ]);
  });

  it("shows a dash for a guest who has never stayed, never a zero", () => {
    const [row] = exportRows([guest({ lastStay: null, stays: 0 })]);
    expect(row?.[4]).toBe("-");
  });

  it("is written by the shared writer, which quotes a name with a comma", () => {
    /* Not this service's own CSV: `src/lib/csv.ts` already holds the
       quoting, the formula-injection guard and the line endings Excel
       needs, and a second writer is a second set of answers to all
       three. */
    const csv = toCsv([...EXPORT_HEADERS], exportRows([guest({ name: "Rao, Meera" })]));
    expect(csv).toContain('"Rao, Meera"');
  });
});
