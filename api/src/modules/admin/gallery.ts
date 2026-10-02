import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { withoutLocation } from "../../routes/idPhotos.ts";
import { managedHotel } from "./groupSettings.ts";

/* ══════════════════════════════════════════════════════════════════
   A HOTEL'S PHOTO GALLERY (the owner's D27-243, D27-244, 2 October)

     GET     /:code/gallery          the photos: id, caption, size, in order
     GET     /:code/gallery/:id      one photo, as { type, data } - Settings
                                      draws it as an <img> from the data
     POST    /:code/gallery          { data: base64 JPEG, caption? }
     PATCH   /:code/gallery/:id      { caption }   blank is none
     PUT     /:code/gallery/order    { ids }       each photo once, in order
     DELETE  /:code/gallery/:id

   Read by everybody who works at the hotel; changed by the owner, an
   administrator or that hotel's GM (roleGate's HOTEL_GALLERY, and the
   table's own policy, app.manages_hotel).

   NO NEW DEPENDENCY (D27-244): the page redraws the photo at 1600 px as a
   JPEG before it is sent (online-checkin's shrinkPhoto), and THIS is the
   guard, reading the file's own segments: a JPEG that starts and ends as one
   and whose segments add up, a frame of at most 1600 px on its long side,
   600 KB at most once the camera's Exif, Photoshop notes and comments are
   taken out (idPhotos.ts's withoutLocation). It does not decode pixels: a
   file with good headers and a broken picture is kept and shows as a broken
   image - served as image/jpeg, nosniff, in a sandbox, it can do nothing.
   ══════════════════════════════════════════════════════════════════ */

export const gallery = new Hono<{ Variables: { subject: string } }>();

const MOST_PHOTOS = 20;
const MOST_SIDE = 1600;
const MOST_BYTES = 600 * 1024;
const NOT_A_PHOTO = "A photo must be a JPEG. Choose it again - it is made one as it is sent.";
const NO_SUCH = { error: "No such photo." };
const refuse = (reason: string) => ({ ok: false as const, reason });
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The photo as kept, with its size - or why it is refused. */
export function readPhoto(bytes: Buffer): { photo: Buffer; width: number; height: number } | { reason: string } {
  const isJpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const photo = isJpeg ? withoutLocation(bytes) : null;
  if (!photo) return { reason: NOT_A_PHOTO };

  /* The frame (SOF0-SOF15, not DHT, JPG or DAC) comes before the scan. */
  let at = 2;
  let size: { width: number; height: number } | null = null;
  while (!size && at + 9 <= photo.length && photo[at + 1] !== 0xda) {
    const marker = photo[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      size = { height: photo.readUInt16BE(at + 5), width: photo.readUInt16BE(at + 7) };
    }
    at += 2 + photo.readUInt16BE(at + 2);
  }
  if (!size || size.width < 1 || size.height < 1) return { reason: NOT_A_PHOTO };
  if (Math.max(size.width, size.height) > MOST_SIDE) {
    return { reason: `That photo is ${size.width} × ${size.height} px. The most is ${MOST_SIDE} px `
      + "on its long side - choose it again and it is made smaller as it is sent." };
  }
  if (photo.length > MOST_BYTES) {
    return { reason: `That photo is ${Math.ceil(photo.length / 1024)} KB. The most is 600 KB - `
      + "choose it again and it is made smaller as it is sent." };
  }
  return { photo, ...size };
}

/** A caption, trimmed; null for none; undefined when too long. */
function captionOf(value: unknown): string | null | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > 120) return undefined;
  return text || null;
}
const TOO_LONG = "A caption is at most 120 characters.";

const hotelHere = async (client: Client, code: string) =>
  (await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and id in (select app.auth_hotel_ids())",
    [code])).rows[0]?.id ?? null;

gallery.get("/:code/gallery", async (c) => {
  const photos = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelHere(client, c.req.param("code"));
    if (!hotelId) return null;
    return (await client.query<{ id: string; caption: string | null; width: number; height: number }>(
      `select id::text, caption, width, height from hotel_photos
        where hotel_id = $1 order by position, added_at, id`, [hotelId])).rows;
  });
  return photos ? c.json({ photos, most: MOST_PHOTOS }) : c.json({ error: "No such property." }, 404);
});

gallery.get("/:code/gallery/:id", async (c) => {
  if (!A_UUID.test(c.req.param("id"))) return c.json(NO_SUCH, 404);
  const row = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelHere(client, c.req.param("code"));
    if (!hotelId) return null;
    return (await client.query<{ data: string }>(
      "select encode(photo, 'base64') as data from hotel_photos where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id")])).rows[0] ?? null;
  });
  return row
    ? c.json({ type: "image/jpeg", data: row.data.replace(/\s/g, "") })
    : c.json(NO_SUCH, 404);
});

gallery.post("/:code/gallery", async (c) => {
  const body = await c.req.json<{ data?: unknown; caption?: unknown }>()
    .catch(() => ({}) as { data?: unknown; caption?: unknown });
  const read = readPhoto(Buffer.from(typeof body.data === "string" ? body.data : "", "base64"));
  if ("reason" in read) return c.json(refuse(read.reason), 409);
  const caption = captionOf(body.caption);
  if (caption === undefined) return c.json(refuse(TOO_LONG), 409);

  const made = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return null;
    /* Two uploads at once must not make twenty-one: one at a time per hotel. */
    await client.query("select pg_advisory_xact_lock(hashtext('hotel_photos:' || $1))", [hotelId]);
    const { rows } = await client.query<{ n: number; next: number }>(
      `select count(*)::int as n, coalesce(max(position) + 1, 0)::int as next
         from hotel_photos where hotel_id = $1`, [hotelId]);
    if (rows[0]!.n >= MOST_PHOTOS) {
      return refuse(`This hotel has ${MOST_PHOTOS} photos, the most it may have. Delete one to add another.`);
    }
    const { rows: added } = await client.query<{ id: string }>(
      `insert into hotel_photos (hotel_id, position, caption, photo, width, height, added_by)
       values ($1, $2, $3, $4, $5, $6, app.current_user_id()) returning id::text`,
      [hotelId, rows[0]!.next, caption, read.photo, read.width, read.height]);
    return { ok: true as const, id: added[0]!.id };
  });
  if (!made) return c.json({ error: "No such property." }, 404);
  return c.json(made, made.ok ? 200 : 409);
});

gallery.patch("/:code/gallery/:id", async (c) => {
  if (!A_UUID.test(c.req.param("id"))) return c.json(NO_SUCH, 404);
  const body = await c.req.json<{ caption?: unknown }>().catch(() => ({}) as { caption?: unknown });
  const caption = captionOf(body.caption);
  if (caption === undefined) return c.json(refuse(TOO_LONG), 409);
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return false;
    return (await client.query(
      "update hotel_photos set caption = $3 where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id"), caption])).rowCount === 1;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});

gallery.put("/:code/gallery/order", async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  const ids = Array.isArray(body.ids) && body.ids.every((id) => typeof id === "string" && A_UUID.test(id))
    ? body.ids as string[] : null;
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ id: string }>(
      "select id::text from hotel_photos where hotel_id = $1", [hotelId]);
    const have = new Set(rows.map((r) => r.id));
    if (!ids || ids.length !== have.size || new Set(ids).size !== ids.length || !ids.every((id) => have.has(id))) {
      return refuse("The order must name each of this hotel's photos once.");
    }
    await client.query(
      `update hotel_photos p set position = o.n
         from unnest($2::uuid[]) with ordinality as o(id, n)
        where p.hotel_id = $1 and p.id = o.id`, [hotelId, ids]);
    return { ok: true as const };
  });
  if (!done) return c.json({ error: "No such property." }, 404);
  return c.json(done, done.ok ? 200 : 409);
});

gallery.delete("/:code/gallery/:id", async (c) => {
  if (!A_UUID.test(c.req.param("id"))) return c.json(NO_SUCH, 404);
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return false;
    return (await client.query(
      "delete from hotel_photos where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id")])).rowCount === 1;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});
