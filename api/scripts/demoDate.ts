/* ══════════════════════════════════════════════════════════════════
   THE DEMO'S DAY (D27-193, 30 September)

   The demo is a snapshot of 25 August 2026. `npm run demo` passes
   --today, and every date read from the snapshot moves by the days since
   then, in India: the business date is the real today, so a booking typed
   with real dates lands where Arrivals looks (the owner's walk-through
   booked 1 October onto a hotel still on 25 August). Without the flag -
   the API test harness, the print samples - it stays on 25 August, which
   their assertions are written against.
   ══════════════════════════════════════════════════════════════════ */

export const ANCHOR = "2026-08-25";

const todayInIndia = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export const SHIFT_DAYS = process.argv.includes("--today")
  ? Math.round((Date.parse(`${todayInIndia()}T00:00:00Z`) - Date.parse(`${ANCHOR}T00:00:00Z`)) / 86_400_000)
  : 0;

/** A snapshot date, moved onto the demo's day. */
export function shift(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + SHIFT_DAYS);
  return d.toISOString().slice(0, 10);
}
