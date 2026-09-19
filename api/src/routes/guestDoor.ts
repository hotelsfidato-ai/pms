import { Hono } from "hono";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { withSession } from "../auth.ts";
import { pool } from "../db.ts";
import { env } from "../env.ts";
import { canSend, send } from "../sending.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN DOOR — one private page per booking (D18-9, D18-10, D18-13)

   GET  /api/guest/:token          what this booking is, and whether the guest
                                   has proved who they are yet
   POST /api/guest/:token/code     send a six-digit code to the phone THE
                                   BOOKING carries
   POST /api/guest/:token/verify   answer it

   and, for the desk, inside the ordinary staff gate:

   POST /api/hotels/:code/stays/:id/guest-link   make a link for this booking

   ⚠ THIS IS THE ONLY DOOR IN THIS SYSTEM OPENED BY SOMEBODY THE HOTEL DOES NOT
   EMPLOY, and behind it is a guest's name, their passport and what they owe.
   So it is written to give away as little as it can:

   · The token is hashed here and only the hash reaches the database
     (migration 114), so a query log is not a set of keys.
   · A token names ONE booking. There is no session, no account and no guest
     role — nothing to widen by mistake later.
   · Before the code is answered, the page may show only what a clerk would
     say across the counter: the guest's own name, their dates, and the last
     four digits of the number on the booking. NOT the bill.
   · A phone that does not match the booking gets no code AND no explanation.
     "Wrong number" tells a stranger which number is right.
   · Every refusal takes the same shape, so what is refused cannot be told
     apart from what does not exist.
   ══════════════════════════════════════════════════════════════════ */

export const guestDoor = new Hono();
export const guestLinks = new Hono<{ Variables: { subject: string } }>();

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** One sentence for every refusal: a stranger learns nothing from which one. */
const NOTHING_HERE = "This link is not usable. Ask the desk for a new one.";

/* ── How often anybody may knock ──────────────────────────────────
   A token is 32 bytes, so guessing one is not the risk; a stolen link being
   hammered for codes is. Per token, per minute, in this process - nginx has
   its own limit in front (deploy/nginx.conf, the master's). */
const A_MINUTE = 60_000;
const OPENS_A_MINUTE = 30;
const CODES_AN_HOUR = 5;
const knocks = new Map<string, { at: number; opens: number; codes: number; hour: number }>();

/* ⚠ AND IT IS SWEPT, WHICH IT WAS NOT (19 September, found by audit).
   A token hash was added on the first knock and never removed, and this is
   the one door in the system that needs no credential of any kind: anybody
   could walk random tokens and grow this map until the process died, taking
   the front desk and the tills with it. The comment above claimed nginx had
   a limit in front — it does not. `deploy/nginx.conf` applied `limit_req`
   only to /api/channel/, and /api/guest/ fell through the plain /api/ block.
   Both halves are fixed: nginx has its own zone now, and nothing here is
   remembered longer than the hour its counters cover. */
const KEEP_FOR = 60 * A_MINUTE;
function sweep(now: number): void {
  for (const [hash, seen] of knocks) {
    if (now - seen.at * A_MINUTE > KEEP_FOR) knocks.delete(hash);
  }
}

function tooOften(tokenHash: string, kind: "open" | "code"): boolean {
  const now = Date.now();
  /* Cheap: this map holds one small object per token seen in the last hour,
     and the sweep only walks that. It runs on the knock rather than on a
     timer so a process with no guests does no work at all. */
  if (knocks.size > 1_000) sweep(now);
  const minute = Math.floor(now / A_MINUTE);
  const hour = Math.floor(now / (60 * A_MINUTE));
  const seen = knocks.get(tokenHash);
  if (!seen || seen.at !== minute) {
    knocks.set(tokenHash, {
      at: minute, opens: 0,
      codes: seen && seen.hour === hour ? seen.codes : 0,
      hour,
    });
  }
  const row = knocks.get(tokenHash)!;
  if (kind === "open") {
    row.opens += 1;
    return row.opens > OPENS_A_MINUTE;
  }
  row.codes += 1;
  return row.codes > CODES_AN_HOUR;
}

export function forgetKnocksForTests(): void {
  knocks.clear();
}

interface OpenRow extends Record<string, unknown> {
  link_id: string; hotel_id: string; hotel_code: string; hotel_name: string;
  reservation_id: string; reference: string; guest_name: string;
  check_in: string; check_out: string; status: string;
  verified: boolean; phone_hint: string | null;
}

/* The door's own connection. NOT `withSession`: a guest has no staff id to run
   as, and giving them one would be giving them a person's reach. Every
   statement below is a call to one of migration 114's functions, each of which
   answers about the single booking the token names. */
async function ask<T extends Record<string, unknown>>(
  text: string, params: unknown[],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<T>(text, params);
    return rows;
  } finally {
    client.release();
  }
}

guestDoor.get("/:token", async (c) => {
  const hash = sha256(c.req.param("token"));
  if (tooOften(hash, "open")) return c.json({ error: NOTHING_HERE }, 429);

  const rows = await ask<OpenRow>("select * from app.guest_link_open($1)", [hash]);
  const it = rows[0];
  if (!it) return c.json({ error: NOTHING_HERE }, 404);

  return c.json({
    hotel: { code: it.hotel_code, name: it.hotel_name },
    booking: {
      reference: it.reference,
      guestName: it.guest_name,
      checkIn: it.check_in,
      checkOut: it.check_out,
      status: it.status,
    },
    /* Until the code is answered this is all there is. The bill, the identity
       form and the requests come next, and each one asks `verified` again on
       the server - a screen deciding what to show is not a guard. */
    verified: it.verified,
    phoneHint: it.phone_hint,
  });
});

guestDoor.post("/:token/code", async (c) => {
  const hash = sha256(c.req.param("token"));
  if (tooOften(hash, "code")) {
    return c.json({ sent: true, hint: null }, 200);   // says nothing either way
  }
  const body = await c.req.json<{ phone?: string }>().catch(() => ({}) as { phone?: string });

  /* ⚠ THE SAME ANSWER WHETHER OR NOT A CODE WAS MADE. A page that says "that
     is not the number on the booking" lets a stranger find the number by
     trying. The guest who typed their own number gets the code; anybody else
     gets this sentence and nothing else. */
  /* ⚠ THE ANSWER DOES NOT DEPEND ON WHETHER A CODE WAS MADE. Not its words,
     not its status, not its shape. The first version of this file returned
     200 "if that is the number…" when the number was wrong and 503 "codes
     cannot be sent yet" when it was right - so trying numbers until the
     answer changed would have found the guest's own. Its own test caught it
     the first time it ran (18 September).

     SENDING IS n8n's (D17-87, D18-13) and n8n is not connected yet, so today
     both answers are the same 503; when it is connected both become the same
     200. The code is NEVER in this answer, in any environment: an answer that
     carries the code is a door with no lock. */
  /* ⚠ THIS ASKED FOR `N8N_SEND_WEBHOOK` UNTIL 19 SEPTEMBER, AND NOTHING HAS
     EVER SET THAT NAME. It was invented here, in a file written before the
     sender existed; the sender reads N8N_SEND_URL and N8N_SEND_SECRET, and
     those are the two the owner is told to set. So the owner would have
     followed the brief to the letter, restarted the API, and this door would
     have gone on answering 503 for ever - with no error anywhere saying why,
     and the whole of the verified half of the guest's page (the bill, the
     identity form, the requests) unreachable behind it. Found by audit.

     Its own test could not catch it: it asserted `[200, 503]` contained the
     status, which is true either way. The test below now pins BOTH states. */
  if (!canSend()) {
    return c.json({
      sent: false,
      message: "Codes cannot be sent yet - WhatsApp is not connected to this "
        + "server. Ask the desk to send you the link instead.",
    }, 503);
  }

  /* ⚠ AND NOTHING IS ISSUED ABOVE THIS LINE. The call to `guest_code_issue`
     used to sit before the check, so every knock at a server that could not
     send burned the guest's previous live code (migration 114 keeps one) for
     an attempt nobody ever made. A record of what was never attempted is
     exactly what migration 117 refuses to write; issuing one is worse. */
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ code: string; sent_to: string }>(
      "select * from app.guest_code_issue($1, $2)", [hash, body.phone ?? ""]);
    const made = rows[0];

    if (made) {
      const { rows: link } = await client.query<OpenRow>(
        "select * from app.guest_link_open($1)", [hash]);
      const it = link[0];
      if (it) {
        /* THE CODE LEAVES THROUGH THE ONE DOOR OUT AND NOWHERE ELSE
           (api/src/sending.ts). It is not logged, not returned, and not put
           in the answer below in any environment - an answer that carries
           the code is a door with no lock. Whether this succeeded does not
           change what the caller is told. */
        await send(client, {
          channel: "whatsapp",
          kind: "guest-link-code",
          hotel: { id: it.hotel_id, code: it.hotel_code, name: it.hotel_name },
          to: { name: it.guest_name, phone: made.sent_to },
          data: { code: made.code, reference: it.reference },
          about: { kind: "reservation", id: it.reservation_id },
        });
      }
    }
  } finally {
    client.release();
  }

  /* ⚠ THE ANSWER IS THE SAME WHETHER OR NOT A CODE WAS MADE, WAS SENT, OR
     FAILED TO SEND. A known and accepted limit: a determined attacker could
     time the difference, because a matching number does an HTTP call and a
     wrong one does not. The words, the status and the shape give nothing
     away, which is what stops somebody finding the guest's number by
     trying. */
  return c.json({
    sent: true,
    message: "If that is the number on the booking, the code has been sent to it.",
  });
});

guestDoor.post("/:token/verify", async (c) => {
  const hash = sha256(c.req.param("token"));
  const body = await c.req.json<{ code?: string }>().catch(() => ({}) as { code?: string });
  const digits = (body.code ?? "").replace(/\D/g, "");

  /* Compared in the database, where the hash lives (114). The length check is
     here only so a wrong shape does not spend an attempt. */
  if (digits.length !== 6) {
    return c.json({ verified: false, error: "The code is six digits." }, 400);
  }

  const rows = await ask<{ ok: boolean }>(
    "select app.guest_code_check($1, $2) as ok", [hash, digits]);

  if (!rows[0]?.ok) {
    return c.json({
      verified: false,
      error: "That code is not right, or it has expired. Ask for a new one.",
    }, 401);
  }
  return c.json({ verified: true });
});

/* ── The desk's side ──────────────────────────────────────────────
   Inside the ordinary staff gate, under row level security, like everything
   else a clerk does. It hands back the link ONCE: after this response the
   token exists nowhere but in the guest's hands. */
guestLinks.post("/:code/stays/:id/guest-link", async (c) => {
  const body = await c.req.json<{ origin?: string }>().catch(() => ({}) as { origin?: string });
  const origin = body.origin === "qr" || body.origin === "confirmation"
    ? body.origin : "desk";

  const result = await withSession(c.get("subject"), async (client, session) => {
    const { rows: hotels } = await client.query<{ id: string }>(
      "select id::text from hotels where code = $1", [c.req.param("code").toUpperCase()]);
    const hotelId = hotels[0]?.id;
    if (!hotelId) return { status: 404 as const, error: "No such property." };

    /* The booking, read under the clerk's own session: a clerk who may not see
       this stay cannot make a link to it. */
    const { rows: stays } = await client.query<{
      id: string; check_out: string; status: string; guest: string; phone: string | null;
    }>(
      `select r.id::text, r.check_out::text, r.status, g.full_name as guest, g.phone
         from reservations r join guests g on g.id = r.guest_id
        where r.id = $1 and r.hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    const stay = stays[0];
    if (!stay) return { status: 404 as const, error: "No such booking." };
    if (stay.status === "cancelled" || stay.status === "void") {
      return { status: 409 as const, error: "That booking is cancelled, so it has no page." };
    }

    /* 32 bytes, base64url: long enough that guessing is not a plan. The plain
       token is in this process and in the answer below, and nowhere else. */
    const token = randomBytes(32).toString("base64url");

    /* ALIVE UNTIL THE MORNING AFTER THEY LEAVE - a page that outlives the stay
       is a bill left on a table (D18-9) - but never for less than a day from
       now. Without that second half, a link made for a guest standing at the
       desk on their departure morning is dead before they reach the lift, and
       a link for a stay already over cannot be made at all (which is what the
       tests found: the demo's bookings ended in August).

       11:00 on the property's own clock, because check-out is a time at the
       hotel and not on this server (BQ-8, migration 113). */
    await client.query(
      `insert into guest_links
         (hotel_id, reservation_id, token_hash, origin, created_by, expires_at)
       values ($1, $2, $3, $4, $5,
               greatest(
                 app.hotel_moment($1, ($6::date + 1)::text || 'T11:00'),
                 now() + interval '24 hours'
               ))`,
      [hotelId, stay.id, sha256(token), origin, session.staffId, stay.check_out]);

    return {
      status: 200 as const,
      link: `${env.corsOrigins[0] ?? "http://localhost:5173"}/g/${token}`,
      guest: stay.guest,
      phoneOnBooking: stay.phone ? `…${stay.phone.replace(/\D/g, "").slice(-4)}` : null,
    };
  });

  if (result.status !== 200) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

/* Exported for the test that proves a stolen token is not a key to anything
   else: the hash the door computes is the hash the database holds. */
export const hashForTests = sha256;
export const constantTimeEqualForTests = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
