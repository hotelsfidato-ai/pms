import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { crsSettings } from "./firestore.ts";

/* ══════════════════════════════════════════════════════════════════
   CRS BOOKINGS, FOR A PERSON (D27-168)

   GET  /:code/crs/bookings                  what the reader did, newest first
   GET  /:code/crs/bookings?reservation=<id> the CRS facts of one booking
   POST /:code/crs/bookings/:crsId/done      the desk has acted on a change

   Done changes nothing in the CRS and nothing on the booking: it is a
   person saying "I have dealt with this", so the note stops standing out.
   The note itself stays, as it was written.

   Row security decides whose hotel is readable. The CRS settings are
   reported as set or not set, never shown.
   ══════════════════════════════════════════════════════════════════ */

export const crsRoutes = new Hono<{ Variables: { subject: string } }>();

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

crsRoutes.get("/:code/crs/bookings", async (c) => {
  const reservation = c.req.query("reservation") ?? null;
  if (reservation !== null && !UUID.test(reservation)) {
    return c.json({ error: "That is not a booking." }, 400);
  }
  const result = await withSession(c.get("subject"), async (client) => {
    const { rows: hotel } = await client.query<{
      id: string; is_on: boolean | null; last_read_at: string | null; last_error: string | null;
    }>(
      `select h.id::text, ch.is_on, ch.last_read_at::text, ch.last_error
         from hotels h left join crs_hotels ch on ch.hotel_id = h.id
        where h.code = upper($1) and h.is_active`, [c.req.param("code")]);
    if (!hotel[0]) return null;

    const { rows } = await client.query<{
      crs_id: string; crs_reference: string; salesperson: string | null; company: string | null;
      guest_name: string | null; check_in: string | null; check_out: string | null;
      crs_status: string; outcome: string; reason: string | null; read_at: string;
      change_note: string | null; changed_at: string | null; change_done_at: string | null;
      answer: string | null; answered_at: string | null; answer_error: string | null;
      bookings: Array<{ id: string; reference: string; status: string }> | null;
    }>(
      `select b.crs_id, b.crs_reference, b.salesperson, b.company, b.guest_name,
              b.check_in::text, b.check_out::text, b.crs_status, b.outcome, b.reason,
              b.read_at::text, b.change_note, b.changed_at::text, b.change_done_at::text,
              b.answer, b.answered_at::text, b.answer_error,
              (select json_agg(json_build_object('id', r.id, 'reference', r.reference,
                                                 'status', r.status) order by r.ota_line)
                 from reservations r where r.id = any(b.reservation_ids)) as bookings
         from crs_bookings b
        where b.hotel_id = $1
          and ($2::uuid is null or $2::uuid = any(b.reservation_ids))
        order by b.read_at desc
        limit 200`,
      [hotel[0].id, reservation]);

    return {
      connection: {
        settingsPresent: crsSettings() !== null,
        mapped: hotel[0].is_on !== null,
        on: hotel[0].is_on === true,
        lastReadAt: hotel[0].last_read_at,
        lastError: hotel[0].last_error,
      },
      bookings: rows.map((r) => ({
        crsId: r.crs_id,
        crsReference: r.crs_reference,
        salesperson: r.salesperson,
        company: r.company,
        guestName: r.guest_name,
        checkIn: r.check_in,
        checkOut: r.check_out,
        crsStatus: r.crs_status,
        outcome: r.outcome,
        reason: r.reason,
        readAt: r.read_at,
        changeNote: r.change_note,
        changedAt: r.changed_at,
        changeDone: r.change_done_at !== null,
        answer: r.answered_at ? r.answer : null,
        answerError: r.answered_at ? null : r.answer_error,
        bookings: r.bookings ?? [],
      })),
    };
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

crsRoutes.post("/:code/crs/bookings/:crsId/done", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const { rows } = await client.query<{ crs_id: string }>(
      `update crs_bookings b
          set change_done_at = now(), change_done_by = $3
         from hotels h
        where h.id = b.hotel_id and h.code = upper($1) and b.crs_id = $2
          and b.change_note is not null and b.change_done_at is null
        returning b.crs_id`,
      [c.req.param("code"), c.req.param("crsId"), session.staffId]);
    return rows[0] ? { ok: true as const }
      : { ok: false as const, reason: "That note is not here, or is already done." };
  });
  return c.json(result, result.ok ? 200 : 409);
});
