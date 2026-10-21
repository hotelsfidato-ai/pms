import { describe, it, expect } from "vitest";
import type { OrderLine } from "@/modules/pos/data/till";
import { oneLinePerDish } from "@/modules/pos/lib/oneLinePerDish";

/* ONE LINE PER DISH (the owner's D27-353): a beer, food, then a second beer
   is "2× Kingfisher" once, where it was first ordered, carrying the newest
   round's id; a different note, a struck line or other sides stay apart. */

const line = (over: Partial<OrderLine>): OrderLine => ({
  id: "x", name: "Kingfisher Strong", qty: 1, unitPrice: 270, taxRate: 0, note: null,
  voided: false, kotStatus: "sent", addedBy: "Ravi", parentLineId: null, isAddon: false,
  variationId: "v-650", extra: null, itemId: "i-kf", addonId: null, moreChoiceIds: [],
  numberedAddons: null, ...over,
} as OrderLine);

const shown = (ls: OrderLine[]) => oneLinePerDish(ls).map((l) => [l.id, l.name, l.qty]);

describe("one line per dish (D27-353)", () => {
  it("a beer, food, then a second beer: one line of 2 where it was first ordered, with the newest round's id", () => {
    expect(shown([
      line({ id: "b1" }),
      line({ id: "f1", name: "Dal Tadka", itemId: "i-dal", variationId: null, unitPrice: 260 }),
      line({ id: "b2", kotStatus: "pending" }),
    ])).toEqual([["b2", "Kingfisher Strong", 2], ["f1", "Dal Tadka", 1]]);
  });

  it("another note, size or price, or a struck line, stays its own", () => {
    expect(shown([
      line({ id: "b1" }),
      line({ id: "b2", note: "chilled" }),
      line({ id: "b3", variationId: "v-330", unitPrice: 170 }),
      line({ id: "b4", voided: true }),
    ]).map(([id]) => id)).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("the same dish with the same sides: the sides add up under it", () => {
    const pau = (id: string) => line({ id, name: "Bhaaji Pau (Butter)", itemId: "i-pau", variationId: "v-b", unitPrice: 120 });
    const side = (id: string, parent: string) => line({
      id, name: "Sides: Onions", parentLineId: parent, isAddon: true, addonId: "a-on", itemId: null,
      variationId: null, unitPrice: 10 });
    expect(shown([pau("p1"), side("s1", "p1"), pau("p2"), side("s2", "p2")]))
      .toEqual([["p2", "Bhaaji Pau (Butter)", 2], ["s2", "Sides: Onions", 2]]);
  });
});
