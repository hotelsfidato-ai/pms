import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import { dateProblem, phoneProblem, MAX_NIGHTS } from "../../validate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE WAITLIST (D27-383 item 8, built under D27-396; migration 268)

   A guest the desk could not book: the nights and room type are full. The
   list shows, for each one still waiting, the rooms free NOW for every one
   of their nights - so a cancellation, a shorter stay or a released
   allotment shows here by itself - oldest first. Booking one is New
   booking, filled in from the entry (`waitlistId` on POST /bookings marks
   it booked in the booking's own transaction).

   Nothing is booked or sent by the system: the hotel decides, and no guest
   is told anything (D27-396). Whoever may make a booking adds and removes.
   ══════════════════════════════════════════════════════════════════ */

export const waitlist = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

waitlist.get("/:code/waitlist", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const today = await businessDateFor(client, hotelId);
    /* `free` is the fewest rooms of the type free on any of the nights - the
       inventory grid's own figure, so held allotment rooms are not free. Null
       once the arrival has passed: there is nothing left to offer. */
    const { rows } = await client.query(
      `select w.id::text, w.guest_name as "guestName", w.phone,
              w.room_type_id::text as "roomTypeId", rt.name as "roomType",
              w.arrival::text, w.departure::text, w.note,
              w.created_at as "createdAt", s.full_name as "addedBy",
              case when w.arrival < $2::date then null else
                (select min(g.available)::int from app.inventory_grid(w.hotel_id, w.arrival, w.departure - 1) g
                  where g.room_type_id = w.room_type_id) end as free
         from waitlist w
         join room_types rt on rt.id = w.room_type_id
         left join staff s  on s.id = w.created_by
        where w.hotel_id = $1 and w.status = 'waiting'
        order by w.created_at, w.id`,
      [hotelId, today]);
    return { today, entries: rows };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

waitlist.post("/:code/waitlist", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");
  const guestName = str("guestName");
  const phone = str("phone");
  const arrival = str("arrival");
  const departure = str("departure");
  const note = str("note");
  const roomTypeId = str("roomTypeId");

  const wrong = (!guestName ? "Whose name goes on the waitlist?" : null)
    ?? (guestName.length > 120 ? "A name is at most 120 characters." : null)
    ?? phoneProblem(phone)
    ?? dateProblem(arrival) ?? dateProblem(departure)
    ?? (departure <= arrival ? "The waitlist is for nights: the departure is after the arrival." : null)
    ?? ((Date.parse(departure) - Date.parse(arrival)) / 86_400_000 > MAX_NIGHTS
      ? `At most ${MAX_NIGHTS} nights.` : null)
    ?? (!A_UUID.test(roomTypeId) ? "Which room type are they waiting for?" : null)
    ?? (note.length > 500 ? "A note is at most 500 characters." : null);
  if (wrong) return c.json(refuse(wrong), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const today = await businessDateFor(client, hotelId);
    if (arrival < today) return refuse("The arrival is on the business date or later.");
    const { rows: rt } = await client.query(
      "select 1 from room_types where id = $1 and hotel_id = $2", [roomTypeId, hotelId]);
    if (!rt[0]) return refuse("That room type is not here.");
    const { rows } = await client.query<{ id: string }>(
      `insert into waitlist (hotel_id, guest_name, phone, room_type_id, arrival, departure, note, created_by)
       values ($1, $2, nullif($3, ''), $4, $5, $6, nullif($7, ''), app.current_user_id())
       returning id::text`,
      [hotelId, guestName, phone, roomTypeId, arrival, departure, note]);
    return { ok: true as const, id: rows[0]!.id };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

waitlist.post("/:code/waitlist/:id/remove", async (c) => {
  const input = await c.req.json<{ reason?: unknown }>().catch(() => ({} as { reason?: unknown }));
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > 200) return c.json(refuse("A reason is at most 200 characters."), 409);
  const id = c.req.param("id");
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!A_UUID.test(id)) return refuse("That guest is no longer on the waitlist.");
    const { rows } = await client.query(
      `update waitlist set status = 'removed', closed_at = now(), closed_by = app.current_user_id(),
              close_reason = nullif($3, '')
        where id = $1 and hotel_id = $2 and status = 'waiting' returning id`,
      [id, hotelId, reason]);
    return rows[0] ? { ok: true as const } : refuse("That guest is no longer on the waitlist.");
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
