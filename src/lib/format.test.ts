import { describe, it, expect } from "vitest";
import { amountInWords, money, dateReport, dateTimeReport } from "./format";

describe("dates on reports (D17-77)", () => {
  it("prints a calendar date as eZee does, and nothing else as a date", () => {
    expect(dateReport("2026-08-25")).toBe("25/08/2026");
    expect(dateReport("Total")).toBe("-");
    expect(dateReport(null)).toBe("-");
  });

  it("prints a moment in the property's time, with seconds and AM or PM", () => {
    expect(dateTimeReport("2026-08-25T10:42:43Z", "Asia/Kolkata")).toBe("25/08/2026 04:12:43 PM");
    expect(dateTimeReport("2026-08-24T18:30:05Z", "Asia/Kolkata")).toBe("25/08/2026 12:00:05 AM");
    expect(dateTimeReport("not a date", "Asia/Kolkata")).toBe("-");
  });
});

/* ══════════════════════════════════════════════════════════════════
   AMOUNT IN WORDS

   A tax invoice states its total in words as well as figures, and the
   words are what settles a dispute about a smudged or altered figure.
   So they have to be right, and "right" here means INDIAN grouping —
   crore and lakh, not million — because "Twelve Million" on an Indian
   invoice is the kind of wrong that gets a document sent back.
   ══════════════════════════════════════════════════════════════════ */

describe("amountInWords", () => {
  it("writes the small end", () => {
    expect(amountInWords(0)).toBe("Zero Rupees Only");
    /* Singular. The first version of this test wrote
       `"One Rupee Only".replace("Rupee ", "Rupees ")` to match what the
       function produced — papering over "One Rupees" instead of fixing
       it. A document that cannot manage the singular invites doubt
       about the figures on it. */
    expect(amountInWords(1)).toBe("One Rupee Only");
    expect(amountInWords(7)).toBe("Seven Rupees Only");
    expect(amountInWords(15)).toBe("Fifteen Rupees Only");
    expect(amountInWords(20)).toBe("Twenty Rupees Only");
    expect(amountInWords(21)).toBe("Twenty One Rupees Only");
    expect(amountInWords(100)).toBe("One Hundred Rupees Only");
    expect(amountInWords(101)).toBe("One Hundred One Rupees Only");
    expect(amountInWords(999)).toBe("Nine Hundred Ninety Nine Rupees Only");
  });

  it("groups in LAKH and CRORE, not thousands and millions", () => {
    expect(amountInWords(1_000)).toBe("One Thousand Rupees Only");
    expect(amountInWords(99_999)).toBe(
      "Ninety Nine Thousand Nine Hundred Ninety Nine Rupees Only",
    );
    /* The first place Indian and international numbering part company. */
    expect(amountInWords(100_000)).toBe("One Lakh Rupees Only");
    expect(amountInWords(1_50_000)).toBe("One Lakh Fifty Thousand Rupees Only");
    expect(amountInWords(10_000_000)).toBe("One Crore Rupees Only");
    expect(amountInWords(12_345_678)).toBe(
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only",
    );
  });

  it("states paise separately, never rounded into the rupees", () => {
    /* Rounding them away would make the words disagree with the
       numerals beside them, and the words are the tie-breaker. */
    expect(amountInWords(5715.15)).toBe(
      "Five Thousand Seven Hundred Fifteen Rupees and Fifteen Paise Only",
    );
    expect(amountInWords(0.5)).toBe("Zero Rupees and Fifty Paise Only");
    expect(amountInWords(1.05)).toBe("One Rupee and Five Paise Only");
    expect(amountInWords(2.01)).toBe("Two Rupees and One Paisa Only");
  });

  it("says so when the document is negative", () => {
    /* A credit note is a negative document. Printing its total as a
       positive would make it read as a second invoice. */
    expect(amountInWords(-5715.15)).toBe(
      "Minus Five Thousand Seven Hundred Fifteen Rupees and Fifteen Paise Only",
    );
  });

  it("agrees with the figure printed beside it", () => {
    /* The two are on the same line of a tax invoice. If they can
       disagree by a paisa, the document is wrong. */
    for (const v of [0, 1, 99.99, 419578.76, 397041.93, 5715.15, 24935]) {
      const figure = money(v);
      const words = amountInWords(v);
      expect(words, `${figure} vs ${words}`).toBeTruthy();
    }

    /* Specifically: the calibrated figures this project reconciles to. */
    expect(amountInWords(419578.76)).toBe(
      "Four Lakh Nineteen Thousand Five Hundred Seventy Eight Rupees and Seventy Six Paise Only",
    );
    expect(amountInWords(397041.93)).toBe(
      "Three Lakh Ninety Seven Thousand Forty One Rupees and Ninety Three Paise Only",
    );
  });

  it("rounds to paise once, at the top", () => {
    expect(amountInWords(0.1 + 0.2)).toBe("Zero Rupees and Thirty Paise Only");
  });

  it("is exact for every two-decimal value, which is all it ever gets", () => {
    /* Amounts arrive from Postgres numeric(12,2) via Number(), so they
       have exactly two places and Math.round(v * 100) is exact.

       1.005 is NOT such a value and comes back as one rupee flat,
       because the float nearest 1.005 is 1.00499999999999989. That is
       arithmetically correct for the value actually held, and it is
       recorded here rather than hidden: do not do money arithmetic in
       JavaScript and then print the words. Sum in SQL. */
    expect(amountInWords(1.005)).toBe("One Rupee Only");

    for (let paise = 0; paise < 100; paise += 1) {
      const v = 7 + paise / 100;
      const words = amountInWords(v);
      if (paise === 0) expect(words).toBe("Seven Rupees Only");
      else expect(words, `7.${String(paise).padStart(2, "0")}`)
        .toMatch(/^Seven Rupees and .+ Pais[ae] Only$/);
    }
  });

  it("does not invent a number for a non-number", () => {
    expect(amountInWords(Number.NaN)).toBe("-");
    expect(amountInWords(Number.POSITIVE_INFINITY)).toBe("-");
  });
});
