import { Hono } from "hono";
import { ask, openedHere, refused } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   A WAKE-UP CALL, ASKED FOR FROM THE GUEST'S PAGE (D27-241)

   Behind the code, by online-checkin's rule 8: its own route file, the
   stay only through app.guest_unlocked inside the two definer functions of
   "wake-up calls and lost property" (183), tested there with the link's
   hash and no unlock (OCI-5). What the guest asks for waits for the desk
   to confirm (guest-services' Wake-up calls screen).

     GET  /api/guest/:token/wake-up   {calls: [{callAt, status}]}
     POST /api/guest/:token/wake-up   {day: "YYYY-MM-DD", time: "HH:MM"}
   ══════════════════════════════════════════════════════════════════ */

export const wakeUpDoor = new Hono();

const NOT_THEN = "That time cannot be asked for here: choose a time during your stay, "
  + "later than now. Or ask the desk.";

wakeUpDoor.get("/:token/wake-up", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const rows = await ask<{ call_at: string; status: string }>(
    "select * from app.guest_wake_ups_mine($1, $2)", [door.hash, door.unlock]);
  return c.json({ calls: rows.map((r) => ({ callAt: r.call_at, status: r.status })) });
});

wakeUpDoor.post("/:token/wake-up", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const b = await c.req.json<{ day?: string; time?: string }>()
    .catch(() => ({}) as { day?: string; time?: string });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day ?? "")) return c.json({ error: NOT_THEN }, 409);
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_wake_up_ask($1, $2, $3::date, $4) as ok", [door.hash, door.unlock, b.day, b.time ?? ""]);
  if (!rows[0]?.ok) return c.json({ error: NOT_THEN }, 409);
  return c.json({ sent: true });
});
