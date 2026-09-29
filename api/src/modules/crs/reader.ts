import { withUser, type Client } from "../../db.ts";
import { createChannelBooking, type ChannelBookingInput } from "../reservations/index.ts";
import { changedSince, missing, type CrsDocument, type CrsSettings } from "./firestore.ts";
import { canTell, tell, type CrsAnswer } from "./tell.ts";

/* ══════════════════════════════════════════════════════════════════
   THE CRS READER - one hotel, one run (D27-168, D27-35)

   1. Every CRS booking for this hotel changed since the last read.
   2. One the PMS has not seen, confirmed in the CRS and made after the
      hotel was connected, becomes a WAITING booking with the room held
      (reservations' machine door: refuses rather than overbooking, and
      answers a repeat with the booking already here). Keyed by the CRS
      document id, never the booking number, which repeats.
   3. No room free: NOTHING is made, and the answer "full" is owed at once.
   4. One the PMS has seen: if what the CRS says now differs, a NOTE for
      the desk. Nothing is applied.
   5. Answers owed - the desk confirmed or refused a waiting booking, or
      the hotel was full - go to the CRS's booking register, once.
   6. Once a day: which open ones were deleted in the CRS. A note again.

   Each booking is its own transaction, so one that fails is read again
   next time and does not hold up the rest.
   ══════════════════════════════════════════════════════════════════ */

export type InSession = <T>(fn: (client: Client) => Promise<T>) => Promise<T>;

/** Read again a minute back, so a change stamped just before the last read
    and committed just after it is not missed. Seen ones are skipped. */
const OVERLAP_MS = 60_000;
/** An answer the register would not take is tried this many runs. */
const MOST_TRIES = 3;

interface Hotel {
  hotelId: string;
  code: string;
  name: string;
  crsHotelId: string;
  bookingSourceId: string;
  connectedAt: string;
  readFrom: string;
  checkDeleted: boolean;
}

interface Seen {
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  guest: string | null;
  rooms: string[];
  deleted?: boolean;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

type CrsRoom = Record<string, unknown>;
const roomsOf = (d: Record<string, unknown>): CrsRoom[] =>
  Array.isArray(d["rooms"]) ? (d["rooms"] as CrsRoom[]) : [];

function guestOf(d: Record<string, unknown>) {
  const guests = Array.isArray(d["guests"]) ? (d["guests"] as Record<string, unknown>[]) : [];
  const primary = guests.find((g) => g["isPrimary"] === true) ?? guests[0] ?? {};
  return {
    name: str(d["customerName"]) ?? str(primary["name"]),
    phone: str(primary["phone"]),
    email: str(primary["email"]),
  };
}

export function seenOf(d: Record<string, unknown>): Seen {
  return {
    status: str(d["status"]),
    checkIn: str(d["checkIn"]),
    checkOut: str(d["checkOut"]),
    guest: guestOf(d).name,
    rooms: roomsOf(d).map((r) => [
      r["roomTypeId"], r["mealPlan"], r["quantity"], r["adults"], r["children"],
      r["extraBeds"], r["sellingRate"],
    ].join("|")),
  };
}

const day = (iso: string | null) => iso === null ? "-"
  : new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });

/** What the desk must act on, in words; null when nothing it compares moved. */
export function changeSentence(before: Seen, now: Seen, d: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (before.status !== now.status) {
    const why = str(d["cancellationReason"]);
    parts.push(now.status === "cancelled"
      ? `Cancelled in the CRS${why ? `: ${why}` : ""}.`
      : `The CRS now says ${String(now.status ?? "-").replace("_", " ")}.`);
  }
  if (before.checkIn !== now.checkIn || before.checkOut !== now.checkOut) {
    parts.push(`The CRS dates are now ${day(now.checkIn)} to ${day(now.checkOut)} `
      + `(were ${day(before.checkIn)} to ${day(before.checkOut)}).`);
  }
  if (before.rooms.join(",") !== now.rooms.join(",")) {
    parts.push("The rooms, guests or rate changed in the CRS.");
  }
  if (before.guest !== now.guest) {
    parts.push(`The guest in the CRS is now ${now.guest ?? "-"} (was ${before.guest ?? "-"}).`);
  }
  return parts.length ? parts.join(" ") : null;
}

const MEAL_PLANS: Record<string, string> = {
  EP: "EP", CP: "CP", MAP: "MAP", AP: "AP", ALL_INCLUSIVE: "AI",
};

/**
 * The booking the PMS makes of a CRS one, or why it cannot make it by
 * itself. Every refusal names what the desk must do instead.
 *
 * THE RATE IS THE CRS'S QUOTE (D27-171): pre-tax, per room per night. A CRS
 * line prices its extra beds and children per line, so the line's nightly
 * total is split across its rooms - and a line that does not split to the
 * paisa, or whose children do not split evenly, is left to a person rather
 * than rounded.
 */
export function bookingFrom(
  d: Record<string, unknown>, roomTypes: Map<string, string>,
): { lines: ChannelBookingInput["lines"] } | { problem: string } {
  const rooms = roomsOf(d);
  if (rooms.length === 0) return { problem: "The CRS booking has no rooms." };
  const lines: ChannelBookingInput["lines"] = [];
  const paise = (v: unknown) => Math.round((num(v) ?? 0) * 100);

  for (const r of rooms) {
    const named = str(r["roomTypeName"]) ?? str(r["roomTypeId"]) ?? "(no room type)";
    const roomTypeId = roomTypes.get(str(r["roomTypeId"]) ?? "");
    if (!roomTypeId) {
      return { problem: `The CRS room type "${named}" is not matched to a room type here.` };
    }
    const mealPlan = MEAL_PLANS[str(r["mealPlan"]) ?? ""];
    if (!mealPlan) return { problem: `The CRS meal plan on "${named}" is not one this hotel sells.` };
    const quantity = num(r["quantity"]) ?? 0;
    const adults = num(r["adults"]) ?? 0;
    const children = num(r["children"]) ?? 0;
    const extraBeds = num(r["extraBeds"]) ?? 0;
    if (![quantity, adults, children, extraBeds].every(Number.isInteger) || quantity < 1 || adults < 1) {
      return { problem: `The CRS line "${named}" has no rooms or no adults.` };
    }
    /* A machine never books at zero (D10): a missing rate is a person's. */
    if (paise(r["sellingRate"]) <= 0) {
      return { problem: `The CRS line "${named}" has no rate.` };
    }
    if (children % quantity !== 0) {
      return { problem: `The CRS line "${named}" has ${children} children across ${quantity} rooms. Book it by hand.` };
    }
    const nightly = paise(r["sellingRate"]) * quantity
      + paise(r["extraBedRate"]) * extraBeds + paise(r["childRate"]) * children;
    if (nightly % quantity !== 0) {
      return { problem: `The CRS line "${named}" does not split to the paisa across ${quantity} rooms. Book it by hand.` };
    }
    lines.push({
      roomTypeId, mealPlan, adults, children: children / quantity, rooms: quantity,
      agreedRate: nightly / quantity / 100,
    });
  }
  return { lines };
}

/* ── One CRS booking ─────────────────────────────────────────────── */

export async function take(
  client: Client, runAs: string, hotel: Hotel, roomTypes: Map<string, string>, doc: CrsDocument,
): Promise<void> {
  const d = doc.data;
  const updatedAt = str(d["updatedAt"]);
  if (!updatedAt) return;
  const now = seenOf(d);

  const { rows: had } = await client.query<{ outcome: string; seen: Seen; newer: boolean }>(
    `select outcome, seen, $2::timestamptz > crs_updated_at as newer
       from crs_bookings where crs_id = $1 for update`,
    [doc.id, updatedAt]);

  if (had[0]) {
    if (!had[0].newer) return;
    const note = had[0].outcome === "full" ? null : changeSentence(had[0].seen, now, d);
    await client.query(
      `update crs_bookings
          set crs_status = $2, crs_updated_at = $3, seen = $4,
              change_note = case when $5::text is null then change_note
                                 else coalesce(change_note || E'\\n', '') || $5 end,
              changed_at = case when $5::text is null then changed_at else now() end,
              change_done_at = case when $5::text is null then change_done_at end,
              change_done_by = case when $5::text is null then change_done_by end
        where crs_id = $1`,
      [doc.id, now.status ?? "-", updatedAt, JSON.stringify({ ...had[0].seen, ...now }), note]);
    return;
  }

  /* Not seen before. Only a live booking, made since the hotel was
     connected: an older one was typed in by hand already. */
  if (now.status !== "confirmed") return;
  const createdAt = str(d["createdAt"]);
  if (!createdAt || new Date(createdAt) < new Date(hotel.connectedAt)) return;

  const guest = guestOf(d);
  const record = async (outcome: string, reason: string | null, reservationIds: string[] = []) => {
    await client.query(
      `insert into crs_bookings
         (crs_id, hotel_id, crs_reference, salesperson, company, guest_name,
          check_in, check_out, crs_status, crs_updated_at, seen, outcome, reason,
          reservation_ids, answer)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13,
               $14::uuid[], case when $12 = 'full' then 'full' end)`,
      [doc.id, hotel.hotelId, str(d["reference"]) ?? "-", str(d["ownerName"]),
       str(d["companyName"]), guest.name, now.checkIn, now.checkOut, now.status,
       updatedAt, JSON.stringify(now), outcome, reason, reservationIds]);
  };

  const plan = bookingFrom(d, roomTypes);
  if ("problem" in plan) return record("needs_attention", plan.problem);
  if (!guest.name || !now.checkIn || !now.checkOut) {
    return record("needs_attention", "The CRS booking has no guest name or no dates.");
  }

  const made = await createChannelBooking(client, runAs, {
    hotelId: hotel.hotelId,
    guestName: guest.name,
    ...(guest.phone ? { phone: guest.phone } : {}),
    ...(guest.email ? { email: guest.email } : {}),
    checkIn: now.checkIn,
    checkOut: now.checkOut,
    bookingSourceId: hotel.bookingSourceId,
    externalRef: doc.id,
    ...(str(d["specialRequests"]) ? { specialRequest: str(d["specialRequests"])! } : {}),
    ...(str(d["ownerName"]) ? { salesPerson: str(d["ownerName"])! } : {}),
    /* Waiting for the hotel, the room held (D27-35). */
    tentative: true,
    lines: plan.lines,
  });

  if (made.ok && !made.duplicate) return record("booked", null, made.reservationIds);
  if (made.ok) {
    return record("needs_attention", `This booking is already here as ${made.references.join(", ")}.`);
  }
  if (made.kind === "no_room") {
    return record("full", `${made.reason} Nothing was booked; the salesperson is told the hotel is full.`);
  }
  return record("needs_attention", made.reason);
}

/* ── The answers owed to the CRS's register ──────────────────────── */

export async function answersOwed(inSession: InSession, hotel: Hotel): Promise<void> {
  if (!canTell()) return;
  const owed = await inSession(async (client) => (await client.query<{
    crs_id: string; crs_reference: string; outcome: string;
    statuses: string[] | null; refs: string[] | null; why: string | null;
  }>(
    `select b.crs_id, b.crs_reference, b.outcome,
            array_agg(r.status order by r.ota_line) filter (where r.id is not null) as statuses,
            array_agg(r.reference order by r.ota_line) filter (where r.id is not null) as refs,
            max(coalesce(r.cancel_reason, r.void_reason)) as why
       from crs_bookings b
       left join reservations r on r.id = any(b.reservation_ids)
      where b.hotel_id = $1 and b.answered_at is null and b.answer_tries < $2
        and b.outcome in ('booked', 'full')
      group by b.crs_id, b.crs_reference, b.outcome`,
    [hotel.hotelId, MOST_TRIES])).rows);

  for (const b of owed) {
    const statuses = b.statuses ?? [];
    const answer: CrsAnswer["answer"] | null =
      b.outcome === "full" ? "full"
      : statuses.length > 0 && statuses.every((s) => ["confirmed", "checked_in", "checked_out"].includes(s))
        ? "confirmed"
      : statuses.length > 0 && statuses.every((s) => s === "cancelled" || s === "void")
        ? "refused"
      : null;
    if (!answer) continue; // still waiting for the desk

    const told = await tell({
      crsId: b.crs_id,
      crsReference: b.crs_reference,
      answer,
      hotelConfirmationNumber: answer === "confirmed" ? (b.refs ?? []).join(", ") : null,
      note: answer === "full" ? "The hotel is full on these dates. Nothing was booked."
        : answer === "refused" ? `Refused by the hotel${b.why ? `: ${b.why}` : "."}`
        : null,
      hotel: { code: hotel.code, name: hotel.name },
    });
    await inSession((client) => client.query(
      told.ok
        ? `update crs_bookings set answer = $2, answered_at = now(), answer_error = null
            where crs_id = $1`
        : `update crs_bookings set answer_tries = answer_tries + 1, answer_error = $3
            where crs_id = $1`,
      told.ok ? [b.crs_id, answer] : [b.crs_id, answer, told.reason]));
  }
}

/* ── Deleted in the CRS, once a day ──────────────────────────────── */

export async function deletedCheck(
  inSession: InSession, settings: CrsSettings, hotel: Hotel,
): Promise<void> {
  const open = await inSession(async (client) => (await client.query<{ crs_id: string }>(
    `select b.crs_id from crs_bookings b
      where b.hotel_id = $1 and b.outcome = 'booked'
        and coalesce((b.seen->>'deleted')::boolean, false) = false
        and exists (select 1 from reservations r where r.id = any(b.reservation_ids)
                     and r.status in ('tentative', 'confirmed'))`,
    [hotel.hotelId])).rows.map((r) => r.crs_id));

  const gone = await missing(settings, open);
  await inSession(async (client) => {
    for (const id of gone) {
      await client.query(
        `update crs_bookings
            set seen = seen || '{"deleted": true}',
                change_note = coalesce(change_note || E'\\n', '') || 'Deleted in the CRS.',
                changed_at = now(), change_done_at = null, change_done_by = null
          where crs_id = $1`, [id]);
    }
    await client.query(
      "update crs_hotels set deleted_checked_on = app.hotel_day(hotel_id, now()) where hotel_id = $1",
      [hotel.hotelId]);
  });
}

/* ── One hotel, one run ──────────────────────────────────────────── */

export async function runHotel(settings: CrsSettings, hotelId: string, runAs: string): Promise<void> {
  const inSession: InSession = (fn) => withUser(runAs, fn);

  const loaded = await inSession(async (client) => {
    const { rows } = await client.query<{
      code: string; name: string; crs_hotel_id: string; booking_source_id: string;
      connected_at: string; read_from: string; check_deleted: boolean;
    }>(
      `select h.code, h.name, ch.crs_hotel_id, ch.booking_source_id::text,
              ch.connected_at::text, coalesce(ch.read_up_to, ch.connected_at)::text as read_from,
              ch.deleted_checked_on is distinct from app.hotel_day(h.id, now()) as check_deleted
         from crs_hotels ch join hotels h on h.id = ch.hotel_id
        where ch.hotel_id = $1`, [hotelId]);
    const { rows: types } = await client.query<{ crs_room_type_id: string; room_type_id: string }>(
      "select crs_room_type_id, room_type_id::text from crs_room_types where hotel_id = $1",
      [hotelId]);
    return rows[0] ? { row: rows[0], types } : null;
  });
  if (!loaded) return;
  const { row, types } = loaded;
  const hotel: Hotel = {
    hotelId, code: row.code, name: row.name, crsHotelId: row.crs_hotel_id,
    bookingSourceId: row.booking_source_id, connectedAt: row.connected_at,
    readFrom: row.read_from, checkDeleted: row.check_deleted,
  };
  const roomTypes = new Map(types.map((t) => [t.crs_room_type_id, t.room_type_id]));

  let upTo: string | null = null;
  const faults: string[] = [];
  try {
    const since = new Date(new Date(hotel.readFrom).getTime() - OVERLAP_MS).toISOString();
    /* ponytail: every hotel's changes are read for each connected hotel and
       the others dropped here; with many hotels, one read shared by all. */
    for (const doc of await changedSince(settings, since)) {
      const at = str(doc.data["updatedAt"]);
      if (at && (upTo === null || new Date(at) > new Date(upTo))) upTo = at;
      if (doc.data["hotelId"] !== hotel.crsHotelId) continue;
      try {
        await inSession((client) => take(client, runAs, hotel, roomTypes, doc));
      } catch (error) {
        faults.push(`${doc.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await answersOwed(inSession, hotel);
    if (hotel.checkDeleted) await deletedCheck(inSession, settings, hotel);
  } catch (error) {
    faults.push(error instanceof Error ? error.message : String(error));
  }

  /* A booking that failed is read again next time: the cursor moves only
     when every one of them was taken. */
  await inSession((client) => client.query(
    `update crs_hotels
        set read_up_to = case when $2::timestamptz is null or $3::text is not null then read_up_to
                              else greatest(coalesce(read_up_to, connected_at), $2::timestamptz) end,
            last_read_at = now(), last_error = $3
      where hotel_id = $1`,
    [hotelId, upTo, faults.length ? faults.join(" · ").slice(0, 1000) : null]));
}
