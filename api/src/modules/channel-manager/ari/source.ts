import type { Client } from "../../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT THE PMS SAYS, DATE BY DATE — part 3 of the SU connection

   For each room type a hotel sends to SU, and each meal plan it sells
   there, for every date in the window:

     rooms left      app.inventory_grid (044): sellable rooms (dated blocks
                     taken out, INV-6) less every booking holding one. The
                     same number the Inventory grid shows a person. Never
                     below zero.
     prices          app.tariff_guests (162): app.tariff_for for 1, 2 … up to
                     the room's sleeps adults: the price a booking of that many people
                     would be charged that night. NULL when any part of it is
                     unpriced; NULL is carried, never turned into 0.
     where from      app.price_for's source: "typed" (a price set for this
                     meal plan and date), "derived" (from the hotel's pricing
                     base, 090) or "rack" (nothing set: the room type's own
                     rate, WHATEVER THE MEAL PLAN). A rack fallback on a
                     breakfast plan is the room-only figure, so whether it may
                     go to SU is the owner's decision, carried here, not taken.
     extra person    app.extra_person_rates: the extra adult and child
                     figures, NULL when nobody set them.
     restrictions    rate_restrictions (044), per room type per date: stop
                     sell, closed to arrival, closed to departure, minimum and
                     maximum nights. No row means none.

   ONE READ, IN THE CALLER'S SESSION, so row-level security scopes it and
   every figure comes from one moment. The 90-day limit on the Inventory
   grid's HTTP route is a screen's limit; SU wants a year at connection,
   and the database functions answer it directly.

   Money stays a string, as the database wrote it.
   ══════════════════════════════════════════════════════════════════ */

export interface AriRoom {
  roomTypeId: string;
  name: string;
  suRoomId: string;
  maxOccupancy: number;
}

export interface AriPlan {
  mealPlan: string;
  suRatePlanId: string;
}

export interface AriDay {
  date: string;
  roomsLeft: number;
  stopSell: boolean;
  closedArrival: boolean;
  closedDeparture: boolean;
  minNights: number | null;
  maxNights: number | null;
}

export interface AriPrice {
  date: string;
  mealPlan: string;
  /** Index 0 is one guest. NULL where that many guests are not priced. */
  byGuests: (string | null)[];
  /** typed | derived | rack, or null when the room itself is unpriced. */
  source: "typed" | "derived" | "rack" | null;
  extraAdult: string | null;
  extraChild: string | null;
}

export interface AriSnapshot {
  hotelId: string;
  suHotelId: string;
  from: string;
  to: string;
  rooms: Array<AriRoom & { days: AriDay[]; plans: Array<AriPlan & { prices: AriPrice[] }> }>;
}

/** The first date SU will take for a hotel: its business date, or today where
    the hotel is if that is later (SU refuses a date in the past). The business
    date is app.business_date, the day after the last closed one - not
    `hotels.business_date`, which stops moving once a night audit has run
    (FD-16's stale column). */
export async function firstSellableDate(client: Client, hotelId: string): Promise<string | null> {
  const { rows } = await client.query<{ first: string }>(
    `select greatest(app.business_date(h.id), (now() at time zone h.timezone)::date)::text as first
       from hotels h where h.id = $1`,
    [hotelId]);
  return rows[0]?.first ?? null;
}

export async function readAri(
  client: Client, hotelId: string, from: string, to: string,
): Promise<AriSnapshot | null> {
  const { rows: hotel } = await client.query<{ su_hotel_id: string }>(
    "select su_hotel_id from channel_hotels where hotel_id = $1", [hotelId]);
  if (!hotel[0]) return null;

  const { rows: rooms } = await client.query<{
    room_type_id: string; name: string; su_room_id: string; max_occupancy: number;
  }>(
    `select m.room_type_id::text, rt.name, m.su_room_id, rt.max_occupancy
       from channel_room_types m join room_types rt on rt.id = m.room_type_id
      where m.hotel_id = $1 and m.is_connected and m.on_su = 'active'
      order by rt.sort_order, rt.name`,
    [hotelId]);

  const { rows: plans } = await client.query<{ meal_plan: string; su_rate_plan_id: string }>(
    `select meal_plan, su_rate_plan_id from channel_rate_plans
      where hotel_id = $1 and is_connected and on_su = 'active'
      order by meal_plan`,
    [hotelId]);

  const snapshot: AriSnapshot = { hotelId, suHotelId: hotel[0].su_hotel_id, from, to, rooms: [] };
  if (rooms.length === 0) return snapshot;

  const { rows: grid } = await client.query<{
    room_type_id: string; for_date: string; available: number;
    stop_sell: boolean | null; closed_arrival: boolean | null; closed_departure: boolean | null;
    min_nights: number | null; max_nights: number | null;
  }>(
    `select g.room_type_id::text, g.for_date::text, g.available,
            r.stop_sell, r.closed_arrival, r.closed_departure, r.min_nights, r.max_nights
       from app.inventory_grid($1, $2::date, $3::date) g
       left join rate_restrictions r
              on r.hotel_id = $1 and r.room_type_id = g.room_type_id and r.for_date = g.for_date
      where g.room_type_id = any($4::uuid[])
      order by g.room_type_id, g.for_date`,
    [hotelId, from, to, rooms.map((r) => r.room_type_id)]);

  const { rows: priced } = plans.length === 0 ? { rows: [] } : await client.query<{
    room_type_id: string; meal_plan: string; for_date: string;
    by_guests: (string | null)[]; source: "typed" | "derived" | "rack" | null;
    extra_adult: string | null; extra_child: string | null;
  }>(
    /* The prices for 1 … n adults are app.tariff_guests (162): tariff_for's
       own arithmetic, one read a date, in inventory - no copy here any more
       (it could not know a one-guest base's second guest is double
       occupancy, D27-194). Calling app.tariff_for per date and per guest
       count took 11 seconds for a year as pms_app, which is why this read
       once a date. Held to app.tariff_for by
       api/test/modules/channel-manager/suAvailability.test.ts and
       db/tests/modules/inventory.sql. */
    `select rt.id::text as room_type_id, mp.meal_plan, d::date::text as for_date,
            app.tariff_guests(rt.id, mp.meal_plan, d::date, rt.max_occupancy)::text[] as by_guests,
            p.source,
            p.extra_adult::text as extra_adult, p.extra_child::text as extra_child
       from room_types rt
       cross join unnest($4::text[]) as mp(meal_plan)
       cross join generate_series($2::date, $3::date, interval '1 day') d
       /* left join: a date the function answers with no row is still a date SU
          must hear about, with no price. */
       left join lateral app.price_parts(rt.id, mp.meal_plan, d::date) p on true
      where rt.hotel_id = $1 and rt.id = any($5::uuid[])
      order by rt.id, mp.meal_plan, d`,
    [hotelId, from, to, plans.map((p) => p.meal_plan), rooms.map((r) => r.room_type_id)]);

  for (const r of rooms) {
    snapshot.rooms.push({
      roomTypeId: r.room_type_id, name: r.name, suRoomId: r.su_room_id, maxOccupancy: r.max_occupancy,
      days: grid.filter((g) => g.room_type_id === r.room_type_id).map((g) => ({
        date: g.for_date,
        roomsLeft: Math.max(0, g.available),
        stopSell: g.stop_sell === true,
        closedArrival: g.closed_arrival === true,
        closedDeparture: g.closed_departure === true,
        minNights: g.min_nights,
        maxNights: g.max_nights,
      })),
      plans: plans.map((p) => ({
        mealPlan: p.meal_plan, suRatePlanId: p.su_rate_plan_id,
        prices: priced
          .filter((x) => x.room_type_id === r.room_type_id && x.meal_plan === p.meal_plan)
          .map((x) => ({
            date: x.for_date, mealPlan: x.meal_plan,
            byGuests: x.by_guests, source: x.source,
            extraAdult: x.extra_adult, extraChild: x.extra_child,
          })),
      })),
    });
  }
  return snapshot;
}
