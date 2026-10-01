import type { Client } from "../../../db.ts";
import type { SuClient } from "../su/client.ts";
import { SU_ENDPOINTS } from "../su/codes.ts";
import { pushAri, type InSession } from "../ari/push.ts";
import { THE_OWNERS_POLICY } from "../ari/payloads.ts";
import {
  createChannelBooking, cancelChannelBooking, channelBookingAlreadyHere, isUniqueViolation,
  type ChannelBookingInput, type ChannelBookingResult,
} from "../../reservations/index.ts";
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

   WORKING IT OUT (D27-183, the owner's answers of 30 September):

   - **new**, no room of that type free: D17-80. NO booking is made; those
     dates go back to SU at once as 0 rooms left, and the GM settles it with
     the site and the guest.
   - **new**, a room free: a real booking through reservations' machine door
     (createChannelBooking), keyed by SU's booking id so a resend is the
     first booking, never a second. Only when everything it needs was SENT:
     the site's code on a booking source (Q1), rupees (Q7), each room's type
     and rate plan mapped, a price above zero for every night and the same
     price every night (Q2: a booking here keeps one rate a night). Anything
     else waits for a person with every reason at once; nothing is guessed.
   - **cancelled**: cancelled here by reservations' door, under the site's
     policy (D17-44, Q4). A guest already arrived waits for a person.
   - **modified**: waits for a person, with the booking here and SU's new
     one side by side (Q3). No change is made by itself.
   - **request**: a person accepts or denies it on SU's extranet (Q5).
   ══════════════════════════════════════════════════════════════════ */

export type Outcome =
  | "created" | "changed" | "cancelled" | "refused_no_room" | "needs_attention" | "ignored";

export interface Handled {
  outcome: Outcome;
  reason: string;
  /** Dates whose rooms left were pushed back to SU at once, if any. */
  pushedBack: { from: string; to: string } | null;
  /** The reservations it became, when it became any. */
  reservationIds: string[];
}

const forAPerson = (reason: string): Handled =>
  ({ outcome: "needs_attention", reason, pushedBack: null, reservationIds: [] });

const nightsBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The booking source a person gave SU's site code, on Booking sources (Q1). */
async function sourceFor(
  client: Client, booking: PushedBooking,
): Promise<{ id: string } | { problem: string }> {
  if (!booking.channelCode) return { problem: "SU did not say which booking site this came from." };
  const { rows } = await client.query<{ id: string }>(
    "select id::text from booking_sources where lower(trim(channel_code)) = lower(trim($1))",
    [booking.channelCode]);
  return rows[0] ? { id: rows[0].id } : {
    problem: `SU sent this from ${booking.channelName ?? "a booking site"} (SU's code `
      + `${booking.channelCode}), and no booking source carries that code. Pick it for that `
      + "source on the Booking sources screen.",
  };
}

/** Everything the reservations door needs, read from SU's message - or every
    reason it cannot be, at once. */
export async function planBooking(
  client: Client, hotelId: string, booking: PushedBooking, bookingSourceId: string,
): Promise<{ input: ChannelBookingInput } | { problems: string[] }> {
  const problems: string[] = [];
  if (booking.currency?.toUpperCase() !== "INR") {
    problems.push(booking.currency
      ? `SU sent this booking in ${booking.currency}. It is not converted; a person books it in rupees.`
      : "SU did not say which currency this booking is in.");
  }
  if (booking.rooms.some((r) => r.arrival !== booking.arrival || r.departure !== booking.departure)) {
    problems.push("The rooms do not all arrive and leave on the same dates, and a booking here is one stay.");
  }

  const lines: ChannelBookingInput["lines"] = [];
  for (const [i, room] of booking.rooms.entries()) {
    const which = booking.rooms.length > 1 ? `room ${i + 1}` : "the room";
    const { rows: type } = await client.query<{ id: string }>(
      `select room_type_id::text as id from channel_room_types
        where hotel_id = $1 and upper(su_room_id) = upper($2)`, [hotelId, room.suRoomId]);
    if (!type[0]) problems.push(`SU sent a room (${room.suRoomId ?? "no id"}) this hotel has not mapped.`);

    const rateIds = [...new Set(room.nights.map((n) => n.rateId))];
    let mealPlan: string | null = null;
    if (rateIds.length !== 1 || !rateIds[0]) {
      problems.push(`SU did not sell ${which} on one rate plan it named.`);
    } else {
      const { rows: plan } = await client.query<{ meal_plan: string }>(
        `select meal_plan from channel_rate_plans
          where hotel_id = $1 and upper(su_rate_plan_id) = upper($2)`, [hotelId, rateIds[0]]);
      if (!plan[0]) problems.push(`SU sent rate plan ${rateIds[0]}, which this hotel has not mapped.`);
      mealPlan = plan[0]?.meal_plan ?? null;
    }

    const nights = room.arrival && room.departure ? nightsBetween(room.arrival, room.departure) : 0;
    const prices = [...new Set(room.nights.map((n) => n.priceBeforeTax))];
    const rate = Number(prices[0]);
    if (room.nights.length !== nights) {
      problems.push(`SU priced ${room.nights.length} of the ${nights} nights of ${which}.`);
    } else if (prices.length > 1) {
      problems.push(`The nights of ${which} are priced differently (`
        + room.nights.map((n) => `${n.date} ${n.priceBeforeTax ?? "-"}`).join(", ")
        + "), and a booking here keeps one rate a night, so the desk books it.");
    } else if (!(rate > 0)) {
      problems.push(`SU sent a price of ${prices[0] ?? "nothing"} a night for ${which}; `
        + "a room is never booked at nothing.");
    }
    if (room.adults === null) problems.push(`SU did not say how many adults are in ${which}.`);

    if (type[0] && mealPlan && room.adults !== null) {
      lines.push({
        roomTypeId: type[0].id, mealPlan, adults: room.adults,
        ...(room.children === null ? {} : { children: room.children }),
        rooms: 1, agreedRate: rate,
      });
    }
  }
  if (problems.length > 0) return { problems };

  const note = [booking.remarks, ...booking.rooms.map((r) => r.specialRequest)]
    .filter(Boolean).join("\n");
  return {
    input: {
      hotelId,
      guestName: booking.guestName!,
      ...(booking.phone ? { phone: booking.phone } : {}),
      ...(booking.email ? { email: booking.email } : {}),
      checkIn: booking.arrival!,
      checkOut: booking.departure!,
      bookingSourceId,
      externalRef: booking.suBookingId!,
      commissionAmount: booking.commission,
      ...(note ? { specialRequest: note } : {}),
      lines,
    },
  };
}

/** The booking here and SU's changed one, side by side, for a person (Q3). */
async function whatChanged(client: Client, hotelId: string, booking: PushedBooking): Promise<string> {
  const { rows } = await client.query<{
    n: number; arrives: string | null; leaves: string | null; rates: string | null; refs: string | null;
  }>(
    `select count(*)::int as n, min(check_in)::text as arrives, max(check_out)::text as leaves,
            string_agg(distinct agreed_rate::text, ', ') as rates,
            string_agg(reference, ', ' order by ota_line) as refs
       from reservations
      where hotel_id = $1 and ota_reference = $2 and ota_line is not null
        and status not in ('cancelled', 'void')`,
    [hotelId, booking.suBookingId]);
  const here = rows[0]!;
  const live = booking.rooms.filter((r) => r.status?.toLowerCase() !== "cancelled");
  const stay = (n: number, from: string | null, to: string | null, rates: string | null) =>
    `${n} room${n === 1 ? "" : "s"}, ${from ?? "-"} to ${to ?? "-"}, ${rates ?? "-"} a night before tax`;
  const now = stay(
    live.length,
    live.map((r) => r.arrival ?? "").sort()[0] || null,
    live.map((r) => r.departure ?? "").sort().at(-1) || null,
    [...new Set(live.flatMap((r) => r.nights.map((x) => x.priceBeforeTax ?? "-")))].join(", ") || null);
  return here.n === 0
    ? `SU sent a change to a booking that is not booked here. Now: ${now}. Nothing was booked.`
    : `SU sent a change to this booking. Here (${here.refs}): `
      + `${stay(here.n, here.arrives, here.leaves, here.rates)}. Now: ${now}. `
      + "Nothing was changed here; the desk changes the booking.";
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
  if (booking.problems.length > 0) return forAPerson(booking.problems.join(" "));

  if (booking.status === "request") {
    return forAPerson("SU sent this as a request to book. Accept or deny it on SU's extranet; "
      + "nothing was booked here.");
  }
  if (booking.status === "modified") {
    return forAPerson(await inSession((client) => whatChanged(client, hotelId, booking)));
  }
  if (booking.status === "cancelled") return cancel(inSession, hotelId, booking);

  /* D17-80. No booking is made, and SU hears at once that there is nothing
     left on those dates, so the site stops selling them. */
  const refuseNoRoom = async (why: string): Promise<Handled> => {
    const from = booking.arrival!;
    const to = booking.departure!;
    const pushed = await pushAri(inSession, su, hotelId, "changes", THE_OWNERS_POLICY, { from, to });
    return {
      outcome: "refused_no_room",
      reason: `${why} No booking was made. `
        + (pushed?.ok
          ? "SU has been told there is nothing left on those dates. "
          : "SU could not be told there is nothing left on those dates. ")
        + "Deal with the booking site and the guest.",
      pushedBack: { from, to },
      reservationIds: [],
    };
  };

  const room = await inSession((client) => roomsAreFree(client, hotelId, booking));
  if (room.unmapped.length > 0) {
    return forAPerson(`SU sent a room (${room.unmapped.join(", ")}) this hotel has not mapped, `
      + "so which room type it is cannot be known.");
  }
  if (!room.free) return refuseNoRoom(`No ${room.full.join(" or ")} is free for these nights.`);

  const source = await inSession((client) => sourceFor(client, booking));
  if ("problem" in source) return forAPerson(`${source.problem} Nothing was booked.`);
  const plan = await inSession((client) => planBooking(client, hotelId, booking, source.id));
  if ("problems" in plan) return forAPerson(`${plan.problems.join(" ")} Nothing was booked.`);

  let made: ChannelBookingResult;
  try {
    made = await inSession((client, staffId) => createChannelBooking(client, staffId ?? "", plan.input));
  } catch (error) {
    /* Two copies at once: the loser's transaction rolled back at the unique
       index, and the winner's booking is the answer (RES-3). */
    if (!isUniqueViolation(error)) throw error;
    made = await inSession((client) => channelBookingAlreadyHere(client, plan.input))
      ?? { ok: false, kind: "refused", reason: "Another copy of this booking was being made at the same moment." };
  }

  if (made.ok && made.duplicate) {
    return { outcome: "ignored", reason: `Already booked here as ${made.references.join(", ")}.`,
             pushedBack: null, reservationIds: [] };
  }
  if (made.ok) {
    return { outcome: "created", reason: `Booked as ${made.references.join(", ")}.`,
             pushedBack: null, reservationIds: made.reservationIds };
  }
  if (made.kind === "no_room") return refuseNoRoom(made.reason);
  return forAPerson(`${made.reason} Nothing was booked.`);
}

/** A cancellation from the site, under the site's policy (D17-44, Q4). */
async function cancel(inSession: InSession, hotelId: string, booking: PushedBooking): Promise<Handled> {
  const source = await inSession((client) => sourceFor(client, booking));
  if ("problem" in source) return forAPerson(`${source.problem} Nothing was cancelled.`);
  const done = await inSession((client, staffId) => cancelChannelBooking(client, staffId ?? "", {
    hotelId,
    bookingSourceId: source.id,
    externalRef: booking.suBookingId!,
    reason: booking.cancelReason ?? `Cancelled on ${booking.channelName ?? "the booking site"}.`,
    chargeFrom: "channel",
  }));
  if (!done.ok) return forAPerson(`${done.reason} Nothing was cancelled.`);
  return {
    outcome: "cancelled",
    reason: done.alreadyCancelled
      ? `Already cancelled here (${done.cancelled.join(", ")}).`
      : `Cancelled ${done.cancelled.join(", ")}, under the site's policy.`,
    pushedBack: null,
    reservationIds: [],
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
