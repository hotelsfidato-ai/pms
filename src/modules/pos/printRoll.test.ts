import { describe, it, expect } from "vitest";
import { rollPage } from "@/modules/pos/lib/printRoll";

/* The roll's paper (the owner's photo, 22 Oct): 80 mm wide, the slip's
   length, no margin. `80mm auto` was dropped by the browser; a length pair
   is kept (checked in Chrome - jsdom does not know `size`). */
describe("printing on the 80 mm roll", () => {
  it("sets the paper to 80 mm by the slip's length, rounded up, with no margin", () => {
    /* 377.9 px is just under 100 mm at 96 to the inch; 4 mm more to feed past the tear bar. */
    expect(rollPage(377.9)).toBe("@media print { @page { size: 80mm 104mm; margin: 0; } }");
  });

  it("is never shorter than wide, so a short KOT is not turned sideways", () => {
    /* 200 px is about 53 mm: a one-dish KOT. 80 x 57 mm would be landscape. */
    expect(rollPage(200)).toBe("@media print { @page { size: 80mm 90mm; margin: 0; } }");
  });
});
