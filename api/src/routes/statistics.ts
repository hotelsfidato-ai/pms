import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   STATISTICS — occupancy, ADR, RevPAR

   Every figure here is DERIVED. None of it is carried by the product,
   and that is new: until migration 022 the availability curve lived in
   a TypeScript fixture, and ADR came from a calibration constant that
   the demo's own ledger did not support.

   THE THREE DEFINITIONS, in one place so they cannot mean two things
   on two screens:

     available   app.sellable_rooms(hotel, date) — rooms minus the
                 blocks covering that date. NOT a count of rooms: a
                 room held out of service is inventory that cannot be
                 sold, and occupancy divides by what can.

     sold        a room-night occupied by a PAYING guest. Excludes
                 cancelled and no-show (never arrived), day-use
                 (occupies no night), and complimentary (occupied, not
                 sold — the Manager Report prints it on its own line).

     revenue     room-category postings, reversals excluded. Extras
                 never enter ADR: ADR is room revenue over rooms sold,
                 and putting a restaurant bill in it inflates the rate
                 a revenue manager is trying to read.
   ══════════════════════════════════════════════════════════════════ */

export const statistics = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/*
 * One night of one reservation is one row. `generate_series` over the
 * stay's dates is what turns a booking into the room-nights every
 * occupancy figure counts — a four-night stay is four, on four dates,
 * and a stay spanning a month boundary lands correctly on both sides
 * without anyone apportioning it by hand.
 */
const SOLD_NIGHTS = `
  select d::date as date, count(*)::int as sold
    from reservations r,
         generate_series(r.check_in, r.check_out - 1, interval '1 day') d
   where r.hotel_id = $1
     and r.status in ('confirmed', 'checked_in', 'checked_out')
     and not r.is_complimentary
     and d::date between $2::date and $3::date
   group by d::date
`;

const PAX_NIGHTS = `
  select d::date as date, coalesce(sum(r.occupancy), 0)::int as pax
    from reservations r,
         generate_series(r.check_in, r.check_out - 1, interval '1 day') d
   where r.hotel_id = $1
     and r.status in ('confirmed', 'checked_in', 'checked_out')
     and d::date between $2::date and $3::date
   group by d::date
`;

interface DayRow {
  date: string;
  available: number;
  sold: number;
  complimentary: number;
  pax: number;
  room_revenue: string;
}

async function daily(
  client: Client, hotelId: string, from: string, to: string,
): Promise<DayRow[]> {
  const { rows } = await client.query<DayRow>(
    `with days as (
       select d::date as date
         from generate_series($2::date, $3::date, interval '1 day') d
     ),
     sold as (${SOLD_NIGHTS}),
     pax as (${PAX_NIGHTS}),
     comp as (
       select d::date as date, count(*)::int as n
         from reservations r,
              generate_series(r.check_in, r.check_out - 1, interval '1 day') d
        where r.hotel_id = $1
          and r.status in ('confirmed','checked_in','checked_out')
          and r.is_complimentary
          and d::date between $2::date and $3::date
        group by d::date
     ),
     revenue as (
       select fp.business_date as date,
              sum(fp.amount) as amount
         from folio_postings fp
        where fp.hotel_id = $1
          and fp.category = 'room'
          and fp.reverses_id is null
          and not exists (
            select 1 from folio_postings rev where rev.reverses_id = fp.id
          )
          and fp.business_date between $2::date and $3::date
        group by fp.business_date
     )
     select days.date::text                              as date,
            app.sellable_rooms($1, days.date)            as available,
            coalesce(sold.sold, 0)                       as sold,
            coalesce(comp.n, 0)                          as complimentary,
            coalesce(pax.pax, 0)                         as pax,
            coalesce(revenue.amount, 0)::text            as room_revenue
       from days
       left join sold    on sold.date    = days.date
       left join comp    on comp.date    = days.date
       left join pax     on pax.date     = days.date
       left join revenue on revenue.date = days.date
      order by days.date`,
    [hotelId, from, to],
  );
  return rows;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : 0);
const money = (a: number, b: number) => (b ? Math.round((a / b) * 100) / 100 : 0);

statistics.get("/:code/statistics/daily", async (c) => {
  const from = c.req.query("from") ?? "2026-08-01";
  const to = c.req.query("to") ?? "2026-08-25";

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    return (await daily(client, hotelId, from, to)).map((d) => ({
      date: d.date,
      availableRooms: d.available,
      roomsSold: d.sold,
      occupancyPct: pct(d.sold, d.available),
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

statistics.get("/:code/statistics/period", async (c) => {
  const from = c.req.query("from") ?? "2026-08-01";
  const to = c.req.query("to") ?? "2026-08-25";

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const days = await daily(client, hotelId, from, to);

    const availableRoomNights = days.reduce((t, d) => t + d.available, 0);
    const roomsSold = days.reduce((t, d) => t + d.sold, 0);
    const roomRevenue =
      Math.round(days.reduce((t, d) => t + Number(d.room_revenue), 0) * 100) / 100;

    /* Rates are recomputed from the TOTALS, never averaged from daily
       averages — the mean of a set of ADRs is not the period's ADR
       unless every day sold the same number of rooms. */
    return {
      from,
      to,
      availableRoomNights,
      roomsSold,
      occupancyPct: pct(roomsSold, availableRoomNights),
      adr: money(roomRevenue, roomsSold),
      revpar: money(roomRevenue, availableRoomNights),
      roomRevenue,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

statistics.get("/:code/statistics/snapshot", async (c) => {
  const date = c.req.query("date") ?? "2026-08-25";

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const day = (await daily(client, hotelId, date, date))[0];
    if (!day) return null;

    return {
      date: day.date,
      available: day.available,
      sold: day.sold,
      vacant: day.available - day.sold,
      occupancyPct: pct(day.sold, day.available),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
