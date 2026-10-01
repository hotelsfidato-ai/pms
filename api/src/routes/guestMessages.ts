import { Hono } from "hono";
import { withSession } from "../auth.ts";
import { A_UUID, DESK_REFUSED, ask, deskAt, openedHere, refused } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   MESSAGES WITH THE FRONT DESK, BOTH WAYS (D27-224, migration 173)

   GET  /api/guest/:token/messages
        the guest's thread: their messages to the desk (132) and the desk's
        replies, newest first. A reply is `from: "desk"` and nothing more -
        the page says "Front desk", and no name ever reaches the guest.

   POST /api/hotels/:code/online-checkin/messages/:reservationId/reply
        the desk replies (DESK_ROLES, the owner's choice), which marks the
        stay's unread messages handled. Refused once the guest has checked
        out. No WhatsApp alert (the owner, D27-224): the guest's page reads
        the thread again every 30 seconds while it is open.

   The thread belongs to the STAY the link and this phone's unlock reach
   (`app.guest_desk_thread`), so the next guest in the room sees none of it.
   ══════════════════════════════════════════════════════════════════ */

export const messagesDoor = new Hono();
export const messagesDesk = new Hono<{ Variables: { subject: string } }>();

messagesDoor.get("/:token/messages", async (c) => {
  const opened = await openedHere(c);
  if (!opened) return refused(c);
  const rows = await ask<{ from_desk: boolean; what: string; status: string | null; at: string }>(
    "select * from app.guest_desk_thread($1, $2)", [opened.hash, opened.unlock]);
  return c.json({
    thread: rows.map((t) => (t.from_desk
      ? { from: "desk", what: t.what, at: t.at }
      : { from: "you", what: t.what, status: t.status, at: t.at })),
  });
});

const CHECKED_OUT = "This guest has checked out. Replies stop at check-out.";

messagesDesk.post("/:code/online-checkin/messages/:reservationId/reply", async (c) => {
  const { what } = await c.req.json<{ what?: unknown }>().catch(() => ({}) as { what?: unknown });
  const text = typeof what === "string" ? what.trim() : "";
  if (text.length < 1 || text.length > 500) {
    return c.json({ error: "Write a reply of up to 500 characters." }, 400);
  }
  const stay = c.req.param("reservationId");
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await deskAt(client, c.req.param("code"));
    if (!hotelId) return 403 as const;
    if (!A_UUID.test(stay)) return 404 as const;
    const { rows: [booking] } = await client.query<{ status: string }>(
      "select status from reservations where id = $1 and hotel_id = $2", [stay, hotelId]);
    if (!booking) return 404 as const;
    if (booking.status === "checked_out") return 409 as const;
    const { rows: [made] } = await client.query<{ id: string; sent_at: string }>(
      `insert into guest_desk_replies (hotel_id, reservation_id, what, sent_by)
       values ($1, $2, $3, $4) returning id::text, sent_at`,
      [hotelId, stay, text, session.staffId]);
    await client.query(
      `update guest_requests set status = 'done', handled_by = $3, handled_at = now()
        where reservation_id = $1 and hotel_id = $2 and kind = 'desk' and status = 'open'`,
      [stay, hotelId, session.staffId]);
    return { reply: { id: made!.id, what: text, sentAt: made!.sent_at, sentBy: session.fullName } };
  });
  if (result === 403) return c.json({ error: DESK_REFUSED }, 403);
  if (result === 404) return c.json({ error: "No such booking here." }, 404);
  if (result === 409) return c.json({ error: CHECKED_OUT }, 409);
  return c.json(result);
});
