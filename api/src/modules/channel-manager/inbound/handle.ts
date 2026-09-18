import type { Client } from "../../../db.ts";
import type { SuClient } from "../su/client.ts";
import { SU_ENDPOINTS } from "../su/codes.ts";
import { pushAri, type InSession } from "../ari/push.ts";
import { THE_OWNERS_POLICY } from "../ari/payloads.ts";
import type { PushedBooking } from "./parse.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT HAPPENS TO A BOOKING SU PUSHED

   In this order, and the order is the point:

   1. It is already stored (the door does that first, so nothing is lost).
   2. SU is told we have it. Until SU hears that, it resends every ten
      minutes, three times, and then drops the booking and emails the hotel -
      so this is said as soon as the message is safe, not after the booking
      is made.
   3. Only then is it worked out.

   WORKING IT OUT, today:

   - **new**, and a room of that type is free for every night: it belongs in
     the reservations door, which does not exist yet (asked of the master:
     MODULE.md, request 6). Until it does, the message waits, marked
     `needs_attention`, and the Channel bookings screen says why. Nothing is
     invented and no half-booking is written.
   - **new**, and no room of that type is free: the owner's D17-80. NO booking
     is made; those dates go back to SU at once as 0 rooms left, so the site
     stops selling what the hotel does not have; and the GM sees it on the
     Channel bookings screen to deal with the site and the guest.
   - **modified** or **cancelled**: they need the same door (amend, cancel),
     so they wait the same way. A cancellation is never guessed at - refusing
     to act is safe, quietly cancelling the wrong stay is not.

   The one thing this does on its own is send rooms left back to SU, because
   that is what stops a second guest booking the same room in the next minute.
   ══════════════════════════════════════════════════════════════════ */

export type Outcome =
  | "created" | "changed" | "cancelled" | "refused_no_room" | "needs_attention" | "ignored";

export interface Handled {
  outcome: Outcome;
  reason: string;
  /** Dates whose rooms left were pushed back to SU at once, if any. */
  pushedBack: { from: string; to: string } | null;
}

/** Which PMS room type each of the booking's rooms is, and whether one is
    free for every night of it. Reads only; decides nothing. */
export async function roomsAreFree(
  client: Client, hotelId: string, booking: PushedBooking,
): Promise<{ free: boolean; unmapped: string[]; full: string[] }> {
  const unmapped: string[] = [];
  const full: string[] = [];
  const wanted = new Map<string, { from: string; to: string; rooms: number }>();

  for (const room of booking.rooms) {
    if (!room.suRoomId || !room.arrival || !room.departure) continue;
    const { rows } = await client.query<{ room_type_id: string; name: string }>(
      `select m.room_type_id::text, rt.name
         from channel_room_types m join room_types rt on rt.id = m.room_type_id
        where m.hotel_id = $1 and upper(m.su_room_id) = upper($2)`,
      [hotelId, room.suRoomId]);
    if (!rows[0]) {
      unmapped.push(room.suRoomId);
      continue;
    }
    const at = wanted.get(rows[0].room_type_id) ?? { from: room.arrival, to: room.departure, rooms: 0 };
    wanted.set(rows[0].room_type_id, {
      from: room.arrival < at.from ? room.arrival : at.from,
      to: room.departure > at.to ? room.departure : at.to,
      rooms: at.rooms + 1,
    });
  }

  for (const [roomTypeId, want] of wanted) {
    /* Every night of the stay, the night of departure excepted: that room is
       free again. The same figure the Inventory grid shows a person. */
    const { rows } = await client.query<{ name: string; short: number }>(
      `select rt.name, min(g.available)::int as short
         from app.inventory_grid($1, $2::date, ($3::date - 1)) g
         join room_types rt on rt.id = g.room_type_id
        where g.room_type_id = $4
        group by rt.name`,
      [hotelId, want.from, want.to, roomTypeId]);
    const row = rows[0];
    if (!row || row.short < want.rooms) full.push(row?.name ?? "a room type");
  }

  return { free: unmapped.length === 0 && full.length === 0, unmapped, full };
}

export async function handleBooking(
  inSession: InSession, su: SuClient, hotelId: string, booking: PushedBooking,
): Promise<Handled> {
  if (booking.problems.length > 0) {
    return {
      outcome: "needs_attention",
      reason: booking.problems.join(" "),
      pushedBack: null,
    };
  }

  if (booking.status === "modified" || booking.status === "cancelled" || booking.status === "request") {
    return {
      outcome: "needs_attention",
      reason: booking.status === "request"
        ? "SU sent this as a request to book, which a person answers."
        : `SU sent a ${booking.status} booking. Changing and cancelling a booking `
          + "from a channel is not built yet, so nothing was changed here.",
      pushedBack: null,
    };
  }

  const room = await inSession((client) => roomsAreFree(client, hotelId, booking));

  if (room.unmapped.length > 0) {
    return {
      outcome: "needs_attention",
      reason: `SU sent a room (${room.unmapped.join(", ")}) this hotel has not mapped, `
        + "so which room type it is cannot be known.",
      pushedBack: null,
    };
  }

  if (!room.free) {
    /* D17-80. No booking is made, and SU hears at once that there is nothing
       left on those dates, so the site stops selling them. */
    const from = booking.arrival!;
    const to = booking.departure!;
    const pushed = await pushAri(inSession, su, hotelId, "changes", THE_OWNERS_POLICY, { from, to });
    return {
      outcome: "refused_no_room",
      reason: `No ${room.full.join(" or ")} is free for these nights, so no booking was made. `
        + (pushed?.ok
          ? "SU has been told there is nothing left on those dates. "
          : "SU could not be told there is nothing left on those dates. ")
        + "Deal with the booking site and the guest.",
      pushedBack: { from, to },
    };
  }

  return {
    outcome: "needs_attention",
    reason: "A room is free, and the door that makes a booking from a channel is not built "
      + "yet. The booking is kept here until it is.",
    pushedBack: null,
  };
}

/** Tells SU the message arrived. SU stops resending it, and stops dropping it
    after an hour. Its own answer is not a booking's answer: if this fails, the
    message is still stored, and SU resends. */
export async function acknowledge(
  su: SuClient, suHotelId: string, notifId: string,
): Promise<{ ok: boolean; reason: string | null }> {
  const sent = await su.post(SU_ENDPOINTS.reservationsReceived, {
    hotelid: suHotelId,
    reservation_notif: { reservation_notif_id: [notifId] },
  });
  return sent.ok ? { ok: true, reason: null } : { ok: false, reason: sent.reason };
}
