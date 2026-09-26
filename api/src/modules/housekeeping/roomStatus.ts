import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   A ROOM'S HOUSEKEEPING STATE, AND TAKING A ROOM OUT OF INVENTORY

   Split out of api/src/routes/property.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service:
   housekeeping. Every endpoint is unchanged, byte for byte, and the
   router keeps the name it had there.

   `HotelRow` and `resolve` are copies of the ones in api/src/routes/
   property.ts, whose header says why a code the caller may not see
   answers 404 — each route file keeps its own.
   ══════════════════════════════════════════════════════════════════ */

const property = new Hono<{ Variables: { subject: string } }>();
export { property as roomStatus };

interface HotelRow {
  id: string;
  code: string;
  name: string;
  address_line: string | null;
  city: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  currency: string;
  check_in_time: string;
  check_out_time: string;
}

async function resolve(client: Client, code: string) {
  const { rows } = await client.query<HotelRow>(
    `select id, code, name, address_line, city, phone, email, gstin, currency,
            to_char(check_in_time,  'HH24:MI') as check_in_time,
            to_char(check_out_time, 'HH24:MI') as check_out_time
       from hotels
      where code = upper($1) and is_active`,
    [code],
  );
  return rows[0] ?? null;
}

const HOUSEKEEPING_IN: Record<string, string> = {
  clean: "clean",
  dirty: "dirty",
  inspected: "inspected",
};

property.put("/:code/rooms/:number/housekeeping", async (c) => {
  const wanted = (await c.req.json().catch(() => ({}))) as { state?: string };
  const state = HOUSEKEEPING_IN[wanted.state ?? ""];

  if (!state) {
    return c.json(
      { allowed: false, reason: `"${wanted.state}" is not a housekeeping state.` },
      400,
    );
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    /* The room is read first so a refusal can name a reason rather
       than reporting "0 rows updated", which tells a clerk nothing. */
    const { rows } = await client.query<{ housekeeping_status: string }>(
      "select housekeeping_status from rooms where hotel_id = $1 and number = $2",
      [hotel.id, c.req.param("number")],
    );
    const room = rows[0];
    if (!room) return { allowed: false, reason: "Room not found." };

    if (room.housekeeping_status === "out_of_service") {
      return {
        allowed: false,
        reason: "This room is held out of service. Release it before cleaning it.",
      };
    }
    if (state === "inspected" && room.housekeeping_status === "dirty") {
      return {
        allowed: false,
        reason: "A dirty room is cleaned before it is inspected.",
      };
    }

    await client.query(
      "update rooms set housekeeping_status = $3 where hotel_id = $1 and number = $2",
      [hotel.id, c.req.param("number"), state],
    );
    return { allowed: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.allowed ? 200 : 409);
});

/* ── Taking a room out of inventory ───────────────────────────────────
   `room_blocks` has existed since 022 with a reason, dates and an
   author. The tape chart draws from it. Nothing has ever written to it,
   so a housekeeper finding a broken shower could not record it and the
   only blocks in the system came from the demo loader.
   ═══════════════════════════════════════════════════════════════════ */
property.post("/:code/rooms/:number/block", async (c) => {
  type Body = {
    reason?: string; from?: string; to?: string | null; note?: string;
    workOrderId?: string | null;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const REASONS = [
    "out_of_service", "out_of_order", "refurbishment",
    "house_use", "owner_occupied",
  ];
  if (!input.reason || !REASONS.includes(input.reason)) {
    return c.json({ ok: false, reason: "Why is the room coming out?" }, 409);
  }
  const from = input.from;
  if (!from) {
    return c.json({ ok: false, reason: "From which date?" }, 409);
  }
  if (input.to && input.to < from) {
    return c.json({
      ok: false,
      reason: "A block cannot end before it starts.",
    }, 409);
  }

  const body = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const { rows: room } = await client.query<{ id: string }>(
      `select id::text from rooms
        where hotel_id = $1 and number = $2 and is_active`,
      [hotel.id, c.req.param("number")],
    );
    if (!room[0]) {
      return { ok: false, reason: `There is no room ${c.req.param("number")} here.` };
    }

    /* A room with somebody in it is not a room you can take out. The
       tape chart would draw it blocked while a guest slept in it, and
       the night audit would still post their room charge. */
    const { rows: occupied } = await client.query<{ guest: string }>(
      `select g.full_name as guest
         from room_assignments ra
         join reservations r on r.id = ra.reservation_id
         join guests g on g.id = r.guest_id
        where ra.room_id = $1 and ra.released_at is null
          and r.status = 'checked_in'
        limit 1`,
      [room[0].id],
    );
    if (occupied[0]) {
      return {
        ok: false,
        reason: `${occupied[0].guest} is in that room. Move them out first.`,
      };
    }

    /* THE REPAIR THIS BLOCK IS FOR, when "Report a repair" also takes the
       room out (the owner, 17 September). The order then points at the
       block (058's `block_id`), so Work orders says "Room is out" and
       putting the room back is one decision. Checked before the first
       write (root MEMORY 243). */
    const workOrderId = input.workOrderId?.trim() || null;
    if (workOrderId) {
      const { rows: order } = await client.query<{
        room_id: string | null; status: string; block_id: string | null;
      }>(
        `select room_id::text, status, block_id::text from work_orders
          where id::text = $1 and hotel_id = $2 for update`,
        [workOrderId, hotel.id],
      );
      if (!order[0]) return { ok: false, reason: "No such repair here." };
      if (order[0].room_id !== room[0].id) {
        return { ok: false, reason: "That repair is not for this room." };
      }
      if (order[0].status === "done" || order[0].status === "cancelled") {
        return { ok: false, reason: "That repair is closed." };
      }
      if (order[0].block_id) {
        return { ok: false, reason: "That repair has already taken the room out." };
      }
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into room_blocks
         (hotel_id, room_id, from_date, to_date, reason, note, created_by)
       values ($1,$2,$3::date,$4::date,$5,$6,$7)
       returning id::text`,
      [hotel.id, room[0].id, from, input.to ?? null,
       input.reason, input.note?.trim() || null, session.staffId],
    );

    /* The room's own status too, when the block starts today or earlier
       — the board reads `housekeeping_status`, the chart reads the
       block, and the two disagreeing is how a room gets sold twice. */
    if (from <= (await businessDateFor(client, hotel.id))) {
      await client.query(
        `update rooms set housekeeping_status = 'out_of_service' where id = $1`,
        [room[0].id],
      );
    }

    if (workOrderId) {
      await client.query(
        `update work_orders set block_id = $1::uuid where id::text = $2 and hotel_id = $3`,
        [rows[0]!.id, workOrderId, hotel.id],
      );
    }

    return { ok: true as const, id: rows[0]!.id };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok ? 200 : 409);
});

property.delete("/:code/rooms/:number/block/:id", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const { rows: room } = await client.query<{ id: string }>(
      `select id::text from rooms where hotel_id = $1 and number = $2`,
      [hotel.id, c.req.param("number")],
    );
    if (!room[0]) return { ok: false, reason: "No such room." };

    /* A repair that took the room out points at this block (058's
       `block_id`, set by "Report a repair" since 17 September). The room is
       back, so the repair no longer takes it out — and a pointer left in
       place would refuse this delete. */
    const { rows: block } = await client.query<{ id: string }>(
      `select id::text from room_blocks
        where id::text = $1 and room_id = $2 and hotel_id = $3 for update`,
      [c.req.param("id"), room[0].id, hotel.id],
    );
    /* Refused BEFORE anything is written (root MEMORY 243). */
    if (!block[0]) return { ok: false, reason: "That block is not here." };

    await client.query(
      `update work_orders set block_id = null
        where block_id = $1::uuid and hotel_id = $2`,
      [block[0].id, hotel.id],
    );
    await client.query(
      `delete from room_blocks where id = $1::uuid and hotel_id = $2`,
      [block[0].id, hotel.id],
    );

    /* Back into inventory DIRTY, never clean. A room that has been out
       for a fortnight of refurbishment needs looking at before somebody
       sleeps in it, and "clean" is a claim nobody has checked. */
    await client.query(
      `update rooms set housekeeping_status = 'dirty'
        where id = $1 and housekeeping_status = 'out_of_service'`,
      [room[0].id],
    );

    return { ok: true as const };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok ? 200 : 409);
});
