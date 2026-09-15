/* ══════════════════════════════════════════════════════════════════
   THE BUSINESS DATE — the day THIS property is operating in

   Until CP11 this was a literal in `src/data/fixtures/property.ts`:

       export const BUSINESS_DATE = "2026-08-25";

   Seventy places read it. It was correct for exactly one property on
   exactly one day, and the moment a second property existed it became
   a lie for one of them: a hotel in Agra closes its day when its own
   night audit runs, and one in Pune closes its own. They sit on
   different dates most nights of the year.

   WHY THIS IS A `let` AND NOT A HOOK

   Every screen reads it synchronously — `queryKeys.arrivals(hotelId,
   BUSINESS_DATE)`, `dateLong(BUSINESS_DATE)`. Turning it into a hook
   would have touched all forty-six screen files to move ONE value out
   of a constant, which is precisely the change the repository seam
   exists to prevent. So the seam absorbs it: the binding stays
   synchronous and this module keeps it true.

   WHAT MAKES THAT SAFE

   `App.tsx` renders a loading state while the session is `starting`
   and redirects when `signed-out`. No screen mounts until the session
   resolves, and `setBusinessDate` is called during that resolution,
   before `status` becomes "signed-in". A screen cannot observe the
   unset value — and if the wiring is ever removed, it reads the empty
   string and every date on the page is visibly blank rather than
   quietly a day wrong.

   That last part is deliberate. A stale-but-plausible date is the
   worst failure this file could have.
   ══════════════════════════════════════════════════════════════════ */

/**
 * The current property's operating day, `YYYY-MM-DD`.
 *
 * Set by the session on sign-in and on every property switch. Empty
 * only before the first session load, which no screen can observe.
 */
export let BUSINESS_DATE = "";

/** The first of the month the property is in — period-to-date starts here. */
export let PTD_FROM = "";

/**
 * Where period-to-date ends: the business date itself.
 *
 * A separate binding rather than an alias, because it was `export
 * const PTD_TO = BUSINESS_DATE` in statistics.ts — a copy taken when
 * the module first loaded. Against a constant that was harmless.
 * Against a value that changes when you switch property, it would
 * have frozen at the empty string and every PTD window would have
 * ended nowhere.
 */
export let PTD_TO = "";

/**
 * Every property's operating day, keyed by BOTH its code and its id.
 *
 * Two stores name the current property differently — `useUi.hotelId`
 * holds the CODE ("5EL"), which is what screens and routes use, while
 * `useSession.hotelId` holds the UUID, which is what role resolution
 * uses. Both must be able to select a date, so both keys are in here.
 */
const dates = new Map<string, string>();

/** Learn every property's date. Called once, when the session loads. */
export function registerBusinessDates(
  hotels: ReadonlyArray<{ id: string; code: string; businessDate: string }>,
): void {
  dates.clear();
  for (const h of hotels) {
    dates.set(h.id, h.businessDate);
    dates.set(h.code, h.businessDate);
  }
}

/**
 * Move the seam onto a property, by code or by id.
 *
 * WHY THIS EXISTS RATHER THAN A CALL IN THE SWITCHER
 *
 * The first version wired `setBusinessDate` into `useSession.setHotelId`
 * and the session load, and both worked. Opening `/h/AGR/arrivals`
 * showed Agra's rooms under 5 Elements' date anyway, because a deep
 * link changes the property through a THIRD path: a route effect
 * calling `useUi.setHotelId`. Nothing in the type system connected the
 * three, and the screen was the only thing that could have said so.
 *
 * So every path funnels through here instead of each remembering.
 *
 * An unknown key leaves the date alone, deliberately. It means a
 * property this person cannot see, every query on the page 404s, and
 * blanking the date would turn a clear "No such property" into a
 * RangeError from date arithmetic.
 */
export function selectProperty(codeOrId: string): void {
  const date = dates.get(codeOrId);
  if (date) setBusinessDate(date);
}

/**
 * Point the seam at one date directly.
 *
 * Used by the session on load and by the test harness, which has no
 * session. Not exported through `@/data/repositories`: screens read
 * the date, they do not set it.
 */
export function setBusinessDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    /* Loud, because the alternative is every report in the system
       quietly filtering on garbage. */
    throw new Error(
      `[business-date] "${date}" is not a date. The API must return ` +
        `YYYY-MM-DD from app.business_date().`,
    );
  }
  BUSINESS_DATE = date;
  PTD_FROM = `${date.slice(0, 7)}-01`;
  PTD_TO = date;
}
