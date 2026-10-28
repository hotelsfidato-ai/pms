import type { Mount } from "../../mount.ts";
import { statistics } from "./statistics.ts";
import { reports } from "./reports.ts";
import { documents } from "./documents.ts";
import { dueOut } from "./dueOut.ts";

/* The front door of the reports service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts).

   `buildReport` and its types are for the master's PDF, .xlsx and CSV
   routes (the contract of 17 September): every report as one object. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", documents],
  ["/api/hotels", statistics],
  ["/api/hotels", reports],
  ["/api/hotels", dueOut],
];

export { buildReport, BUILT_KEYS, paramsProblem, switchedOff } from "./build.ts";
export { REPORT_KEYS, STORE_REPORT_KEYS } from "./document.ts";
/* ⚠ ADDED FOR PURCHASING (D18-3), by that chat — the master reviews it at
   merge. The three builders that exist so "no report spells a row by hand":
   the purchase order is drawn by the shared renderer, so it builds its
   document with the same three rather than keeping copies of them. */
export { col, row, total } from "./document.ts";

/* ⚠ OPENED FOR REVENUE MANAGEMENT (R1), 18 September, by the master.

   That service could not build **pickup** or the week-ago column of
   **pace** and built neither rather than counting room-nights its own
   way — which is the exact fault its brief names, and which is how the
   Dashboard and the Manager report came to disagree about occupancy in
   August. ONE DEFINITION OF EVERY FIGURE means the definition has to be
   reachable, and until now this door exported the finished documents and
   nothing they were made of.

   `NIGHTS` is the fragment that decides what counts as a room-night. It
   is the one that matters: the moment a second service writes its own,
   the two disagree on the day somebody cancels late.

   These are READ. Nothing here writes, and revenue management holds a
   test that refuses an SQL write anywhere in its own folders. */
export {
  dailyFigures, sumDays, firstTradingDay, propertyFor, propertyById,
  isoDateParam, heading, NIGHTS,
  /* The nights a room posting pays for, read from its words. Opened 24
     September for the night audit (D24-14): a walk-in's whole-stay line
     has paid for tonight, and the audit must not charge it again. */
  POSTING_NIGHTS,
  /* ⚠ WHAT THE RESTAURANT SOLD, opened 19 September. `dailyFigures`
     answers about `folio_postings` and a POS order only lands there when
     it is charged to a room — so anything settled in cash at the outlet
     is invisible to it. Any service totalling SALES needs both, or it
     understates the day. See the note on `posSales` itself. */
  posSales,
} from "./figures.ts";
export type { DayFigures, Property, StayNight, PosDay } from "./figures.ts";
export type {
  ReportDoc, ReportKey, ReportParams, ReportSection, ReportRow, ReportColumn,
  ReportFact, ReportChart, CellKind, Cell,
} from "./document.ts";
