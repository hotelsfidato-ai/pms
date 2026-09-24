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

/* The core keeps the two reads every service leans on: the property and
   its rooms. Split by service on 15 September
   (docs/SERVICE-FOLDERS-PLAN.md): a room's housekeeping state and its
   blocks are in modules/housekeeping/roomStatus.ts, the module switches
   in modules/admin/moduleSwitches.ts. No endpoint changed. */

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
  cgst_rate: string | null;
  sgst_rate: string | null;
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
         be sold — 17 of the 18 here.

         OUT OF SERVICE IS THE DATED BLOCK (INV-6, the owner's D17-11).
         This read `housekeeping_status`, while availability, occupancy and
         the bell read `room_blocks` — two records, and nothing kept them in
         step. It now asks the same function every occupancy figure divides
         by, for the hotel's own business date. */
      client.query<{ n: string }>(
        "select app.sellable_rooms($1, app.business_date($1))::text as n",
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
      /* Null where nobody has set it (D22-9): Number(null) is 0, a rate
         nobody chose. */
      tax: {
        cgst: hotel.cgst_rate === null ? null : Number(hotel.cgst_rate),
        sgst: hotel.sgst_rate === null ? null : Number(hotel.sgst_rate),
      },
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
