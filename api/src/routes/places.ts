import { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../auth.ts";

/* ══════════════════════════════════════════════════════════════════
   PLACES AND SUPPLIERS — the door that was missing

   Migration 094 built `locations` and `suppliers` for the Store, the
   equipment register and purchasing, and seeded nothing, as the owner's
   rule requires. Nothing in the system could ADD one. So no property had
   a store, and equipment could never "leave the store" (S12) — reported by
   the equipment chat on 16 September. Shared by three services and owned
   by none, so it is core, like approvals.

   WHO MAY CHANGE THEM: the owner, an administrator and the GM — the three
   roles the owner's table already gives everything on stock and equipment
   (docs/STOCK-AND-EQUIPMENT-PLAN.md § 6). Whether the Hotel Manager and the
   Inventory Manager may too is ASKED of the owner, not assumed; widening it
   is this one list. Anybody rostered here may read them — the Store and
   the register already print these names.

   NOTHING IS DELETED. A place or a supplier is switched off: stock was kept
   there, equipment stood there, a delivery came from them, and those rows
   must still say where and from whom. 094 revokes DELETE from the app.
   ══════════════════════════════════════════════════════════════════ */

export const places = new Hono<{ Variables: { subject: string } }>();

/** The roles that may add, change and switch off a place or a supplier. */
export const PLACE_KEEPERS: readonly string[] = ["owner", "admin", "gm"];

export const PLACE_KINDS = [
  "store", "kitchen", "bar", "restaurant", "public_area", "office", "other",
] as const;

const REFUSED =
  "Adding or changing places and suppliers is for the owner, an administrator " +
  "or the general manager. Ask one of them.";

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/** May the signed-in person change places and suppliers at this hotel?
    A group administrator counts as the owner everywhere; anybody else has
    the role their row gives them at THIS hotel (as rateSetters.ts reads it). */
async function keepsPlaces(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (
              select 1 from staff s
               where s.id = app.current_user_id() and s.is_active and s.is_group_admin
            )
         or exists (
              select 1 from staff_hotels sh
                join staff s on s.id = sh.staff_id
               where sh.staff_id = app.current_user_id()
                 and sh.hotel_id = $1 and s.is_active
                 and sh.role = any($2::text[])
            ) as may`,
    [hotelId, PLACE_KEEPERS]);
  return rows[0]?.may === true;
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/** A database refusal, in words a person can act on. */
function explain(err: unknown, what: "place" | "supplier", name: string | null): string | null {
  const code = (err as { code?: string }).code;
  if (code === "23505") return `There is already a ${what} called “${name}” here.`;
  if (code === "23514") {
    const c = (err as { constraint?: string }).constraint ?? "";
    if (c.includes("gstin")) return "A GSTIN is 15 characters: two digits, then 13 letters or digits.";
    if (c.includes("kind")) return "Choose what kind of place this is.";
    if (c.includes("name")) return `A ${what} needs a name.`;
  }
  return null;
}

/* ── Reading ───────────────────────────────────────────────────── */
places.get("/:code/places", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const [locs, sups, may] = await Promise.all([
      client.query<{ id: string; name: string; kind: string; is_active: boolean }>(
        `select id::text, name, kind, is_active from locations
          where hotel_id = $1 order by is_active desc, name`, [hotelId]),
      client.query<{
        id: string; name: string; contact: string | null; phone: string | null;
        email: string | null; gstin: string | null; address: string | null;
        note: string | null; is_active: boolean;
      }>(
        `select id::text, name, contact, phone, email, gstin, address, note, is_active
           from suppliers where hotel_id = $1 order by is_active desc, name`, [hotelId]),
      keepsPlaces(client, hotelId),
    ]);

    return {
      mayChange: may,
      whoMay: may ? null : REFUSED,
      places: locs.rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, isActive: r.is_active })),
      suppliers: sups.rows.map((r) => ({
        id: r.id, name: r.name, contact: r.contact, phone: r.phone, email: r.email,
        gstin: r.gstin, address: r.address, note: r.note, isActive: r.is_active,
      })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── A place ───────────────────────────────────────────────────── */
type PlaceBody = { name?: unknown; kind?: unknown; isActive?: unknown };

async function savePlace(subject: string, code: string, id: string | null, input: PlaceBody) {
  const name = text(input.name);
  const kind = typeof input.kind === "string" ? input.kind : "";
  if (!name) return { status: 409 as const, body: refuse("A place needs a name.") };
  if (!(PLACE_KINDS as readonly string[]).includes(kind)) {
    return { status: 409 as const, body: refuse("Choose what kind of place this is.") };
  }
  return withSession(subject, async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return { status: 404 as const, body: { error: "No such property." } };
    /* Refused before anything is written (root MEMORY 243). */
    if (!(await keepsPlaces(client, hotelId))) return { status: 403 as const, body: refuse(REFUSED) };
    try {
      if (id === null) {
        const { rows } = await client.query<{ id: string }>(
          `insert into locations (hotel_id, name, kind, created_by)
           values ($1, $2, $3, app.current_user_id()) returning id::text`,
          [hotelId, name, kind]);
        return { status: 200 as const, body: { ok: true as const, id: rows[0]!.id } };
      }
      const active = typeof input.isActive === "boolean" ? input.isActive : null;
      const { rowCount } = await client.query(
        `update locations set name = $3, kind = $4, is_active = coalesce($5, is_active)
          where id = $1 and hotel_id = $2`,
        [id, hotelId, name, kind, active]);
      if (!rowCount) return { status: 404 as const, body: refuse("No such place here.") };
      return { status: 200 as const, body: { ok: true as const, id } };
    } catch (err) {
      const said = explain(err, "place", name);
      if (said) return { status: 409 as const, body: refuse(said) };
      throw err;
    }
  });
}

places.post("/:code/places", async (c) => {
  const input = await c.req.json<PlaceBody>().catch(() => ({}) as PlaceBody);
  const r = await savePlace(c.get("subject"), c.req.param("code"), null, input);
  return c.json(r.body, r.status);
});

places.put("/:code/places/:id", async (c) => {
  const input = await c.req.json<PlaceBody>().catch(() => ({}) as PlaceBody);
  const r = await savePlace(c.get("subject"), c.req.param("code"), c.req.param("id"), input);
  return c.json(r.body, r.status);
});

/* ── A supplier ────────────────────────────────────────────────── */
type SupplierBody = {
  name?: unknown; contact?: unknown; phone?: unknown; email?: unknown;
  gstin?: unknown; address?: unknown; note?: unknown; isActive?: unknown;
};

async function saveSupplier(subject: string, code: string, id: string | null, input: SupplierBody) {
  const name = text(input.name);
  if (!name) return { status: 409 as const, body: refuse("A supplier needs a name.") };
  /* Capitals and no spaces, as it is printed on an invoice; checked for shape
     by the database, never invented. */
  const gstin = text(input.gstin)?.replace(/\s+/g, "").toUpperCase() ?? null;
  const values = [name, text(input.contact), text(input.phone), text(input.email),
                  gstin, text(input.address), text(input.note)];
  return withSession(subject, async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return { status: 404 as const, body: { error: "No such property." } };
    if (!(await keepsPlaces(client, hotelId))) return { status: 403 as const, body: refuse(REFUSED) };
    try {
      if (id === null) {
        const { rows } = await client.query<{ id: string }>(
          `insert into suppliers
             (hotel_id, name, contact, phone, email, gstin, address, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8, app.current_user_id()) returning id::text`,
          [hotelId, ...values]);
        return { status: 200 as const, body: { ok: true as const, id: rows[0]!.id } };
      }
      const active = typeof input.isActive === "boolean" ? input.isActive : null;
      const { rowCount } = await client.query(
        `update suppliers
            set name = $3, contact = $4, phone = $5, email = $6, gstin = $7,
                address = $8, note = $9, is_active = coalesce($10, is_active)
          where id = $1 and hotel_id = $2`,
        [id, hotelId, ...values, active]);
      if (!rowCount) return { status: 404 as const, body: refuse("No such supplier here.") };
      return { status: 200 as const, body: { ok: true as const, id } };
    } catch (err) {
      const said = explain(err, "supplier", name);
      if (said) return { status: 409 as const, body: refuse(said) };
      throw err;
    }
  });
}

places.post("/:code/suppliers", async (c) => {
  const input = await c.req.json<SupplierBody>().catch(() => ({}) as SupplierBody);
  const r = await saveSupplier(c.get("subject"), c.req.param("code"), null, input);
  return c.json(r.body, r.status);
});

places.put("/:code/suppliers/:id", async (c) => {
  const input = await c.req.json<SupplierBody>().catch(() => ({}) as SupplierBody);
  const r = await saveSupplier(c.get("subject"), c.req.param("code"), c.req.param("id"), input);
  return c.json(r.body, r.status);
});
