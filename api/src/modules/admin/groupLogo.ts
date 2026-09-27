import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GROUP'S LOGO (the owner's D27-53, 27 September)

   One logo for the whole group, chosen in Settings, printed on every
   bill. A setting, not code (D21-27): this file holds no logo, and a
   copy with none prints the hotel's name. The table is the group's one
   row (see its migration, "one logo for the whole group").

     GET     /:code/group-logo   every active member of staff - they print bills
     PUT     /:code/group-logo   the owner, an administrator or the GM
     DELETE  /:code/group-logo   the same three

   WHO is the role gate's (roleGate.ts, GROUP_LOGO), before this route
   runs, and the database's (`app.sets_group_logo`) behind it. The hotel
   in the address is only where the person is standing: there is one
   logo, whichever hotel it is set from.

   WHAT is decided HERE, before `withSession` opens (MEMORY 243: inside
   it a refusal is a commit): a real PNG or a real SVG by its CONTENT,
   whatever the file was called or claimed to be; 200 KB at most (the
   owner, 27 September); and never an SVG that carries a script, an
   event handler or an embedded page. The screens show it only through
   an <img> (src/modules/admin/data/groupLogo.ts), where an SVG cannot
   run anything - refusing the script as well means no later reader
   that inlines it can be the one that does.
   ══════════════════════════════════════════════════════════════════ */

export const groupLogo = new Hono<{ Variables: { subject: string } }>();

export const LOGO_LIMIT = 200 * 1024;

type LogoType = "image/png" | "image/svg+xml";

const refuse = (reason: string) => ({ ok: false as const, reason });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* An XML prolog, comments and a DOCTYPE with no internal subset may come
   before the root; the root must be <svg> and the file must end with it. */
const SVG_SHAPE =
  /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>[]*>\s*)*<svg[\s>][\s\S]*<\/svg>\s*$/i;

/* Anything in an SVG that can run or pull in a page. An entity declaration
   is here too: it is how an XML file is made to expand without end. */
const SVG_ACTIVE = /<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|javascript:|\son[a-z]+\s*=/i;

/** What the file IS, read from its bytes, or why it is refused. */
export function readLogo(bytes: Buffer): { type: LogoType } | { reason: string } {
  if (bytes.length === 0) return { reason: "No file was sent." };
  if (bytes.length > LOGO_LIMIT) {
    return { reason: `The logo is ${Math.ceil(bytes.length / 1024)} KB. The most is 200 KB.` };
  }
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return { type: "image/png" };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return { reason: "The logo must be a PNG or an SVG picture." };
  }
  if (!SVG_SHAPE.test(text)) return { reason: "The logo must be a PNG or an SVG picture." };
  if (SVG_ACTIVE.test(text)) {
    return { reason: "This SVG carries a script or an embedded page, so it cannot go on a bill. "
      + "Save it again without them, or use a PNG." };
  }
  return { type: "image/svg+xml" };
}

/* The role gate lets through a person with no role at the hotel in the
   address and leaves the answer to the route: "No such property", as
   everywhere else - asked before anything is written. */
const worksAt = async (client: Client, code: string) =>
  (await client.query(
    "select 1 from hotels where code = upper($1) and id in (select app.auth_hotel_ids())",
    [code])).rowCount === 1;
const NO_SUCH = { error: "No such property." };

groupLogo.get("/:code/group-logo", async (c) => {
  const found = await withSession(c.get("subject"), async (client) => {
    if (!(await worksAt(client, c.req.param("code")))) return null;
    const { rows } = await client.query<{ image_type: LogoType; image: string }>(
      "select image_type, encode(image, 'base64') as image from group_logo");
    /* Postgres wraps base64 every 76 characters; a data: URL wants none. */
    return { logo: rows[0] ? { type: rows[0].image_type, data: rows[0].image.replace(/\s/g, "") } : null };
  });
  return found ? c.json(found) : c.json(NO_SUCH, 404);
});

groupLogo.put("/:code/group-logo", async (c) => {
  const { data } = await c.req.json<{ data?: unknown }>().catch(() => ({}) as { data?: unknown });
  const bytes = Buffer.from(typeof data === "string" ? data : "", "base64");
  const read = readLogo(bytes);
  if ("reason" in read) return c.json(refuse(read.reason), 409);

  const done = await withSession(c.get("subject"), async (client) => {
    if (!(await worksAt(client, c.req.param("code")))) return false;
    await client.query(
      `insert into group_logo (id, image_type, image, changed_by)
       values (1, $1, $2, app.current_user_id())
       on conflict (id) do update
         set image_type = excluded.image_type, image = excluded.image,
             changed_by = excluded.changed_by, changed_at = now()`,
      [read.type, bytes]);
    return true;
  });
  return done ? c.json({ ok: true, type: read.type }) : c.json(NO_SUCH, 404);
});

groupLogo.delete("/:code/group-logo", async (c) => {
  const done = await withSession(c.get("subject"), async (client) => {
    if (!(await worksAt(client, c.req.param("code")))) return false;
    await client.query("delete from group_logo");
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});
