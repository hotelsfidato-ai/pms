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
  name: string;
  city: string;
  state: string | null;
  gstin: string | null;
  timezone: string;
  currency: string;
  check_in_time: string;
  check_out_time: string;
}

hotels.get("/", async (c) => {
  const subject = c.get("subject");

  const body = await withSession(subject, async (client, session: Session) => {
    /* No hotel filter. RLS applies `hotels_read`, so an Agra clerk and
       the group owner run the same SQL and get different rows. */
    const { rows } = await client.query<HotelRow>(
      `select id, code, name, city, state, gstin, timezone, currency,
              to_char(check_in_time,  'HH24:MI') as check_in_time,
              to_char(check_out_time, 'HH24:MI') as check_out_time
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
        city: h.city,
        state: h.state,
        gstin: h.gstin,
        timezone: h.timezone,
        currency: h.currency,
        checkInTime: h.check_in_time,
        checkOutTime: h.check_out_time,
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

  return {
    staffId: session.staffId,
    email: session.email,
    fullName: session.fullName,
    isGroupAdmin: session.isGroupAdmin,
    /* A group admin holds no staff_hotels rows and still reaches
       everything — `auth_hotel_ids()` accounts for that. Reporting the
       empty list alongside the flag keeps the interface from reading
       "no properties" when the truth is "all of them". */
    hotels: rows.map((r) => ({ hotelId: r.hotel_id, role: r.role })),
  };
}
