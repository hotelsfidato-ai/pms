import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import { cleanPreferences } from "./preferenceRules.ts";

/* ══════════════════════════════════════════════════════════════════
   A GUEST'S PREFERENCES (D27-383 item 10; built under D27-396)

   On the guest's own record (guests.preferences, migration "a guest's
   preferences"): the same at every hotel the record already is, and
   nowhere else. Shown where they help - the stay lists and the stay panel,
   Assign room, the housekeeping board for a room's arriving guest, the
   restaurant's order for a guest in house - and an allergy in red,
   wherever it is shown, whatever a setting says.

     GET /:code/guest-preferences       every stay still to come or in house
                                        here whose guest has one, with its
                                        room: the lists' marks, housekeeping
                                        and the till read this one answer
     GET /:code/guests/:id/preferences  one guest who has stayed here
     PUT /:code/guests/:id/preferences  set them - whoever may edit the
                                        guest (roleGate's GUEST, customer
                                        edit, as Edit guest), and only a
                                        guest who has stayed here

   AN ALLERGY IS NEVER LOST TO A JOIN. A record joined into another (the
   CRM's join) keeps its own preferences for an undo; what it said about
   an allergy is read with the kept record's, so joining two records never
   hides one. Everything else is the kept record's.
   ══════════════════════════════════════════════════════════════════ */

export const preferences = new Hono<{ Variables: { subject: string } }>();

const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_HERE = "No such guest here.";

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/** The guest's preferences, with every allergy a record joined into them
    carried, for the row aliased `g`. */
const WITH_ALLERGIES = `
  g.preferences || jsonb_strip_nulls(jsonb_build_object('allergies', (
    select string_agg(distinct btrim(x.preferences ->> 'allergies'), '; ')
      from guests x
     where (x.id = g.id or x.joined_into = g.id) and x.preferences ? 'allergies')))`;

/** The allergy of whoever is in house in each of these rooms, as the order
    screen shows it (RoomPreferences, "in-house"): for the KOT and the Kitchen
    screen (D27-396). Room numbers in upper case; every stay in the room. */
export async function inHouseAllergies(
  client: Client, hotelId: string, rooms: string[],
): Promise<Map<string, string>> {
  if (rooms.length === 0) return new Map();
  const { rows } = await client.query<{ room: string; allergies: string }>(
    `select upper(app.stay_room(r.id)) as room,
            string_agg(distinct (${WITH_ALLERGIES}) ->> 'allergies', '; ') as allergies
       from reservations r
       join guests g on g.id = r.guest_id
      where r.hotel_id = $1 and r.status = 'checked_in'
        and upper(app.stay_room(r.id)) = any($2::text[])
      group by 1`,
    [hotelId, rooms]);
  return new Map(rows.filter((r) => r.allergies).map((r) => [r.room, r.allergies]));
}

preferences.get("/:code/guest-preferences", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const { rows } = await client.query(
      `select r.id::text as "stayId", g.id::text as "guestId", app.stay_room(r.id) as room,
              (r.status in ('confirmed', 'tentative') and r.check_in = $2::date) as arriving,
              r.status = 'checked_in' as "inHouse",
              ${WITH_ALLERGIES} as preferences
         from reservations r
         join guests g on g.id = r.guest_id
        where r.hotel_id = $1
          and r.status in ('confirmed', 'tentative', 'checked_in')
          and (g.preferences <> '{}'::jsonb
               or exists (select 1 from guests x where x.joined_into = g.id and x.preferences ? 'allergies'))`,
      [hotelId, bd]);
    const { rows: [h] } = await client.query<{ smoking: boolean }>(
      "select app.hotel_offers_smoking($1) as smoking", [hotelId]);
    return { smokingOffered: h!.smoking, stays: rows };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

const ONE = `
  select ${WITH_ALLERGIES} as preferences, app.hotel_offers_smoking($2) as "smokingOffered"
    from guests g
   where g.id = $1::uuid
     and exists (select 1 from reservations r where r.guest_id = g.id and r.hotel_id = $2)`;

preferences.get("/:code/guests/:id/preferences", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId || !A_UUID.test(c.req.param("id"))) return null;
    return (await client.query(ONE, [c.req.param("id"), hotelId])).rows[0] ?? null;
  });
  return body ? c.json(body) : c.json({ error: NOT_HERE }, 404);
});

preferences.put("/:code/guests/:id/preferences", async (c) => {
  const input = await c.req.json<{ preferences?: unknown }>().catch(() => ({}) as { preferences?: unknown });
  const clean = cleanPreferences(input.preferences);
  if (!clean.ok) return c.json({ ok: false, reason: clean.reason }, 409);

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId || !A_UUID.test(c.req.param("id"))) return null;
    /* A guest belongs to the group, so "this hotel's guest" is "has stayed
       here", which row security answers through reservations - the scope
       Edit guest uses (GU-1). Asked in the same statement as the write. */
    const { rows } = await client.query(
      `update guests g set preferences = app.preferences_kept($3::jsonb, g.preferences, $2)
        where g.id = $1::uuid
          and exists (select 1 from reservations r where r.guest_id = g.id and r.hotel_id = $2)
       returning g.id`,
      [c.req.param("id"), hotelId, JSON.stringify(clean.value)]);
    if (!rows[0]) return null;
    return { ok: true as const, ...(await client.query(ONE, [c.req.param("id"), hotelId])).rows[0] };
  });
  return body ? c.json(body) : c.json({ error: NOT_HERE }, 404);
});
