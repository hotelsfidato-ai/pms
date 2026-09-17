import type { Client } from "../../db.ts";
import { round2 } from "./document.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DAY'S FIGURES — one derivation for every report

   Monthly and Yearly statistics, Monthly occupancy, the Manager report's
   three columns, the Dashboard and the property page all add up these
   rows. Two queries for one figure is how two screens come to disagree.

   THE OWNER'S DEFINITIONS (17 September, D17-62 follow-up), as the eZee
   exports print them:

     A NIGHT'S ROOM CHARGE SITS ON THAT NIGHT.
       The desk posts a walk-in's whole stay on arrival (D17-33) and the
       night audit posts one night at a time. Either way the charge is
       reported on the night it pays for: a posting that says
       "Room 204 · 2 nights" is split evenly over its two nights, the
       paise left over going to the last, so the nights add back to the
       posting exactly. Anything else posted to the room category is one
       night, on its own date.

     A NIGHT NOT POSTED YET, ON OR AFTER THE BUSINESS DATE, COUNTS AT THE
       BOOKING'S RATE. Tonight before the audit, and the nights booked
       ahead that Monthly statistics shows. A night before the business
       date that nobody posted earned nothing, and counts nothing.

     A COMPLIMENTARY ROOM IS SOLD. The Manager report's Sold Room, the
       occupancy and the average rate count it (eZee: 5 sold = 4 paying +
       1 complimentary, 29.41% = 5 of 17, ADR = room charges ÷ 5). Monthly
       statistics prints paying nights and complimentary ones in two
       columns, and divides by both.

     AVAILABLE is app.sellable_rooms(): the rooms minus the blocks on the
       date. A day-use room occupies no night: it is counted apart, and
       its charge is room revenue on its day.

   Nothing in reservations or postings is changed by any of this.
   ══════════════════════════════════════════════════════════════════ */

export interface DayFigures {
  date: string;
  available: number;
  /** Paying room-nights. */
  paying: number;
  complimentary: number;
  /** Paying + complimentary: what the Manager report calls Sold Room. */
  sold: number;
  dayUse: number;
  adults: number;
  children: number;
  room: number;
  roomTax: number;
  extra: number;
  extraTax: number;
  /** Positive: the discount given. */
  discount: number;
  receipt: number;
}

/** Nights of a posting, from the words the desk writes on it. */
export const POSTING_NIGHTS = `
  greatest(1, coalesce(
    (regexp_match(fp.description, '(\\d+)\\s+nights?\\s*$'))[1]::int, 1))`;

/** Postings that still count: not a reversal, and not reversed. */
export const LIVE = `
  fp.reverses_id is null
  and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)`;

export async function dailyFigures(
  client: Client, hotelId: string, from: string, to: string,
): Promise<DayFigures[]> {
  const { rows } = await client.query<{
    date: string; available: number; paying: number; complimentary: number;
    day_use: number; adults: number; children: number;
    room: string; room_tax: string; extra: string; extra_tax: string;
    discount: string; receipt: string;
  }>(
    `with days as (
       select d::date as date
         from generate_series($2::date, $3::date, interval '1 day') d
     ),
     bd as (select app.business_date($1) as d),

     /* Every live room posting that pays for a night inside the window. */
     room_posts as (
       select coalesce(fp.reservation_id, f.reservation_id) as reservation_id,
              fp.business_date, fp.amount, fp.tax_amount,
              ${POSTING_NIGHTS} as n
         from folio_postings fp
         join folios f on f.id = fp.folio_id
        where fp.hotel_id = $1
          and fp.category = 'room'
          and ${LIVE}
          and fp.business_date <= $3::date
     ),
     posted_nights as (
       select p.reservation_id,
              (p.business_date + g.i)::date as night,
              case when g.i < p.n - 1 then round(p.amount / p.n, 2)
                   else p.amount - round(p.amount / p.n, 2) * (p.n - 1) end as rent,
              case when g.i < p.n - 1 then round(p.tax_amount / p.n, 2)
                   else p.tax_amount - round(p.tax_amount / p.n, 2) * (p.n - 1) end as tax
         from room_posts p,
              generate_series(0, p.n - 1) g(i)
        where (p.business_date + g.i)::date between $2::date and $3::date
     ),

     /* Every night of every stay that is still a stay. */
     stay_nights as (
       select r.id as reservation_id, d::date as night,
              r.is_complimentary as comp, r.adults, r.children,
              r.agreed_rate
         from reservations r,
              generate_series(greatest(r.check_in, $2::date),
                              least(r.check_out - 1, $3::date),
                              interval '1 day') d
        where r.hotel_id = $1
          and r.status in ('confirmed', 'checked_in', 'checked_out')
          and r.check_out > r.check_in
          and r.check_in <= $3::date
          and r.check_out > $2::date
     ),
     /* Tonight and the nights booked ahead, not posted yet, at the
        booking's rate and the tax the room's rule gives that rate. */
     booked_nights as (
       select s.night, s.agreed_rate as rent,
              round(s.agreed_rate * app.gst_rate($1, 'room', s.agreed_rate) / 100.0, 2) as tax
         from stay_nights s, bd
        where not s.comp
          and s.agreed_rate > 0
          and s.night >= bd.d
          and not exists (select 1 from posted_nights p
                           where p.reservation_id = s.reservation_id
                             and p.night = s.night)
     ),
     rent as (
       select night, sum(rent) as room, sum(tax) as room_tax
         from (select night, rent, tax from posted_nights
               union all
               select night, rent, tax from booked_nights) x
        group by night
     ),
     occupancy as (
       select night,
              count(*) filter (where not comp)::int as paying,
              count(*) filter (where comp)::int     as complimentary,
              sum(adults)::int                      as adults,
              sum(children)::int                    as children
         from stay_nights
        group by night
     ),
     day_use as (
       select r.check_in as date, count(*)::int as n
         from reservations r
        where r.hotel_id = $1
          and r.status in ('confirmed', 'checked_in', 'checked_out')
          and r.check_out = r.check_in
          and r.check_in between $2::date and $3::date
        group by r.check_in
     ),
     other as (
       select fp.business_date as date,
              sum(fp.amount) filter (where fp.category not in
                    ('room','payment','discount','tax','refund'))            as extra,
              coalesce(sum(fp.tax_amount) filter (where fp.category <> 'room'), 0)
                + coalesce(sum(fp.amount) filter (where fp.category = 'tax'), 0) as extra_tax,
              -sum(fp.amount) filter (where fp.category = 'discount')        as discount,
              -sum(fp.amount) filter (where fp.category = 'payment')         as receipt
         from folio_postings fp
        where fp.hotel_id = $1
          and ${LIVE}
          and fp.business_date between $2::date and $3::date
        group by fp.business_date
     )
     select days.date::text                          as date,
            app.sellable_rooms($1, days.date)        as available,
            coalesce(o.paying, 0)                    as paying,
            coalesce(o.complimentary, 0)             as complimentary,
            coalesce(u.n, 0)                         as day_use,
            coalesce(o.adults, 0)                    as adults,
            coalesce(o.children, 0)                  as children,
            coalesce(rent.room, 0)::text             as room,
            coalesce(rent.room_tax, 0)::text         as room_tax,
            coalesce(other.extra, 0)::text           as extra,
            coalesce(other.extra_tax, 0)::text       as extra_tax,
            coalesce(other.discount, 0)::text        as discount,
            coalesce(other.receipt, 0)::text         as receipt
       from days
       left join occupancy o on o.night  = days.date
       left join rent        on rent.night = days.date
       left join day_use u   on u.date   = days.date
       left join other       on other.date = days.date
      order by days.date`,
    [hotelId, from, to],
  );

  return rows.map((r) => ({
    date: r.date,
    available: Number(r.available),
    paying: Number(r.paying),
    complimentary: Number(r.complimentary),
    sold: Number(r.paying) + Number(r.complimentary),
    dayUse: Number(r.day_use),
    adults: Number(r.adults),
    children: Number(r.children),
    room: round2(Number(r.room)),
    roomTax: round2(Number(r.room_tax)),
    extra: round2(Number(r.extra)),
    extraTax: round2(Number(r.extra_tax)),
    discount: round2(Number(r.discount)),
    receipt: round2(Number(r.receipt)),
  }));
}

/** The days added up. Rates are made from these totals, never averaged. */
export function sumDays(days: DayFigures[]): Omit<DayFigures, "date"> {
  const add = (k: keyof Omit<DayFigures, "date">) =>
    round2(days.reduce((t, d) => t + d[k], 0));
  return {
    available: add("available"),
    paying: add("paying"),
    complimentary: add("complimentary"),
    sold: add("sold"),
    dayUse: add("dayUse"),
    adults: add("adults"),
    children: add("children"),
    room: add("room"),
    roomTax: add("roomTax"),
    extra: add("extra"),
    extraTax: add("extraTax"),
    discount: add("discount"),
    receipt: add("receipt"),
  };
}

/* ── The property, as every report heads it ────────────────────────── */

export interface Property {
  id: string;
  code: string;
  name: string;
  address: string | null;
  gstin: string | null;
  currency: string;
  timezone: string;
  businessDate: string;
}

/** By code (a route) or by id (the master's PDF route, which has the id). */
export async function propertyFor(client: Client, code: string): Promise<Property | null> {
  return propertyWhere(client, "code = upper($1)", code);
}

export async function propertyById(client: Client, id: string): Promise<Property | null> {
  return propertyWhere(client, "id = $1::uuid", id);
}

async function propertyWhere(client: Client, where: string, value: string): Promise<Property | null> {
  const { rows } = await client.query<{
    id: string; code: string; name: string; address: string | null; gstin: string | null;
    currency: string; timezone: string; bd: string;
  }>(
    `select id, code, name,
            nullif(btrim(address_line), '') as address,
            gstin, currency, coalesce(timezone, 'Asia/Kolkata') as timezone,
            to_char(app.business_date(id), 'YYYY-MM-DD') as bd
       from hotels where ${where} and is_active`,
    [value],
  );
  const h = rows[0];
  return h
    ? {
        id: h.id, code: h.code, name: h.name, address: h.address, gstin: h.gstin,
        currency: h.currency.trim(), timezone: h.timezone, businessDate: h.bd,
      }
    : null;
}

/** The property as a report heads it. */
export const heading = (p: Property) =>
  ({ code: p.code, name: p.name, address: p.address, gstin: p.gstin });

/** A date sent in a query string, or null if it is not one. */
export function isoDateParam(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}
