import { Hono, type Context } from "hono";
import { randomBytes } from "node:crypto";
import { pool } from "../db.ts";
import { env } from "../env.ts";
import { canSend, send } from "../sending.ts";
import { ask, sha256, tooOften } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ROOM AND THE PHONE (D27-235 2.4) - the guest's door without a link

   A guest staying now types their room number and their phone number at
   /g/h/<hotel>. The WhatsApp code goes ONLY to the booking's own number, and
   only when both match; then the code opens the stay like any other.

     POST /api/guest/by-room/send  {hotel, room, phone}
       ALWAYS {sent: true, ticket, message} - the same words, a ticket of the
       same length - whether anything matched. On a match the ticket is a new
       booking link's token (only its hash is kept, 181) and the code goes
       through the door's own machinery (158's guest_code_make, sending.ts);
       on none it is random and nothing is written.
     POST /api/guest/by-room/open  {ticket, code}
       {verified: true, unlock} - or ONE refusal for everything else: no such
       ticket, a wrong or old code, a malformed one.

   ⚠ The door's own /:token/verify is NOT used: it answers "not usable" for
   a link that does not exist and "not right" for a wrong code, and that
   difference would tell a stranger which room and number matched.
   ⚠ The sending is not awaited, so a match does not take longer than a
   mismatch by the time it takes to reach WhatsApp. ponytail: the match still
   writes one row; pad both paths to a floor if timing ever needs to be flat.

   Limits: five tries an hour from one address (nginx's X-Real-IP), three
   links an hour for one stay (181), and the code's own five wrong answers.
   Over any of them: the same answer, nothing sent.
   ══════════════════════════════════════════════════════════════════ */

export const byRoom = new Hono();

const SENT = "If the room and the number match a guest staying now, a code is on its way "
  + "to that number on WhatsApp.";
const CANNOT_SEND = "Codes cannot be sent yet - sending is not set up on this server. Ask the desk.";
const REFUSED = "That did not work. Check the code, or ask the desk.";

/* The door's own development switch (guestDoor.ts, D27-105), read the same
   way: the code on screen, never in a built app. Here it ALSO shows whether
   the room matched - development only, with ALLOW_DEV_AUTH. */
const codeOnScreen = (): boolean =>
  env.allowDevAuth && process.env["GUEST_CODE_ON_SCREEN"] === "1";

const addressOf = (c: Context) =>
  c.req.header("x-real-ip")?.trim()
  || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  || "direct";

/** The code for a fresh link, to the booking's own number. */
async function deliver(tokenHash: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      code: string | null; phone: string | null; reservation_id: string; reference: string;
      guest_name: string; hotel_id: string; hotel_code: string; hotel_name: string;
    }>("select * from app.guest_code_make($1)", [tokenHash]);
    const made = rows[0];
    if (!made?.code || !made.phone) return null;
    if (codeOnScreen()) return made.code;
    await send(client, {
      channel: "whatsapp",
      kind: "guest-link-code",
      hotel: { id: made.hotel_id, code: made.hotel_code, name: made.hotel_name },
      to: { name: made.guest_name, phone: made.phone },
      data: { code: made.code, reference: made.reference,
              guestName: made.guest_name, hotelName: made.hotel_name },
      about: { kind: "reservation", id: made.reservation_id },
    });
    return null;
  } finally {
    client.release();
  }
}

byRoom.post("/by-room/send", async (c) => {
  if (!canSend() && !codeOnScreen()) return c.json({ sent: false, message: CANNOT_SEND });

  const b = await c.req.json<{ hotel?: string; room?: string; phone?: string }>()
    .catch(() => ({}) as { hotel?: string; room?: string; phone?: string });
  const ticket = randomBytes(32).toString("base64url");
  const answer: Record<string, unknown> = { sent: true, ticket, message: SENT };

  if (tooOften(sha256(`by-room:${addressOf(c)}`), "code")) return c.json(answer);

  const hash = sha256(ticket);
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_room_phone_link($1, $2, $3, $4) as ok",
    [String(b.hotel ?? ""), String(b.room ?? ""), String(b.phone ?? ""), hash]);
  if (rows[0]?.ok) {
    if (codeOnScreen()) {
      const code = await deliver(hash);
      if (code) answer["devCode"] = code;
    } else {
      void deliver(hash).catch((error) => console.error("[guest] by-room code not sent", error));
    }
  }
  return c.json(answer);
});

byRoom.post("/by-room/open", async (c) => {
  const b = await c.req.json<{ ticket?: string; code?: string }>()
    .catch(() => ({}) as { ticket?: string; code?: string });
  const digits = String(b.code ?? "").replace(/\D/g, "");
  const ticket = String(b.ticket ?? "");
  if (digits.length !== 6 || ticket === "") return c.json({ verified: false, error: REFUSED }, 401);

  const unlock = randomBytes(32).toString("base64url");
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_code_answer($1, $2, $3) as ok", [sha256(ticket), digits, sha256(unlock)]);
  if (!rows[0]?.ok) return c.json({ verified: false, error: REFUSED }, 401);
  return c.json({ verified: true, unlock });
});
