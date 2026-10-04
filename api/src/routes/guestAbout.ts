import { Hono } from "hono";
import { ask, openedHere, refused } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   ABOUT THE HOTEL, ON THE GUEST'S PAGE (D27-249, D27-257, migration 194)

   GET /api/guest/:token/about   behind this phone's unlock (rule 8): the
                                 hotel's highlights (about, attractions,
                                 directions, activities, landmarks), the
                                 amenities it has switched on, and its map
                                 point for an "Open in Maps" link. Never the
                                 policy texts or anything of the stay.
   ══════════════════════════════════════════════════════════════════ */

export const guestAbout = new Hono();

guestAbout.get("/:token/about", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const [it] = await ask<{
    texts: Record<string, string>; amenities: { name: string; icon: string }[];
    latitude: string | null; longitude: string | null;
  }>("select texts, amenities, latitude::text, longitude::text from app.guest_about($1, $2)",
    [door.hash, door.unlock]);
  if (!it) return refused(c);
  return c.json({
    texts: it.texts, amenities: it.amenities,
    map: it.latitude && it.longitude ? { latitude: Number(it.latitude), longitude: Number(it.longitude) } : null,
  });
});
