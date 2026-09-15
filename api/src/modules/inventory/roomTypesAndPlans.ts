import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ROOM-TYPE AND RATE-PLAN LISTS

   Split out of api/src/routes/directory.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service:
   inventory. Every endpoint is unchanged, byte for byte, and the router
   keeps the name it had there. `hotelIdFor` is a copy of the one beside
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
      max_occupancy: number; rack_rate: string; numbers: string[];
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
              array_agg(rm.number order by rm.number)   as numbers
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
      rackRate: Number(r.rack_rate),
      numbers: r.numbers,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

directory.get("/rate-plans", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{
      code: string; name: string; includes: string;
    }>("select code, name, includes from meal_plans order by code");

    /* Where the live eZee system shows each plan. Presentation, not
       schema — the export prints "Deluxe CP", room type and meal plan
       together, and only two of these appear in it at all. */
    const SEEN: Record<string, string> = { CP: "Deluxe CP", RO: "Room Only" };

    return rows.map((r) => ({
      code: r.code === "RO" ? "Room Only" : r.code,
      name: r.name,
      includes: r.includes,
      seenAs: SEEN[r.code] ?? null,
    }));
  });

  return c.json(body ?? []);
});
