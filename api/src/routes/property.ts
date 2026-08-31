import { Hono } from "hono";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE PROPERTY — its configuration, and its rooms

   The URL carries the hotel CODE, not its uuid. `hotels.code` is
   commented "appears in URLs" in migration 002, and a code is what a
   person can read back over the phone.

   Resolution is a plain `where code = $1` inside the session, so a
   code the caller may not see resolves to nothing and returns 404 —
   the same answer as a code that does not exist. That is deliberate:
   telling someone a property exists but is not theirs is still
   telling them it exists.
   ══════════════════════════════════════════════════════════════════ */

export const property = new Hono<{ Variables: { subject: string } }>();

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
  cgst_rate: string;
  sgst_rate: string;
}

async function resolve(client: Client, code: string) {
  const { rows } = await client.query<HotelRow>(
    `select id, code, name, address_line, city, phone, email, gstin, currency,
            to_char(check_in_time,  'HH24:MI') as check_in_time,
            to_char(check_out_time, 'HH24:MI') as check_out_time,
            cgst_rate, sgst_rate
       from hotels
      where code = upper($1) and is_active`,
    [code],
  );
  return rows[0] ?? null;
}

/**
 * Payment methods are a CHECK constraint on `payments.method`, not
 * per-property configuration — every property takes the same kinds of
 * money. The database stores the canonical value; this is the label a
 * clerk reads. Presentation belongs here, not in the schema.
 */
const PAYMENT_METHODS = [
  "Cash", "UPI", "Credit Card", "Debit Card",
  "Net Banking", "Wallet", "Cheque", "Bank Transfer", "City Ledger",
];

property.get("/:code", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const [types, plans, rooms] = await Promise.all([
      client.query<{ name: string }>(
        `select name from room_types
          where hotel_id = $1 and is_active order by sort_order, name`,
        [hotel.id],
      ),
      client.query<{ code: string }>(
        "select code from meal_plans order by code",
      ),
      /* The SELLABLE count, not the physical one. Occupancy divides by
         this, and a room held out of service is inventory that cannot
         be sold — 17 of the 18 here. */
      client.query<{ n: string }>(
        `select count(*)::text as n from rooms
          where hotel_id = $1 and is_active
            and housekeeping_status <> 'out_of_service'`,
        [hotel.id],
      ),
    ]);

    return {
      id: hotel.code,
      name: hotel.name,
      address: hotel.address_line ?? hotel.city,
      phone: hotel.phone ?? "",
      email: hotel.email ?? "",
      gstin: hotel.gstin ?? "",
      currency: hotel.currency,
      checkInTime: hotel.check_in_time,
      checkOutTime: hotel.check_out_time,
      rooms: Number(rooms.rows[0]?.n ?? 0),
      roomTypes: types.rows.map((r) => r.name),
      rateTypes: plans.rows.map((r) => r.code),
      tax: { cgst: Number(hotel.cgst_rate), sgst: Number(hotel.sgst_rate) },
      paymentMethods: PAYMENT_METHODS,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Rooms ───────────────────────────────────────────────────────── */

/** The schema separates held-back from broken; the interface does not yet. */
const HOUSEKEEPING_OUT: Record<string, string> = {
  clean: "clean",
  dirty: "dirty",
  inspected: "inspected",
  out_of_service: "out-of-service",
  out_of_order: "out-of-order",
};

const HOUSEKEEPING_IN: Record<string, string> = {
  clean: "clean",
  dirty: "dirty",
  inspected: "inspected",
};

property.get("/:code/rooms", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const { rows } = await client.query<{
      number: string;
      type: string;
      floor: number | null;
      housekeeping_status: string;
      max_occupancy: number;
      base_rate: string | null;
      blocks: string | null;
    }>(
      /* The DATES a room is out of inventory, alongside its current
         housekeeping status.

         `housekeeping_status = 'out_of_service'` says a room is out
         TODAY. It cannot say a room was back in inventory for six days
         in August, which is what the real export shows and what the
         tape chart has to draw. Until 022 modelled room_blocks the
         frontend answered that from a hardcoded list of six dates in a
         fixture file. */
      /* rt.base_rate comes back so the interface never has to invent a
         price. It did: `RACK` in stayview.ts and WalkInFlow.tsx held
         { Superior: 4099, Deluxe: 3699 } and fell back to 4099 for
         anything else — so a walk-in at a property those two names do
         not exist at arrived pre-filled at a figure nobody chose.

         Nullable since 032. A room type with no rate yet is a real
         state and the interface shows a dash for it. */
      `select r.number, rt.name as type, r.floor,
              r.housekeeping_status, rt.max_occupancy,
              rt.base_rate::text,
              (select json_agg(json_build_object(
                        'id',   b.id::text,
                        'from', to_char(b.from_date,'YYYY-MM-DD'),
                        'to',   to_char(b.to_date,'YYYY-MM-DD'),
                        'reason', b.reason)
                        order by b.from_date)
                 from room_blocks b
                where b.room_id = r.id)::text as blocks
         from rooms r
         join room_types rt on rt.id = r.room_type_id
        where r.hotel_id = $1 and r.is_active
        order by r.number`,
      [hotel.id],
    );

    return rows.map((r) => ({
      number: r.number,
      type: r.type,
      floor: r.floor ?? 0,
      status: HOUSEKEEPING_OUT[r.housekeeping_status] ?? r.housekeeping_status,
      maxOccupancy: r.max_occupancy,
      /* null, not 0. Zero is a claim the room is free. */
      rackRate: r.base_rate === null ? null : Number(r.base_rate),
      /* Half-open, as the schema stores them: a block from the 8th to
         the 14th covers the 8th through the 13th. The tape chart draws
         a room as sellable on a date when NO block covers it. */
      blocks: r.blocks
        ? (JSON.parse(r.blocks) as Array<{
            id: string; from: string; to: string; reason: string | null;
          }>)
        : [],
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

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
  type Body = { reason?: string; from?: string; to?: string | null; note?: string };
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

    const { rowCount } = await client.query(
      `delete from room_blocks
        where id = $1 and room_id = $2 and hotel_id = $3`,
      [c.req.param("id"), room[0].id, hotel.id],
    );
    if (!rowCount) return { ok: false, reason: "That block is not here." };

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
