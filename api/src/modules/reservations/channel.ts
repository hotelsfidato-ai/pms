import type { Client } from "../../db.ts";
import {
  makeBooking, alreadyReceived, answerRepeat, fingerprintOf, isUniqueViolation,
  type BookingRequest, type BookingResult,
} from "./book.ts";

/* ══════════════════════════════════════════════════════════════════
   A BOOKING FROM A BOOKING SITE - what a machine may do to a reservation

   The owner's D17-79: SU pushes a booking the moment a site takes one, and
   the channel manager turns it into a real booking here. These three
   functions are called IN PROCESS, inside the caller's own transaction and
   its own session, so the whole of it - the guest, the rooms, the folios,
   the inbox row that says what happened - commits together or not at all.

   They are not routes and they never will be: a machine reaches the PMS at
   the channel manager's own door (/api/channel), which knows SU. This is
   what that door calls once it knows whose booking it is.

   WHAT IS DIFFERENT FROM A BOOKING AT THE DESK:
   - It may not overbook (D17-43, D17-80). The desk may; a site must be told
     "no room" instead, and nothing is written when it is.
   - It carries the site's own reference, so the same booking sent twice is
     answered with the first one (RES-3).
   - It keeps the commission the site sent, where it sends one (D17-84).
   - It is CANCELLED, not voided: the booking was real and the guest called
     it off, and a cancellation report counts it (111).
   ══════════════════════════════════════════════════════════════════ */

export interface ChannelBookingInput {
  hotelId: string;
  guestName: string;
  phone?: string;
  email?: string;
  /** "YYYY-MM-DD". The night of departure is not charged. */
  checkIn: string;
  checkOut: string;
  /** The OTA's row in booking_sources - Booking.com, Agoda, and so on. */
  bookingSourceId: string;
  /** SU's booking id: the key a repeat is recognised by (RES-3). */
  externalRef: string;
  /** What the site said it will keep, as it sent it (D17-84). */
  commissionAmount?: string | number | null;
  expectedArrival?: string;
  /** Anything the guest asked for, kept on the booking's notes. */
  specialRequest?: string;
  /** Waiting for the hotel, the room held (D27-35): the CRS's bookings
      arrive this way and the hotel confirms. Left out: confirmed, as a
      booking site's always has been. */
  tentative?: boolean;
  /** Who sold it - the CRS's salesperson (D27-168). */
  salesPerson?: string;
  lines: Array<{
    roomTypeId: string;
    mealPlan?: string;
    adults?: number;
    children?: number;
    rooms?: number;
    /** The rate the site sold at. Sent by every OTA; without it the PMS
        would price the booking itself, which is not what the guest paid. */
    agreedRate?: number;
  }>;
}

export type ChannelBookingResult =
  | {
      ok: true;
      /** True when this booking was already here: nothing was made now. */
      duplicate: boolean;
      reference: string;
      references: string[];
      reservationIds: string[];
      folioIds: string[];
      guestId: string | null;
    }
  | { ok: false; kind: "no_room" | "unpriced" | "refused"; reason: string };

const answer = (result: BookingResult): ChannelBookingResult => {
  if (!result.ok) return { ok: false, kind: result.kind, reason: result.reason };
  const references = result.bookings.map((b) => b.reference);
  return {
    ok: true,
    duplicate: result.duplicate,
    reference: references[0] ?? "",
    references,
    reservationIds: result.reservationIds,
    folioIds: result.folioIds,
    guestId: result.guestId,
  };
};

/**
 * A booking a site has taken. Refuses rather than overbooking, answers a
 * repeat with the booking already here, and writes nothing when it refuses.
 *
 * A booking whose line has no rate and no price on the calendar comes back
 * `unpriced` - never charged at zero, which would give the room away.
 */
export async function createChannelBooking(
  client: Client, staffId: string, input: ChannelBookingInput,
): Promise<ChannelBookingResult> {
  const request: BookingRequest = {
    hotelId: input.hotelId,
    guestName: input.guestName,
    ...(input.phone === undefined ? {} : { phone: input.phone }),
    ...(input.email === undefined ? {} : { email: input.email }),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    bookingSourceId: input.bookingSourceId,
    externalRef: input.externalRef,
    ...(input.expectedArrival === undefined ? {} : { expectedArrival: input.expectedArrival }),
    ...(input.tentative === undefined ? {} : { tentative: input.tentative }),
    ...(input.salesPerson === undefined ? {} : { salesPerson: input.salesPerson }),
    lines: input.lines,
    /* The whole point of the difference (D17-80). */
    refuseWhenFull: true,
  };

  const made = await makeBooking(client, request);
  const result = answer(made);

  if (result.ok && !result.duplicate && result.reservationIds.length > 0) {
    /* What the site said it will keep, and anything the guest asked for.
       Written after the booking rather than inside it, because both are the
       channel's own facts and nothing at the desk sends them. NULL stays
       NULL: a site that sent no commission is not a site that charges none. */
    const commission = input.commissionAmount === undefined || input.commissionAmount === null
      ? null : String(input.commissionAmount);
    const note = input.specialRequest?.trim() || null;
    if (commission !== null || note !== null) {
      await client.query(
        `update reservations
            set commission_amount = coalesce($2::numeric, commission_amount),
                notes = coalesce($3, notes)
          where id = any($1::uuid[])`,
        [result.reservationIds, commission, note]);
    }
  }

  /* `staffId` is not written here: the session already IS that account, and
     `created_by` comes from the row's own audit (016). It is taken so that a
     caller cannot forget whose act this is, and so this reads like the other
     doors. */
  void staffId;
  return result;
}

/**
 * The booking again, as it stands, for a caller that lost a race.
 *
 * Two copies of the same push at once: both pass the already-received check
 * before either commits, and the second loses at a unique index, which rolls
 * ITS transaction back. The booking did land, so the caller opens a FRESH
 * session and asks this, where the winner's rows are visible.
 */
export async function channelBookingAlreadyHere(
  client: Client, input: ChannelBookingInput,
): Promise<ChannelBookingResult | null> {
  const earlier = await alreadyReceived(
    client, input.hotelId, input.bookingSourceId, input.externalRef);
  if (earlier.length === 0) return null;
  const request: BookingRequest = {
    hotelId: input.hotelId,
    guestName: input.guestName,
    ...(input.phone === undefined ? {} : { phone: input.phone }),
    ...(input.email === undefined ? {} : { email: input.email }),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    bookingSourceId: input.bookingSourceId,
    externalRef: input.externalRef,
    lines: input.lines,
  };
  return answer(answerRepeat(earlier, input.externalRef, fingerprintOf(request)));
}

export { isUniqueViolation };

/* ── Cancelling ───────────────────────────────────────────────────── */

export interface ChannelCancelInput {
  hotelId: string;
  bookingSourceId: string;
  /** The site's own reference for the booking being cancelled. */
  externalRef: string;
  reason: string;
  /** An OTA booking follows the OTA's policy, not the hotel's terms
      (D17-44). "channel" is the only value today; it is named rather than
      assumed so that a hotel's own terms cannot be applied by accident. */
  chargeFrom: "channel";
  /** What the site says it is charging the guest, if anything. Recorded on
      the booking's own note; nothing is posted to a folio here, because the
      site collects it, not the hotel. */
  channelFee?: string | number | null;
}

export type ChannelCancelResult =
  | { ok: true; cancelled: string[]; alreadyCancelled: boolean }
  | { ok: false; kind: "not_here" | "arrived" | "refused"; reason: string };

/**
 * A booking the site cancelled.
 *
 * Cancelled, not voided: it was a real booking that the guest called off, and
 * a report that counts cancellations must be able to tell the two apart. A
 * guest who has already arrived cannot be cancelled - that is a departure or
 * a void, and a person decides which.
 */
export async function cancelChannelBooking(
  client: Client, staffId: string, input: ChannelCancelInput,
): Promise<ChannelCancelResult> {
  const reason = input.reason?.trim();
  if (!reason) {
    return { ok: false, kind: "refused", reason: "A cancellation says why (111)." };
  }
  if (input.chargeFrom !== "channel") {
    return {
      ok: false, kind: "refused",
      reason: "A booking from a site is cancelled under the site's policy (D17-44).",
    };
  }

  const { rows } = await client.query<{ id: string; reference: string; status: string }>(
    `select id::text, reference, status
       from reservations
      where hotel_id = $1 and booking_source_id = $2 and ota_reference = $3
      order by ota_line`,
    [input.hotelId, input.bookingSourceId, input.externalRef]);

  if (rows.length === 0) {
    return {
      ok: false, kind: "not_here",
      reason: `No booking here carries the reference ${input.externalRef} from that channel.`,
    };
  }

  const arrived = rows.filter((r) => r.status === "checked_in" || r.status === "checked_out");
  if (arrived.length > 0) {
    return {
      ok: false, kind: "arrived",
      reason: `${arrived.map((r) => r.reference).join(", ")} has already arrived, `
        + "so it cannot be cancelled. The desk settles and checks out, or voids it.",
    };
  }

  const open = rows.filter((r) => r.status !== "cancelled" && r.status !== "void");
  if (open.length === 0) {
    return { ok: true, cancelled: rows.map((r) => r.reference), alreadyCancelled: true };
  }

  const note = input.channelFee === undefined || input.channelFee === null
    ? reason
    : `${reason} The site says it is charging the guest ${String(input.channelFee)}.`;

  await client.query(
    `update reservations
        set status = 'cancelled', cancelled_at = now(), cancelled_by = $2,
            cancel_reason = $3,
            notes = case when notes is null or btrim(notes) = '' then $3
                         else notes || E'\\n' || $3 end
      where id = any($1::uuid[])`,
    [open.map((r) => r.id), staffId || null, note]);

  return { ok: true, cancelled: open.map((r) => r.reference), alreadyCancelled: false };
}
