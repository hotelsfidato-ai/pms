import { Hono } from "hono";
import { withSession } from "../auth.ts";
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
    }>(
      `select r.number, rt.name as type, r.floor,
              r.housekeeping_status, rt.max_occupancy
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
