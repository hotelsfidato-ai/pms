import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ROOM-TYPE AND RATE-PLAN LISTS

   Split out of api/src/routes/directory.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service:
   inventory. The router keeps the name it had there. One change since:
   an unpriced room type's rack rate travels as null, not 0 (INV-3,
   16 September). `hotelIdFor` is a copy of the one beside
   it in modules/guests/directory.ts — each route file keeps its own.
   ══════════════════════════════════════════════════════════════════ */

const directory = new Hono<{ Variables: { subject: string } }>();
export { directory as roomTypesAndPlans };

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/* ── Room types and rate plans ───────────────────────────────────── */

directory.get("/:code/room-types", async (c) => {
  const asOnParam = c.req.query("asOn");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const asOn = asOnParam ?? bd;

    const { rows } = await client.query<{
      type: string; rooms: string; sellable: string;
      max_occupancy: number; rack_rate: string | null; numbers: string[];
    }>(
      `select rt.name                                   as type,
              count(rm.id)::text                        as rooms,
              count(rm.id) filter (where not exists (
                select 1 from room_blocks b
                 where b.room_id = rm.id
                   and $2::date >= b.from_date
                   and (b.to_date is null or $2::date <= b.to_date)
              ))::text                                  as sellable,
              rt.max_occupancy,
              rt.base_rate                              as rack_rate,
              array_agg(rm.number order by rm.number collate app.room_order) as numbers
         from room_types rt
         join rooms rm on rm.room_type_id = rt.id and rm.is_active
        where rt.hotel_id = $1 and rt.is_active
        group by rt.id, rt.name, rt.max_occupancy, rt.base_rate, rt.sort_order
        order by rt.sort_order, rt.name`,
      [hotelId, asOn],
    );

    return rows.map((r) => ({
      type: r.type,
      rooms: Number(r.rooms),
      sellable: Number(r.sellable),
      maxOccupancy: r.max_occupancy,
      /* null, not 0 (INV-3): `Number(null)` turned a room type nobody has
         priced into a free one. */
      rackRate: r.rack_rate === null ? null : Number(r.rack_rate),
      numbers: r.numbers,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ⚠ `GET /api/hotels/rate-plans` WAS HERE AND COULD NEVER RUN (INV-1).
   It listed the meal plans, group-wide. But this router is mounted at
   /api/hotels, where `GET /:code` is registered first, so Hono matched
   "rate-plans" as a property code and the route answered
   404 "No such property." — read on 15 September, and confirmed by
   calling it on 16 September.

   Removed rather than reordered: nothing called it, and moving a route
   above another to make it reachable is a change every later route has
   to remember. The meal plans a screen needs come with the rates:
   `GET /:code/rate-plans` (`rates.ts`) returns `mealPlans` alongside
   the room types and the rate rows.

   A route a broader route shadows is not a route; it is a 404 with a
   comment. Removed 16 September 2026. */
