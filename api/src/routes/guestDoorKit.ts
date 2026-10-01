import type { Context } from "hono";
import { createHash } from "node:crypto";
import { withSession } from "../auth.ts";
import { pool } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST DOOR'S KIT (D27-225, step 0 of the in-stay plan)

   What every route on the guest's door, and every desk route beside it,
   is built from - moved here from guestDoor.ts unchanged, so each feature
   (in-room dining, messages with the desk, table booking, …) keeps its
   routes in its OWN file and adds one mount line to guestDoor.ts.

   ⚠ THE DOOR'S RULES COME WITH THE KIT (online-checkin/MODULE.md):
     · the stay only ever from `app.guest_unlocked`, inside a definer
       function that takes the token's hash AND this phone's unlock's hash -
       never a stay, room, folio or table id from the caller
     · `openedHere` first, on every route behind the code; the database
       function asks again - the door's check is a courtesy, not the guard
     · a refusal answers `refused` (404, NOTHING_HERE): a stranger cannot
       tell it from a link that never existed
     · a database test with the link's hash and no unlock, for every new
       function (OCI-5)
     · NOBODY REPLACES `app.guest_link_open` AGAIN - its return type cannot
       change on a replay, and lanes would wipe each other's columns. Each
       section asks its own function and hides itself when it has nothing.
   ══════════════════════════════════════════════════════════════════ */

export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** One sentence for every refusal: a stranger learns nothing from which one. */
export const NOTHING_HERE = "This link is not usable. Ask the desk for a new one.";

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

export function tooOften(tokenHash: string, kind: "open" | "code" | "photo"): boolean {
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

export interface OpenRow extends Record<string, unknown> {
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
export const unlockOf = (c: Context) => {
  const held = /^Guest\s+(\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  return held ? sha256(held) : null;
};

export const refused = (c: Context) => c.json({ error: NOTHING_HERE }, 404);

/* Opened WITH this phone's unlock: the one check every route behind the code
   makes before it does anything. Each database function behind it asks again
   - this is the door's courtesy, the function is the guard. */
export async function openedHere(
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
export async function ask<T extends Record<string, unknown>>(
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

export const DESK_ROLES: readonly string[] = ["owner", "admin", "gm", "hotel_manager", "front_desk"];
export const DESK_REFUSED = "Online check-in is handled by reception, the manager, an "
  + "administrator or the owner. Ask one of them.";

export type Db = Parameters<Parameters<typeof withSession>[1]>[0];

/* The hotel, if this person holds a desk role there - the same question the
   spa and the other services ask, in the same words. */
export async function deskAt(
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

/** A booking, room or photo id as the desk sends it: a uuid, or nothing is asked. */
export const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
