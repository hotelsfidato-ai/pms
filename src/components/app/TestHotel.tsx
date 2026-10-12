import { cn } from "@/lib/cn";
import { TEST_DOCUMENT, TEST_STRIPE, useIsTestHotel } from "@/lib/testHotel";

/* ══════════════════════════════════════════════════════════════════
   WHAT A TEST HOTEL LOOKS LIKE (the owner's D27-296 (8), (9))

   A test hotel is the live system with practice data in it, so nothing on
   its screens or its paper may be mistaken for the real hotel's:

     TestHotelStripe     orange, at the top of EVERY screen, one line that
                         wraps on a phone. No close button: it cannot be
                         put away. The shell draws it, and so does each
                         full-screen page that covers the shell (the
                         Kitchen's wall screen, the Terminal).
     TestPrintWatermark  TEST · NOT VALID across every page printed from
                         the shell, whatever the page is.
     TestDocumentMark    TEST · NOT VALID, large, on the document itself -
                         on screen and on paper, the till's 80mm slips too,
                         which print without the shell.
     TestTag             TEST beside a test hotel's name in a list.

   A real hotel draws none of them: each returns nothing, so its screens
   and documents are exactly what they were.
   ══════════════════════════════════════════════════════════════════ */

/** The stripe. `code`: the hotel it is about; without, the hotel in view. */
export function TestHotelStripe({ code }: { code?: string }) {
  const test = useIsTestHotel(code);
  if (!test) return null;
  return (
    <div
      role="note"
      data-test-stripe
      className="no-print print:hidden shrink-0 bg-brand-orange-600 text-white px-4 py-1.5 text-center text-sm font-semibold leading-snug"
    >
      {TEST_STRIPE}
    </div>
  );
}

/** TEST · NOT VALID across each printed page, drawn by the shell. Paper
    only: on screen the stripe says it. */
export function TestPrintWatermark() {
  const test = useIsTestHotel();
  if (!test) return null;
  return (
    <div
      aria-hidden
      data-test-watermark
      className="hidden print:flex fixed inset-0 z-[100] items-center justify-center pointer-events-none"
    >
      <span className="-rotate-[30deg] whitespace-nowrap text-[88px] font-extrabold tracking-[0.06em] text-grey-300/80">
        {TEST_DOCUMENT}
      </span>
    </div>
  );
}

/** TEST · NOT VALID on a document, large. `slip`: the 80mm roll, black on
    white, as a thermal printer prints; otherwise the A4 page's orange. */
export function TestDocumentMark({ slip = false, className }: { slip?: boolean; className?: string }) {
  return (
    <p
      data-test-document
      className={cn(
        "text-center font-extrabold uppercase",
        slip
          ? "my-2 border-y-4 border-double border-ink-900 py-1.5 text-[24px] leading-tight tracking-wide text-ink-900"
          : "mb-4 rounded-md border-4 border-brand-orange-600 py-2.5 text-[34px] leading-tight tracking-[0.08em] text-brand-orange-700",
        className,
      )}
    >
      {TEST_DOCUMENT}
    </p>
  );
}

/** TEST, beside a test hotel's name. */
export function TestTag({ className }: { className?: string }) {
  return (
    <span
      data-test-tag
      className={cn(
        "inline-flex items-center shrink-0 rounded-sm bg-brand-orange-600 px-1.5 text-2xs font-bold leading-[18px] tracking-wide text-white",
        className,
      )}
    >
      TEST
    </span>
  );
}
