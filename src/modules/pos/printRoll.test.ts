import { describe, it, expect, vi, afterEach } from "vitest";
import { printRoll, rollPage } from "@/modules/pos/lib/printRoll";

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

/* In the Fidato Printer app (D27-360) the page asks the app, never the
   browser's print screen, and a refusal reaches the caller. */
describe("printing in the Fidato Printer app", () => {
  afterEach(() => { delete window.fidatoPrinter; vi.restoreAllMocks(); });

  it("hands the app the paper's length and opens no print screen", async () => {
    const print = vi.fn().mockResolvedValue({ ok: true, reason: null });
    window.fidatoPrinter = { print };
    const screen = vi.spyOn(window, "print").mockImplementation(() => {});
    const slip = document.createElement("div");
    slip.getBoundingClientRect = () => ({ height: 377.9 }) as DOMRect;
    await printRoll(slip);
    expect(print).toHaveBeenCalledWith(104);
    expect(screen).not.toHaveBeenCalled();
    expect(document.head.querySelector("style")?.textContent ?? "").not.toContain("80mm");
  });

  it("throws when the printer does not take it", async () => {
    window.fidatoPrinter = { print: vi.fn().mockResolvedValue({ ok: false, reason: "Printer offline." }) };
    await expect(printRoll(null)).rejects.toThrow("Printer offline.");
  });
});
