import { api } from "@/lib/api";
import {
  getPeriodStatistics, getTodaySnapshot, listDailyStatistics,
} from "@/modules/reports";
import {
  datesAhead, sameMonthLastYear, type DateAhead, type Pace,
} from "@/modules/revenue-management/logic/outlook";
import type { Pickup } from "@/modules/revenue-management/logic/pickup";

/* ══════════════════════════════════════════════════════════════════
   EVERY FIGURE THROUGH THE REPORTS SERVICE'S FRONT DOOR

   `@/modules/reports` is that service's index.ts and the only file of
   it this service may touch (`src/test/boundaries.test.ts`). Available
   rooms, rooms sold and occupancy are ITS definitions - the ones the
   Manager report, Monthly statistics and the Dashboard all add up
   (`api/src/modules/reports/figures.ts`, D17-71, D17-72, D17-93).

   There is deliberately no query here. A second definition of
   occupancy is how the Dashboard and the Manager report came to
   disagree in August, and the brief for this service names that as the
   thing not to do again.

   THE PROPERTY'S OWN DAY. `getTodaySnapshot` answers for the property's
   business date, not this laptop's. Two hotels are routinely on
   different days - one has run its night audit and the other has not -
   so the window ahead is measured from the property, never from `new
   Date()`.

   PICKUP IS HERE NOW (19 September, RM-1). It was absent because a
   booking's creation date could not be reached: the reports door
   exported the finished documents and nothing they were made of. R1
   asked, the master opened the door on 18 September, and this
   service's OWN server route now counts creation dates over the
   reports service's `stay_nights` rule - ITS fragment, imported, not a
   second copy of it. So `sold` on the pickup route and `roomsSold` on
   the statistics route are the same number by construction, not by
   coincidence.
   ══════════════════════════════════════════════════════════════════ */

/** How far ahead the outlook looks. Ninety nights is a quarter - far
    enough to see a season forming, near enough that every row is a
    date somebody could still act on. */
export const WINDOW_NIGHTS = 90;

export interface Outlook {
  /** The property's business date. Everything ahead is measured from it. */
  today: string;
  days: DateAhead[];
}

const plusDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000)
    .toISOString().slice(0, 10);

/* The calendar month a YYYY-MM-DD date falls in. Private: the seam
   refuses an exported function nothing outside can reach
   (`repositories.test.ts`, rule 2b), and `getPace` is the only caller. */
function monthOfDate(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

/** The nights ahead, as the reports service counts them. Null when the
    caller may not see this property - a refusal, not an empty screen. */
export async function getOutlook(
  code: string, nights = WINDOW_NIGHTS,
): Promise<Outlook | null> {
  if (!code) return null;
  const snapshot = await getTodaySnapshot(code);
  if (!snapshot) return null;

  const today = snapshot.date;
  const rows = await listDailyStatistics(code, today, plusDays(today, nights));

  return {
    today,
    days: datesAhead(
      rows.map((r) => ({
        date: r.date,
        available: r.availableRooms,
        sold: r.roomsSold,
        occupancyPct: r.occupancyPct,
      })),
      today,
    ),
  };
}

/**
 * When each room-night on the books was booked, for every night the
 * screen asks about.
 *
 * ONE FETCH, BOTH ANSWERS. The window runs from the first of the
 * property's own month - which is behind the business date, and is
 * what pace needs - to the end of the outlook window ahead, which is
 * what the table needs. Asking twice for two overlapping windows is
 * two chances to disagree about a night in the overlap.
 *
 * Null when the caller may not see this property: a refusal, not an
 * empty screen.
 */
export async function getPickup(
  code: string, today: string, nights = WINDOW_NIGHTS,
): Promise<Pickup | null> {
  if (!code || !today) return null;
  const month = monthOfDate(today);
  return api<Pickup>(
    `/api/hotels/${encodeURIComponent(code)}/revenue/pickup`
    + `?from=${month.from}&to=${plusDays(today, nights)}`,
  );
}

/** This month on the books, and the same month last year. */
export async function getPace(code: string, today: string): Promise<Pace | null> {
  if (!code || !today) return null;
  const month = monthOfDate(today);
  const then = sameMonthLastYear(month.from);

  const [now, lastYear] = await Promise.all([
    getPeriodStatistics(code, month.from, month.to),
    getPeriodStatistics(code, then.from, then.to),
  ]);

  return now ? { now, lastYear } : null;
}
