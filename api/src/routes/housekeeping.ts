import { Hono } from "hono";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHOSE ROOMS ARE THESE

   The housekeeping board showed every room in the property to whoever
   opened it. A housekeeper arriving at eight has one question — which
   rooms are mine — and the board could not answer it, so the answer
   stayed on the supervisor's paper sheet and the board was decoration
   beside it.

   WHO CAN BE ASSIGNED

   Everyone with access to the property, not only staff whose role is
   `housekeeping`. Checked before writing this: across all three
   properties in the system, that role is held by NOBODY. Filtering on
   it would have shipped a dropdown that is empty at every property on
   day one, which is a feature that does not work presented as one that
   does. The role is shown beside each name so a supervisor can see who
   they are picking, and housekeepers sort first.
   ══════════════════════════════════════════════════════════════════ */

export const housekeeping = new Hono<{ Variables: { subject: string } }>();

async function resolve(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    `select id::text from hotels where code = upper($1) and is_active`,
    [code],
  );
  return rows[0] ?? null;
}

/** The date the work belongs to: asked for, or the business date. */
async function workDate(client: Client, hotelId: string, asked?: string) {
  return asked && /^\d{4}-\d{2}-\d{2}$/.test(asked)
    ? asked
    : await businessDateFor(client, hotelId);
}

/* ── Who a room can be given to ───────────────────────────────────── */
housekeeping.get("/:code/housekeepers", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const { rows } = await client.query<{
      id: string; name: string; role: string;
    }>(
      `select s.id::text, s.full_name as name, sh.role
         from staff s
         join staff_hotels sh on sh.staff_id = s.id
        where sh.hotel_id = $1 and s.is_active
        order by (sh.role <> 'housekeeping'), s.full_name`,
      [hotel.id],
    );
    return rows;
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

/* ── Today's sheet ────────────────────────────────────────────────── */
housekeeping.get("/:code/housekeeping/assignments", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const date = await workDate(client, hotel.id, c.req.query("date"));

    const { rows } = await client.query<{
      room: string; staff_id: string; staff_name: string;
      role: string; note: string | null;
    }>(
      `select r.number as room, a.staff_id::text, s.full_name as staff_name,
              sh.role, a.note
         from housekeeping_assignments a
         join rooms r on r.id = a.room_id
         join staff s on s.id = a.staff_id
         left join staff_hotels sh
                on sh.staff_id = a.staff_id and sh.hotel_id = a.hotel_id
        where a.hotel_id = $1 and a.work_date = $2::date
        order by r.number`,
      [hotel.id, date],
    );

    return {
      date,
      assignments: rows.map((r) => ({
        room: r.room,
        staffId: r.staff_id,
        staffName: r.staff_name,
        role: r.role,
        note: r.note,
      })),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

/* ── Give a room to somebody ──────────────────────────────────────── */
housekeeping.put("/:code/housekeeping/assignments/:number", async (c) => {
  type Body = { staffId?: string; date?: string; note?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.staffId) {
    return c.json({ ok: false, reason: "Who is cleaning it?" }, 409);
  }

  const body = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const date = await workDate(client, hotel.id, input.date);

    const { rows: room } = await client.query<{ id: string }>(
      `select id::text from rooms
        where hotel_id = $1 and number = $2 and is_active`,
      [hotel.id, c.req.param("number")],
    );
    if (!room[0]) {
      return { ok: false, reason: `There is no room ${c.req.param("number")} here.` };
    }

    /* Named back, so the confirmation says a person and not an id.
       Also the check that they work here — the D7 trigger would refuse
       the insert, but a constraint violation is not a sentence anybody
       can read. */
    const { rows: who } = await client.query<{ name: string }>(
      `select s.full_name as name
         from staff s
         join staff_hotels sh on sh.staff_id = s.id
        where s.id = $1 and sh.hotel_id = $2 and s.is_active`,
      [input.staffId, hotel.id],
    );
    if (!who[0]) {
      return { ok: false, reason: "That person does not work at this property." };
    }

    /* Reassignment is the ordinary case — a rota changes at nine when
       somebody calls in sick — so this is an upsert and not an error. */
    await client.query(
      `insert into housekeeping_assignments
         (hotel_id, room_id, work_date, staff_id, note, assigned_by)
       values ($1,$2,$3::date,$4,$5,$6)
       on conflict (room_id, work_date) do update
          set staff_id    = excluded.staff_id,
              note        = excluded.note,
              assigned_by = excluded.assigned_by,
              assigned_at = now()`,
      [hotel.id, room[0].id, date, input.staffId,
       input.note?.trim() || null, session.staffId],
    );

    return { ok: true as const, staffName: who[0].name, date };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok ? 200 : 409);
});

/* ── Take it back off them ────────────────────────────────────────── */
housekeeping.delete("/:code/housekeeping/assignments/:number", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const date = await workDate(client, hotel.id, c.req.query("date"));

    const { rowCount } = await client.query(
      `delete from housekeeping_assignments a
        using rooms r
        where a.room_id = r.id
          and a.hotel_id = $1 and r.number = $2 and a.work_date = $3::date`,
      [hotel.id, c.req.param("number"), date],
    );
    if (!rowCount) return { ok: false, reason: "That room is not assigned." };

    return { ok: true as const };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok ? 200 : 409);
});
