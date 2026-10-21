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
   slip, no margin - nothing to shrink, and no margin for a header or footer.
   ══════════════════════════════════════════════════════════════════ */

/** The page rule for a slip `heightPx` CSS pixels tall (96 to the inch). */
export const rollPage = (heightPx: number) =>
  `@media print { @page { size: 80mm ${Math.ceil((heightPx * 25.4) / 96) + 4}mm; margin: 0; } }`;

/** Prints the page with the paper set to the roll and the slip's length. */
export function printRoll(slip: HTMLElement | null) {
  const style = document.createElement("style");
  style.textContent = rollPage(slip?.getBoundingClientRect().height ?? 0);
  document.head.appendChild(style);
  try { window.print(); } finally { style.remove(); }
}
