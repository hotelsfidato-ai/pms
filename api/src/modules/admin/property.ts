import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { managedHotel } from "./groupSettings.ts";

/* ══════════════════════════════════════════════════════════════════
   THE PROPERTY'S PROFILE (phase 2 of the settings plan; D27-249, D27-257)

     GET     /:code/property-profile   registrations, texts, child ages
     PUT     /:code/registrations      { registrations: [{ label, number }] } ≤ 4
     PUT     /:code/texts/:kind        { body }   blank removes the text
     PUT     /:code/child-ages         { free, max }   null for not set
     GET     /:code/amenities          ONE list for the group, with this
                                        hotel's On/Off and whether it is used
     PUT     /:code/amenities/:id      { on }   this hotel's switch
     POST    /:code/amenities          { name, icon? }   the owner or an Admin
     PATCH   /:code/amenities/:id      { name?, icon?, isActive? }   the same
     PUT     /:code/amenities/order    { ids }   the same
     DELETE  /:code/amenities/:id      the same; only while no hotel uses it

   The hotel's things are the logo's three (roleGate, and app.manages_hotel
   in each table's policy); the amenities list is the owner's or an
   Admin's (app.keeps_amenities), said in words before the database would
   refuse it. The child ages are WORDS ONLY: no price reads them (D27-257).
   Every change is recorded by the tables' audit triggers (194).
   ══════════════════════════════════════════════════════════════════ */

export const property = new Hono<{ Variables: { subject: string } }>();

export const TEXT_KINDS = [
  "about", "attractions", "directions", "activities", "landmarks",
  "parking", "family", "reservation_terms",
] as const;
const NO_SUCH_HOTEL = { error: "No such property." };
const refuse = (reason: string) => ({ ok: false as const, reason });
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEEPERS_ONLY = "Only the owner or an Admin changes the amenities list.";

const hotelHere = async (client: Client, code: string) =>
  (await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and id in (select app.auth_hotel_ids())",
    [code])).rows[0]?.id ?? null;
const keeps = async (client: Client) =>
  (await client.query<{ ok: boolean }>("select app.keeps_amenities() as ok")).rows[0]?.ok === true;

property.get("/:code/property-profile", async (c) => {
  const out = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelHere(client, c.req.param("code"));
    if (!hotelId) return null;
    const [h] = (await client.query<{
      registrations: { label: string; number: string }[];
      child_free_age: number | null; child_max_age: number | null;
      latitude: string | null; longitude: string | null;
    }>(`select extra_registrations as registrations, child_free_age, child_max_age,
               latitude::text, longitude::text from hotels where id = $1`, [hotelId])).rows;
    const texts = (await client.query<{ kind: string; body: string }>(
      "select kind, body from hotel_texts where hotel_id = $1", [hotelId])).rows;
    return {
      registrations: h!.registrations,
      texts: Object.fromEntries(texts.map((t) => [t.kind, t.body])),
      childFreeAge: h!.child_free_age, childMaxAge: h!.child_max_age,
      map: h!.latitude && h!.longitude ? { latitude: Number(h!.latitude), longitude: Number(h!.longitude) } : null,
    };
  });
  return out ? c.json(out) : c.json(NO_SUCH_HOTEL, 404);
});

property.put("/:code/registrations", async (c) => {
  const body = await c.req.json<{ registrations?: unknown }>().catch(() => ({}) as { registrations?: unknown });
  const list = Array.isArray(body.registrations) ? body.registrations as Record<string, unknown>[] : null;
  if (!list) return c.json(refuse("Send the registration numbers as a list."), 409);
  if (list.length > 4) return c.json(refuse("A hotel keeps at most four more registration numbers."), 409);
  const clean = list.map((r) => ({
    label: typeof r?.["label"] === "string" ? r["label"].trim() : "",
    number: typeof r?.["number"] === "string" ? r["number"].trim() : "",
  }));
  if (clean.some((r) => !r.label || !r.number)) return c.json(refuse("Each one needs a label and a number."), 409);
  if (clean.some((r) => r.label.length > 40 || r.number.length > 40)) {
    return c.json(refuse("A label or a number is at most 40 characters."), 409);
  }
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return false;
    await client.query("update hotels set extra_registrations = $2::jsonb where id = $1",
      [hotelId, JSON.stringify(clean)]);
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH_HOTEL, 404);
});

property.put("/:code/texts/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!(TEXT_KINDS as readonly string[]).includes(kind)) return c.json({ error: "No such text." }, 404);
  const body = await c.req.json<{ body?: unknown }>().catch(() => ({}) as { body?: unknown });
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text.length > 2000) return c.json(refuse("A text is at most 2000 characters."), 409);
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return false;
    if (!text) {
      await client.query("delete from hotel_texts where hotel_id = $1 and kind = $2", [hotelId, kind]);
    } else {
      await client.query(
        `insert into hotel_texts (hotel_id, kind, body, changed_by) values ($1, $2, $3, app.current_user_id())
         on conflict (hotel_id, kind) do update
            set body = excluded.body, changed_by = excluded.changed_by, changed_at = now()`,
        [hotelId, kind, text]);
    }
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH_HOTEL, 404);
});

property.put("/:code/child-ages", async (c) => {
  const body = await c.req.json<{ free?: unknown; max?: unknown }>().catch(() => ({}) as { free?: unknown; max?: unknown });
  const age = (v: unknown, lo: number) =>
    v === null || v === undefined || v === "" ? null
      : Number.isInteger(v) && (v as number) >= lo && (v as number) <= 17 ? v as number : undefined;
  const free = age(body.free, 0);
  const max = age(body.max, 1);
  if (free === undefined || max === undefined) return c.json(refuse("An age is a whole number up to 17."), 409);
  if (free !== null && max !== null && free >= max) return c.json(refuse("The free age must be below the child age."), 409);
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return false;
    await client.query("update hotels set child_free_age = $2, child_max_age = $3 where id = $1", [hotelId, free, max]);
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH_HOTEL, 404);
});

/* ── ONE amenities list ──────────────────────────────────────────── */

property.get("/:code/amenities", async (c) => {
  const out = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelHere(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      id: string; name: string; icon: string; is_active: boolean; on: boolean; used: boolean;
    }>(
      `select a.id::text, a.name, a.icon, a.is_active,
              exists (select 1 from hotel_amenities h where h.amenity_id = a.id and h.hotel_id = $1) as on,
              exists (select 1 from hotel_amenities h where h.amenity_id = a.id) as used
         from amenities a order by a.position, a.name`, [hotelId]);
    return {
      amenities: rows.map((a) => ({ id: a.id, name: a.name, icon: a.icon, isActive: a.is_active, on: a.on, used: a.used })),
      mayKeep: await keeps(client),
    };
  });
  return out ? c.json(out) : c.json(NO_SUCH_HOTEL, 404);
});

property.put("/:code/amenities/order", async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  const ids = Array.isArray(body.ids) && body.ids.every((id) => typeof id === "string" && A_UUID.test(id))
    ? body.ids as string[] : null;
  const out = await withSession(c.get("subject"), async (client) => {
    if (!(await keeps(client))) return { status: 403 as const, body: refuse(KEEPERS_ONLY) };
    const { rows } = await client.query<{ id: string }>("select id::text from amenities");
    const have = new Set(rows.map((r) => r.id));
    if (!ids || ids.length !== have.size || new Set(ids).size !== ids.length || !ids.every((id) => have.has(id))) {
      return { status: 409 as const, body: refuse("The order must name each amenity once.") };
    }
    await client.query(
      `update amenities a set position = o.n * 10
         from unnest($1::uuid[]) with ordinality as o(id, n) where a.id = o.id`, [ids]);
    return { status: 200 as const, body: { ok: true } };
  });
  return c.json(out.body, out.status);
});

property.put("/:code/amenities/:id", async (c) => {
  if (!A_UUID.test(c.req.param("id"))) return c.json({ error: "No such amenity." }, 404);
  const body = await c.req.json<{ on?: unknown }>().catch(() => ({}) as { on?: unknown });
  if (typeof body.on !== "boolean") return c.json(refuse("Say On or Off."), 409);
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managedHotel(client, c.req.param("code"));
    if (!hotelId) return false;
    if (body.on) {
      await client.query(
        `insert into hotel_amenities (hotel_id, amenity_id, changed_by)
         select $1, a.id, app.current_user_id() from amenities a where a.id = $2
         on conflict do nothing`, [hotelId, c.req.param("id")]);
    } else {
      await client.query("delete from hotel_amenities where hotel_id = $1 and amenity_id = $2",
        [hotelId, c.req.param("id")]);
    }
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH_HOTEL, 404);
});

const ICON = /^[a-z-]{1,30}$/;

property.post("/:code/amenities", async (c) => {
  const body = await c.req.json<{ name?: unknown; icon?: unknown }>().catch(() => ({}) as { name?: unknown; icon?: unknown });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const icon = typeof body.icon === "string" && ICON.test(body.icon) ? body.icon : "other";
  if (!name || name.length > 40) return c.json(refuse("A name of up to 40 characters."), 409);
  const out = await withSession(c.get("subject"), async (client) => {
    if (!(await keeps(client))) return { status: 403 as const, body: refuse(KEEPERS_ONLY) };
    const { rows: twin } = await client.query(
      "select 1 from amenities where lower(btrim(name)) = lower($1)", [name]);
    if (twin.length) return { status: 409 as const, body: refuse("That amenity is on the list already.") };
    const { rows } = await client.query<{ id: string }>(
      `insert into amenities (name, icon, position, created_by)
       select $1, $2, coalesce(max(position), 0) + 10, app.current_user_id() from amenities
       returning id::text`, [name, icon]);
    return { status: 200 as const, body: { ok: true, id: rows[0]!.id } };
  });
  return c.json(out.body, out.status);
});

property.patch("/:code/amenities/:id", async (c) => {
  if (!A_UUID.test(c.req.param("id"))) return c.json({ error: "No such amenity." }, 404);
  const body = await c.req.json<{ name?: unknown; icon?: unknown; isActive?: unknown }>()
    .catch(() => ({}) as { name?: unknown; icon?: unknown; isActive?: unknown });
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (name !== undefined && (!name || name.length > 40)) return c.json(refuse("A name of up to 40 characters."), 409);
  const icon = typeof body.icon === "string" && ICON.test(body.icon) ? body.icon : undefined;
  const active = typeof body.isActive === "boolean" ? body.isActive : undefined;
  const out = await withSession(c.get("subject"), async (client) => {
    if (!(await keeps(client))) return { status: 403 as const, body: refuse(KEEPERS_ONLY) };
    if (name) {
      const { rows: twin } = await client.query(
        "select 1 from amenities where lower(btrim(name)) = lower($1) and id <> $2", [name, c.req.param("id")]);
      if (twin.length) return { status: 409 as const, body: refuse("That amenity is on the list already.") };
    }
    const { rowCount } = await client.query(
      `update amenities set name = coalesce($2, name), icon = coalesce($3, icon),
              is_active = coalesce($4, is_active) where id = $1`,
      [c.req.param("id"), name ?? null, icon ?? null, active ?? null]);
    return rowCount === 1
      ? { status: 200 as const, body: { ok: true } }
      : { status: 404 as const, body: { error: "No such amenity." } };
  });
  return c.json(out.body, out.status);
});

property.delete("/:code/amenities/:id", async (c) => {
  if (!A_UUID.test(c.req.param("id"))) return c.json({ error: "No such amenity." }, 404);
  const out = await withSession(c.get("subject"), async (client) => {
    if (!(await keeps(client))) return { status: 403 as const, body: refuse(KEEPERS_ONLY) };
    const { rows: used } = await client.query(
      "select 1 from hotel_amenities where amenity_id = $1 limit 1", [c.req.param("id")]);
    if (used.length) {
      return { status: 409 as const, body: refuse(
        "A hotel has this amenity switched on. Switch it off there first, or turn it Off here.") };
    }
    const { rowCount } = await client.query("delete from amenities where id = $1", [c.req.param("id")]);
    return rowCount === 1
      ? { status: 200 as const, body: { ok: true } }
      : { status: 404 as const, body: { error: "No such amenity." } };
  });
  return c.json(out.body, out.status);
});
