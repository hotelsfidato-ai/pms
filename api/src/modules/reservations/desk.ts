import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { COMP_ROLES, holdsRoleAt } from "./book.ts";

/* ══════════════════════════════════════════════════════════════════
   THE NEW BOOKING SCREEN'S TWO LISTS, AND CONFIRMING A WAITING BOOKING
   (Phase 1, D27-33)

     sales people      one list for the group (D27-37); a booking keeps the
                       NAME, so "Other" can still be typed
     room promotions   per hotel; a discount over 10% is only one of these
                       (D27-36)
     confirm           Waiting for the hotel -> confirmed; then the voucher
                       may go (the owner, 27 September)

   Each list is saved WHOLE, as the tax card's slabs are: the dialog shows
   the list and sends it back. A name left out is switched off, never
   deleted - a booking that used it still points at it. Kept by the owner,
   an administrator or the GM (the owner, 27 September), asked here; the
   gate lets every role through to this answer (roleGate: own).
   ══════════════════════════════════════════════════════════════════ */

export const desk = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const KEEPERS_ONLY =
  "This list is kept by the owner, an administrator or the general manager.";

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/** Trimmed, non-empty, at most 80 characters, each once (case aside). */
function cleanNames(names: unknown): string[] | null {
  if (!Array.isArray(names) || names.length > 200) return null;
  const seen = new Map<string, string>();
  for (const n of names) {
    if (typeof n !== "string" || !n.trim() || n.trim().length > 80) return null;
    seen.set(n.trim().toLowerCase(), n.trim());
  }
  return [...seen.values()];
}

/* ── Sales people ─────────────────────────────────────────────────── */

desk.get("/:code/sales-people", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    if (!(await hotelFor(client, c.req.param("code")))) return null;
    const { rows } = await client.query<{ id: string; name: string }>(
      "select id::text, name from sales_people where is_active order by lower(name)");
    return rows;
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

desk.put("/:code/sales-people", async (c) => {
  const input = await c.req.json<{ names?: unknown }>().catch(() => ({}) as { names?: unknown });
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, COMP_ROLES))) return { forbidden: KEEPERS_ONLY };
    const names = cleanNames(input.names);
    if (!names) return refuse("Each name is written out, at most 80 characters.");

    await client.query(
      `update sales_people set is_active = false
        where is_active and lower(btrim(name)) <> all($1::text[])`,
      [names.map((n) => n.toLowerCase())]);
    await client.query(
      `insert into sales_people (name) select unnest($1::text[])
       on conflict ((lower(btrim(name)))) do update
         set is_active = true, name = excluded.name`,
      [names]);
    return { ok: true as const, count: names.length };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Room promotions ──────────────────────────────────────────────── */

desk.get("/:code/room-promotions", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ id: string; name: string; percent: string }>(
      `select id::text, name, percent::text from room_promotions
        where hotel_id = $1 and is_active order by lower(name)`, [hotelId]);
    return rows.map((r) => ({ id: r.id, name: r.name, percent: Number(r.percent) }));
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

desk.put("/:code/room-promotions", async (c) => {
  const input = await c.req.json<{ promotions?: unknown }>()
    .catch(() => ({}) as { promotions?: unknown });
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, COMP_ROLES))) return { forbidden: KEEPERS_ONLY };

    const list = Array.isArray(input.promotions) ? input.promotions as unknown[] : null;
    const names = cleanNames(list?.map((p) => (p as { name?: unknown })?.name));
    const percents = (list ?? []).map((p) => Number((p as { percent?: unknown })?.percent));
    if (!list || !names || names.length !== list.length
        || percents.some((p) => !Number.isFinite(p) || p <= 0 || p > 100)) {
      return refuse("Each promotion has its own name and a percentage above 0, at most 100.");
    }

    await client.query(
      `update room_promotions set is_active = false
        where hotel_id = $1 and is_active and lower(btrim(name)) <> all($2::text[])`,
      [hotelId, names.map((n) => n.toLowerCase())]);
    await client.query(
      `insert into room_promotions (hotel_id, name, percent)
       select $1, n, p from unnest($2::text[], $3::numeric[]) as t(n, p)
       on conflict (hotel_id, (lower(btrim(name)))) do update
         set is_active = true, name = excluded.name, percent = excluded.percent`,
      [hotelId, names, percents]);
    return { ok: true as const, count: names.length };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Confirming a booking that was waiting for the hotel ──────────────
   The whole booking: every room of its group that is still waiting, as it
   was made together. Anybody who may make a booking may confirm one (the
   owner, 27 September; the gate asks). Nothing is sent here - the voucher
   is its own act. */
desk.post("/:code/stays/:id/confirm", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ reference: string; status: string }>(
      "select reference, status from reservations where id = $1 and hotel_id = $2",
      [c.req.param("id"), hotelId]);
    const stay = rows[0];
    if (!stay) return refuse("No such booking.");
    if (stay.status !== "tentative") {
      return refuse(`${stay.reference} is not waiting for the hotel, so there is nothing to confirm.`);
    }
    const { rowCount } = await client.query(
      `update reservations set status = 'confirmed'
        where hotel_id = $2 and status = 'tentative'
          and (id = $1 or group_id = (select group_id from reservations where id = $1))`,
      [c.req.param("id"), hotelId]);
    return { ok: true as const, rooms: rowCount ?? 0, reference: stay.reference };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
