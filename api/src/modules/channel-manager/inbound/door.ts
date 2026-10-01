import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { withUser } from "../../../db.ts";
import { readSuPushKey } from "../su/config.ts";
import { suConnection } from "../su/runtime.ts";
import { scrubCardFields } from "./scrub.ts";
import { readPushedMessage, type PushedBooking } from "./parse.ts";
import { acknowledge, handleBooking, type Handled } from "./handle.ts";
import type { InSession } from "../ari/push.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DOOR SU PUSHES BOOKINGS THROUGH — part 4 (D17-79)

   POST /api/channel/su/reservations

   The only address in this system a machine outside it may call without a
   person's sign-in, so every line here is about what it refuses.

   WHO. SU presents the key the owner generated (`SU_PUSH_KEY`, the server's
   settings only). It is compared as a hash, in constant time, so the answer
   does not depend on how much of the key was right. Anything else gets 401
   and no detail: a door that says "wrong key" tells a stranger the key is
   what is missing.

   HOW MUCH. SU sends one booking at a time and waits to be told we have it,
   so a flood is somebody else. More than a minute's worth is refused with
   429 - and nginx has its own limit in front of this (the master's).

   WHAT HAPPENS, IN ORDER.
   1. The card fields are cut out of the message before anything else touches
      it (D17-83).
   2. The hotel is found from the id SU was given - and only a hotel that is
      on SU and switched on for the channel manager (D17-45). Anything else
      is refused, so SU retries and, in the end, emails the property: better
      than a booking quietly vanishing into a server that will not use it.
   3. The message is STORED, whole, before it is worked out.
   4. SU is told we have it, which stops it resending.
   5. It is worked out (see handle.ts): a booking for a room that is no
      longer free is refused and those dates go back to SU as 0 rooms left
      (D17-80); the rest becomes a booking, a cancellation, or a line for a
      person that says why (D27-183).

   The answer to SU is `{"Status":"Success"}` once the message is stored,
   because that is what SU asked for and what is true: we have it.
   ══════════════════════════════════════════════════════════════════ */

export const inbound = new Hono();

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

function keyMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  /* Hashes first, so the comparison is over two equal lengths and cannot leak
     the key's length either. */
  return timingSafeEqual(sha256(presented.trim()), sha256(expected));
}

/* One minute's worth. SU pushes one booking at a time per property and waits
   for the acknowledgement, so this is far above anything SU does. */
export const PUSHES_A_MINUTE = 120;
let minute = { at: 0, count: 0 };

export function resetDoorLimitForTests(): void {
  minute = { at: 0, count: 0 };
}

function withinLimit(now = Date.now()): boolean {
  const thisMinute = Math.floor(now / 60_000);
  if (minute.at !== thisMinute) minute = { at: thisMinute, count: 0 };
  minute.count += 1;
  return minute.count <= PUSHES_A_MINUTE;
}

interface Stored {
  id: number;
  hotelId: string;
  alreadyHad: boolean;
}

inbound.post("/su/reservations", async (c) => {
  const expected = readSuPushKey();
  if (!expected) {
    return c.json({ Status: "Fail", Errors: [{ ShortText: "Not set up to receive bookings." }] }, 503);
  }
  const presented = c.req.header("x-su-key")
    ?? (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!keyMatches(presented, expected)) {
    return c.json({ Status: "Fail", Errors: [{ ShortText: "Authorization Required" }] }, 401);
  }
  if (!withinLimit()) {
    return c.json({ Status: "Fail", Errors: [{ ShortText: "Too many at once. Try again shortly." }] }, 429);
  }

  const raw = await c.req.json().catch(() => null);
  if (raw === null) {
    return c.json({ Status: "Fail", Errors: [{ ShortText: "The message is not JSON." }] }, 400);
  }

  /* Before anything else, and before any log line. */
  const scrubbed = scrubCardFields(raw);
  const bookings = readPushedMessage(scrubbed.payload);
  if (bookings.length === 0) {
    return c.json({ Status: "Fail", Errors: [{ ShortText: "The message holds no booking." }] }, 400);
  }

  const refusals: string[] = [];
  let kept = 0;

  for (const booking of bookings) {
    const where = await hotelFor(booking.suHotelId);
    if (!where) {
      refusals.push(
        `No hotel here is connected to SU as ${booking.suHotelId ?? "(no hotel id)"}, `
        + "or it is not switched on for the channel manager.");
      continue;
    }
    if (!where.runAs) {
      refusals.push("That hotel has no service account for the channel manager yet.");
      continue;
    }

    const inSession: InSession = (fn) =>
      withUser(where.runAs!, (client) => fn(client, where.runAs!));

    const stored = await store(inSession, where.hotelId, booking, scrubbed.payload, scrubbed.cardFieldsRemoved);
    kept += 1;
    /* Already had this exact message: it was answered once, and answering it
       the same way again is the whole point of keeping it. */
    if (stored.alreadyHad) continue;

    const su = suConnection();
    if (su.ok && booking.notifId && booking.suHotelId) {
      const said = await acknowledge(su.client, booking.suHotelId, booking.notifId);
      if (said.ok) {
        await inSession((client) => client.query(
          "update channel_bookings set acknowledged_at = now() where id = $1", [stored.id]));
      }
    }

    const handled: Handled = !su.ok
      ? {
          outcome: "needs_attention",
          reason: "SU is not set up on this server, so this booking was kept but nothing "
            + "was sent back to SU about it.",
          pushedBack: null,
          reservationIds: [],
        }
      /* A failure is said on the list, not left as "Just arrived" forever. */
      : await handleBooking(inSession, su.client, where.hotelId, booking).catch((error: unknown) => ({
          outcome: "needs_attention" as const,
          reason: `Working this booking out failed (${error instanceof Error ? error.message : String(error)}). `
            + "It is kept here; nothing was booked.",
          pushedBack: null,
          reservationIds: [],
        }));

    await inSession((client) => client.query(
      `update channel_bookings set outcome = $2, outcome_reason = $3, reservation_ids = $4::uuid[]
        where id = $1`,
      [stored.id, handled.outcome, handled.reason, handled.reservationIds]));
  }

  if (kept === 0) {
    /* Nothing was stored, so SU must keep it: it resends, and in the end tells
       the property by email. Never answered as success. */
    return c.json({ Status: "Fail", Errors: refusals.map((r) => ({ ShortText: r })) }, 409);
  }
  return c.json({ Status: "Success" });
});

/** Which hotel SU's hotel id belongs to, before anybody has a session. */
async function hotelFor(suHotelId: string | null): Promise<{ hotelId: string; runAs: string | null } | null> {
  if (!suHotelId) return null;
  return withUser("", async (client) => {
    const { rows } = await client.query<{ hotel_id: string; run_as: string | null }>(
      "select hotel_id::text, run_as::text from app.channel_hotel_for($1)", [suHotelId]);
    const row = rows[0];
    return row ? { hotelId: row.hotel_id, runAs: row.run_as } : null;
  });
}

async function store(
  inSession: InSession, hotelId: string, booking: PushedBooking,
  payload: unknown, cardFieldsRemoved: number,
): Promise<Stored> {
  return inSession(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into channel_bookings
         (hotel_id, su_booking_id, notif_id, channel_code, channel_name, status,
          arrival, departure, guest_name, rooms, currency, total, commission, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (hotel_id, su_booking_id, notif_id) do nothing
       returning id::text`,
      [hotelId, booking.suBookingId ?? "(none)", booking.notifId ?? "(none)",
       booking.channelCode, booking.channelName, booking.status ?? "new",
       booking.arrival, booking.departure, booking.guestName, booking.rooms.length,
       booking.currency, booking.total, booking.commission,
       JSON.stringify({ ...(payload as object), cardFieldsRemoved })]);

    if (rows[0]) return { id: Number(rows[0].id), hotelId, alreadyHad: false };

    const { rows: had } = await client.query<{ id: string }>(
      `select id::text from channel_bookings
        where hotel_id = $1 and su_booking_id = $2 and notif_id = $3`,
      [hotelId, booking.suBookingId ?? "(none)", booking.notifId ?? "(none)"]);
    return { id: Number(had[0]!.id), hotelId, alreadyHad: true };
  });
}
