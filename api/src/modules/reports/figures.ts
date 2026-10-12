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
       columns, and divides by `sold`. The hotel's two switches (migration
       192) decide what is sold (soldRule below); every report follows
       them (D27-307).

     AVAILABLE is app.sellable_rooms(): the rooms minus the blocks on the
       date. A day-use room occupies no night: it is counted apart, and
       its charge is room revenue on its day.

     AVAILABLE STARTS ON THE PROPERTY'S FIRST TRADING DAY (the owner,
       D17-93). Before a property traded it had nothing to sell, and
       counting a full month of empty rooms against it is a lie about a
       year: the eZee export shows nothing for those months and so do we.
       The first trading day is the earliest date the property has a
       record for - its earliest arrival, or the earliest day anything
       was posted, whichever came first. A property that has never traded
       is not held back by this: it has no first day, so every day of the
       window counts, which is what a new property planning its year
       needs to see. Every report that prints an available figure says
       which day it counted from.

   Nothing in reservations or postings is changed by any of this.
   ══════════════════════════════════════════════════════════════════ */

export interface DayFigures {
  date: string;
  available: number;
  /** Rooms the property has but could not sell that day: out of service,
      house use. Nil before it traded — a room it had not opened yet was
      not being held back. */
  blocked: number;
  /** Paying room-nights. */
  paying: number;
  complimentary: number;
  /** What the Manager report calls Sold Room: paying, plus complimentary
      and half of each day use as the hotel's switches say (soldRule). */
  sold: number;
  dayUse: number;
  adults: number;
  children: number;
  room: number;
  /** Null when a night not charged yet has no room GST rule (D27-173): unknown, a dash. */
  roomTax: number | null;
  extra: number;
  extraTax: number;
  /** OF `extra` AND `extraTax`, what was alcohol and the VAT on it (D21-91).
      Inside the two figures above, not beside them: every report that adds
      up `extra` still does, and the accountant's export takes these out to
      keep VAT off its GST columns. Nil where nothing was sold under VAT. */
  alcohol: number;
  vat: number;
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

/**
 * THE NIGHTS, as common table expressions over $1 hotel, $2 first day,
 * $3 last day: bd, room_posts, posted_nights (a posting's charge spread
 * over the nights it pays for), stay_nights (every night of every stay)
 * and booked_nights (a night not posted yet, on or after the business
 * date, at the booking's rate). dailyFigures() adds them up by date;
 * the Night Audit reads them room by room. One text, so the two cannot
 * count a night two ways.
 */
export const NIGHTS = `
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
        booking's rate and the tax the room's rule gives that rate.
        gst_rate_OR_NULL (29 September, D27-173): a property with no room
        GST rule yet (a new one has none, D22-9) takes bookings, and
        gst_rate raised here for every reader - a 500 on the Dashboard and
        every report built on this. The tax of such a night is unknown: a
        null, a dash on the screen, never a zero. Posting a charge still
        refuses without a rule (night-audit, front-desk operations). */
     booked_nights as (
       select s.reservation_id, s.night, s.agreed_rate as rent,
              round(s.agreed_rate * app.gst_rate_or_null($1, 'room', s.agreed_rate) / 100.0, 2) as tax
         from stay_nights s, bd
        where not s.comp
          and s.agreed_rate > 0
          and s.night >= bd.d
          and not exists (select 1 from posted_nights p
                           where p.reservation_id = s.reservation_id
                             and p.night = s.night)
     )`;

/**
 * The first day this property has any trading record: its earliest
 * arrival, or the earliest day anything was posted to a bill, whichever
 * is earlier. Null when it has never traded (the owner, D17-93).
 *
 * ONE definition, here beside the others, because four reports print a
 * figure that divides by it. A year's occupancy that changed definition
 * silently is exactly the figure somebody compares next year.
 */
export async function firstTradingDay(
  client: Client, hotelId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ day: string | null }>(
    `select to_char(least(
              (select min(r.check_in) from reservations r
                where r.hotel_id = $1
                  and r.status in ('confirmed','checked_in','checked_out','no_show')),
              (select min(fp.business_date) from folio_postings fp
                where fp.hotel_id = $1)
            ), 'YYYY-MM-DD') as day`,
    [hotelId],
  );
  return rows[0]?.day ?? null;
}

/** HOW THE HOTEL COUNTS A ROOM SOLD (192, the owner's D27-260 Q5): a
    complimentary room is sold (on, as the owner's eZee reports), and a day
    use is half a room when the hotel says so (off: not counted, as before -
    it has its own line). dailyFigures().sold is made from it, and a report
    that prints how it counted reads it here (D27-307). */
export async function soldRule(client: Client, hotelId: string) {
  const { rows } = await client.query<{ comp: boolean; half: boolean }>(
    "select kpi_comp_as_sold as comp, kpi_day_use_half as half from hotels where id = $1", [hotelId]);
  return { compSold: rows[0]?.comp ?? true, dayUseHalf: rows[0]?.half ?? false };
}

export async function dailyFigures(
  client: Client, hotelId: string, from: string, to: string,
): Promise<DayFigures[]> {
  const opened = await firstTradingDay(client, hotelId);
  const { rows } = await client.query<{
    date: string; available: number; blocked: number; paying: number; complimentary: number;
    day_use: number; adults: number; children: number;
    room: string; room_tax: string | null; extra: string; extra_tax: string;
    alcohol: string; vat: string;
    discount: string; receipt: string;
  }>(
    `with days as (
       select d::date as date
         from generate_series($2::date, $3::date, interval '1 day') d
     ),
     ${NIGHTS},
     rent as (
       /* One night with no tax rule makes the day's room tax unknown,
          rather than the sum of the others. */
       select night, sum(rent) as room,
              case when bool_or(tax is null) then null else sum(tax) end as room_tax
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
              /* Of the two above: alcohol, and its VAT (D21-91). */
              sum(fp.amount) filter (where fp.tax_scheme = 'vat' and fp.category not in
                    ('room','payment','discount','tax','refund'))            as alcohol,
              sum(fp.tax_amount) filter (where fp.tax_scheme = 'vat'
                    and fp.category <> 'room')                               as vat,
              -sum(fp.amount) filter (where fp.category = 'discount')        as discount,
              /* Money received. A bill transferred to the city ledger is
                 posted as a payment, but nobody has paid it yet. */
              -sum(fp.amount) filter (where fp.category = 'payment'
                 and not exists (select 1 from payments p
                                  where p.posting_id = fp.id and p.method = 'city_ledger')) as receipt
         from folio_postings fp
        where fp.hotel_id = $1
          and ${LIVE}
          and fp.business_date between $2::date and $3::date
        group by fp.business_date
     )
     select days.date::text                          as date,
            /* Nothing was available before the property traded (D17-93),
               and nothing was held back either: a room the property had
               not opened yet was not out of service. */
            case when $4::date is not null and days.date < $4::date then 0
                 else app.sellable_rooms($1, days.date) end as available,
            case when $4::date is not null and days.date < $4::date then 0
                 else greatest(0, (select count(*) from rooms rm
                                    where rm.hotel_id = $1 and rm.is_active)
                                  - app.sellable_rooms($1, days.date)) end as blocked,
            coalesce(o.paying, 0)                    as paying,
            coalesce(o.complimentary, 0)             as complimentary,
            coalesce(u.n, 0)                         as day_use,
            coalesce(o.adults, 0)                    as adults,
            coalesce(o.children, 0)                  as children,
            coalesce(rent.room, 0)::text             as room,
            case when rent.night is null then '0' else rent.room_tax::text end as room_tax,
            coalesce(other.extra, 0)::text           as extra,
            coalesce(other.extra_tax, 0)::text       as extra_tax,
            coalesce(other.alcohol, 0)::text         as alcohol,
            coalesce(other.vat, 0)::text             as vat,
            coalesce(other.discount, 0)::text        as discount,
            coalesce(other.receipt, 0)::text         as receipt
       from days
       left join occupancy o on o.night  = days.date
       left join rent        on rent.night = days.date
       left join day_use u   on u.date   = days.date
       left join other       on other.date = days.date
      order by days.date`,
    [hotelId, from, to, opened],
  );

  const { compSold, dayUseHalf } = await soldRule(client, hotelId);

  return rows.map((r) => ({
    date: r.date,
    available: Number(r.available),
    blocked: Number(r.blocked),
    paying: Number(r.paying),
    complimentary: Number(r.complimentary),
    sold: Number(r.paying) + (compSold ? Number(r.complimentary) : 0)
      + (dayUseHalf ? Number(r.day_use) / 2 : 0),
    dayUse: Number(r.day_use),
    adults: Number(r.adults),
    children: Number(r.children),
    room: round2(Number(r.room)),
    roomTax: r.room_tax === null ? null : round2(Number(r.room_tax)),
    extra: round2(Number(r.extra)),
    extraTax: round2(Number(r.extra_tax)),
    alcohol: round2(Number(r.alcohol)),
    vat: round2(Number(r.vat)),
    discount: round2(Number(r.discount)),
    receipt: round2(Number(r.receipt)),
  }));
}

/** The days added up. Rates are made from these totals, never averaged. */

/* ══════════════════════════════════════════════════════════════════
   WHAT THE RESTAURANT SOLD, PER DAY — and why it is HERE

   ⚠ ADDED 19 SEPTEMBER, BECAUSE THE TALLY EXPORT WAS UNDERSTATING SALES.

   A POS order only reaches `folio_postings` when it is charged TO A ROOM.
   An order settled in cash, by card or by UPI at the outlet lives in
   `pos_orders` and never touches a folio — so `dailyFigures().extra`,
   which sums `folio_postings`, cannot see it and never could.

   The Manager report has always known this: it reads the outlets
   separately and prints `Total Revenue = PMS Revenue + POS Revenue`. But
   it did that in a PRIVATE function inside `builders/manager.ts`, so the
   accounting service had no way to reach it and built its sales figure
   from `dailyFigures` alone. A walk-in diner paying cash appeared on the
   Manager report and not in the export handed to the accountant — which
   is GST filed on an understated figure, and exactly the disagreement the
   accounting service exists to prevent.

   So the definition lives here, where every service reads it through one
   door. `settled` and `not l.voided` are the Manager report's own
   predicates, word for word: a figure that is only ALMOST the same as the
   one already in use is worse than no figure at all.

   ⚠ ONE DIFFERENCE, ON PURPOSE (24 September): a bill charged to a room is
   left out. The Manager report keeps the restaurant's room postings out of
   its extra charges instead ("POS to PMS Posting"); the day book takes the
   folio whole from `dailyFigures`, so it is this side that leaves them out.
   Either way each bill is counted once, and the totals agree.
   ══════════════════════════════════════════════════════════════════ */
export interface PosDay {
  date: string;
  /** Before tax, after nothing else. Discounts are already off the line. */
  net: number;
  tax: number;
  /** Of `net` and `tax`: alcohol after its share of the discount, and its
      VAT (D21-91). Inside them, as in DayFigures. */
  alcohol: number;
  vat: number;
}

export async function posSales(
  client: Client, hotelId: string, from: string, to: string,
): Promise<PosDay[]> {
  const { rows } = await client.query<{
    date: string; net: string; tax: string; alcohol: string; vat: string;
  }>(
    `with settled as (
       select o.id, o.business_date
         from pos_orders o
        where o.hotel_id = $1
          and o.status = 'settled'
          -- ⚠ NOT A BILL CHARGED TO A ROOM (24 September, the owner's yes):
          -- that one is already a posting on the room's folio, so
          -- dailyFigures counts it, and the day book - this function's one
          -- reader - added it twice. Only what never reaches a folio here.
          and o.payment_method is distinct from 'room'
          -- ...nor one settled to a banquet function: since D27-133 (28
          -- September) the till posts it onto the function's folio the same
          -- way, so it too is counted from the folio.
          and o.payment_method is distinct from 'function'
          and o.business_date between $2::date and $3::date
     ),
     lines as (
       select s.business_date as date,
              sum(round(l.qty * l.unit_price, 2)) as gross
         from settled s
         join pos_order_lines l on l.order_id = s.id and not l.voided
        group by 1
     ),
     rated as (
       /* The discount and the tax as the till itself resolved them, per
          rate — the same function the Manager report reads. */
       select s.business_date as date,
              sum(r.discount) as discount,
              sum(r.tax)      as tax,
              /* ...and by tax, so VAT can be named apart (D21-91). */
              sum(r.taxable) filter (where r.tax_scheme = 'vat') as alcohol,
              sum(r.tax)     filter (where r.tax_scheme = 'vat') as vat
         from settled s
         cross join lateral app.pos_order_by_tax(s.id) r
        group by 1
     )
     select to_char(d.date, 'YYYY-MM-DD') as date,
            coalesce(l.gross, 0) - coalesce(r.discount, 0) as net,
            coalesce(r.tax, 0)                             as tax,
            coalesce(r.alcohol, 0)                         as alcohol,
            coalesce(r.vat, 0)                             as vat
       from (select distinct business_date as date from settled) d
       left join lines l on l.date = d.date
       left join rated r on r.date = d.date
      order by 1`,
    [hotelId, from, to],
  );
  return rows.map((r) => ({
    date: r.date,
    net: Number(r.net),
    tax: Number(r.tax),
    alcohol: Number(r.alcohol),
    vat: Number(r.vat),
  }));
}

export function sumDays(days: DayFigures[]): Omit<DayFigures, "date"> {
  const add = (k: Exclude<keyof DayFigures, "date" | "roomTax">) =>
    round2(days.reduce((t, d) => t + d[k], 0));
  return {
    available: add("available"),
    blocked: add("blocked"),
    paying: add("paying"),
    complimentary: add("complimentary"),
    sold: add("sold"),
    dayUse: add("dayUse"),
    adults: add("adults"),
    children: add("children"),
    room: add("room"),
    /* One day unknown makes the total unknown (D27-173). */
    roomTax: days.some((d) => d.roomTax === null) ? null : round2(days.reduce((t, d) => t + d.roomTax!, 0)),
    extra: add("extra"),
    extraTax: add("extraTax"),
    alcohol: add("alcohol"),
    vat: add("vat"),
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
  /** D27-296: a test hotel's report is marked TEST · NOT VALID. */
  test: boolean;
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
    currency: string; timezone: string; bd: string; test: boolean;
  }>(
    `select id, code, name, test_of is not null as test,
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
        test: h.test,
      }
    : null;
}

/** The property as a report heads it. */
export const heading = (p: Property) =>
  ({ code: p.code, name: p.name, address: p.address, gstin: p.gstin, timezone: p.timezone,
     ...(p.test ? { test: true } : {}) });

/** A date sent in a query string, or null if it is not one. */
export function isoDateParam(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

/* ── One night, stay by stay ───────────────────────────────────────── */

export interface StayNight {
  reservationId: string;
  complimentary: boolean;
  /** The night's room charge: posted and spread, or the booking's rate. */
  rent: number;
  /** Null when the night is not charged yet and rooms have no GST rule (D27-173). */
  tax: number | null;
}

/** Every stay occupying the night of `date`, with what that night earned. */
export async function stayNights(client: Client, hotelId: string, date: string): Promise<StayNight[]> {
  const { rows } = await client.query<{
    reservation_id: string; comp: boolean; rent: string; tax: string | null;
  }>(
    `with ${NIGHTS}
     select s.reservation_id::text,
            s.comp,
            (coalesce((select sum(p.rent) from posted_nights p
                        where p.reservation_id = s.reservation_id and p.night = s.night), 0)
             + coalesce((select sum(b.rent) from booked_nights b
                          where b.reservation_id = s.reservation_id and b.night = s.night), 0))::text as rent,
            case when exists (select 1 from booked_nights b
                               where b.reservation_id = s.reservation_id and b.night = s.night
                                 and b.tax is null) then null
                 else (coalesce((select sum(p.tax) from posted_nights p
                                  where p.reservation_id = s.reservation_id and p.night = s.night), 0)
                       + coalesce((select sum(b.tax) from booked_nights b
                                    where b.reservation_id = s.reservation_id and b.night = s.night), 0))::text
            end as tax
       from stay_nights s`,
    [hotelId, date, date],
  );
  return rows.map((r) => ({
    reservationId: r.reservation_id,
    complimentary: r.comp,
    rent: round2(Number(r.rent)),
    tax: r.tax === null ? null : round2(Number(r.tax)),
  }));
}
