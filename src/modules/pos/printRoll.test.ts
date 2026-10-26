import { describe, it, expect, vi, afterEach } from "vitest";
import { printRoll, rollPage } from "@/modules/pos/lib/printRoll";

/* The roll's paper (the owner's photo, 22 Oct): 80 mm wide, the slip's
   length, no margin. `80mm auto` was dropped by the browser; a length pair
   is kept (checked in Chrome - jsdom does not know `size`). */
describe("printing on the 80 mm roll", () => {
  it("sets the paper to 80 mm by the slip's length, rounded up, with no margin", () => {
    /* 377.9 px is just under 100 mm at 96 to the inch; 4 mm more to feed past the tear bar. */
    expect(rollPage(377.9, 90)).toBe("@media print { @page { size: 80mm 104mm; margin: 0; } }");
    expect(rollPage(700)).toBe("@media print { @page { size: 80mm 190mm; margin: 0; } }");
  });

  it("is never shorter than the computer's shortest slip, 160 mm unless it says otherwise (D27-363)", () => {
    /* 200 px is about 53 mm: a one-dish KOT. 80 x 57 mm would be landscape;
       the BAR PC's printer turned 80 x 90 to 104 mm too (MEMORY 427). */
    expect(rollPage(200)).toBe("@media print { @page { size: 80mm 160mm; margin: 0; } }");
    expect(rollPage(200, 120)).toBe("@media print { @page { size: 80mm 120mm; margin: 0; } }");
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
    await printRoll(slip, 90);
    expect(print).toHaveBeenCalledWith(104, 80);
    await printRoll(slip);
    expect(print).toHaveBeenLastCalledWith(160, 80);
    /* The KOT's design on 58 mm paper (D27-368): the app is told the width. */
    await printRoll(slip, 90, 58);
    expect(print).toHaveBeenLastCalledWith(104, 58);
    expect(screen).not.toHaveBeenCalled();
    expect(document.head.querySelector("style")?.textContent ?? "").not.toContain("80mm");
  });

  it("throws when the printer does not take it", async () => {
    window.fidatoPrinter = { print: vi.fn().mockResolvedValue({ ok: false, reason: "Printer offline." }) };
    await expect(printRoll(null)).rejects.toThrow("Printer offline.");
  });
});
