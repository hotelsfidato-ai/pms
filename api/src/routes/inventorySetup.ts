import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   SETTING UP WHAT THE PROPERTY SELLS

   Until this file, nothing in the API could create a room or a room
   type. `app.provision_property` builds a whole property from a
   template in one act, and after that the only way to add a Deluxe or
   a room 308 was SQL.

   That is a real hole in a system meant to run seven hotels: six of
   them are not configured yet, room counts change, a floor gets
   converted. A property manager cannot be told to ask for a database
   session.

   NO PRICE IS SET HERE, and that is deliberate rather than an
   omission. `base_rate` stays NULL on a new room type — the rack rate
   is set on the rate calendar, by somebody who has decided what the
   room is worth. Defect 63 is the system shipping prices nobody at the
   hotel had chosen, and a "create room type" form with a rate field
   pre-filled at 3500 is the same fault wearing a different hat.

   A ROOM TYPE IS NOT DELETED. Reservations, rates and folio history
   all point at it, and removing one would either fail on a foreign key
   or orphan a year of bookings. It is deactivated, like everything
   else here — the same rule `hotels_no_delete` enforces one level up.
   ══════════════════════════════════════════════════════════════════ */

export const inventorySetup = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/* ── Room types ───────────────────────────────────────────────────── */

inventorySetup.post("/:code/room-types", async (c) => {
  type Body = {
    code?: string; name?: string;
    baseOccupancy?: number; maxOccupancy?: number; sortOrder?: number;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const code = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  if (!code) return c.json(refuse("A short code, like DLX."), 409);
  if (!/^[A-Z0-9]{2,10}$/.test(code)) {
    return c.json(refuse(
      "Two to ten letters or digits — it prints on the tape chart and "
      + "the rate grid, where there is no room for a sentence."), 409);
  }
  if (!name) return c.json(refuse("What is this type called?"), 409);

  const base = Number(input.baseOccupancy ?? 2);
  const max = Number(input.maxOccupancy ?? 3);
  if (!Number.isInteger(base) || base < 1) {
    return c.json(refuse("How many people does the rate cover?"), 409);
  }
  if (!Number.isInteger(max) || max < base) {
    return c.json(refuse(
      "The maximum is at least the number the rate covers — otherwise "
      + "an extra person costs less than nobody."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into room_types
           (hotel_id, code, name, base_occupancy, max_occupancy, sort_order)
         values ($1,$2,$3,$4,$5,$6)
         returning id::text`,
        /* base_rate is NOT in this list. A new type is UNPRICED until
           somebody sets a rate on the calendar. */
        [hotelId, code, name, base, max, input.sortOrder ?? 0]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      if (e?.code === "23505") {
        return refuse(`This property already has a type coded ${code}.`);
      }
      return refuse(e?.message ?? "That room type could not be added.");
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

inventorySetup.patch("/:code/room-types/:id", async (c) => {
  type Body = {
    name?: string; baseOccupancy?: number; maxOccupancy?: number;
    sortOrder?: number; isActive?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: cur } = await client.query<{
      base_occupancy: number; max_occupancy: number;
    }>(
      `select base_occupancy, max_occupancy from room_types
        where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    if (!cur[0]) return "missing" as const;

    const base = input.baseOccupancy ?? cur[0].base_occupancy;
    const max = input.maxOccupancy ?? cur[0].max_occupancy;
    if (max < base) {
      return refuse("The maximum is at least the number the rate covers.");
    }

    /* DEACTIVATING IS NOT DELETING, and it is refused while rooms are
       still of this type — otherwise the tape chart shows rooms whose
       type is switched off, and nothing explains why they cannot be
       sold. Move the rooms first. */
    if (input.isActive === false) {
      const { rows: still } = await client.query<{ n: string }>(
        `select count(*)::text as n from rooms
          where room_type_id = $1 and is_active`, [c.req.param("id")]);
      if (Number(still[0]!.n) > 0) {
        return refuse(
          `${still[0]!.n} room${Number(still[0]!.n) === 1 ? " is" : "s are"} `
          + "still of this type. Move them to another type first.");
      }
    }

    await client.query(
      `update room_types set
         name = coalesce($3, name),
         base_occupancy = $4, max_occupancy = $5,
         sort_order = coalesce($6, sort_order),
         is_active = coalesce($7, is_active)
       where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId, input.name?.trim() || null,
       base, max, input.sortOrder ?? null, input.isActive ?? null]);
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such room type." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Rooms ────────────────────────────────────────────────────────── */

inventorySetup.post("/:code/rooms", async (c) => {
  type Body = {
    number?: string; roomTypeId?: string; floor?: number | null;
    smoking?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const number = input.number?.trim();
  if (!number) return c.json(refuse("What is the room number?"), 409);
  if (!input.roomTypeId) return c.json(refuse("Which type is it?"), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The type must belong to THIS property. RLS scopes what a session
       can see, and a group admin sees every hotel — so without this a
       room at Akkalkot could be given a Pune room type and every rate
       lookup would quietly miss. The same guard 060 gives banquet. */
    const { rows: type } = await client.query<{ id: string; active: boolean }>(
      `select id::text, is_active as active from room_types
        where id = $1 and hotel_id = $2`, [input.roomTypeId, hotelId]);
    if (!type[0]) return refuse("That room type is not at this property.");
    if (!type[0].active) {
      return refuse("That room type is switched off. Turn it back on first.");
    }

    const { rows: clash } = await client.query<{ n: string }>(
      `select count(*)::text as n from rooms
        where hotel_id = $1 and number = $2`, [hotelId, number]);
    if (Number(clash[0]!.n) > 0) {
      return refuse(`This property already has a room ${number}.`);
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into rooms (hotel_id, room_type_id, number, floor, smoking)
       values ($1,$2,$3,$4,$5) returning id::text`,
      [hotelId, input.roomTypeId, number,
       input.floor ?? null, input.smoking ?? false]);
    return { ok: true as const, id: rows[0]!.id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

inventorySetup.patch("/:code/rooms/:number", async (c) => {
  type Body = {
    roomTypeId?: string; floor?: number | null; smoking?: boolean;
    isActive?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: room } = await client.query<{ id: string; occupied: boolean }>(
      `select id::text, occupancy_status <> 'vacant' as occupied
         from rooms where hotel_id = $1 and number = $2`,
      [hotelId, c.req.param("number")]);
    if (!room[0]) return "missing" as const;

    if (input.roomTypeId) {
      const { rows: type } = await client.query<{ id: string }>(
        `select id::text from room_types where id = $1 and hotel_id = $2`,
        [input.roomTypeId, hotelId]);
      if (!type[0]) return refuse("That room type is not at this property.");
    }

    /* A ROOM WITH SOMEBODY IN IT IS NOT RETIRED. The guest is standing
       in it, the folio is open, and the night audit has to charge for
       it. Take it out of service through a block, which is dated and
       has a reason — that is what 022 built blocks for. */
    if (input.isActive === false && room[0].occupied) {
      return refuse(
        "Somebody is in that room. Block it instead — a block has dates "
        + "and a reason, and this does not.");
    }

    await client.query(
      `update rooms set
         room_type_id = coalesce($3, room_type_id),
         floor = case when $4::boolean then $5::smallint else floor end,
         smoking = coalesce($6, smoking),
         is_active = coalesce($7, is_active)
       where hotel_id = $1 and number = $2`,
      [hotelId, c.req.param("number"), input.roomTypeId ?? null,
       Object.hasOwn(input, "floor"), input.floor ?? null,
       input.smoking ?? null, input.isActive ?? null]);
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such room." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── What is there now ────────────────────────────────────────────── */

inventorySetup.get("/:code/room-setup", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: types } = await client.query<{
      id: string; code: string; name: string; base: number; max: number;
      sort: number; active: boolean; rate: string | null; rooms: number;
      sellable: number;
    }>(
      `select rt.id::text, rt.code, rt.name,
              rt.base_occupancy as base, rt.max_occupancy as max,
              rt.sort_order as sort, rt.is_active as active,
              rt.base_rate::text as rate,
              count(r.id)::int as rooms,
              count(r.id) filter (where r.is_active)::int as sellable
         from room_types rt
         left join rooms r on r.room_type_id = rt.id
        where rt.hotel_id = $1
        group by rt.id
        order by rt.sort_order, rt.code`,
      [hotelId]);

    const { rows: rooms } = await client.query<{
      id: string; number: string; type_id: string; type: string;
      floor: number | null; smoking: boolean; active: boolean;
      occupied: boolean;
    }>(
      `select r.id::text, r.number, rt.id::text as type_id, rt.name as type,
              r.floor, r.smoking, r.is_active as active,
              r.occupancy_status <> 'vacant' as occupied
         from rooms r join room_types rt on rt.id = r.room_type_id
        where r.hotel_id = $1
        order by r.number`,
      [hotelId]);

    return {
      types: types.map((t) => ({
        id: t.id, code: t.code, name: t.name,
        baseOccupancy: t.base, maxOccupancy: t.max, sortOrder: t.sort,
        isActive: t.active,
        /* NULL, not 0. An unpriced type is not a free one, and this is
           the seventh place that rule is enforced. */
        rackRate: t.rate === null ? null : Number(t.rate),
        rooms: t.rooms, sellable: t.sellable,
      })),
      rooms: rooms.map((r) => ({
        id: r.id, number: r.number, roomTypeId: r.type_id, roomType: r.type,
        floor: r.floor, smoking: r.smoking, isActive: r.active,
        occupied: r.occupied,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
