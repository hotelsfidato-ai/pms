import { Hono, type Context } from "hono";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { withSession } from "../auth.ts";
import { pool } from "../db.ts";
import { env } from "../env.ts";
import { canSend, send } from "../sending.ts";
import { idNumberProblem } from "../validate.ts";

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

   BEHIND THE CODE (21 September, D21-6 to D21-19, migration 121):

   GET  /api/guest/:token/details    what the guest has sent, and its state
   POST /api/guest/:token/details    their ID and address - a SUBMISSION
   GET  /api/guest/:token/bill       the bill as it stands (D21-10, migration 124)
   GET  /api/guest/:token/requests   their spa / laundry requests
   POST /api/guest/:token/requests   ask for one, where the hotel offers it -
                                     or, kind 'desk', message the front desk
                                     (D23-14, migration 132)

   · THE CODE UNLOCKS THIS PHONE, NOT THE LINK (D21-6). `verify` hands back an
     unlock, once; the page sends it as `Authorization: Guest …` and it is hashed here
     like the token. Every room behind the code takes BOTH hashes, and asks
     `app.guest_unlocked` in the database every time. The link alone, however
     many times the code was answered on it, opens nothing behind it.
   · A ROOM CARD NAMES A ROOM (D21-7). Same address, `/g/:token`; the database
     resolves it to whoever is checked in there now. Before the code it shows
     the hotel and the room number and nothing else (D21-14).
   · NOTHING THE GUEST TYPES REACHES guest_documents (D21-8). It waits for a
     clerk, who confirms it through the staff routes at the foot of this file.
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
  link_id: string; kind: "booking" | "room";
  hotel_id: string; hotel_code: string; hotel_name: string;
  room_number: string | null; occupied: boolean;
  /* Null on a room card until THIS phone has answered the code (D21-14). */
  reservation_id: string | null; reference: string | null; guest_name: string | null;
  check_in: string | null; check_out: string | null; status: string | null;
  verified: boolean; phone_hint: string | null; offers: string[] | null;
}

/** The unlock this phone holds, hashed - or null, which unlocks nothing.

    ⚠ IN `Authorization: Guest <unlock>`, NOT A HEADER OF ITS OWN (OCI-4).
    It was `x-guest-unlock` until the page was opened in a browser on 21
    September: the API's CORS list (server.ts, the master's) does not name
    it, so every call behind the code was blocked by its preflight and the
    guest read "could not reach the hotel" the moment the code was right.
    The tests run in-process and never meet a preflight. `authorization` is
    already allowed, is not written to access logs, and is ignored on
    /api/guest by the staff gate - and a signed-in clerk's `Bearer` token on
    the same browser is not a `Guest` one, so it unlocks nothing here. */
const unlockOf = (c: Context) => {
  const held = /^Guest\s+(\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  return held ? sha256(held) : null;
};

const refused = (c: Context) => c.json({ error: NOTHING_HERE }, 404);

/* Opened WITH this phone's unlock: the one check every route behind the code
   makes before it does anything. Each database function behind it asks again
   - this is the door's courtesy, the function is the guard. */
async function openedHere(
  c: Context,
): Promise<{ hash: string; unlock: string; it: OpenRow } | null> {
  const hash = sha256(c.req.param("token") ?? "");
  const unlock = unlockOf(c);
  if (tooOften(hash, "open") || !unlock) return null;
  const rows = await ask<OpenRow>("select * from app.guest_link_open($1, $2)", [hash, unlock]);
  const it = rows[0];
  return it?.verified ? { hash, unlock, it } : null;
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

  /* WITH this phone's unlock, if it holds one: `verified` means "this phone
     has answered the code for this stay" and nothing wider (D21-6). */
  const rows = await ask<OpenRow>(
    "select * from app.guest_link_open($1, $2)", [hash, unlockOf(c)]);
  const it = rows[0];
  if (!it) return c.json({ error: NOTHING_HERE }, 404);

  return c.json({
    kind: it.kind,
    hotel: { code: it.hotel_code, name: it.hotel_name },
    /* A room card's own number; null on a booking's link. */
    room: it.room_number,
    /* A room card with nobody checked in says only that (D21-15). */
    occupied: it.occupied,
    /* The database has already emptied these on a room card that this phone
       has not unlocked (D21-14). Null, not an empty booking. */
    booking: it.reference === null ? null : {
      reference: it.reference,
      guestName: it.guest_name,
      checkIn: it.check_in,
      checkOut: it.check_out,
      status: it.status,
    },
    verified: it.verified,
    phoneHint: it.phone_hint,
    /* D21-25: the page offers "Send me the code" only when one can be sent.
       This is about the SERVER, not the booking - it is the same answer for
       every link, so it tells a stranger nothing about this one. */
    canSendCodes: canSend(),
    cannotSend: canSend() ? null : CANNOT_SEND,
    /* What this hotel offers behind the code (D21-63): only once unlocked. */
    offers: it.verified ? (it.offers ?? []) : [],
  });
});

/* The answer to "send me the code", whichever way it went. ONE sentence and
   ONE shape: a right number, a wrong number and one knock too many all get
   exactly this (D21-25 - the rate-limited answer used to be
   `{ sent: true, hint: null }`, which the page printed as a blank line). */
/* And the one sentence for a server that cannot send at all - on opening, so
   the page can say it BEFORE asking for a number (D21-25), and again if a
   code is asked for anyway. One definition, here. */
const CANNOT_SEND = "Codes cannot be sent yet - WhatsApp is not connected to "
  + "this server. Ask the desk to send you the link instead.";

const MAYBE_SENT = {
  sent: true,
  message: "If that is the number on the booking, the code has been sent to it.",
};

guestDoor.post("/:token/code", async (c) => {
  const hash = sha256(c.req.param("token"));
  /* Nothing can be sent: say so first. Asked before the knock is counted, so
     a guest reading this sentence has not spent one of their five an hour. */
  if (!canSend()) return c.json({ sent: false, message: CANNOT_SEND }, 503);
  if (tooOften(hash, "code")) return c.json(MAYBE_SENT);
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
     status, which is true either way. The test below now pins BOTH states.
     (The `canSend` check that refuses now sits at the top of this handler,
     above the knock count - 21 September, D21-25.) */

  /* ⚠ AND NOTHING IS ISSUED ABOVE THIS LINE. The call to `guest_code_issue`
     used to sit before the check, so every knock at a server that could not
     send burned the guest's previous live code (migration 114 keeps one) for
     an attempt nobody ever made. A record of what was never attempted is
     exactly what migration 117 refuses to write; issuing one is worse. */
  const client = await pool.connect();
  try {
    /* One call: the code, AND what the message needs - the stay, its name and
       the booking's own number (migration 121). None of it goes into the
       answer below; it goes only into the message. */
    const { rows } = await client.query<{
      code: string; phone: string; reservation_id: string; reference: string;
      guest_name: string; hotel_id: string; hotel_code: string; hotel_name: string;
    }>("select * from app.guest_code_make($1, $2)", [hash, body.phone ?? ""]);
    const made = rows[0];

    if (made) {
      /* THE CODE LEAVES THROUGH THE ONE DOOR OUT AND NOWHERE ELSE
         (api/src/sending.ts). It is not logged, not returned, and not put in
         the answer below in any environment - an answer that carries the
         code is a door with no lock. Whether this succeeded does not change
         what the caller is told.

         ⚠ TO THE WHOLE NUMBER (OCI-2). This passed `sent_to`, the masked
         "…0011" kept for the record, as the recipient - so the first code
         sent once WhatsApp was connected would have reached nobody. */
      await send(client, {
        channel: "whatsapp",
        kind: "guest-link-code",
        hotel: { id: made.hotel_id, code: made.hotel_code, name: made.hotel_name },
        to: { name: made.guest_name, phone: made.phone },
        data: { code: made.code, reference: made.reference },
        about: { kind: "reservation", id: made.reservation_id },
      });
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
  return c.json(MAYBE_SENT);
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

  /* THE UNLOCK (D21-6). Made here, 32 bytes; only its hash is handed to the
     database, which records it against this link AND the stay the code was
     sent for, in the same statement that accepts the code. The secret goes
     back in this answer once and lives in the guest's open tab. The link
     itself gains nothing: another phone holding it is asked for a code. */
  const unlock = randomBytes(32).toString("base64url");
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_code_answer($1, $2, $3) as ok", [hash, digits, sha256(unlock)]);

  if (!rows[0]?.ok) {
    return c.json({
      verified: false,
      error: "That code is not right, or it has expired. Ask for a new one.",
    }, 401);
  }
  return c.json({ verified: true, unlock });
});

/* ── Behind the code ───────────────────────────────────────────────
   Every route here starts with `openedHere` (the link AND this phone's
   unlock), and every database function it calls asks `app.guest_unlocked`
   again. Refused, each one answers exactly what an unknown link answers:
   the same 404 and the same sentence, so a stranger cannot learn from these
   either whether the link is real (property 5). */

const ID_TYPES = ["aadhaar", "passport", "driving_licence", "voter", "other"];
const isDate = (v: unknown) => v === undefined || v === null || v === ""
  || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));

guestDoor.get("/:token/details", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const rows = await ask<{
    status: string; submitted_at: string; id_type: string; id_last_four: string;
  }>("select * from app.guest_details_state($1, $2)", [door.hash, door.unlock]);
  const d = rows[0];
  return c.json({
    sent: d ? {
      status: d.status, submittedAt: d.submitted_at,
      idType: d.id_type, idLastFour: d.id_last_four,
    } : null,
  });
});

guestDoor.post("/:token/details", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

  /* Checked here only so a typing slip gets a sentence rather than a fault;
     the table's own constraints are the rule. Only the fields D21-19 names. */
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length <= max;
  if (typeof b.idType !== "string" || !ID_TYPES.includes(b.idType)) {
    return c.json({ error: "Choose which ID this is." }, 400);
  }
  if (typeof b.idNumber !== "string" || b.idNumber.trim() === "" || !text(b.idNumber, 40)) {
    return c.json({ error: "Type the number on the ID." }, 400);
  }
  /* GP-1 (round D): an Aadhaar "12ab" was taken here. The desk's rule. */
  const wrongId = idNumberProblem(b.idType, b.idNumber);
  if (wrongId) return c.json({ error: wrongId }, 400);
  if (!isDate(b.passportExpiry) || !isDate(b.visaExpiry)) {
    return c.json({ error: "A date is not a date - check the expiry dates." }, 400);
  }
  for (const [k, max] of [["visaNumber", 40], ["addressLine", 300], ["city", 80], ["country", 80]] as const) {
    if (b[k] !== undefined && b[k] !== null && !text(b[k], max)) {
      return c.json({ error: "Something typed is too long." }, 400);
    }
  }

  const rows = await ask<{ ok: boolean }>(
    "select app.guest_details_submit($1, $2, $3::jsonb) as ok",
    [door.hash, door.unlock, JSON.stringify({
      idType: b.idType, idNumber: b.idNumber,
      passportExpiry: b.passportExpiry ?? null, visaNumber: b.visaNumber ?? null,
      visaExpiry: b.visaExpiry ?? null, addressLine: b.addressLine ?? null,
      city: b.city ?? null, country: b.country ?? null,
      /* D25-39: the guest's own yes to offers, recorded at once. */
      offersAgreed: b.offersAgreed === true,
    })]);
  if (!rows[0]?.ok) return refused(c);
  return c.json({ sent: true });
});

/* THE BILL AS IT STANDS (D21-10) - finance's one definition, `app.stay_bill`
   (123), through `app.guest_bill` (124), which answers only for the stay this
   link and this phone's unlock reach. Nothing is added up here. */
guestDoor.get("/:token/bill", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const rows = await ask<{ bill: unknown }>(
    "select app.guest_bill($1, $2) as bill", [door.hash, door.unlock]);
  const bill = rows[0]?.bill;
  if (!bill) return refused(c);
  return c.json(bill);
});

guestDoor.get("/:token/requests", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const rows = await ask<{
    kind: string; what: string; wanted: string | null; status: string; created_at: string;
  }>("select * from app.guest_requests_mine($1, $2)", [door.hash, door.unlock]);
  return c.json({
    offers: door.it.offers ?? [],
    requests: rows.map((r) => ({
      kind: r.kind, what: r.what, wanted: r.wanted, status: r.status, createdAt: r.created_at,
    })),
  });
});

guestDoor.post("/:token/requests", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const b = await c.req.json<{ kind?: string; what?: string; wanted?: string }>()
    .catch(() => ({}) as { kind?: string; what?: string; wanted?: string });
  if (!b.what || b.what.trim() === "" || b.what.length > 500 || (b.wanted?.length ?? 0) > 100) {
    return c.json({ error: "Say what you would like, in a sentence or two." }, 400);
  }

  const rows = await ask<{ ok: boolean }>(
    "select app.guest_request_make($1, $2, $3, $4, $5) as ok",
    [door.hash, door.unlock, b.kind ?? "", b.what, b.wanted ?? null]);
  /* Unlocked, so a plain sentence is safe here: the hotel does not offer it,
     or ten are already waiting. */
  if (!rows[0]?.ok) {
    return c.json({ error: "That cannot be asked for here. Ask the desk." }, 409);
  }
  return c.json({ sent: true });
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
      link: linkFor(token),
      guest: stay.guest,
      phoneOnBooking: stay.phone ? `…${stay.phone.replace(/\D/g, "").slice(-4)}` : null,
    };
  });

  if (result.status !== 200) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

/* The address a guest's link carries: the server's own setting, never written
   into the code (D21-60 - pms.fidatohotels.com for now). */
function linkFor(token: string): string {
  return `${env.corsOrigins[0] ?? "http://localhost:5173"}/g/${token}`;
}

/* ── The desk's side of online check-in (D21-8, D21-9, D21-16, D21-62) ──
   Ordinary staff routes: row level security decides which hotel's rows a
   clerk sees, and these roles decide who may act. Reception does all of it
   at the desk; the floor above it may too. */
const DESK_ROLES: readonly string[] = ["owner", "admin", "gm", "hotel_manager", "front_desk"];
const DESK_REFUSED = "Online check-in is handled by reception, the manager, an "
  + "administrator or the owner. Ask one of them.";

type Db = Parameters<Parameters<typeof withSession>[1]>[0];

/* The hotel, if this person holds a desk role there - the same question the
   spa and the other services ask, in the same words. */
async function deskAt(client: Db, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string; may: boolean }>(
    `select h.id::text,
            exists (select 1 from staff s
                     where s.id = app.current_user_id() and s.is_active and s.is_group_admin)
         or exists (select 1 from staff_hotels sh join staff s on s.id = sh.staff_id
                     where sh.staff_id = app.current_user_id() and sh.hotel_id = h.id
                       and s.is_active and sh.role = any($2::text[])) as may
       from hotels h where h.code = $1`,
    [code.toUpperCase(), DESK_ROLES]);
  return rows[0]?.may ? rows[0].id : null;
}

/* AADHAAR: THE LAST FOUR, ON EVERY SCREEN (D21-18). The full number is stored
   (D21-17) and appears only on the printed registration card; it never leaves
   this API for a screen. A passport is shown whole - the clerk compares it
   with the passport in their hand. */
const shownNumber = (type: string, n: string) =>
  type === "aadhaar" ? `…${n.slice(-4)}` : n;

guestLinks.get("/:code/online-checkin", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await deskAt(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: waiting } = await client.query<{
      id: string; guest: string; reference: string; id_type: string; id_number: string;
      passport_expiry: string | null; visa_number: string | null; visa_expiry: string | null;
      address_line: string | null; city: string | null; country: string | null;
      submitted_at: string;
    }>(
      `select d.id::text, g.full_name as guest, r.reference, d.id_type, d.id_number,
              d.passport_expiry::text, d.visa_number, d.visa_expiry::text,
              d.address_line, d.city, d.country, d.submitted_at
         from guest_detail_submissions d
         join reservations r on r.id = d.reservation_id
         join guests g       on g.id = d.guest_id
        where d.hotel_id = $1 and d.status = 'waiting'
        order by d.submitted_at`, [hotelId]);

    const { rows: requests } = await client.query<{
      id: string; kind: string; what: string; wanted: string | null;
      created_at: string; guest: string; reference: string;
    }>(
      `select q.id::text, q.kind, q.what, q.wanted, q.created_at,
              g.full_name as guest, r.reference
         from guest_requests q
         join reservations r on r.id = q.reservation_id
         join guests g       on g.id = r.guest_id
        where q.hotel_id = $1 and q.status = 'open' and q.kind <> 'desk'
        order by q.created_at`, [hotelId]);

    const { rows: rooms } = await client.query<{
      id: string; number: string; card_since: string | null;
    }>(
      `select rm.id::text, rm.number,
              (select l.created_at from guest_links l
                where l.room_id = rm.id and l.revoked_at is null) as card_since
         from rooms rm
        where rm.hotel_id = $1 and rm.is_active
        order by rm.number`, [hotelId]);

    return {
      waiting: waiting.map((d) => ({
        id: d.id, guest: d.guest, reference: d.reference, idType: d.id_type,
        idNumber: shownNumber(d.id_type, d.id_number),
        passportExpiry: d.passport_expiry, visaNumber: d.visa_number,
        visaExpiry: d.visa_expiry, addressLine: d.address_line, city: d.city,
        country: d.country, submittedAt: d.submitted_at,
      })),
      requests: requests.map((q) => ({
        id: q.id, kind: q.kind, what: q.what, wanted: q.wanted,
        createdAt: q.created_at, guest: q.guest, reference: q.reference,
      })),
      rooms: rooms.map((r) => ({ id: r.id, number: r.number, cardSince: r.card_since })),
    };
  });
  if (!body) return c.json({ error: DESK_REFUSED }, 403);
  return c.json(body);
});

/* CONFIRMED BY A PERSON, UNDER THEIR NAME (D21-8). The one place a guest's
   details reach guest_documents - and so Form C - and it is the clerk's own
   session writing them, with the same merge the check-in flow uses: a field
   the guest left blank does not blank one already on file. */
guestLinks.post("/:code/online-checkin/submissions/:id/confirm", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await deskAt(client, c.req.param("code"));
    if (!hotelId) return 403 as const;

    const { rows } = await client.query(
      `with d as (
         select * from guest_detail_submissions
          where id = $1 and hotel_id = $2 and status = 'waiting'
          for update)
       insert into guest_documents
         (guest_id, id_type, id_number, passport_expiry, visa_number,
          visa_expiry, address_line, city, country, captured_by, captured_at)
       select guest_id, id_type, id_number, passport_expiry, visa_number,
              visa_expiry, address_line, city, country, app.current_user_id(), now()
         from d
       on conflict (guest_id) do update set
         id_type         = excluded.id_type,
         id_number       = excluded.id_number,
         passport_expiry = coalesce(excluded.passport_expiry, guest_documents.passport_expiry),
         visa_number     = coalesce(excluded.visa_number, guest_documents.visa_number),
         visa_expiry     = coalesce(excluded.visa_expiry, guest_documents.visa_expiry),
         address_line    = coalesce(excluded.address_line, guest_documents.address_line),
         city            = coalesce(excluded.city, guest_documents.city),
         country         = coalesce(excluded.country, guest_documents.country),
         captured_by     = excluded.captured_by,
         captured_at     = excluded.captured_at
       returning guest_id`, [c.req.param("id"), hotelId]);
    if (rows.length === 0) return 409 as const;

    await client.query(
      `update guest_detail_submissions
          set status = 'confirmed', handled_by = $2, handled_at = now()
        where id = $1`, [c.req.param("id"), session.staffId]);
    return 200 as const;
  });
  if (result === 403) return c.json({ error: DESK_REFUSED }, 403);
  if (result === 409) {
    return c.json({ error: "Those details were already handled, or are not this property's." }, 409);
  }
  return c.json({ confirmed: true });
});

/* Not this: the clerk found it wrong and will take the details from the ID at
   the desk, as before. Nothing is written to guest_documents. */
guestLinks.post("/:code/online-checkin/submissions/:id/set-aside", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await deskAt(client, c.req.param("code"));
    if (!hotelId) return 403 as const;
    const { rowCount } = await client.query(
      `update guest_detail_submissions
          set status = 'set_aside', handled_by = $3, handled_at = now()
        where id = $1 and hotel_id = $2 and status = 'waiting'`,
      [c.req.param("id"), hotelId, session.staffId]);
    return rowCount ? 200 as const : 409 as const;
  });
  if (result === 403) return c.json({ error: DESK_REFUSED }, 403);
  if (result === 409) return c.json({ error: "Already handled." }, 409);
  return c.json({ setAside: true });
});

/* A request, handled - booked through the spa's or laundry's own screen, or
   declined. This marks it; it books nothing (D21-9). */
guestLinks.post("/:code/online-checkin/requests/:id", async (c) => {
  const { status } = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
  if (status !== "done" && status !== "declined") {
    return c.json({ error: "Done, or declined?" }, 400);
  }
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await deskAt(client, c.req.param("code"));
    if (!hotelId) return 403 as const;
    const { rowCount } = await client.query(
      `update guest_requests set status = $3, handled_by = $4, handled_at = now()
        where id = $1 and hotel_id = $2 and status = 'open'`,
      [c.req.param("id"), hotelId, status, session.staffId]);
    return rowCount ? 200 as const : 409 as const;
  });
  if (result === 403) return c.json({ error: DESK_REFUSED }, 403);
  if (result === 409) return c.json({ error: "Already handled." }, 409);
  return c.json({ status });
});

/* MESSAGES TO THE FRONT DESK (D23-14) - guest requests of kind 'desk', read
   on the desk's Guest messages screen: one booking's, handled ones too, or
   (no `reservation`) every booking's still unread. Marked handled through the
   request route above, as `done` - who and when are its columns. */
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

guestLinks.get("/:code/online-checkin/messages", async (c) => {
  const reservation = c.req.query("reservation") ?? null;
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await deskAt(client, c.req.param("code"));
    if (!hotelId) return null;
    if (reservation !== null && !A_UUID.test(reservation)) return { messages: [] };
    const { rows } = await client.query<{
      id: string; what: string; created_at: string; guest: string; reference: string;
      handled_by: string | null; handled_at: string | null;
    }>(
      `select q.id::text, q.what, q.created_at, g.full_name as guest, r.reference,
              s.full_name as handled_by, q.handled_at
         from guest_requests q
         join reservations r on r.id = q.reservation_id
         join guests g       on g.id = r.guest_id
         left join staff s   on s.id = q.handled_by
        where q.hotel_id = $1 and q.kind = 'desk'
          and (q.reservation_id = $2::uuid or ($2::uuid is null and q.status = 'open'))
        order by q.created_at desc
        limit 200`, [hotelId, reservation]);
    return {
      messages: rows.map((m) => ({
        id: m.id, what: m.what, createdAt: m.created_at, guest: m.guest,
        reference: m.reference, handledBy: m.handled_by, handledAt: m.handled_at,
      })),
    };
  });
  if (!body) return c.json({ error: DESK_REFUSED }, 403);
  return c.json(body);
});

/* ROOM CARDS (D21-7, D21-16, D21-62). A card's token is shown ONCE, here, to
   be printed - only its hash is kept - so printing is always making: a new
   card for a room kills that room's old card in the same transaction. The
   sheet does it for every room at once, and the screen says so before it is
   pressed. A card never expires; the desk ends it by printing another. */
async function newCards(client: Db, hotelId: string, staffId: string, roomId: string | null) {
  const { rows: rooms } = await client.query<{ id: string; number: string }>(
    `select id::text, number from rooms
      where hotel_id = $1 and is_active and ($2::uuid is null or id = $2::uuid)
      order by number`, [hotelId, roomId]);
  const cards: { room: string; link: string }[] = [];
  for (const room of rooms) {
    const token = randomBytes(32).toString("base64url");
    await client.query(
      `update guest_links set revoked_at = now(), revoked_by = $2
        where room_id = $1 and revoked_at is null`, [room.id, staffId]);
    await client.query(
      `insert into guest_links (hotel_id, room_id, token_hash, origin, created_by, expires_at)
       values ($1, $2, $3, 'room', $4, 'infinity')`,
      [hotelId, room.id, sha256(token), staffId]);
    cards.push({ room: room.number, link: linkFor(token) });
  }
  return cards;
}

guestLinks.post("/:code/online-checkin/rooms/:roomId/card", async (c) => {
  const cards = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await deskAt(client, c.req.param("code"));
    return hotelId ? newCards(client, hotelId, session.staffId, c.req.param("roomId")) : null;
  });
  if (!cards) return c.json({ error: DESK_REFUSED }, 403);
  if (cards.length === 0) return c.json({ error: "No such room here." }, 404);
  return c.json({ cards });
});

guestLinks.post("/:code/online-checkin/cards", async (c) => {
  const cards = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await deskAt(client, c.req.param("code"));
    return hotelId ? newCards(client, hotelId, session.staffId, null) : null;
  });
  if (!cards) return c.json({ error: DESK_REFUSED }, 403);
  return c.json({ cards });
});

/* Exported for the test that proves a stolen token is not a key to anything
   else: the hash the door computes is the hash the database holds. */
export const hashForTests = sha256;
export const constantTimeEqualForTests = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
