import { Hono } from "hono";
import { ask, openedHere, refused } from "./guestDoorKit.ts";
import { cleanPreferences } from "../modules/guests/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN PREFERENCES, ON THEIR PAGE (D27-383 item 10)

   Behind the code, by online-checkin's rule 8: its own route file, the
   guest only through app.guest_unlocked inside the two definer functions
   of "a guest's preferences", tested there with the link's hash and no
   unlock (OCI-5). Only the stay's own guest's record, never anybody
   else's: the page shows only their own.

     GET /api/guest/:token/preferences   {preferences, smokingOffered}
     PUT /api/guest/:token/preferences   {preferences}
   ══════════════════════════════════════════════════════════════════ */

export const preferencesDoor = new Hono();

preferencesDoor.get("/:token/preferences", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const [it] = await ask<{ preferences: Record<string, unknown>; smoking_offered: boolean }>(
    "select * from app.guest_preferences($1, $2)", [door.hash, door.unlock]);
  if (!it) return refused(c);
  return c.json({ preferences: it.preferences, smokingOffered: it.smoking_offered });
});

preferencesDoor.put("/:token/preferences", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const b = await c.req.json<{ preferences?: unknown }>().catch(() => ({}) as { preferences?: unknown });
  const clean = cleanPreferences(b.preferences);
  if (!clean.ok) return c.json({ error: clean.reason }, 409);
  const [it] = await ask<{ ok: boolean }>(
    "select app.guest_preferences_save($1, $2, $3::jsonb) as ok",
    [door.hash, door.unlock, JSON.stringify(clean.value)]);
  if (!it?.ok) return refused(c);
  return c.json({ saved: true });
});
