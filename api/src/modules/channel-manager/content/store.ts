import type { Client } from "../../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT A HOTEL SENDS TO SU — read from the PMS, the record (D17-28)

   Everything SU's content calls need, in one read, inside the caller's
   session so row-level security scopes it to the hotels the person has:

     the hotel record          hotels (002, 019, 168): name, address, phone,
                               email, currency, time zone, check-in/out, and
                               its postcode and map point - the hotel's own,
                               set in Settings (D27-214); where its profile
                               has none yet, what was typed in SU's setup
                               before 168 (channel_hotels keeps those columns)
     its SU details            channel_hotels (106): SU's hotel id and
                               what SU requires that the record lacks
     its room types            room_types, with the rooms that are active,
                               and each one's SU mapping (channel_room_types)
     its meal plans            meal_plans, and each one's SU rate plan
                               (channel_rate_plans)
     whether it is switched on app.module_enabled(hotel, 'channel_manager'):
                               the master's per-hotel switch (D17-45). No row
                               means off, and no row can exist until the
                               switch is built, so today it is off everywhere.

   Money stays a string from the database to the payload (db.ts): a rack
   rate is sent to SU exactly as it was typed.
   ══════════════════════════════════════════════════════════════════ */

export interface HotelRecord {
  id: string; code: string; name: string;
  addressLine: string | null; city: string; state: string | null;
  phone: string | null; email: string | null;
  currency: string; timezone: string;
  checkIn: string; checkOut: string;
  postalCode: string | null; latitude: string | null; longitude: string | null;
}

export interface ChannelHotel {
  suHotelId: string;
  countryCode: string | null;
  contactFirstName: string | null; contactLastName: string | null;
  description: string | null;
  onSu: boolean;
  contentSentAt: string | null; contentResult: string | null; contentOk: boolean | null;
}

export interface OnSu { onSu: "active" | "deactivated" | null }
export interface SendRecord {
  sentAt: string | null; sentAs: string | null; sentResult: string | null; sentOk: boolean | null;
}

export interface RoomTypeContent {
  id: string; code: string; name: string;
  maxOccupancy: number; rackRate: string | null; rooms: number;
  mapping: (OnSu & SendRecord & {
    suRoomId: string; suRoomType: number; maxChildren: number; isConnected: boolean;
  }) | null;
}

export interface MealPlanContent {
  code: string; name: string; includes: string;
  mapping: (OnSu & SendRecord & {
    suRatePlanId: string; suMealPlan: number; isConnected: boolean;
  }) | null;
}

export interface HotelContent {
  hotel: HotelRecord;
  channel: ChannelHotel | null;
  roomTypes: RoomTypeContent[];
  mealPlans: MealPlanContent[];
  switchedOn: boolean;
}

export async function hotelIdFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

export async function loadContent(client: Client, hotelId: string): Promise<HotelContent | null> {
  const { rows: hotels } = await client.query<{
    id: string; code: string; name: string; address_line: string | null;
    city: string; state: string | null; phone: string | null; email: string | null;
    currency: string; timezone: string; check_in: string; check_out: string;
    postal_code: string | null; latitude: string | null; longitude: string | null;
    switched_on: boolean;
  }>(
    `select h.id::text, h.code, h.name, h.address_line, h.city, h.state, h.phone,
            h.email::text, h.currency, h.timezone,
            to_char(h.check_in_time, 'HH24:MI') as check_in,
            to_char(h.check_out_time, 'HH24:MI') as check_out,
            coalesce(h.pin, c.postal_code) as postal_code,
            coalesce(h.latitude, c.latitude)::text as latitude,
            coalesce(h.longitude, c.longitude)::text as longitude,
            app.module_enabled(h.id, 'channel_manager') as switched_on
       from hotels h left join channel_hotels c on c.hotel_id = h.id
      where h.id = $1`,
    [hotelId]);
  const h = hotels[0];
  if (!h) return null;

  const { rows: ch } = await client.query<{
    su_hotel_id: string; country_code: string | null;
    contact_first_name: string | null; contact_last_name: string | null;
    description: string | null; on_su: boolean;
    content_sent_at: string | null; content_result: string | null; content_ok: boolean | null;
  }>(
    `select su_hotel_id, country_code,
            contact_first_name, contact_last_name, description, on_su,
            content_sent_at::text, content_result, content_ok
       from channel_hotels where hotel_id = $1`,
    [hotelId]);

  const { rows: types } = await client.query<{
    id: string; code: string; name: string; max_occupancy: number;
    base_rate: string | null; rooms: string;
    su_room_id: string | null; su_room_type: number | null; max_children: number | null;
    is_connected: boolean | null; on_su: "active" | "deactivated" | null;
    sent_at: string | null; sent_as: string | null; sent_result: string | null; sent_ok: boolean | null;
  }>(
    `select rt.id::text, rt.code, rt.name, rt.max_occupancy,
            /* the normal price: the room type's own today (EP, one guest where it
               has a base, D27-188), not only the old rack rate */
            (select p.price from app.price_for(rt.id, 'EP', app.business_date($1)) p)::text as base_rate,
            (select count(*) from rooms r
              where r.room_type_id = rt.id and r.is_active)::text as rooms,
            m.su_room_id, m.su_room_type, m.max_children, m.is_connected, m.on_su,
            m.sent_at::text, m.sent_as, m.sent_result, m.sent_ok
       from room_types rt
       left join channel_room_types m on m.room_type_id = rt.id
      where rt.hotel_id = $1 and rt.is_active
      order by rt.sort_order, rt.name`,
    [hotelId]);

  const { rows: plans } = await client.query<{
    code: string; name: string; includes: string;
    su_rate_plan_id: string | null; su_meal_plan: number | null;
    is_connected: boolean | null; on_su: "active" | "deactivated" | null;
    sent_at: string | null; sent_as: string | null; sent_result: string | null; sent_ok: boolean | null;
  }>(
    `select mp.code, mp.name, mp.includes,
            m.su_rate_plan_id, m.su_meal_plan, m.is_connected, m.on_su,
            m.sent_at::text, m.sent_as, m.sent_result, m.sent_ok
       from meal_plans mp
       left join channel_rate_plans m on m.meal_plan = mp.code and m.hotel_id = $1
      order by mp.code`,
    [hotelId]);

  const c = ch[0];
  return {
    hotel: {
      id: h.id, code: h.code, name: h.name, addressLine: h.address_line,
      city: h.city, state: h.state, phone: h.phone, email: h.email,
      currency: h.currency, timezone: h.timezone, checkIn: h.check_in, checkOut: h.check_out,
      postalCode: h.postal_code, latitude: h.latitude, longitude: h.longitude,
    },
    channel: c ? {
      suHotelId: c.su_hotel_id, countryCode: c.country_code,
      contactFirstName: c.contact_first_name, contactLastName: c.contact_last_name,
      description: c.description, onSu: c.on_su,
      contentSentAt: c.content_sent_at, contentResult: c.content_result, contentOk: c.content_ok,
    } : null,
    roomTypes: types.map((t) => ({
      id: t.id, code: t.code, name: t.name, maxOccupancy: t.max_occupancy,
      rackRate: t.base_rate, rooms: Number(t.rooms),
      mapping: t.su_room_id === null ? null : {
        suRoomId: t.su_room_id, suRoomType: t.su_room_type!, maxChildren: t.max_children!,
        isConnected: t.is_connected === true, onSu: t.on_su,
        sentAt: t.sent_at, sentAs: t.sent_as, sentResult: t.sent_result, sentOk: t.sent_ok,
      },
    })),
    mealPlans: plans.map((p) => ({
      code: p.code, name: p.name, includes: p.includes,
      mapping: p.su_rate_plan_id === null ? null : {
        suRatePlanId: p.su_rate_plan_id, suMealPlan: p.su_meal_plan!,
        isConnected: p.is_connected === true, onSu: p.on_su,
        sentAt: p.sent_at, sentAs: p.sent_as, sentResult: p.sent_result, sentOk: p.sent_ok,
      },
    })),
    switchedOn: h.switched_on,
  };
}

/* ── What SU said: recorded as it happened ──────────────────────────
   `on_su` moves only on an answer SU accepted; a refusal leaves SU's
   state as it was and says why. */

export async function recordHotelSend(
  client: Client, hotelId: string, staffId: string, ok: boolean, result: string,
): Promise<void> {
  await client.query(
    `update channel_hotels
        set content_sent_at = now(), content_ok = $2, content_result = $3,
            on_su = on_su or $2, updated_by = $4, updated_at = now()
      where hotel_id = $1`,
    [hotelId, ok, result, staffId]);
}

export async function recordRoomTypeSend(
  client: Client, roomTypeId: string, staffId: string,
  sentAs: string, ok: boolean, result: string, onSuIfOk: "active" | "deactivated",
): Promise<void> {
  await client.query(
    `update channel_room_types
        set sent_at = now(), sent_as = $2, sent_ok = $3, sent_result = $4,
            on_su = case when $3 then $5 else on_su end,
            updated_by = $6, updated_at = now()
      where room_type_id = $1`,
    [roomTypeId, sentAs, ok, result, onSuIfOk, staffId]);
}

export async function recordRatePlanSend(
  client: Client, hotelId: string, mealPlan: string, staffId: string,
  sentAs: string, ok: boolean, result: string, onSuIfOk: "active" | "deactivated",
): Promise<void> {
  await client.query(
    `update channel_rate_plans
        set sent_at = now(), sent_as = $3, sent_ok = $4, sent_result = $5,
            on_su = case when $4 then $6 else on_su end,
            updated_by = $7, updated_at = now()
      where hotel_id = $1 and meal_plan = $2`,
    [hotelId, mealPlan, sentAs, ok, result, onSuIfOk, staffId]);
}
