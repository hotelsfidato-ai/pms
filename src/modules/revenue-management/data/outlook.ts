import {
  getPeriodStatistics, getTodaySnapshot, listDailyStatistics,
} from "@/modules/reports";
import {
  datesAhead, sameMonthLastYear, type DateAhead, type Pace,
} from "@/modules/revenue-management/logic/outlook";

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

   ⚠ NOT HERE YET: PICKUP, and the third column of pace. "How many of
   those rooms were sold in the last 1, 7 and 30 days" needs each
   booking's creation date, which no front door answers today. The ask
   is written up in MODULE.md under Requests (R1) and in DEFECTS.md as
   RM-1. Nothing is guessed in the meantime: the screen does not show a
   pickup column at all rather than show one it cannot fill.
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
