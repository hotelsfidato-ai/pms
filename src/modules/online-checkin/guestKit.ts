import { useEffect } from "react";
import { ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST PAGE'S KIT (D27-225, step 0 of the in-stay plan)

   What every section of /g/:token behind the code is built from - moved
   out of pages/GuestPage.tsx unchanged, so each feature keeps its section
   in its OWN file and adds one line to `Behind` there.

   ⚠ A section asks its own door route and hides itself when it has
   nothing to show; it never widens `GET /api/guest/:token` (MODULE.md).
   ══════════════════════════════════════════════════════════════════ */

/** The door's own sentence for everything it refuses, in its words. */
export const NOTHING_HERE = "This link is not usable. Ask the desk for a new one.";

/** Refused behind the code: the unlock has gone - expired, or a new guest
    is in the room. Not an error to show: the page asks for a code again. */
export const unlockGone = (error: unknown) => error instanceof ApiError && error.status === 404;

/** Refused behind the code → ask for a code again, once. */
export function useUnlockGone(error: unknown, onUnlockGone: () => void) {
  useEffect(() => { if (unlockGone(error)) onUnlockGone(); }, [error, onUnlockGone]);
}

/** The server's own words (`api()` reads `error`, `reason`, then
    `message` - fixed for every screen on 21 September); nothing invented. */
export function messageFrom(error: unknown): string {
  return (error instanceof Error && error.message) || NOTHING_HERE;
}

/* The fidato look, phone first (375px is this page's primary size): the
   guest's name as the large title, then one card per part, each under its
   own 16px heading, parts 20px apart and 12px from a heading to its card.
   The bill is finance's own document, so it sits on the page, not in a
   card of ours. */
export const SECTION = "mb-5 last:mb-0";
export const H2 = "text-md font-semibold text-ink-900";
export const LEAD = "text-sm text-grey-600 mt-0.5";
