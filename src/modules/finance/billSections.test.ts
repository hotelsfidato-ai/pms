import { describe, it, expect } from "vitest";
import { billSections, sectionOf, sectionsTotal, type SectionLine } from "./sections";

/* D27-200 (the owner, 30 September): the bill in sections - Room with GST,
   Restaurant with GST, Bar with VAT, then other charges. No figure may
   change: the sections' subtotals and taxes add up to the bill's old total. */

const line = (over: Partial<SectionLine> & { id: string }): SectionLine & { id: string } => ({
  category: "room", scheme: "gst", amount: 0, tax: 0, rate: 5, ...over,
});

/* All four sections and a reversal: two room nights, a restaurant bill, the
   same bill's drinks under VAT, laundry, a discount, and a second restaurant
   bill reversed (its reversal carries the negative amount and tax). */
const LINES = [
  line({ id: "r1", amount: 3522.86, tax: 176.14 }),
  line({ id: "r2", amount: 3522.86, tax: 176.14 }),
  line({ id: "f1", category: "food", amount: 850, tax: 42.5 }),
  line({ id: "b1", category: "food", scheme: "vat", amount: 600, tax: 60, rate: 10 }),
  line({ id: "l1", category: "laundry", amount: 300, tax: 54, rate: 18 }),
  line({ id: "d1", category: "discount", amount: -100, tax: 0, rate: null }),
  line({ id: "f2", category: "food", amount: 410.33, tax: 20.52 }),
  line({ id: "f2r", category: "food", amount: -410.33, tax: -20.52 }),
];

describe("the bill's sections", () => {
  it("place a line by its category and tax scheme, never by its words", () => {
    expect(sectionOf({ category: "room", scheme: "gst" })).toBe("room");
    expect(sectionOf({ category: "food", scheme: "gst" })).toBe("restaurant");
    expect(sectionOf({ category: "beverage", scheme: "gst" })).toBe("restaurant");
    /* Alcohol is under VAT whichever outlet sold it: the restaurant's too. */
    expect(sectionOf({ category: "food", scheme: "vat" })).toBe("bar");
    expect(sectionOf({ category: "misc", scheme: "gst" })).toBe("other");
    expect(sectionOf({ category: "laundry" })).toBe("other");
  });

  it("add up to the old total, all four sections and a reversal", () => {
    const sections = billSections(LINES);
    expect(sections.map((s) => s.title))
      .toEqual(["Room", "Restaurant", "Bar", "Other charges and adjustments"]);

    expect(sections.map((s) => [s.subtotal, s.taxes])).toEqual([
      [7045.72, [{ label: "GST 5%", amount: 352.28 }]],
      /* The reversed bill and its reversal stay in their section and cancel. */
      [850, [{ label: "GST 5%", amount: 42.5 }]],
      [600, [{ label: "VAT 10%", amount: 60 }]],
      [200, [{ label: "GST 18%", amount: 54 }]],
    ]);
    expect(sections[1]!.lines.map((l) => l.id)).toEqual(["f1", "f2", "f2r"]);

    /* The old total: every charge's amount and tax, added as one list. */
    const old = Math.round(LINES.reduce((n, l) => n + l.amount * 100 + l.tax * 100, 0)) / 100;
    expect(old).toBe(9204.5);
    expect(sectionsTotal(sections)).toBe(old);
  });

  it("leave out a section with no line, and name the last one plainly without an adjustment", () => {
    const sections = billSections([LINES[0]!, LINES[4]!]);
    expect(sections.map((s) => s.title)).toEqual(["Room", "Other charges"]);
    expect(billSections([], ["room"]).map((s) => [s.title, s.subtotal])).toEqual([["Room", 0]]);
  });
});
