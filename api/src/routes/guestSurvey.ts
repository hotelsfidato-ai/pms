import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import type { Client } from "../db.ts";
import { env } from "../env.ts";
import { ask, openedHere, refused, sha256 } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   THE FEEDBACK SURVEY, ON THE GUEST'S PAGE (D27-383 item 10)

   Behind the code, by online-checkin's rule 8: its own route file, the
   stay only through app.guest_unlocked inside the two definer functions of
   "the feedback survey", tested there with the link's hash and no unlock
   (OCI-5). Offered after check-out, where the hotel has switched it on
   (Settings, Modules, off to start), once a stay.

     GET  /api/guest/:token/survey   {offered, answered}
     POST /api/guest/:token/survey   {overall, room?, cleanliness?, food?, staff?, comment?}

   ⚠ NOT REVIEW GATING. The answer is the same whatever the score: nothing
   here, and nothing after it, asks for a review because a guest was happy
   (Google forbids asking only the happy ones). The review request is the
   desk's, and goes whatever was answered.
   ══════════════════════════════════════════════════════════════════ */

export const surveyDoor = new Hono();

export const SURVEY_REFUSED = {
  off: "This hotel is not asking for feedback on its page.",
  not_yet: "The survey opens once you have checked out.",
  answered: "You have already answered for this stay. Thank you.",
  scores: "Choose a score from 1 to 5 for the stay overall; the others are 1 to 5 or left out.",
  comment: "A comment is 1000 characters at most.",
} as const;

surveyDoor.get("/:token/survey", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const [it] = await ask<{ offered: boolean; answered: boolean }>(
    "select * from app.guest_survey($1, $2)", [door.hash, door.unlock]);
  if (!it) return refused(c);
  return c.json({ offered: it.offered, answered: it.answered });
});

/** 1 to 5, or null when left out; undefined when it is neither. */
const score = (v: unknown): number | null | undefined =>
  v === undefined || v === null ? null
    : Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? (v as number) : undefined;

surveyDoor.post("/:token/survey", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const parts = ["overall", "room", "cleanliness", "food", "staff"].map((k) => score(b[k]));
  if (parts.includes(undefined) || parts[0] === null) return c.json({ error: SURVEY_REFUSED.scores }, 409);
  const comment = typeof b["comment"] === "string" ? b["comment"].trim() : "";
  if (comment.length > 1000) return c.json({ error: SURVEY_REFUSED.comment }, 409);

  const [it] = await ask<{ said: string }>(
    "select app.guest_survey_answer($1, $2, $3, $4, $5, $6, $7, $8) as said",
    [door.hash, door.unlock, ...parts, comment]);
  const said = it?.said;
  if (said === "saved") return c.json({ sent: true });
  if (said === "off" || said === "not_yet" || said === "answered") {
    return c.json({ error: SURVEY_REFUSED[said] }, 409);
  }
  return refused(c);
});

/* ── The survey's link, for the review request (reputation's ask) ──────
   Where the hotel asks for feedback and this stay has not answered, the
   review request carries a fresh link to the guest's own page - made as
   the desk's link is, under the clerk's session, alive until the morning
   after the stay and never less than a day (app.guest_link_expires,
   D18-9). Null when there is nothing to offer: switched off, or answered. */
export async function surveyLinkFor(
  client: Client, hotelId: string, stayId: string, staffId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ check_out: string }>(
    `select r.check_out::text from reservations r
      where r.id = $1 and r.hotel_id = $2 and r.status = 'checked_out'
        and app.module_enabled($2, 'feedback_survey')
        and not exists (select 1 from guest_feedback f where f.reservation_id = r.id)`,
    [stayId, hotelId]);
  if (!rows[0]) return null;
  const token = randomBytes(32).toString("base64url");
  await client.query(
    `insert into guest_links (hotel_id, reservation_id, token_hash, origin, created_by, expires_at)
     values ($1, $2, $3, 'desk', $4, app.guest_link_expires($1, $5::date))`,
    [hotelId, stayId, sha256(token), staffId, rows[0].check_out]);
  return `${env.corsOrigins[0] ?? "http://localhost:5173"}/g/${token}`;
}
