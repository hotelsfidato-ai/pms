/* The front door of the Revenue management service - the only file another
   service may import (src/test/boundaries.test.ts).

   It shows and it suggests and it NEVER changes a price (D18-15). Nothing
   here writes, and nothing here is a writer another service could borrow:
   `neverWritesARate.test.ts` reads this whole folder and refuses one.

   Its screens and its menu entry are registered by `nav.ts` and
   `routes.tsx`, which the core reads directly. Nothing else needs this
   service yet, so the door carries only what a reader would want: the
   words it puts on a date, and the figures behind them. */
export {
  suggest, temperOf, softestFirst, datesAhead, aheadBy, comparable,
  THRESHOLDS,
} from "./logic/outlook";
export type { OutlookDay, DateAhead, Suggestion, Temper, Pace } from "./logic/outlook";
export { getOutlook, getPace, WINDOW_NIGHTS } from "./data/outlook";
export type { Outlook } from "./data/outlook";
