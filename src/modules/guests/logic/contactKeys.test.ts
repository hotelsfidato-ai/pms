import { describe, it, expect } from "vitest";
import { phoneKey, emailKey, refusesOffers } from "./contactKeys";

/* ⚠ THE SAME SAMPLES as db/tests/modules/crm.sql, which asks
   `app.phone_key` the same questions. The rule lives in two places for one
   reason (marketing decides in the browser); these two lists are what keep
   the two copies one rule. */
const PHONE_SAMPLES: ReadonlyArray<[string | null, string | null]> = [
  ["+91 98765 43210", "9876543210"],
  ["098765 43210", "9876543210"],
  ["9876543210", "9876543210"],
  ["91 98765 43210", "9876543210"],
  ["98765-43210 ext", "9876543210"],
  ["+44 20 7946 0958", "442079460958"],
  ["12345", null],
  ["0000000000", null],
  ["+91 00000 00000", null],
  ["", null],
  [null, null],
];

describe("the keys a phone and an email are compared on", () => {
  it.each(PHONE_SAMPLES)("reads %s as %s", (typed, key) => {
    expect(phoneKey(typed)).toBe(key);
  });

  it("reads an email trimmed and in lower case, and a blank as nothing", () => {
    expect(emailKey("  Rohit@Example.COM ")).toBe("rohit@example.com");
    expect(emailKey("  ")).toBeNull();
  });

  it("refuses an offer to a number that asked for none, however it is typed", () => {
    const noOffers = { phones: ["9876543210"], emails: ["rohit@example.com"] };
    expect(refusesOffers(noOffers, "+91 98765 43210", null)).toBe(true);
    expect(refusesOffers(noOffers, null, "ROHIT@example.com")).toBe(true);
    expect(refusesOffers(noOffers, "98765 43211", "priya@example.com")).toBe(false);
  });
});
