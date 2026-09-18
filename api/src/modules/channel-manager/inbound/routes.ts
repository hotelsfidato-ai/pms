import { Hono } from "hono";
import { withSession } from "../../../auth.ts";
import { maySetUpSuAt, SU_REFUSED } from "../access.ts";
import { hotelIdFor } from "../content/store.ts";

/* ══════════════════════════════════════════════════════════════════
   CHANNEL BOOKINGS, FOR A PERSON — part 4

   GET  /:code/channel-manager/bookings          what SU has pushed
   POST /:code/channel-manager/bookings/:id/done  a person has dealt with it

   The list is what the owner's D17-80 needs somebody to see: a booking SU
   sent for a room that was no longer free, which the PMS refused, and which
   the GM must now settle with the booking site and the guest. It also shows
   the ones waiting for the reservations door, and anything a person must read.

   Marking one done changes nothing at SU and makes no booking: it is a person
   saying "I have dealt with this", so it stops standing in the list. What SU
   said and what the PMS did stay exactly as they were recorded.
   ══════════════════════════════════════════════════════════════════ */

export const bookings = new Hono<{ Variables: { subject: string } }>();

bookings.get("/:code/channel-manager/bookings", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await maySetUpSuAt(client, hotelId))) return { ok: false as const, reason: SU_REFUSED };

    const { rows } = await client.query<{
      id: string; su_booking_id: string; channel_code: string | null; channel_name: string | null;
      status: string; arrival: string | null; departure: string | null; guest_name: string | null;
      rooms: number; currency: string | null; total: string | null; commission: string | null;
      outcome: string; outcome_reason: string | null; received_at: string;
      acknowledged_at: string | null; handled_at: string | null; card_fields_removed: number | null;
    }>(
      `select id::text, su_booking_id, channel_code, channel_name, status,
              arrival::text, departure::text, guest_name, rooms, currency,
              total::text, commission::text, outcome, outcome_reason,
              received_at::text, acknowledged_at::text, handled_at::text,
              (payload->>'cardFieldsRemoved')::int as card_fields_removed
         from channel_bookings
        where hotel_id = $1
        order by received_at desc
        limit 100`,
      [hotelId]);

    return {
      bookings: rows.map((r) => ({
        id: r.id,
        suBookingId: r.su_booking_id,
        channel: r.channel_name ?? (r.channel_code ? `Site ${r.channel_code}` : null),
        status: r.status,
        arrival: r.arrival, departure: r.departure,
        guestName: r.guest_name, rooms: r.rooms,
        currency: r.currency, total: r.total, commission: r.commission,
        outcome: r.outcome, reason: r.outcome_reason,
        receivedAt: r.received_at,
        acknowledged: r.acknowledged_at !== null,
        handled: r.handled_at !== null,
        cardFieldsRemoved: r.card_fields_removed ?? 0,
      })),
    };
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  if ("ok" in result) return c.json(result, 403);
  return c.json(result);
});

bookings.post("/:code/channel-manager/bookings/:id/done", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await maySetUpSuAt(client, hotelId))) return { ok: false as const, reason: SU_REFUSED };

    const { rows } = await client.query<{ id: string }>(
      `update channel_bookings
          set handled_at = now(), handled_by = $3
        where hotel_id = $1 and id = $2 and handled_at is null
        returning id::text`,
      [hotelId, c.req.param("id"), session.staffId]);
    if (!rows[0]) return { ok: false as const, reason: "That one is not here, or is already dealt with." };
    return { ok: true as const };
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result.ok === false) return c.json(result, result.reason === SU_REFUSED ? 403 : 409);
  return c.json(result);
});
