import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { monthStart } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import {
  dailyFigures, propertyFor, isoDateParam, NIGHTS, type Property,
} from "../reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   PICKUP — of the rooms on the books for a night, how many were
   booked in the last 1, 7 and 30 days

   RM-1, and the first item of this service's brief. It was NOT built on
   18 September, because there was no honest way to build it: counting
   room-nights needs the reports service's own `stay_nights` rule, and
   that rule was not reachable from here. R1 asked for it; the master
   opened the door on 18 September; this file is the answer.

   ⚠ THE NIGHTS ARE THE REPORTS SERVICE'S, NOT OURS. `NIGHTS` below is
   ITS text, imported through its front door — the same fragment
   `dailyFigures()` adds up for the Manager report, Monthly statistics
   and the Dashboard. The moment this service spells its own
   `stay_nights`, the two disagree on the day somebody cancels late,
   and the screen starts arguing with the Manager report about how many
   rooms are sold. That is the exact fault this service's brief exists
   to prevent, and it is how the Dashboard and the Manager report came
   to disagree about occupancy in August.

   So this file adds exactly ONE fact the reports service does not
   carry: WHEN the booking behind each of those room-nights was made.
   `sold` is not counted here at all — it is `dailyFigures().sold`,
   read through the door, so a reader can see that the three pickup
   figures are subsets of a number this service did not derive.

   IT SHOWS AND IT SUGGESTS (D18-15). Read only, a GET, no write of any
   kind — `neverWritesARate.test.ts` reads this whole folder and
   refuses one.
   ══════════════════════════════════════════════════════════════════ */

/**
 * One coming night, and when the rooms on it were booked.
 *
 * THE WINDOWS ARE COUNTED BACK FROM THE PROPERTY'S OWN DAY. `last1` is
 * the business date itself, `last7` that day and the six before it,
 * `last30` that day and the twenty-nine before it. Nothing bounds them
 * at the top: a booking taken after the business date — the night
 * audit for the 27th has not run and it is already the 28th outside —
 * was made more recently still, not less, so it belongs in the nearest
 * window rather than in none of them.
 */
export interface PickupNight {
  date: string;
  /** `dailyFigures().sold`. The reports service's figure, untouched. */
  sold: number;
  last1: number;
  last7: number;
  last30: number;
}

export interface PickupReply {
  from: string;
  to: string;
  /** The property's own day. Every window is counted back from it. */
  businessDate: string;
  /**
   * The day this property's booking records begin: the earliest
   * `created_at` on any reservation it holds, in its own time zone.
   * Null when it holds none.
   *
   * ⚠ THE CALLER NEEDS THIS TO KNOW WHEN NOT TO BELIEVE THE COUNTS.
   * A window that opens before the records do cannot tell "booked in
   * the last 30 days" apart from "every booking we have", and a figure
   * that cannot be told apart from another figure is not a figure. The
   * screen turns that case into a dash and a sentence
   * (`logic/pickup.ts`); this route deliberately does NOT, because a
   * route that answered null would leave nothing for a test to check
   * the arithmetic against.
   */
  recordsFrom: string | null;
  nights: PickupNight[];
}

/**
 * When the property's booking records start, on its own clock.
 *
 * `created_at` is a `timestamptz`; the session runs in UTC on the
 * hotel's server and in Asia/Kolkata on this laptop, so a bare cast
 * would give a different day on each (root MEMORY 297). The property's
 * own zone is the only one that means anything to the person reading
 * the screen.
 */
async function recordsFrom(
  client: Client, property: Property,
): Promise<string | null> {
  const { rows } = await client.query<{ day: string | null }>(
    `select to_char((min(r.created_at) at time zone $2), 'YYYY-MM-DD') as day
       from reservations r
      where r.hotel_id = $1`,
    [property.id, property.timezone],
  );
  return rows[0]?.day ?? null;
}

/**
 * How many of each night's room-nights were booked inside each window.
 *
 * The rows counted are `stay_nights` — the reports service's, verbatim
 * — joined back to the booking only to read its creation date. One row
 * per room-night, exactly as `dailyFigures()` counts them, which is
 * why `last30` can never exceed `sold` unless something is wrong.
 */
async function bookedWhen(
  client: Client, property: Property, from: string, to: string,
): Promise<Map<string, [number, number, number]>> {
  const { rows } = await client.query<{
    date: string; last1: number; last7: number; last30: number;
  }>(
    `with ${NIGHTS},
     made as (
       select s.night,
              (r.created_at at time zone $4)::date as made
         from stay_nights s
         join reservations r on r.id = s.reservation_id
     )
     select made.night::text                                  as date,
            count(*) filter (where made.made >= $5::date)::int      as last1,
            count(*) filter (where made.made >= $5::date - 6)::int  as last7,
            count(*) filter (where made.made >= $5::date - 29)::int as last30
       from made
      group by made.night`,
    [property.id, from, to, property.timezone, property.businessDate],
  );

  const by = new Map<string, [number, number, number]>();
  for (const r of rows) {
    by.set(r.date, [Number(r.last1), Number(r.last7), Number(r.last30)]);
  }
  return by;
}

export const pickup = new Hono<{ Variables: { subject: string } }>();

pickup.get("/:code/revenue/pickup", async (c) => {
  const fromParam = isoDateParam(c.req.query("from"));
  const toParam = isoDateParam(c.req.query("to"));

  const body = await withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code"));
    if (!property) return null;

    /* The same defaults the reports service's own statistics routes
       take, so a caller that omits them gets the property's month
       rather than a window this service invented. */
    const from = fromParam ?? monthStart(property.businessDate);
    const to = toParam ?? property.businessDate;

    /* ONE AT A TIME, on purpose. These three share the session's single
       client, and `Promise.all` over it makes pg queue them behind each
       other while warning that it will stop doing so in pg@9 — seen in
       the test log on 19 September. Nothing here is slow enough to be
       worth a second connection. */
    const days = await dailyFigures(client, property.id, from, to);
    const made = await bookedWhen(client, property, from, to);
    const records = await recordsFrom(client, property);

    return {
      from,
      to,
      businessDate: property.businessDate,
      recordsFrom: records,
      nights: days.map((d) => {
        const [last1, last7, last30] = made.get(d.date) ?? [0, 0, 0];
        return { date: d.date, sold: d.sold, last1, last7, last30 };
      }),
    } satisfies PickupReply;
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
