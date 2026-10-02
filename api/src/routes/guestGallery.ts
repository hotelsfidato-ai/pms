import { Hono } from "hono";
import { A_UUID, ask, openedHere, refused, sha256, tooOften } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S PHOTOS ON THE GUEST'S PAGE (D27-243, D27-244, migration 186)

   GET  /api/guest/:token/gallery       the list, behind this phone's unlock
                                         (rule 8): id, caption, size, in order
   GET  /api/guest/:token/gallery/:id   one picture, on the link alone, as
                                         the logo is: an <img> cannot carry
                                         the unlock, and the pictures are the
                                         hotel's, public to whoever holds a
                                         link - never a guest's

   Each picture is cached a day (`private`: the address carries the link), its
   tag its own hash, and counted in the door's own bucket for pictures, so a
   gallery of twenty does not use up the page's opens. In front of it,
   deploy/nginx.conf gives these addresses their own zone (a release step).
   ══════════════════════════════════════════════════════════════════ */

export const guestGallery = new Hono();

guestGallery.get("/:token/gallery", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const photos = await ask<{ id: string; caption: string | null; width: number; height: number }>(
    "select id::text, caption, width, height from app.guest_gallery($1, $2)", [door.hash, door.unlock]);
  return c.json({ photos });
});

guestGallery.get("/:token/gallery/:id", async (c) => {
  const hash = sha256(c.req.param("token"));
  if (tooOften(hash, "picture") || !A_UUID.test(c.req.param("id"))) return refused(c);
  const [it] = await ask<{ photo: Buffer; tag: string }>(
    "select photo, tag from app.guest_gallery_photo($1, $2::uuid)", [hash, c.req.param("id")]);
  if (!it) return refused(c);
  const tag = `"${it.tag}"`;
  const headers = {
    "cache-control": "private, max-age=86400",
    etag: tag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  if (c.req.header("if-none-match") === tag) return c.body(null, 304, headers);
  return c.body(new Uint8Array(it.photo), 200, { ...headers, "content-type": "image/jpeg" });
});
