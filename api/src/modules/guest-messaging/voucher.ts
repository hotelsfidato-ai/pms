import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { canSend, send, NOT_CONNECTED } from "../../sending.ts";
import {
  channelFor, claimTurn, dueFromDatabase, linkFromDatabase, messageFor, withVoucher, KIND, LIMITS,
  type Due,
} from "./jobs.ts";
import { voucherFile } from "./voucherDocument.ts";

/* ══════════════════════════════════════════════════════════════════
   SEND VOUCHER - the booking confirmation, now, from the desk (D27-35)

   The owner, 27 September: ONE voucher goes, the same one whoever sends it,
   recorded so it never goes twice. So this is not a second message: it is
   the sweep's own booking confirmation (jobs.ts - the same due row, the same
   link, the same `messageFor`) sent at once, with the clerk's name on it
   instead of the system's. What went, when and by whom is read back from
   `GET /:code/guest-messages?reservation=` as every other message is.

   Refused, and nothing written, when: sending is switched off; the booking
   is Waiting for the hotel (a waiting booking sends nothing); it is not
   confirmed; it was sent already, by anybody; there is nowhere to send it.
   The turn (`claimTurn`) is taken FIRST, so the sweep cannot be half-way
   through sending the same confirmation.
   ══════════════════════════════════════════════════════════════════ */

export const voucher = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

voucher.post("/:code/stays/:id/confirmation", async (c) => {
  /* Asked before any session: nothing is looked up, nothing recorded. */
  if (!canSend()) return c.json(refuse(NOT_CONNECTED), 503);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const { rows: stay } = await client.query<{
      hotel_id: string; status: string; lead: string;
    }>(
      `select r.hotel_id::text, r.status,
              coalesce(app.group_lead(r.group_id), r.id)::text as lead
         from reservations r join hotels h on h.id = r.hotel_id
        where r.id = $1 and h.code = $2`,
      [c.req.param("id"), c.req.param("code").toUpperCase()]);
    const booking = stay[0];
    if (!booking) return null;
    if (booking.status === "tentative") {
      return refuse(
        "This booking is waiting for the hotel, so nothing is sent to the guest. "
        + "Confirm it first.");
    }
    if (booking.status !== "confirmed") {
      return refuse(`This booking is ${booking.status.replace("_", " ")}, so no voucher goes.`);
    }

    await claimTurn(client, KIND.confirmation, booking.lead);
    const due = (await dueFromDatabase(client, LIMITS, booking.hotel_id))
      .find((d) => d.kind === KIND.confirmation && d.reservationId === booking.lead);
    if (!due) {
      /* Not owed: sent already (by anybody), three tries failed, or the stay
         has begun - app.guest_messages_due's three reasons (131). */
      return refuse(
        "The voucher for this booking has gone already, or three tries to send "
        + "it failed. It is sent once, and not again from here.");
    }
    if (!channelFor(due)) {
      return refuse(
        "There is nowhere to send it: no email address, and no telephone number "
        + "the guest agreed to WhatsApp on.");
    }

    const link = await linkFromDatabase(client, due);
    const message = await withVoucher(client, messageFor(due, link)!);
    const answer = await send(client, {
      ...message, sentBy: { id: session.staffId, name: session.fullName },
    });
    return answer.ok ? { ok: true as const } : refuse(answer.reason);
  });

  if (!result) return c.json({ error: "No such booking." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ══════════════════════════════════════════════════════════════════
   SEND CHECK-IN LINK - the guest's own page, on its own (D27-105)

   Before this the link rode only inside the voucher and the reminder, or
   was copied by hand. The clerk presses it when a guest asks; it goes the
   way every message to this guest goes (`channelFor`: WhatsApp only on the
   tick, else email) with a fresh page for THIS booking - a room of a group
   has its own guest and its own page. Each press is a new message with a
   new id: a clerk who sends it again means it. The day-before send is the
   sweep's arrival reminder, which already carries the link.
   ══════════════════════════════════════════════════════════════════ */
voucher.post("/:code/stays/:id/checkin-link", async (c) => {
  if (!canSend()) return c.json(refuse(NOT_CONNECTED), 503);

  const result = await withSession(c.get("subject"), async (client, session) => {
    /* Read under the clerk's own session: a clerk who may not see this
       booking cannot send its page. */
    const { rows } = await client.query<{
      id: string; reference: string; status: string; check_in: string; check_out: string;
      nights: number; whatsapp_agreed: boolean; guest_name: string; phone: string | null;
      email: string | null; hotel_id: string; hotel_code: string; hotel_name: string;
      hotel_phone: string | null;
    }>(
      `select r.id::text, r.reference, r.status, r.check_in::text, r.check_out::text,
              (r.check_out - r.check_in)::int as nights, r.whatsapp_agreed,
              g.full_name as guest_name, g.phone, g.email,
              h.id::text as hotel_id, h.code as hotel_code, h.name as hotel_name,
              h.phone as hotel_phone
         from reservations r
         join guests g on g.id = r.guest_id
         join hotels h on h.id = r.hotel_id
        where r.id = $1 and h.code = $2`,
      [c.req.param("id"), c.req.param("code").toUpperCase()]);
    const b = rows[0];
    if (!b) return null;
    if (b.status !== "confirmed") {
      return refuse(b.status === "tentative"
        ? "This booking is waiting for the hotel, so nothing is sent to the guest. Confirm it first."
        : `This booking is ${b.status.replace("_", " ")}, so no check-in link goes.`);
    }

    const due: Due = {
      kind: KIND.checkInLink, reservationId: b.id, reference: b.reference,
      hotel: { id: b.hotel_id, code: b.hotel_code, name: b.hotel_name, phone: b.hotel_phone },
      guest: { name: b.guest_name, phone: b.phone, email: b.email },
      whatsappAgreed: b.whatsapp_agreed, checkIn: b.check_in, checkOut: b.check_out,
      nights: b.nights, held: false,
    };
    if (!channelFor(due)) {
      return refuse(
        "There is nowhere to send it: no email address, and no telephone number "
        + "the guest agreed to WhatsApp on.");
    }
    const link = await linkFromDatabase(client, due);
    /* Not the voucher's once-only id: a new press is a new message. */
    const { id: _once, ...message } = messageFor(due, link)!;
    const answer = await send(client, {
      ...message, sentBy: { id: session.staffId, name: session.fullName },
    });
    return answer.ok ? { ok: true as const } : refuse(answer.reason);
  });

  if (!result) return c.json({ error: "No such booking." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ══════════════════════════════════════════════════════════════════
   VIEW VOUCHER - the same PDF, to look at, print or save (D27-187)

   The one the confirmation carries (voucherFile), about the group's lead as
   Send voucher's is, and it sends nothing. Read under the clerk's session
   first: the voucher's facts come through a definer (158), so a booking this
   person cannot see is "No such booking." before it is ever drawn. Only a
   confirmed booking has a voucher (app.guest_voucher).
   ══════════════════════════════════════════════════════════════════ */
const AN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

voucher.get("/:code/stays/:id/voucher.pdf", async (c) => {
  if (!AN_ID.test(c.req.param("id"))) return c.json({ error: "No such booking." }, 404);
  const file = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{ lead: string }>(
      `select coalesce(app.group_lead(r.group_id), r.id)::text as lead
         from reservations r join hotels h on h.id = r.hotel_id
        where r.id = $1 and h.code = $2`,
      [c.req.param("id"), c.req.param("code").toUpperCase()]);
    if (!rows[0]) return null;
    return (await voucherFile(client, rows[0].lead)) ?? ("none" as const);
  });
  if (!file) return c.json({ error: "No such booking." }, 404);
  if (file === "none") {
    return c.json({ error: "Only a confirmed booking has a voucher." }, 409);
  }
  return c.body(file.bytes, 200, {
    "content-type": file.contentType,
    "content-disposition": `inline; filename="${file.name}"`,
  });
});
