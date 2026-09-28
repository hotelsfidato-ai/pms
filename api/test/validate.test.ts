import { describe, it, expect } from "vitest";
import {
  phoneProblem, emailProblem, aadhaarProblem, idNumberProblem, documentDatesProblem,
  expiredDocuments, countryProblem, portalNumberProblem, roomNumberProblem, floorProblem,
  countProblem, dateProblem, priceProblem, MAX_NIGHTS,
} from "../src/validate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S RULES FOR A TYPED VALUE (round D, 28 September)

   Each row is a value the QA of 28 September saw saved, or its fix.
   No database: these are the rules alone. Every door that uses them has
   its own test that the door asks.
   ══════════════════════════════════════════════════════════════════ */

describe("phone and email (X-2)", () => {
  it("refuses what QA typed, takes a real number either way it is written", () => {
    expect(phoneProblem("abc")).toMatch(/not a phone number/);
    expect(phoneProblem("123")).toMatch(/not a phone number/);
    expect(phoneProblem("0000000000")).toMatch(/not a phone number/);
    expect(phoneProblem("98765 4321x")).toMatch(/not a phone number/);
    expect(phoneProblem("+91 98765 43210")).toBeNull();
    expect(phoneProblem("098765-43210")).toBeNull();
    expect(phoneProblem("+44 (20) 7946 0958")).toBeNull();
    expect(phoneProblem("")).toBeNull();
    expect(phoneProblem(null)).toBeNull();
  });
  it("refuses an email with no shape", () => {
    expect(emailProblem("not-an-email")).toMatch(/not an email/);
    expect(emailProblem("a b@c.in")).toMatch(/not an email/);
    expect(emailProblem("guest@example.com")).toBeNull();
    expect(emailProblem(" ")).toBeNull();
  });
});

describe("identity documents (FD-2, GP-1, GU-2)", () => {
  it("an Aadhaar is 12 digits with UIDAI's check digit", () => {
    expect(aadhaarProblem("12ab")).toMatch(/12 digits/);
    expect(aadhaarProblem("134567890123")).toMatch(/does not start with 0 or 1/);
    /* The number QA typed for FD-3 was made up, and its last digit is
       wrong; UIDAI's own sandbox numbers pass. */
    expect(aadhaarProblem("234567890123")).toMatch(/mistyped/);
    expect(aadhaarProblem("234567890124")).toBeNull();
    expect(aadhaarProblem("9999 4105 7058")).toBeNull();
    expect(aadhaarProblem("999971658847")).toBeNull();
  });
  it("a passport is 6 to 15 letters and digits; other documents 4 or more", () => {
    expect(idNumberProblem("passport", "1")).toMatch(/passport number/);
    expect(idNumberProblem("passport", "SAMPLE-0000")).toMatch(/passport number/);
    expect(idNumberProblem("passport", "A1234567")).toBeNull();
    expect(idNumberProblem("aadhaar", "12ab")).toMatch(/12 digits/);
    expect(idNumberProblem("driving_licence", "MH1")).toMatch(/4 to 40/);
    expect(idNumberProblem("voter", "ABC1234567")).toBeNull();
  });
  it("refuses impossible dates, only warns of an expired document", () => {
    const today = "2026-08-25";
    expect(documentDatesProblem({ dateOfBirth: "2030-01-01" }, today)).toMatch(/birth is in the future/);
    expect(documentDatesProblem({ passportIssuedOn: "2020-01-01", passportExpiry: "2019-01-01" }, today))
      .toMatch(/expires before it was issued/);
    expect(documentDatesProblem({ visaExpiry: "2021-02-30" }, today)).toMatch(/not a date/);
    expect(documentDatesProblem({ dateOfBirth: "1990-05-01", passportExpiry: "2020-01-01" }, today))
      .toBeNull();
    expect(expiredDocuments({ passportExpiry: "2020-01-01", visaExpiry: "2021-01-01" }, today))
      .toEqual(["The passport expired on 2020-01-01.", "The visa expired on 2021-01-01."]);
    expect(expiredDocuments({ passportExpiry: "2030-01-01" }, today)).toEqual([]);
  });
});

describe("nationality, the portal's number, rooms (BK-4, GU-3, RT-4)", () => {
  it("a country is an ISO code", () => {
    expect(countryProblem("ZZ")).toMatch(/not a country code/);
    expect(countryProblem("EU")).toMatch(/not a country code/);
    expect(countryProblem("in")).toBeNull();
    expect(countryProblem("GB")).toBeNull();
  });
  it("the portal's number", () => {
    expect(portalNumberProblem("!")).toMatch(/6 to 30/);
    expect(portalNumberProblem("abcdefg")).toMatch(/at least one digit/);
    expect(portalNumberProblem("FRRO/2026-004512")).toBeNull();
  });
  it("a room number and a floor", () => {
    expect(roomNumberProblem("x".repeat(60))).toMatch(/at most 10/);
    expect(roomNumberProblem("A-12")).toBeNull();
    expect(floorProblem(-5)).toMatch(/0 \(the ground floor\) to 99/);
    expect(floorProblem(1.5)).toMatch(/whole number/);
    expect(floorProblem(null)).toBeNull();
    expect(floorProblem(0)).toBeNull();
  });
});

describe("counts, dates, prices (FD-4, FD-6, FD-8, FD-9, X-1)", () => {
  it("counts are whole numbers in range", () => {
    expect(countProblem(-1, "Children", 0)).toMatch(/from 0 to 99/);
    expect(countProblem(0, "Adults", 1)).toMatch(/from 1 to 99/);
    expect(countProblem(400, "Nights", 1, MAX_NIGHTS)).toMatch(/from 1 to 90/);
    expect(countProblem(Number.NaN, "Nights", 1, MAX_NIGHTS)).toMatch(/whole number/);
    expect(countProblem(2, "Adults", 1)).toBeNull();
  });
  it("a date is a real date", () => {
    expect(dateProblem("")).toBe("Choose a date.");
    expect(dateProblem("2026-02-30")).toMatch(/not a date/);
    expect(dateProblem("2026-08-25")).toBeNull();
  });
  it("0 only when ticked Free; blank is not priced yet", () => {
    expect(priceProblem(0, false)).toMatch(/ticked Free/);
    expect(priceProblem(0, true)).toBeNull();
    expect(priceProblem(null, false)).toBeNull();
    expect(priceProblem(-1, false)).toMatch(/0 or more/);
    expect(priceProblem(99_999_999_999, false)).toMatch(/larger than any price/);
    expect(priceProblem(2500, false)).toBeNull();
  });
});
