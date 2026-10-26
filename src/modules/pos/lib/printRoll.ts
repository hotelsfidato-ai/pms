/* ══════════════════════════════════════════════════════════════════
   PRINTING ON THE 80 MM ROLL (the owner's photo, 22 October)

   A KOT printed by the KOT station's shortcut (Chrome with --kiosk-printing)
   came out tiny in the middle of a long strip, under Chrome's own date and
   title and over its web address and "1/1". The slips asked for
   `@page { size: 80mm auto }`, which is not CSS (a length cannot pair with
   auto), so the browser dropped it and the whole app's A4 page (theme.css)
   applied: Chrome shrank an A4 page onto the roll and drew its header and
   footer in the margins. With a print window a person fixes that by hand,
   and their Chrome remembers; the KOT station's Chrome is a fresh one.

   So the paper is said exactly, at print time: 80 mm wide, as long as the
   slip (never shorter than wide), no margin - nothing to shrink, no margin
   for a header or footer.
   ══════════════════════════════════════════════════════════════════ */

/* NEVER SHORTER THAN WIDE (the owner's photos, 22 October): a page 80 mm wide
   and 64 mm long is a landscape page, and the printer turned a short KOT
   sideways on the roll; the bill, longer than 80 mm, came out upright. 90 mm
   was not enough for the BAR PC's printer in the Fidato Printer app (25
   October, MEMORY 427): its KOTs still came out sideways and its bills - 150
   mm and more - upright. So the shortest slip is 160 mm unless the computer
   says otherwise (Restaurant setup, KOT section, its own setting and a test
   print, D27-363). */
export const DEFAULT_SLIP_MM = 160;

/** The paper's length for a slip `heightPx` CSS pixels tall (96 to the inch),
    never shorter than `minMm`. */
export const rollMm = (heightPx: number, minMm: number = DEFAULT_SLIP_MM) =>
  Math.max(minMm, Math.ceil((heightPx * 25.4) / 96) + 4);

/** The page rule for a slip `heightPx` CSS pixels tall. */
export const rollPage = (heightPx: number, minMm: number = DEFAULT_SLIP_MM, widthMm: 58 | 80 = 80) =>
  `@media print { @page { size: ${widthMm}mm ${rollMm(heightPx, minMm)}mm; margin: 0; } }`;

/* THE FIDATO PRINTER APP (the owner's D27-360): on a printing computer the
   PMS runs inside a small app that prints straight to the printer - no
   window, no print screen. It hands this page `window.fidatoPrinter`; anywhere
   else the browser's own print is used, as before. */
declare global {
  interface Window {
    fidatoPrinter?: { print: (heightMm: number, widthMm?: number) => Promise<{ ok: boolean; reason: string | null }> };
  }
}

/** Prints the page with the paper set to the roll and the slip's length -
    through the Fidato Printer app when the page runs in it. */
export async function printRoll(slip: HTMLElement | null, minMm: number = DEFAULT_SLIP_MM, widthMm: 58 | 80 = 80) {
  const height = slip?.getBoundingClientRect().height ?? 0;
  const style = document.createElement("style");
  style.textContent = rollPage(height, minMm, widthMm);
  document.head.appendChild(style);
  try {
    if (window.fidatoPrinter) {
      const done = await window.fidatoPrinter.print(rollMm(height, minMm), widthMm);
      if (!done.ok) throw new Error(done.reason ?? "The printer did not take it.");
    } else {
      window.print();
    }
  } finally {
    style.remove();
  }
}
