import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { canSend, send, NOT_CONNECTED } from "../../sending.ts";
import {
  channelFor, claimTurn, dueFromDatabase, linkFromDatabase, messageFor, KIND, LIMITS,
} from "./jobs.ts";

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
    const message = messageFor(due, link)!;
    const answer = await send(client, {
      ...message, sentBy: { id: session.staffId, name: session.fullName },
    });
    return answer.ok ? { ok: true as const } : refuse(answer.reason);
  });

  if (!result) return c.json({ error: "No such booking." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
