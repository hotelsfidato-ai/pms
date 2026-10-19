import { Hono } from "hono";
import { withSession, type Session } from "../auth.ts";

/* ══════════════════════════════════════════════════════════════════
   HOTELS

   The first route, and the one CP7 is measured by: it returns the
   properties this person may see, and it does not filter by hotel
   anywhere in this file. `hotels_read` does that in the database.

   If a `where hotel_id = ...` ever appears in a route, isolation has
   moved out of the schema and into application code, where it has to
   be remembered on every query instead of enforced on every query.
   ══════════════════════════════════════════════════════════════════ */

export const hotels = new Hono<{ Variables: { subject: string } }>();

interface HotelRow {
  id: string;
  code: string;
  test_of: string | null;
  name: string;
  city: string;
  state: string | null;
  gstin: string | null;
  timezone: string;
  currency: string;
  check_in_time: string;
  check_out_time: string;
  business_date: string;
  today: string;
  /* The front desk's rules (187, D27-243). */
  default_payment_method: string;
  desk_may_overbook: boolean;
  advance_before_check_in: "none" | "first_night" | "whole_stay";
  weekend_days: number[];
  default_id_type: string | null;
  default_nationality: string;
  default_title: string | null;
  payment_methods: { label: string; kind: string }[];
  /* Phase 5 (192, D27-260). */
  default_guarantee: "confirmed" | "tentative";
  default_bill_to: "guest" | "company";
  required_booking_fields: string[];
  hk_dirty_after_move: boolean;
  hk_dirty_after_unblock: boolean;
  hk_stayover_dirty_at_audit: boolean;
  id_types_off: string[];
  status_colours: Record<string, string> | null;
  pos_round_off: "off" | "manual" | "automatic";
  kpi_day_use_half: boolean;
  kpi_comp_as_sold: boolean;
  invoice_at_checkout: string;
  invoice_copies: number;
  holidays: Array<{ day: string; name: string; colour: string | null }>;
}

hotels.get("/", async (c) => {
  const subject = c.get("subject");

  const body = await withSession(subject, async (client, session: Session) => {
    /* No hotel filter. RLS applies `hotels_read`, so an Agra clerk and
       the group owner run the same SQL and get different rows.

       That sentence was FALSE until migration 031. `hotels_read` was
       `app.is_active_staff()` — anyone who could sign in listed every
       property in the group, GSTIN included. Every other table was
       scoped correctly, so no guest and no money ever leaked; the
       roster of properties did.

       It was found by using the new admin API rather than by any test:
       a clerk created and rostered at one property asked this endpoint
       what it could see, and it named all four. The comment had
       described the intention for months while the policy did
       something else, which is the worst pair — the comment is what
       anybody reads. */
    const { rows } = await client.query<HotelRow>(
      `select id, code, name, city, state, gstin, timezone, currency,
              /* D27-296: a test hotel names the real hotel it copies, by code.
                 Through a definer: its testers cannot read the real hotel's row. */
              app.real_hotel_code(id) as test_of,
              to_char(check_in_time,  'HH24:MI') as check_in_time,
              to_char(check_out_time, 'HH24:MI') as check_out_time,
              /* Each property's OWN operating day. Two hotels are
                 routinely on different dates: one has run its night
                 audit and the other has not. Returned per row for
                 exactly that reason - there is no group business
                 date to return instead. */
              to_char(app.business_date(id), 'YYYY-MM-DD') as business_date,
              /* The property's real date, in its own time zone (D27-237): a
                 business date behind it is a day nobody closed. */
              to_char((now() at time zone timezone)::date, 'YYYY-MM-DD') as today,
              /* The front desk's rules, read by its screens and set on
                 Settings › Operations (187, D27-243). */
              default_payment_method, desk_may_overbook, advance_before_check_in,
              weekend_days::int[] as weekend_days,
              default_id_type, default_nationality, default_title,
              /* The hotel's own ways of paying that are On, in its order (191). */
              coalesce((select json_agg(json_build_object('label', pm.label, 'kind', pm.kind)
                                        order by pm.sort_order, lower(pm.label))
                          from payment_methods pm
                         where pm.hotel_id = hotels.id and pm.is_active), '[]') as payment_methods,
              /* Phase 5 (192, D27-260). */
              default_guarantee, default_bill_to, required_booking_fields,
              hk_dirty_after_move, hk_dirty_after_unblock, hk_stayover_dirty_at_audit,
              id_types_off, status_colours, pos_round_off, kpi_day_use_half, kpi_comp_as_sold,
              /* The tax invoice at check-out (229, D27-344). */
              invoice_at_checkout, invoice_copies,
              /* Shaded like a weekend on the Calendar and Rates (192). */
              (select coalesce(json_agg(json_build_object(
                        'day', to_char(hh.day, 'YYYY-MM-DD'), 'name', hh.name, 'colour', hh.colour)
                        order by hh.day), '[]'::json)
                 from hotel_holidays hh where hh.hotel_id = hotels.id) as holidays
         from hotels
        where is_active
        order by code`,
    );

    return {
      /* Which of those the person may actually work in. Reading the
         hotel list and holding a posting there are different grants —
         `hotels_read` is every active clerk; `staff_hotels` is not. */
      scope: await scopeFor(client, session),
      hotels: rows.map((h) => ({
        id: h.id,
        code: h.code,
        name: h.name,
        /* D27-296: the real hotel's code for a test hotel; null for a real one. */
        testOf: h.test_of,
        city: h.city,
        state: h.state,
        gstin: h.gstin,
        timezone: h.timezone,
        currency: h.currency,
        checkInTime: h.check_in_time,
        checkOutTime: h.check_out_time,
        businessDate: h.business_date,
        today: h.today,
        deskRules: {
          defaultPaymentMethod: h.default_payment_method,
          deskMayOverbook: h.desk_may_overbook,
          advanceBeforeCheckIn: h.advance_before_check_in,
          weekendDays: h.weekend_days,
          defaultIdType: h.default_id_type,
          defaultNationality: h.default_nationality,
          defaultTitle: h.default_title,
          paymentMethods: h.payment_methods,
          defaultGuarantee: h.default_guarantee,
          defaultBillTo: h.default_bill_to,
          requiredBookingFields: h.required_booking_fields,
          hkDirtyAfterMove: h.hk_dirty_after_move,
          hkDirtyAfterUnblock: h.hk_dirty_after_unblock,
          hkStayoverDirtyAtAudit: h.hk_stayover_dirty_at_audit,
          idTypesOff: h.id_types_off,
          statusColours: h.status_colours,
          posRoundOff: h.pos_round_off,
          kpiDayUseHalf: h.kpi_day_use_half,
          kpiCompAsSold: h.kpi_comp_as_sold,
          invoiceAtCheckout: h.invoice_at_checkout,
          invoiceCopies: h.invoice_copies,
          holidays: h.holidays,
        },
      })),
    };
  });

  return c.json(body);
});

async function scopeFor(
  client: Parameters<Parameters<typeof withSession>[1]>[0],
  session: Session,
) {
  const { rows } = await client.query<{ hotel_id: string; role: string }>(
    `select hotel_id, role from staff_hotels where staff_id = $1`,
    [session.staffId],
  );

  /* Where this person lands after signing in, and how they like the
     house grouped (087). On the server so a GM can set it for them and
     so it is the same answer on the desk terminal and on a phone. */
  const { rows: prefs } = await client.query<{
    home_screen: string; room_grouping: string;
  }>(`select home_screen, room_grouping from app.my_preferences()`);

  /* D27-296: added for testing - works only in test hotels. */
  const { rows: me } = await client.query<{ test_only: boolean }>(
    `select test_only from staff where id = $1`, [session.staffId]);

  /* Whether this person has put their Start here card away (089). */
  const { rows: startHere } = await client.query<{ dismissed: boolean }>(
    `select app.my_start_here_dismissed() as dismissed`);

  return {
    staffId: session.staffId,
    email: session.email,
    fullName: session.fullName,
    isGroupAdmin: session.isGroupAdmin,
    testOnly: me[0]?.test_only ?? false,
    /* A group admin holds no staff_hotels rows and still reaches
       everything — `auth_hotel_ids()` accounts for that. Reporting the
       empty list alongside the flag keeps the interface from reading
       "no properties" when the truth is "all of them". */
    hotels: rows.map((r) => ({ hotelId: r.hotel_id, role: r.role })),
    homeScreen: prefs[0]?.home_screen ?? "dashboard",
    roomGrouping: prefs[0]?.room_grouping ?? "type",
    startHereDismissed: startHere[0]?.dismissed ?? false,
  };
}
