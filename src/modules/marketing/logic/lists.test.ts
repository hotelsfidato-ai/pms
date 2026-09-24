import { describe, it, expect } from "vitest";
import {
  EXPORT_HEADERS, aYearBefore, cameFrom, exportRows, mayBeWrittenTo,
  notReturnedInAYear, stayedTwice, type Addressable,
} from "./lists";
import { toCsv } from "@/lib/csv";
import { ROLES, canAccess, can } from "@/lib/permissions";
import { mayReach } from "@/components/app/navigation";

/* ══════════════════════════════════════════════════════════════════
   WHAT A MARKETING LIST MAY NOT CONTAIN

   Four things are worth a test each, because breaking any of them is
   silent - the list still renders, it is simply wrong about a person:

     nobody reaches a list without going through `mayBeWrittenTo`;

     a phone or email on the No offers list (D21-22) is on no list, in
     whatever form the desk typed it (MKT-1);

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
const NONE = { phones: [], emails: [] };

/** Qualifies for all three lists on every count but consent. */
const onEveryList = (over: Partial<Addressable> = {}) => guest({
  stays: 4, lastStay: "2024-01-01", sources: ["Agoda"], ...over,
});

const everyList = (g: Addressable, noOffers: { phones: string[]; emails: string[] }) => [
  stayedTwice([g], noOffers), notReturnedInAYear([g], ASON, noOffers),
  cameFrom([g], "Agoda", noOffers),
];

describe("who may be written to at all", () => {
  it("passes a guest with a telephone number", () => {
    expect(mayBeWrittenTo(guest(), NONE)).toBe(true);
  });

  it("passes a guest with only an email address", () => {
    expect(mayBeWrittenTo(guest({ phone: null, email: "meera@example.in" }), NONE))
      .toBe(true);
  });

  it("refuses a guest with neither", () => {
    expect(mayBeWrittenTo(guest({ phone: null, email: null }), NONE)).toBe(false);
  });

  it("refuses a guest whose number is blank space", () => {
    /* The desk types a space into a field it cannot leave empty. */
    expect(mayBeWrittenTo(guest({ phone: "   ", email: null }), NONE)).toBe(false);
  });

  it("keeps every list behind it", () => {
    /* The gate is only a gate if nothing walks round it. A guest with
       no way to reach them qualifies for all three lists on every other
       count and appears on none. */
    for (const list of everyList(onEveryList({ phone: null, email: null }), NONE)) {
      expect(list).toEqual([]);
    }
  });
});

describe("No offers (MKT-1, D21-22)", () => {
  it("the same guest is on all three lists until they ask for no offers", () => {
    for (const list of everyList(onEveryList(), NONE)) expect(list).toHaveLength(1);
  });

  it("a phone on No offers is on no list, however the desk typed it", () => {
    /* Kept as its key, 9820011111; this guest was typed "+91 98200 11111". */
    const noOffers = { phones: ["9820011111"], emails: [] };
    for (const list of everyList(onEveryList(), noOffers)) expect(list).toEqual([]);
    expect(mayBeWrittenTo(guest({ phone: "098200 11111" }), noOffers)).toBe(false);
  });

  it("an email on No offers is on no list, whatever its capitals", () => {
    const noOffers = { phones: [], emails: ["meera@example.in"] };
    const g = onEveryList({ phone: null, email: " Meera@Example.IN " });
    for (const list of everyList(g, noOffers)) expect(list).toEqual([]);
  });

  it("either one on No offers keeps the guest off, even with the other free", () => {
    const g = onEveryList({ email: "meera@example.in" });
    for (const list of everyList(g, { phones: ["9820011111"], emails: [] })) {
      expect(list).toEqual([]);
    }
  });
});

describe("stayed twice", () => {
  it("takes a guest who has stayed twice", () => {
    expect(stayedTwice([guest({ stays: 2 })], NONE).map((g) => g.name))
      .toEqual(["Meera Rao"]);
  });

  it("leaves a guest who has stayed once", () => {
    expect(stayedTwice([guest({ stays: 1 })], NONE)).toEqual([]);
  });
});

describe("not returned in a year", () => {
  it("takes a guest who left more than a year ago", () => {
    expect(notReturnedInAYear([guest({ lastStay: "2025-06-30" })], ASON, NONE))
      .toHaveLength(1);
  });

  it("leaves a guest who left within the year", () => {
    expect(notReturnedInAYear([guest({ lastStay: "2025-09-20" })], ASON, NONE))
      .toEqual([]);
  });

  it("leaves a guest who is arriving next month - they have returned", () => {
    expect(notReturnedInAYear(
      [guest({ lastStay: "2024-03-01", nextStay: "2026-10-04" })], ASON, NONE,
    )).toEqual([]);
  });

  it("leaves a guest who has never stayed", () => {
    /* A booking that has not happened yet has no last stay. "Has not
       returned" is about somebody who came once, not about somebody the
       hotel has never met. */
    expect(notReturnedInAYear([guest({ lastStay: null })], ASON, NONE)).toEqual([]);
  });

  it("takes a year off a date without building one", () => {
    expect(aYearBefore("2026-09-19")).toBe("2025-09-19");
    expect(aYearBefore("2028-02-29")).toBe("2027-02-29");
  });
});

describe("came from a booking site", () => {
  it("takes a guest who booked through that site", () => {
    expect(cameFrom([guest({ sources: ["Agoda", "Walk-in"] })], "Agoda", NONE))
      .toHaveLength(1);
  });

  it("leaves a guest who booked through another", () => {
    expect(cameFrom([guest({ sources: ["Walk-in"] })], "Agoda", NONE)).toEqual([]);
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

describe("who sees the lists (D22-17)", () => {
  it("the owner, an administrator and the GM - every other role is refused", () => {
    const THREE = ["owner", "admin", "gm"];
    for (const role of ROLES) {
      const allowed = THREE.includes(role);
      expect(canAccess(role, "marketing"), role).toBe(allowed);
      expect(can(role, "export", "marketing"), `${role} exports`).toBe(allowed);
      expect(mayReach(role, "/coming-soon/marketing"), `${role} reaches`).toBe(allowed);
    }
  });
});
