import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GROUP'S NAME AND LOGO (the owner's D27-53 and D27-65, 27 September)

   One group setting, chosen in Settings, printed on every bill: the
   masthead is the property's name and under it "by <group name>"
   (D27-65), and the logo (D27-53). A setting, not code (D21-27): this
   file names no group and holds no logo, and a copy with neither prints
   the hotel's name alone. The table is the group's one row (its
   migration: "the group's name and logo").

     GET     /:code/group        every active member of staff - they print bills
     PUT     /:code/group/name   the owner, an administrator or the GM
     PUT     /:code/group/logo   the same three
     DELETE  /:code/group/logo   the same three
     PUT     /:code/logo         THIS hotel's own logo (D27-214): the owner, an
     DELETE  /:code/logo         administrator or the GM AT that hotel

   WHO is the role gate's (roleGate.ts, GROUP_SETTINGS), before this route
   runs, and the database's (`app.sets_group_settings`) behind it. The
   hotel in the address is only where the person is standing: there is
   one setting, whichever hotel it is changed from.

   WHAT is decided HERE, before `withSession` opens (MEMORY 243: inside
   it a refusal is a commit): a name of up to 80 characters, blank for
   none; a logo that is a real PNG or a real SVG by its CONTENT, whatever
   the file was called or claimed to be, 200 KB at most (the owner, 27
   September), and never an SVG that carries a script, an event handler
   or an embedded page. The screens show the logo only through an <img>
   (src/modules/admin/data/groupSettings.ts), where an SVG cannot run
   anything - refusing the script as well means no later reader that
   inlines it can be the one that does.
   ══════════════════════════════════════════════════════════════════ */

export const groupSettings = new Hono<{ Variables: { subject: string } }>();

const LOGO_LIMIT = 200 * 1024;
const NAME_LIMIT = 80;

type LogoType = "image/png" | "image/svg+xml";

const refuse = (reason: string) => ({ ok: false as const, reason });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* An XML prolog, comments and a DOCTYPE with no internal subset may come
   before the root; the root must be <svg> and the file must end with it.
   ⚠ A comment's body may not contain "-->". Written as `<!--[\s\S]*?-->`
   it could also swallow the next comment, so thirty empty comments had
   2^30 readings and held the API for 105 seconds (ADM-10, measured on 27
   September before this was merged); now each comment has one. */
const SVG_SHAPE =
  /^\s*(<\?xml[^>]*\?>\s*)?(<!--(?:(?!-->)[\s\S])*-->\s*|<!DOCTYPE[^>[]*>\s*)*<svg[\s>][\s\S]*<\/svg>\s*$/i;

/* Anything in an SVG that can run or pull in a page. An entity declaration
   is here too: it is how an XML file is made to expand without end. */
const SVG_ACTIVE = /<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|javascript:|\son[a-z]+\s*=/i;

/** What the file IS, read from its bytes, or why it is refused. */
function readLogo(bytes: Buffer): { type: LogoType } | { reason: string } {
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

/* One write, whichever half changes: the row is made the first time. */
async function change(client: Client, set: string, values: unknown[]) {
  await client.query(
    `insert into group_settings (id, changed_by) values (1, app.current_user_id())
     on conflict (id) do nothing`);
  await client.query(
    `update group_settings set ${set}, changed_by = app.current_user_id(), changed_at = now()
      where id = 1`, values);
}

groupSettings.get("/:code/group", async (c) => {
  const found = await withSession(c.get("subject"), async (client) => {
    if (!(await worksAt(client, c.req.param("code")))) return null;
    type Picture = { logo_type: LogoType | null; logo: string | null };
    const { rows } = await client.query<Picture & { name: string | null }>(
      "select name, logo_type, encode(logo, 'base64') as logo from group_settings");
    /* The hotel's own (D27-214, migration 168): its documents print it in
       place of the group's. No row, and the group's prints. */
    const { rows: own } = await client.query<Picture>(
      `select l.logo_type, encode(l.logo, 'base64') as logo
         from hotel_logos l join hotels h on h.id = l.hotel_id
        where h.code = upper($1)`, [c.req.param("code")]);
    /* Postgres wraps base64 every 76 characters; a data: URL wants none. */
    const picture = (row: Picture | undefined) =>
      row?.logo && row.logo_type ? { type: row.logo_type, data: row.logo.replace(/\s/g, "") } : null;
    return { name: rows[0]?.name ?? null, logo: picture(rows[0]), hotelLogo: picture(own[0]) };
  });
  return found ? c.json(found) : c.json(NO_SUCH, 404);
});

groupSettings.put("/:code/group/name", async (c) => {
  const { name } = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown });
  const typed = typeof name === "string" ? name.trim() : "";
  if (typed.length > NAME_LIMIT) {
    return c.json(refuse(`The group's name is ${typed.length} characters. The most is ${NAME_LIMIT}.`), 409);
  }
  const done = await withSession(c.get("subject"), async (client) => {
    if (!(await worksAt(client, c.req.param("code")))) return false;
    await change(client, "name = $1", [typed || null]);
    return true;
  });
  return done ? c.json({ ok: true, name: typed || null }) : c.json(NO_SUCH, 404);
});

groupSettings.put("/:code/group/logo", async (c) => {
  const { data } = await c.req.json<{ data?: unknown }>().catch(() => ({}) as { data?: unknown });
  const bytes = Buffer.from(typeof data === "string" ? data : "", "base64");
  const read = readLogo(bytes);
  if ("reason" in read) return c.json(refuse(read.reason), 409);

  const done = await withSession(c.get("subject"), async (client) => {
    if (!(await worksAt(client, c.req.param("code")))) return false;
    await change(client, "logo_type = $1, logo = $2", [read.type, bytes]);
    return true;
  });
  return done ? c.json({ ok: true, type: read.type }) : c.json(NO_SUCH, 404);
});

groupSettings.delete("/:code/group/logo", async (c) => {
  const done = await withSession(c.get("subject"), async (client) => {
    if (!(await worksAt(client, c.req.param("code")))) return false;
    await change(client, "logo_type = null, logo = null", []);
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});

/* ── A hotel's own logo (D27-214, migration 168) ─────────────────────
   The same picture rules as the group's (readLogo). WHO: the role gate's
   room-setup grant at the hotel in the address, and the table's policy
   (app.manages_hotel) behind it - asked here first, so a person who may
   not is told "No such property" and nothing is attempted. */
const managedHotel = async (client: Client, code: string) =>
  (await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and app.manages_hotel(id)",
    [code])).rows[0]?.id ?? null;

groupSettings.put("/:code/logo", async (c) => {
  const { data } = await c.req.json<{ data?: unknown }>().catch(() => ({}) as { data?: unknown });
  const bytes = Buffer.from(typeof data === "string" ? data : "", "base64");
  const read = readLogo(bytes);
  if ("reason" in read) return c.json(refuse(read.reason), 409);

  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return false;
    await client.query(
      `insert into hotel_logos (hotel_id, logo_type, logo, changed_by)
       values ($1, $2, $3, app.current_user_id())
       on conflict (hotel_id) do update
          set logo_type = excluded.logo_type, logo = excluded.logo,
              changed_by = excluded.changed_by, changed_at = now()`,
      [hotelId, read.type, bytes]);
    return true;
  });
  return done ? c.json({ ok: true, type: read.type }) : c.json(NO_SUCH, 404);
});

groupSettings.delete("/:code/logo", async (c) => {
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return false;
    await client.query("delete from hotel_logos where hotel_id = $1", [hotelId]);
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});
