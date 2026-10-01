import { Hono } from "hono";
import { ask, refused, sha256, tooOften } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S LOGO ON THE GUEST'S PAGE (D27-223, migration 174)

   GET /api/guest/:token/logo
        the link's hotel's own logo, else the group's (D27-214) - the
        picture and nothing else, drawn by the page as an <img>. It is the
        hotel's, not the stay's, so it needs no unlock: the page shows the
        hotel's name before the code already. A link that does not open,
        knocks too often, or a group with no logo at all: the door's one
        sentence (rule 5).

   CACHED PER HOTEL: the tag is the picture's own hash, the same for every
   link to that hotel. The browser keeps it an hour, then asks with the tag
   and is answered 304 - but only once the link has opened again, so a dead
   link's tag opens nothing. `private`: the address carries the link, and
   no shared cache may keep it.

   An SVG opened on its own runs nothing: the upload refuses scripts
   (groupSettings.ts), and this answer forbids them again.
   ══════════════════════════════════════════════════════════════════ */

export const logoDoor = new Hono();

logoDoor.get("/:token/logo", async (c) => {
  const hash = sha256(c.req.param("token"));
  if (tooOften(hash, "open")) return refused(c);
  const [it] = await ask<{ logo_type: string; logo: Buffer; tag: string }>(
    "select * from app.guest_logo($1)", [hash]);
  if (!it) return refused(c);
  const tag = `"${it.tag}"`;
  const headers = {
    "cache-control": "private, max-age=3600",
    etag: tag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };
  if (c.req.header("if-none-match") === tag) return c.body(null, 304, headers);
  return c.body(new Uint8Array(it.logo), 200, { ...headers, "content-type": it.logo_type });
});
