import type { Client } from "./db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BUSINESS DATE

   The day a property is operating in. It is NOT today's date, and it
   is not the same for two properties.

   WHY THIS FILE EXISTS

   Before CP11 the string "2026-08-25" appeared as a fallback in
   twelve route handlers, and four WRITE paths defaulted to
   `new Date().toISOString().slice(0, 10)` — the server's wall clock.

   The constant was merely wrong for a second property. The wall clock
   was wrong for the FIRST one:

     A clerk settles a bill at 00:40. The night audit for the 25th has
     not run, so the hotel is still operating in the 25th. The wall
     clock says the 26th. The receipt lands on the 26th, the night
     audit closes the 25th without it, and the day's cash never
     balances. Nobody can find the money, because it is filed under a
     day the hotel had not reached yet.

   That is the entire reason hotels have a business date, and the
   reason it must come from one place.

   AUTHORITY: app.business_date(hotel) — the day after the last
   COMPLETED night audit run, or the property's configured date if
   none has run. Migration 023.
   ══════════════════════════════════════════════════════════════════ */

/**
 * The date this property is operating in, straight from the database.
 *
 * Runs inside the caller's transaction, so it sees the same snapshot
 * as the write it is dating. A night audit completing mid-request
 * cannot move the date out from under a posting.
 */
export async function businessDateFor(
  client: Client,
  hotelId: string,
): Promise<string> {
  const { rows } = await client.query<{ d: string }>(
    `select to_char(app.business_date($1::uuid), 'YYYY-MM-DD') as d`,
    [hotelId],
  );

  const date = rows[0]?.d;
  if (!date) {
    /* app.business_date() coalesces to a not-null column, so null here
       means the hotel id does not exist — never that the property has
       no date. Failing is right: a posting with a guessed date is
       worse than a posting that did not happen. */
    throw new Error(
      `[business-date] no business date for hotel ${hotelId}. ` +
        `Refusing to date a record from the wall clock.`,
    );
  }
  return date;
}

/**
 * The supplied date, or the property's own if none was supplied.
 *
 * Every route that took `?asOn=` or `body.businessDate` used to fall
 * back to a literal. This is that fallback, once.
 */
export async function resolveDate(
  client: Client,
  hotelId: string,
  supplied: string | undefined,
): Promise<string> {
  return supplied ?? businessDateFor(client, hotelId);
}

/* ── Windows anchored to the business date ───────────────────────── */

/**
 * The first of the month the given date falls in.
 *
 * Period-to-date starts here. This too was a literal — "2026-08-01" —
 * in five handlers, which meant every PTD figure in the system would
 * have kept reporting August after the property moved into September.
 */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * The last day of the month the given date falls in.
 *
 * Day 0 of the NEXT month, which is how JavaScript spells "the last
 * day of this one" without a table of month lengths or a leap-year
 * rule. Built in UTC so a server west of Greenwich cannot land on the
 * 30th.
 */
export function monthEnd(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
