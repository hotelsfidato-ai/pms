import { Hono, type Context } from "hono";
import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { withSession } from "../auth.ts";
import { pool } from "../db.ts";
import { env } from "../env.ts";
import { canSend, send } from "../sending.ts";
import { idNumberProblem } from "../validate.ts";
import {
  ID_PHOTOS_OFF, MAX_UPLOAD, NOTICE_VERSION, get as getPhotos, idPhotosOn, photosFrom,
  put as putPhotos, remove as removePhotos,
} from "./idPhotos.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN DOOR — one private page per booking (D18-9, D18-10, D18-13)

   GET  /api/guest/:token          what this booking is, and whether the guest
                                   has proved who they are yet
   POST /api/guest/:token/code     send a six-digit code to the phone or the
                                   email THE BOOKING carries - the guest
                                   chooses which, and types neither (D27-207)
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
   · Nobody types a number (D27-105): the code goes to the one the booking
     carries, so there is no number to guess and nothing to give away.
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
/* An ID photo is megabytes, encrypted here and sent on: ten an hour is a
   guest retaking a blurred one, not a stranger filling the hotel's Drive. */
const PHOTOS_AN_HOUR = 10;
const knocks = new Map<string, { at: number; opens: number; codes: number; photos: number; hour: number }>();

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

function tooOften(tokenHash: string, kind: "open" | "code" | "photo"): boolean {
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
      photos: seen && seen.hour === hour ? seen.photos : 0,
      hour,
    });
  }
  const row = knocks.get(tokenHash)!;
  if (kind === "open") {
    row.opens += 1;
    return row.opens > OPENS_A_MINUTE;
  }
  if (kind === "photo") {
    row.photos += 1;
    return row.photos > PHOTOS_AN_HOUR;
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

  /* The booking's email, masked, so the page can offer "a code by email" and
     say where it would go (D27-207). Null on a room card (D21-14) and where
     the booking has none. */
  const ways = await ask<{ email_hint: string | null }>(
    "select * from app.guest_link_ways($1)", [hash]);

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
    emailHint: ways[0]?.email_hint ?? null,
    /* D21-25: the page asks for a code only when one can be sent. This is
       about the SERVER, not the booking - it is the same answer for every
       link, so it tells a stranger nothing about this one. */
    canSendCodes: canSend() || codeOnScreen(),
    cannotSend: canSend() || codeOnScreen() ? null : CANNOT_SEND,
    /* Continue with Google is offered only where the server has its client
       id (D27-207). The id is public - it names this system to Google - and
       the same for every link. */
    googleClientId: googleClientId(),
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
const CANNOT_SEND = "Codes cannot be sent yet - sending is not set up on this "
  + "server. Ask the desk.";

/* ── TRY IT WITHOUT WHATSAPP - DEVELOPMENT ONLY (D27-105) ─────────────
   GUEST_CODE_ON_SCREEN=1 makes the code and hands it back in the answer
   instead of sending it, so the owner and QA can walk the whole page with
   no WhatsApp at all. It works only beside ALLOW_DEV_AUTH=1, which env.ts
   refuses to start with under NODE_ENV=production - so on the live server
   this is false whatever the settings say. The page shows it only in a
   development build, and scripts/check-no-dev-login.mjs fails any build
   that carries it. Everywhere else the rule stands: an answer that carries
   the code is a door with no lock. */
const codeOnScreen = (): boolean =>
  env.allowDevAuth && process.env["GUEST_CODE_ON_SCREEN"] === "1";

/* The answers to "send me the code" (D27-105). The guest types nothing: the
   code goes to the number THE STAY carries, and the page says where - its
   last four digits, or on a room card nothing of the number (D21-14). The
   old rule that a right number and a wrong one must read the same went with
   the typed number: there is nothing left to guess. */
/* The page says NO_PHONE itself on a booking's link with no number
   (GuestPage.tsx) - change one, change both; the door's copy answers a room
   card, which never shows the number. */
const NO_PHONE = "There is no mobile number on this booking, so no code can be "
  + "sent. Ask the desk.";
const NO_EMAIL = "There is no email address on this booking, so no code can be "
  + "sent by email. Ask the desk.";
const TOO_OFTEN = "Five codes have gone to this booking in the last hour. "
  + "Use the latest one, or ask the desk.";
const NOT_SENT = "The code could not be sent just now. Try again in a minute, "
  + "or ask the desk.";

guestDoor.post("/:token/code", async (c) => {
  const hash = sha256(c.req.param("token"));
  const onScreen = codeOnScreen();
  /* WHICH WAY, the guest's choice (D27-207): WhatsApp, or the email on the
     booking. Only the word is read - never a number or an address. */
  const body = await c.req.json<{ by?: string }>().catch(() => ({}) as { by?: string });
  const byEmail = body.by === "email";
  /* Nothing can be sent: say so first. Asked before the knock is counted, so
     a guest reading this sentence has not spent one of their five an hour. */
  if (!canSend() && !onScreen) return c.json({ sent: false, message: CANNOT_SEND }, 503);
  if (tooOften(hash, "code")) return c.json({ sent: false, message: TOO_OFTEN });

  /* ⚠ NOTHING IS ISSUED ABOVE THIS LINE. The call that makes the code used
     to sit before the check, so every knock at a server that could not send
     burned the guest's previous live code (migration 114 keeps one) for an
     attempt nobody ever made. */
  const client = await pool.connect();
  try {
    /* One call: the code, AND what the message needs - the stay, its name and
       the booking's own number (162). None of the number goes into the
       answer; it goes only into the message. */
    const { rows } = await client.query<{
      code: string | null; sent_to: string | null; phone?: string | null; email?: string | null;
      reservation_id: string; reference: string; guest_name: string;
      hotel_id: string; hotel_code: string; hotel_name: string; room_card: boolean;
    }>(byEmail ? "select * from app.guest_email_code_make($1)"
               : "select * from app.guest_code_make($1)", [hash]);
    const made = rows[0];
    if (!made) return c.json({ error: NOTHING_HERE }, 404);
    const address = byEmail ? made.email : made.phone;
    if (!made.code || !address) return c.json({ sent: false, message: byEmail ? NO_EMAIL : NO_PHONE });

    /* Where it went, as the page may say it: on a room card nothing of the
       guest (D21-14); on a booking's link the number's last digits or the
       address masked, never whole. */
    const where = byEmail
      ? (made.room_card ? "to the email on the booking" : `to ${made.sent_to}`)
      : (made.room_card ? "to the phone on the booking"
        : `to the number ending ${made.sent_to!.replace("…", "")}`);
    if (onScreen) {
      return c.json({
        sent: true,
        message: `Development only: nothing was sent. The code would have gone ${where}.`,
        devCode: made.code,
      });
    }

    /* THE CODE LEAVES THROUGH THE ONE DOOR OUT AND NOWHERE ELSE
       (api/src/sending.ts). It is not logged and not returned.

       ⚠ TO THE WHOLE NUMBER (OCI-2). This once passed `sent_to`, the masked
       "…0011" kept for the record, as the recipient - so the first code
       sent once WhatsApp was connected would have reached nobody. */
    const answer = await send(client, {
      channel: byEmail ? "email" : "whatsapp",
      kind: "guest-link-code",
      hotel: { id: made.hotel_id, code: made.hotel_code, name: made.hotel_name },
      to: byEmail ? { name: made.guest_name, email: address }
        : { name: made.guest_name, phone: address },
      /* The email's words are written in the workflow from these (D17-87). */
      data: {
        code: made.code, reference: made.reference,
        guestName: made.guest_name, hotelName: made.hotel_name,
      },
      about: { kind: "reservation", id: made.reservation_id },
    });
    return c.json(answer.ok
      ? { sent: true, message: `We sent the code ${byEmail ? "by email" : "on WhatsApp"} ${where}.` }
      : { sent: false, message: NOT_SENT });
  } finally {
    client.release();
  }
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

/* ── CONTINUE WITH GOOGLE (D27-207) ────────────────────────────────
   The third proof. The page gets a signed answer from Google ("this browser
   is signed in as this address") and posts it here. Nothing of it is
   trusted until it is checked:

     · Google signed it - against Google's own published keys
     · for THIS system - `aud` is our client id (GOOGLE_CLIENT_ID)
     · Google issued it, it has not expired, and it was made in the last
       ten minutes - so an old answer found somewhere is not a key
     · the address is one Google has verified

   and then the DATABASE decides whose booking it is: the address must be the
   one the stay carries (`app.guest_google_answer`, 167). A match hands out
   the same unlock as a right code, and nothing else: no account, no
   session, no guest role (rule 1) - and no Firebase user, so no guest ever
   sits in the project the staff sign in to.

   GOOGLE_CLIENT_ID unset: the button is not offered and this answers what
   an unknown link answers. */
const googleClientId = (): string | null => process.env["GOOGLE_CLIENT_ID"]?.trim() || null;
const google = new OAuth2Client();
const GOOGLE_ANSWER_LIVES_S = 10 * 60;
const NOT_THIS_GOOGLE = "That Google account is not the one on this booking. "
  + "Use the email the booking was made with, or ask for a code.";

/** The address Google vouches for, or null for anything that fails a check.
    Which check failed is not said: the answer is the same sentence. */
async function emailGoogleVouchesFor(credential: string, clientId: string): Promise<string | null> {
  try {
    const ticket = await google.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    if (!p || p.email_verified !== true || typeof p.email !== "string") return null;
    if (Date.now() / 1000 - p.iat > GOOGLE_ANSWER_LIVES_S) return null;
    return p.email;
  } catch {
    return null;
  }
}

guestDoor.post("/:token/google", async (c) => {
  const hash = sha256(c.req.param("token"));
  const clientId = googleClientId();
  if (!clientId) return refused(c);
  if (tooOften(hash, "open")) return c.json({ error: NOTHING_HERE }, 429);

  const body = await c.req.json<{ credential?: unknown }>().catch(() => ({}) as { credential?: unknown });
  const email = typeof body.credential === "string" && body.credential.length <= 4096
    ? await emailGoogleVouchesFor(body.credential, clientId) : null;

  /* The unlock, as `verify` makes it: only its hash reaches the database,
     in the same statement that accepts the address. */
  const unlock = randomBytes(32).toString("base64url");
  const rows = email === null ? [] : await ask<{ ok: boolean }>(
    "select app.guest_google_answer($1, $2, $3) as ok", [hash, email, sha256(unlock)]);

  if (!rows[0]?.ok) return c.json({ verified: false, error: NOT_THIS_GOOGLE }, 401);
  return c.json({ verified: true, unlock });
});

/* ── Behind the code ───────────────────────────────────────────────
   Every route here starts with `openedHere` (the link AND this phone's
   unlock), and every database function it calls asks `app.guest_unlocked`
   again. Refused, each one answers exactly what an unknown link answers:
   the same 404 and the same sentence, so a stranger cannot learn from these
   either whether the link is real (property 5). */

const ID_TYPES = ["aadhaar", "passport", "driving_licence", "voter", "other"];
/* What a guest may type, and how long (D21-19, D27-169). The Form III ones
   are 147's: the person and the visit, not the remarks or the next
   destination, which stay with the desk. */
const TEXTS = [
  ["visaNumber", 40], ["addressLine", 300], ["city", 80], ["country", 80],
  ["specialRequests", 500], ["nationality", 60],
  ["passportIssuePlace", 80], ["passportIssueCountry", 80], ["visaType", 40],
  ["visaIssuePlace", 80], ["visaIssueCountry", 80], ["arrivedFrom", 200],
  ["previousStay", 200], ["purposeOther", 200], ["arrivalPort", 80],
  ["phoneInIndia", 20], ["mobileInIndia", 20], ["phoneAbroad", 20], ["mobileAbroad", 20],
  ["refAddress", 300], ["refCity", 80], ["refState", 80], ["refPincode", 10],
] as const;
const DATES = ["passportExpiry", "visaExpiry", "dateOfBirth", "passportIssuedOn",
  "visaIssuedOn", "arrivedInIndiaOn"] as const;
const GENDERS = ["female", "male", "transgender"];
const PURPOSES = ["tourism", "business", "employment", "medical", "student", "conference", "others"];
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
  for (const [k, max] of TEXTS) {
    if (b[k] !== undefined && b[k] !== null && !text(b[k], max)) {
      return c.json({ error: "Something typed is too long." }, 400);
    }
  }
  /* D27-169: the arrival time, and Form III's own lists (147). */
  if (!DATES.every((k) => isDate(b[k]))) {
    return c.json({ error: "A date is not a date - check the dates." }, 400);
  }
  if (b.expectedArrival && !(typeof b.expectedArrival === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.expectedArrival))) {
    return c.json({ error: "The arrival time is hours and minutes, like 14:30." }, 400);
  }
  if (b.gender && !GENDERS.includes(b.gender as string)) return c.json({ error: "Choose one of the listed genders." }, 400);
  if (b.purpose && !PURPOSES.includes(b.purpose as string)) return c.json({ error: "Choose one of the listed purposes." }, 400);
  if (b.employedInIndia !== undefined && b.employedInIndia !== null && typeof b.employedInIndia !== "boolean") {
    return c.json({ error: "Employed in India is yes or no." }, 400);
  }

  const rows = await ask<{ ok: boolean }>(
    "select app.guest_details_submit($1, $2, $3::jsonb) as ok",
    [door.hash, door.unlock, JSON.stringify({
      ...Object.fromEntries([...TEXTS.map(([k]) => k), ...DATES, "idType", "idNumber",
        "expectedArrival", "gender", "purpose", "employedInIndia"].map((k) => [k, b[k] ?? null])),
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

/* ── THE ID PHOTO (D27-207 to D27-212) ─────────────────────────────
   Optional, after the details are sent: a photo of the front of a
   government photo ID, and the back if it has one. It is a SUBMISSION like
   the details (D21-8) - the desk sees it beside them and checks the real
   ID - and it is never on this server: idPhotos.ts encrypts it with the
   hotel's own password and stores it in Drive.

   ⚠ THE GUEST WRITES, AND NEVER READS. There is no route on this door that
   hands a photo back: not the image, not its name, not where it is. The
   guest is told only that it is there and since when, or that the desk
   removed it and why.

   THE ORDER OF THE CHECKS: the link, the knocks, this phone's unlock -
   and only then is a single byte of the body read. A stranger cannot make
   this server take in megabytes. */
const PHOTO_NOT_OFFERED = "This hotel is not taking ID photos online. Show your ID at the desk.";
const PHOTO_TOO_OFTEN = "Ten photos have been sent from this link in the last hour. "
  + "Try again later, or show your ID at the desk.";
const PHOTO_TOO_BIG = "Those photos are too large to send. Take them again, or show your ID at the desk.";
const PHOTO_NOT_NOW = "Send your check-in details first. If the desk has already "
  + "checked them, show your ID at the desk.";
const PHOTO_NOT_STORED = "The photo could not be stored just now, and nothing was kept. "
  + "Try again shortly, or show your ID at the desk.";

/** What the desk's reason reads as on the guest's own page. */
const REMOVED_SAYS: Readonly<Record<string, string>> = {
  not_masked: "The front desk removed your photo because the Aadhaar number was not covered. "
    + "Send it again with the first 8 digits hidden.",
  not_readable: "The front desk could not read your photo. Send a clearer one.",
  not_an_id: "The photo was not a government photo ID. Send one, or show your ID at the desk.",
};
const REMOVED_OTHERWISE = "The hotel removed your ID photo.";

guestDoor.get("/:token/id-photo", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const rows = await ask<{
    status: string | null; sides: string[] | null; stored_at: string | null;
    removed_reason: string | null; may_send: boolean; hotel_phone: string | null;
  }>("select * from app.guest_id_photo_state($1, $2)", [door.hash, door.unlock]);
  const it = rows[0];
  if (!it) return refused(c);
  return c.json({
    /* Whether this hotel takes them at all: its password and the store. */
    offered: idPhotosOn(door.it.hotel_code),
    maySend: it.may_send,
    notice: NOTICE_VERSION,
    /* The hotel's own number, for the notice's "to have it deleted, contact". */
    contact: it.hotel_phone,
    sent: it.status === "stored" ? { sides: it.sides, at: it.stored_at } : null,
    removed: it.status === "removed"
      ? REMOVED_SAYS[it.removed_reason ?? ""] ?? REMOVED_OTHERWISE : null,
  });
});

guestDoor.post("/:token/id-photo", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  /* From here the caller is behind the code, so a plain sentence is safe. */
  const code = door.it.hotel_code;
  if (!idPhotosOn(code)) return c.json({ error: PHOTO_NOT_OFFERED }, 409);
  if (tooOften(door.hash, "photo")) return c.json({ error: PHOTO_TOO_OFTEN }, 429);

  /* The length the browser declares is the length Node will read, and no
     more: checked before the body is touched. */
  const length = Number(c.req.header("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_UPLOAD) {
    return c.json({ error: PHOTO_TOO_BIG }, 413);
  }
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "Send the photo as a form upload." }, 400);
  /* The consent the notice asks for (DPDP): no tick, no photo. */
  if (form.get("agreed") !== "yes") {
    return c.json({ error: "Tick the box to agree before sending the photo." }, 400);
  }
  const photos = await photosFrom(form);
  if (typeof photos === "string") return c.json({ error: photos }, 400);

  /* The row first (167), so a file that reaches Drive always has one. */
  const begun = await ask<{
    id: string; hotel_code: string; reference: string; guest_name: string;
  }>("select * from app.guest_id_photo_begin($1, $2, $3::text[], $4)",
    [door.hash, door.unlock, photos.map((p) => p.side), NOTICE_VERSION]);
  const row = begun[0];
  if (!row) return c.json({ error: PHOTO_NOT_NOW }, 409);

  const stored = await putPhotos({
    id: row.id, hotelCode: row.hotel_code, reference: row.reference,
    guestName: row.guest_name, by: "the guest",
  }, photos);
  if (!stored) {
    await ask("select app.guest_id_photo_abandon($1, $2, $3)", [door.hash, door.unlock, row.id]);
    return c.json({ error: PHOTO_NOT_STORED }, 503);
  }

  const done = await ask<{ done: { replaced: { id: string; driveFileId: string }[] } | null }>(
    "select app.guest_id_photo_stored($1, $2, $3, $4, $5, $6) as done",
    [door.hash, door.unlock, row.id, stored.driveFileId, stored.sha256, stored.bytes]);
  if (!done[0]?.done) {
    /* The unlock ended while Drive was answering: take the file back. */
    await removePhotos(row.hotel_code, stored.driveFileId);
    await ask("select app.guest_id_photo_abandon($1, $2, $3)", [door.hash, door.unlock, row.id]);
    return refused(c);
  }

  /* A REPLACED PHOTO GOES AT ONCE - an unmasked Aadhaar replaced by a masked
     one must not stay in Drive. If Drive will not delete it now, that is
     written down for a manager. */
  for (const old of done[0].done.replaced) {
    if (!(await removePhotos(row.hotel_code, old.driveFileId))) {
      await ask("select app.guest_id_photo_delete_failed($1, $2, $3)", [door.hash, door.unlock, old.id]);
    }
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
async function deskAt(
  client: Db, code: string, roles: readonly string[] = DESK_ROLES,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string; may: boolean }>(
    `select h.id::text,
            exists (select 1 from staff s
                     where s.id = app.current_user_id() and s.is_active and s.is_group_admin)
         or exists (select 1 from staff_hotels sh join staff s on s.id = sh.staff_id
                     where sh.staff_id = app.current_user_id() and sh.hotel_id = h.id
                       and s.is_active and sh.role = any($2::text[])) as may
       from hotels h where h.code = $1`,
    [code.toUpperCase(), roles]);
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
      submitted_at: string; more: Record<string, string | boolean | null>;
      photo_id: string | null; photo_sides: string[] | null; photo_at: string | null;
    }>(
      `select d.id::text, g.full_name as guest, r.reference, d.id_type, d.id_number,
              d.passport_expiry::text, d.visa_number, d.visa_expiry::text,
              d.address_line, d.city, d.country, d.submitted_at,
              -- The ID photo sent with them, if any: that it is there, never
              -- where. The image is fetched only when a clerk opens it.
              p.id::text as photo_id, p.sides as photo_sides, p.stored_at as photo_at,
              -- D27-169: what else the guest sent, for the clerk to check.
              -- Only what was filled in; the screen names each one.
              jsonb_strip_nulls(jsonb_build_object(
                'expectedArrival', to_char(d.expected_arrival, 'HH24:MI'),
                'specialRequests', d.special_requests, 'nationality', d.nationality,
                'gender', d.gender, 'dateOfBirth', d.date_of_birth,
                'passportIssuedOn', d.passport_issued_on, 'passportIssuePlace', d.passport_issue_place,
                'passportIssueCountry', d.passport_issue_country, 'visaType', d.visa_type,
                'visaIssuedOn', d.visa_issued_on, 'visaIssuePlace', d.visa_issue_place,
                'visaIssueCountry', d.visa_issue_country, 'arrivedFrom', d.arrived_from,
                'previousStay', d.previous_stay, 'purpose', d.purpose, 'purposeOther', d.purpose_other,
                'arrivedInIndiaOn', d.arrived_in_india_on, 'arrivalPort', d.arrival_port,
                'phoneInIndia', d.phone_in_india, 'mobileInIndia', d.mobile_in_india,
                'phoneAbroad', d.phone_abroad, 'mobileAbroad', d.mobile_abroad,
                'employedInIndia', d.employed_in_india, 'refAddress', d.ref_address,
                'refCity', d.ref_city, 'refState', d.ref_state, 'refPincode', d.ref_pincode
              )) as more
         from guest_detail_submissions d
         join reservations r on r.id = d.reservation_id
         join guests g       on g.id = d.guest_id
         left join lateral (
           select x.id, x.sides, x.stored_at from guest_id_photos x
            where x.reservation_id = d.reservation_id and x.guest_id = d.guest_id
              and x.status = 'stored'
            order by x.created_at desc limit 1) p on true
        where d.hotel_id = $1 and d.status = 'waiting'
        order by d.submitted_at`, [hotelId]);
    const keeps = (await deskAt(client, c.req.param("code"), KEEPER_ROLES)) !== null;

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
        country: d.country, submittedAt: d.submitted_at, more: d.more,
        photo: d.photo_id ? { id: d.photo_id, sides: d.photo_sides, at: d.photo_at } : null,
      })),
      requests: requests.map((q) => ({
        id: q.id, kind: q.kind, what: q.what, wanted: q.wanted,
        createdAt: q.created_at, guest: q.guest, reference: q.reference,
      })),
      rooms: rooms.map((r) => ({ id: r.id, number: r.number, cardSince: r.card_since })),
      /* Whether this hotel's ID photos can be kept at all, and the sentence
         when not; and whether this person is one of those who see the kept
         ones (owner, Admin, GM). */
      idPhotos: {
        on: idPhotosOn(c.req.param("code")),
        off: idPhotosOn(c.req.param("code")) ? null : ID_PHOTOS_OFF,
        keeper: keeps,
      },
    };
  });
  if (!body) return c.json({ error: DESK_REFUSED }, 403);
  return c.json(body);
});

/* ── THE ID PHOTO, AT THE DESK (D27-210) ───────────────────────────
   WHO SEES ONE, and it is decided here on every call:

     while its details WAIT      every desk role - the clerk confirming them
                                 looks at it beside the typed details, and
                                 removes one that is not masked, not
                                 readable or not an ID
     once it is KEPT             (confirmed, set aside, or added at the desk)
                                 the owner, an administrator and the GM
                                 only; they alone delete it, with a reason

   EVERY VIEW IS WRITTEN DOWN, before the image is fetched. The image comes
   from Drive, is checked against its hash and decrypted in memory
   (idPhotos.ts), and goes out with `no-store`: nothing of it is kept here
   or in the browser's cache. */
const KEEPER_ROLES: readonly string[] = ["owner", "admin", "gm"];
const KEEPER_REFUSED = "A kept ID photo is seen and deleted by the owner, an "
  + "administrator or the general manager. Ask one of them.";
const PHOTO_REFUSED = "An ID photo is for reception while its details wait to be "
  + "checked, and afterwards for the owner, an administrator or the general manager.";
const NO_PHOTO = "No such photo here.";
const DESK_REASONS: readonly string[] = ["not_masked", "not_readable", "not_an_id"];

type PhotoRow = {
  id: string; hotel_code: string; status: string; drive_file_id: string | null;
  cipher_sha256: string | null; waiting: boolean; delete_failed: boolean;
};

/** The row, and whether this person may act on it: 200 with the row, or
    the status to answer. Under the clerk's own session, so another hotel's
    photo is simply not there. */
async function photoFor(client: Db, code: string, id: string): Promise<PhotoRow | 403 | 404> {
  if (!A_UUID.test(id)) return 404;
  const hotelId = await deskAt(client, code);
  if (!hotelId) return 403;
  const { rows } = await client.query<PhotoRow>(
    `select p.id::text, p.hotel_code, p.status, p.drive_file_id, p.cipher_sha256,
            coalesce(d.status = 'waiting', false) as waiting,
            p.drive_delete_failed_at is not null as delete_failed
       from guest_id_photos p
       left join guest_detail_submissions d on d.id = p.submission_id
      where p.id = $1 and p.hotel_id = $2 and p.status <> 'pending'`, [id, hotelId]);
  const row = rows[0];
  if (!row) return 404;
  if (!(row.status === "stored" && row.waiting) && !(await deskAt(client, code, KEEPER_ROLES))) return 403;
  return row;
}

guestLinks.get("/:code/online-checkin/id-photos", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await deskAt(client, c.req.param("code"), KEEPER_ROLES);
    if (!hotelId) return null;
    const { rows } = await client.query<{
      id: string; guest: string; reference: string; sides: string[]; stored_at: string;
      by: string | null; status: string; removed_reason: string | null;
    }>(
      `select p.id::text, g.full_name as guest, r.reference, p.sides, p.stored_at,
              s.full_name as by, p.status, p.removed_reason
         from guest_id_photos p
         join reservations r on r.id = p.reservation_id
         join guests g       on g.id = p.guest_id
         left join staff s   on s.id = p.uploaded_by
         left join guest_detail_submissions d on d.id = p.submission_id
        where p.hotel_id = $1
          and ((p.status = 'stored' and coalesce(d.status <> 'waiting', true))
            or (p.status = 'removed' and p.drive_delete_failed_at is not null))
        order by p.stored_at desc
        limit 200`, [hotelId]);
    return {
      photos: rows.map((p) => ({
        id: p.id, guest: p.guest, reference: p.reference, sides: p.sides, at: p.stored_at,
        /* Null: the guest sent it from their own page. */
        addedBy: p.by,
        /* Removed, but Drive has not deleted its file yet: "Try again". */
        notYetDeleted: p.status === "removed",
      })),
    };
  });
  if (!body) return c.json({ error: KEEPER_REFUSED }, 403);
  return c.json(body);
});

guestLinks.get("/:code/online-checkin/id-photos/:id", async (c) => {
  const found = await withSession(c.get("subject"), async (client, session) => {
    const row = await photoFor(client, c.req.param("code"), c.req.param("id"));
    if (typeof row === "number") return row;
    if (row.status !== "stored") return 404 as const;
    await client.query(
      `insert into guest_id_photo_views (hotel_id, photo_id, viewed_by)
       select hotel_id, id, $2 from guest_id_photos where id = $1`, [row.id, session.staffId]);
    return row;
  });
  if (found === 403) return c.json({ error: PHOTO_REFUSED }, 403);
  if (found === 404) return c.json({ error: NO_PHOTO }, 404);

  const photos = await getPhotos({
    hotelCode: found.hotel_code, driveFileId: found.drive_file_id!, sha256: found.cipher_sha256!,
  });
  c.header("Cache-Control", "no-store");
  if (photos === "unreachable") {
    return c.json({ error: "The photo cannot be fetched right now. The typed details are "
      + "still here; try the photo again in a few minutes." }, 503);
  }
  if (photos === "unreadable") {
    return c.json({ error: "The photo could not be opened: it is not what was stored, or "
      + "this hotel's password has changed since. Tell the owner." }, 409);
  }
  return c.json({
    photos: photos.map((p) => ({
      side: p.side, image: `data:${p.type};base64,${p.bytes.toString("base64")}`,
    })),
  });
});

/* REMOVED BY A PERSON, WITH A REASON. The row is marked first - so the
   photo is gone from every screen whatever Drive does - and then the Drive
   file is deleted; if Drive will not, that is written on the row and a
   keeper sees "not yet deleted" with Try again, which is this same call. */
guestLinks.post("/:code/online-checkin/id-photos/:id/remove", async (c) => {
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const typed = (reason ?? "").trim();
  const result = await withSession(c.get("subject"), async (client, session) => {
    const row = await photoFor(client, c.req.param("code"), c.req.param("id"));
    if (typeof row === "number") return row;
    if (row.status === "stored") {
      /* While the details wait, one of the desk's three reasons; a kept
         photo is deleted with the keeper's own words. */
      const why = row.waiting ? (DESK_REASONS.includes(typed) ? typed : null)
        : (typed.length >= 3 && typed.length <= 200 ? `deleted: ${typed}` : null);
      if (!why) return 400 as const;
      await client.query(
        `update guest_id_photos
            set status = 'removed', removed_at = now(), removed_by = $2, removed_reason = $3
          where id = $1 and status = 'stored'`, [row.id, session.staffId, why]);
    } else if (!row.delete_failed) {
      return 404 as const;
    }
    return row;
  });
  if (result === 403) return c.json({ error: PHOTO_REFUSED }, 403);
  if (result === 404) return c.json({ error: NO_PHOTO }, 404);
  if (result === 400) return c.json({ error: "Say why it is being removed." }, 400);

  const deleted = await removePhotos(result.hotel_code, result.drive_file_id!);
  await withSession(c.get("subject"), (client) => client.query(
    "update guest_id_photos set drive_delete_failed_at = $2 where id = $1",
    [result.id, deleted ? null : new Date()]));
  return c.json({ removed: true, deletedFromDrive: deleted });
});

/* THE DESK ADDS ONE AT CHECK-IN (D27-210), for a guest who did not send it
   online - so there is a copy for every guest. The clerk has the real ID in
   hand and photographs it; the guest's yes is the clerk's tick, recorded
   with the clerk's name. The same checks and the same `put` as the guest's
   own, and the photo is KEPT from that moment: the desk does not fetch it
   back (the screen showed it from the device before it was sent). */
guestLinks.post("/:code/stays/:id/id-photo", async (c) => {
  const code = c.req.param("code");
  const stayId = c.req.param("id");
  if (!A_UUID.test(stayId)) return c.json({ error: "No such booking." }, 404);

  /* Who, and which booking, before a byte of the body is read. */
  const who = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await deskAt(client, code);
    if (!hotelId) return null;
    const { rows } = await client.query<{
      guest_id: string; reference: string; guest: string; hotel_code: string;
    }>(
      `select r.guest_id::text, r.reference, g.full_name as guest, h.code as hotel_code
         from reservations r
         join guests g on g.id = r.guest_id
         join hotels h on h.id = r.hotel_id
        where r.id = $1 and r.hotel_id = $2`, [stayId, hotelId]);
    return { hotelId, stay: rows[0] ?? null, staffId: session.staffId, clerk: session.fullName };
  });
  if (!who) return c.json({ error: DESK_REFUSED }, 403);
  if (!who.stay) return c.json({ error: "No such booking." }, 404);
  if (!idPhotosOn(code)) return c.json({ error: ID_PHOTOS_OFF }, 409);

  const length = Number(c.req.header("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_UPLOAD) {
    return c.json({ error: "Those photos are too large. Take them again." }, 413);
  }
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "Send the photo as a form upload." }, 400);
  if (form.get("agreed") !== "yes") {
    return c.json({ error: "Tick that the guest agreed to the hotel keeping this photo." }, 400);
  }
  const photos = await photosFrom(form);
  if (typeof photos === "string") return c.json({ error: photos }, 400);

  const id = await withSession(c.get("subject"), async (client) => (await client.query<{ id: string }>(
    `insert into guest_id_photos
       (hotel_id, hotel_code, reservation_id, guest_id, uploaded_by, sides, notice_version)
     values ($1, $2, $3, $4, $5, $6::text[], $7)
     returning id::text`,
    [who.hotelId, who.stay!.hotel_code, stayId, who.stay!.guest_id, who.staffId,
     photos.map((p) => p.side), NOTICE_VERSION])).rows[0]!.id);

  const stored = await putPhotos({
    id, hotelCode: who.stay.hotel_code, reference: who.stay.reference,
    guestName: who.stay.guest, by: `${who.clerk}, at the desk`,
  }, photos);
  if (!stored) {
    await withSession(c.get("subject"), (client) => client.query(
      "delete from guest_id_photos where id = $1 and status = 'pending'", [id]));
    return c.json({ error: "The photo could not be stored just now, and nothing was kept. "
      + "Try again shortly." }, 503);
  }

  /* Stored; and the photo before it for this guest and stay, if there was
     one, goes at once - the same rule as a guest's own replacement. */
  const replaced = await withSession(c.get("subject"), async (client, session) => {
    await client.query(
      `update guest_id_photos
          set status = 'stored', stored_at = now(), drive_file_id = $2,
              cipher_sha256 = $3, cipher_bytes = $4
        where id = $1 and status = 'pending'`, [id, stored.driveFileId, stored.sha256, stored.bytes]);
    return (await client.query<{ id: string; drive_file_id: string }>(
      `update guest_id_photos
          set status = 'removed', removed_at = now(), removed_by = $4, removed_reason = 'replaced'
        where reservation_id = $1 and guest_id = $2 and status = 'stored' and id <> $3
        returning id::text, drive_file_id`, [stayId, who.stay!.guest_id, id, session.staffId])).rows;
  });
  for (const old of replaced) {
    if (!(await removePhotos(who.stay.hotel_code, old.drive_file_id))) {
      await withSession(c.get("subject"), (client) => client.query(
        "update guest_id_photos set drive_delete_failed_at = now() where id = $1", [old.id]));
    }
  }
  return c.json({ added: true });
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
          visa_expiry, address_line, city, country,
          gender, date_of_birth, passport_issued_on, passport_issue_place,
          passport_issue_country, visa_type, visa_issued_on, visa_issue_place,
          visa_issue_country, captured_by, captured_at)
       select guest_id, id_type, id_number, passport_expiry, visa_number,
              visa_expiry, address_line, city, country,
              gender, date_of_birth, passport_issued_on, passport_issue_place,
              passport_issue_country, visa_type, visa_issued_on, visa_issue_place,
              visa_issue_country, app.current_user_id(), now()
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
         gender          = coalesce(excluded.gender, guest_documents.gender),
         date_of_birth   = coalesce(excluded.date_of_birth, guest_documents.date_of_birth),
         passport_issued_on     = coalesce(excluded.passport_issued_on, guest_documents.passport_issued_on),
         passport_issue_place   = coalesce(excluded.passport_issue_place, guest_documents.passport_issue_place),
         passport_issue_country = coalesce(excluded.passport_issue_country, guest_documents.passport_issue_country),
         visa_type          = coalesce(excluded.visa_type, guest_documents.visa_type),
         visa_issued_on     = coalesce(excluded.visa_issued_on, guest_documents.visa_issued_on),
         visa_issue_place   = coalesce(excluded.visa_issue_place, guest_documents.visa_issue_place),
         visa_issue_country = coalesce(excluded.visa_issue_country, guest_documents.visa_issue_country),
         captured_by     = excluded.captured_by,
         captured_at     = excluded.captured_at
       returning guest_id`, [c.req.param("id"), hotelId]);
    if (rows.length === 0) return 409 as const;

    /* D27-169: the rest of what the guest sent goes where the desk keeps it,
       in the same transaction, under the same clerk - the nationality on the
       guest, the arrival time and their requests on the booking ("Guest asked
       online: …", added to the notes, never over them), and a foreign
       guest's visit on its Form III record (147). A field left blank changes
       nothing already there. */
    await client.query(
      `update guests g set nationality = coalesce(d.nationality, g.nationality)
         from guest_detail_submissions d where d.id = $1 and g.id = d.guest_id`,
      [c.req.param("id")]);
    await client.query(
      `update reservations r
          set expected_arrival = coalesce(d.expected_arrival, r.expected_arrival),
              notes = case when d.special_requests is null then r.notes
                           else concat_ws(E'\\n', nullif(r.notes, ''),
                                          'Guest asked online: ' || d.special_requests) end
         from guest_detail_submissions d where d.id = $1 and r.id = d.reservation_id`,
      [c.req.param("id")]);
    await client.query(
      `insert into form_iii_stays
         (hotel_id, reservation_id, arrived_from, previous_stay, purpose, purpose_other,
          arrived_in_india_on, arrival_port, phone_in_india, mobile_in_india,
          phone_abroad, mobile_abroad, employed_in_india,
          ref_address, ref_city, ref_state, ref_pincode, updated_by)
       select hotel_id, reservation_id, arrived_from, previous_stay, purpose, purpose_other,
              arrived_in_india_on, arrival_port, phone_in_india, mobile_in_india,
              phone_abroad, mobile_abroad, employed_in_india,
              ref_address, ref_city, ref_state, ref_pincode, app.current_user_id()
         from guest_detail_submissions
        where id = $1
          and coalesce(arrived_from, previous_stay, purpose, purpose_other,
                       arrived_in_india_on::text, arrival_port, phone_in_india,
                       mobile_in_india, phone_abroad, mobile_abroad,
                       employed_in_india::text, ref_address, ref_city, ref_state,
                       ref_pincode) is not null
       on conflict (reservation_id) do update set
         arrived_from        = coalesce(excluded.arrived_from, form_iii_stays.arrived_from),
         previous_stay       = coalesce(excluded.previous_stay, form_iii_stays.previous_stay),
         purpose             = coalesce(excluded.purpose, form_iii_stays.purpose),
         purpose_other       = coalesce(excluded.purpose_other, form_iii_stays.purpose_other),
         arrived_in_india_on = coalesce(excluded.arrived_in_india_on, form_iii_stays.arrived_in_india_on),
         arrival_port        = coalesce(excluded.arrival_port, form_iii_stays.arrival_port),
         phone_in_india      = coalesce(excluded.phone_in_india, form_iii_stays.phone_in_india),
         mobile_in_india     = coalesce(excluded.mobile_in_india, form_iii_stays.mobile_in_india),
         phone_abroad        = coalesce(excluded.phone_abroad, form_iii_stays.phone_abroad),
         mobile_abroad       = coalesce(excluded.mobile_abroad, form_iii_stays.mobile_abroad),
         employed_in_india   = coalesce(excluded.employed_in_india, form_iii_stays.employed_in_india),
         ref_address         = coalesce(excluded.ref_address, form_iii_stays.ref_address),
         ref_city            = coalesce(excluded.ref_city, form_iii_stays.ref_city),
         ref_state           = coalesce(excluded.ref_state, form_iii_stays.ref_state),
         ref_pincode         = coalesce(excluded.ref_pincode, form_iii_stays.ref_pincode),
         updated_by          = excluded.updated_by`,
      [c.req.param("id")]);

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
