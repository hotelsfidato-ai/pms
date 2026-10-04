import { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../../auth.ts";
import { readPhoto } from "../admin/index.ts";

/* ══════════════════════════════════════════════════════════════════
   A ROOM TYPE'S PHOTOS AND AMENITIES (P3; D27-258)

     GET    /:code/room-types/:id/photos            the list (no bytes)
     GET    /:code/room-types/:id/photos/:photoId   one, as base64 JPEG
     POST   /:code/room-types/:id/photos            { data (base64), caption? } - ten a type
     PUT    /:code/room-types/:id/photos/order      { ids } - each of the type's photos once
     DELETE /:code/room-types/:id/photos/:photoId
     GET    /:code/room-types/:id/amenities         { amenityIds }
     PUT    /:code/room-types/:id/amenities         { amenityIds } - from P2's one catalogue

   The photo rules are the gallery's (admin/gallery.ts readPhoto: a JPEG by
   its own bytes, Exif out, 1600 px, 600 KB) - one check, through admin's
   door, not a copy.
   ══════════════════════════════════════════════════════════════════ */

export const roomTypeExtras = new Hono<{ Variables: { subject: string } }>();

const MOST_PHOTOS = 10;
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (reason: string) => ({ ok: false as const, reason });
const NO_SUCH = { error: "No such room type or photo." };

/** The type's hotel, when the type is at this property. */
async function typeHere(client: Client, code: string, typeId: string): Promise<string | null> {
  if (!A_UUID.test(typeId)) return null;
  const { rows } = await client.query<{ hotel_id: string }>(
    `select rt.hotel_id::text from room_types rt join hotels h on h.id = rt.hotel_id
      where h.code = upper($1) and rt.id = $2`, [code, typeId]);
  return rows[0]?.hotel_id ?? null;
}

roomTypeExtras.get("/:code/room-types/:id/photos", async (c) => {
  const photos = await withSession(c.get("subject"), async (client) => {
    if (!(await typeHere(client, c.req.param("code"), c.req.param("id")))) return null;
    return (await client.query<{ id: string; caption: string | null; width: number; height: number }>(
      `select id::text, caption, width, height from room_type_photos
        where room_type_id = $1 order by position, added_at, id`, [c.req.param("id")])).rows;
  });
  return photos ? c.json({ photos, most: MOST_PHOTOS }) : c.json(NO_SUCH, 404);
});

roomTypeExtras.get("/:code/room-types/:id/photos/:photoId", async (c) => {
  if (!A_UUID.test(c.req.param("photoId"))) return c.json(NO_SUCH, 404);
  const row = await withSession(c.get("subject"), async (client) => {
    if (!(await typeHere(client, c.req.param("code"), c.req.param("id")))) return null;
    return (await client.query<{ data: string }>(
      "select encode(photo, 'base64') as data from room_type_photos where room_type_id = $1 and id = $2",
      [c.req.param("id"), c.req.param("photoId")])).rows[0] ?? null;
  });
  return row ? c.json({ type: "image/jpeg", data: row.data.replace(/\s/g, "") }) : c.json(NO_SUCH, 404);
});

roomTypeExtras.post("/:code/room-types/:id/photos", async (c) => {
  const body = await c.req.json<{ data?: unknown; caption?: unknown }>()
    .catch(() => ({}) as { data?: unknown; caption?: unknown });
  const read = readPhoto(Buffer.from(typeof body.data === "string" ? body.data : "", "base64"));
  if ("reason" in read) return c.json(refuse(read.reason), 409);
  const caption = typeof body.caption === "string" && body.caption.trim() ? body.caption.trim() : null;
  if (caption && caption.length > 120) return c.json(refuse("A caption is at most 120 letters."), 409);
  const made = await withSession(c.get("subject"), async (client) => {
    const hotelId = await typeHere(client, c.req.param("code"), c.req.param("id"));
    if (!hotelId) return null;
    /* Two uploads at once must not make eleven: one at a time per type. */
    await client.query("select pg_advisory_xact_lock(hashtext('room_type_photos:' || $1))", [c.req.param("id")]);
    const { rows } = await client.query<{ n: number; next: number }>(
      `select count(*)::int as n, coalesce(max(position) + 1, 0)::int as next
         from room_type_photos where room_type_id = $1`, [c.req.param("id")]);
    if (rows[0]!.n >= MOST_PHOTOS) {
      return refuse(`This room type has ${MOST_PHOTOS} photos, the most it may have. Delete one to add another.`);
    }
    const { rows: added } = await client.query<{ id: string }>(
      `insert into room_type_photos (hotel_id, room_type_id, position, caption, photo, width, height, added_by)
       values ($1, $2, $3, $4, $5, $6, $7, app.current_user_id()) returning id::text`,
      [hotelId, c.req.param("id"), rows[0]!.next, caption, read.photo, read.width, read.height]);
    return { ok: true as const, id: added[0]!.id };
  });
  if (!made) return c.json(NO_SUCH, 404);
  return c.json(made, made.ok ? 200 : 409);
});

roomTypeExtras.put("/:code/room-types/:id/photos/order", async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  const ids = Array.isArray(body.ids) && body.ids.every((id) => typeof id === "string" && A_UUID.test(id))
    ? body.ids as string[] : null;
  const done = await withSession(c.get("subject"), async (client) => {
    if (!(await typeHere(client, c.req.param("code"), c.req.param("id")))) return null;
    const { rows } = await client.query<{ id: string }>(
      "select id::text from room_type_photos where room_type_id = $1", [c.req.param("id")]);
    const have = new Set(rows.map((r) => r.id));
    if (!ids || ids.length !== have.size || new Set(ids).size !== ids.length || !ids.every((id) => have.has(id))) {
      return refuse("The order must name each of this room type's photos once.");
    }
    await client.query(
      `update room_type_photos p set position = o.n
         from unnest($2::uuid[]) with ordinality as o(id, n)
        where p.room_type_id = $1 and p.id = o.id`, [c.req.param("id"), ids]);
    return { ok: true as const };
  });
  if (!done) return c.json(NO_SUCH, 404);
  return c.json(done, done.ok ? 200 : 409);
});

roomTypeExtras.delete("/:code/room-types/:id/photos/:photoId", async (c) => {
  if (!A_UUID.test(c.req.param("photoId"))) return c.json(NO_SUCH, 404);
  const done = await withSession(c.get("subject"), async (client) => {
    if (!(await typeHere(client, c.req.param("code"), c.req.param("id")))) return false;
    return (await client.query("delete from room_type_photos where room_type_id = $1 and id = $2",
      [c.req.param("id"), c.req.param("photoId")])).rowCount === 1;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});

roomTypeExtras.get("/:code/room-types/:id/amenities", async (c) => {
  const ids = await withSession(c.get("subject"), async (client) => {
    if (!(await typeHere(client, c.req.param("code"), c.req.param("id")))) return null;
    return (await client.query<{ id: string }>(
      "select amenity_id::text as id from room_type_amenities where room_type_id = $1", [c.req.param("id")]))
      .rows.map((r) => r.id);
  });
  return ids ? c.json({ amenityIds: ids }) : c.json(NO_SUCH, 404);
});

roomTypeExtras.put("/:code/room-types/:id/amenities", async (c) => {
  const body = await c.req.json<{ amenityIds?: unknown }>().catch(() => ({}) as { amenityIds?: unknown });
  const ids = Array.isArray(body.amenityIds) && body.amenityIds.every((id) => typeof id === "string" && A_UUID.test(id))
    ? [...new Set(body.amenityIds as string[])] : null;
  if (!ids) return c.json(refuse("Send the amenities this room type has."), 409);
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await typeHere(client, c.req.param("code"), c.req.param("id"));
    if (!hotelId) return null;
    await client.query("delete from room_type_amenities where room_type_id = $1", [c.req.param("id")]);
    /* Only the catalogue's own, switched on (P2's `amenities`). */
    await client.query(
      `insert into room_type_amenities (hotel_id, room_type_id, amenity_id)
       select $1, $2, a.id from amenities a where a.id = any($3::uuid[]) and a.is_active`,
      [hotelId, c.req.param("id"), ids]);
    return { ok: true as const };
  });
  if (!done) return c.json(NO_SUCH, 404);
  return c.json(done);
});
