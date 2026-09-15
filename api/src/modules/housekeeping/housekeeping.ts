import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";

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

/* ══════════════════════════════════════════════════════════════════
   WORK ORDERS

   A dripping tap in 204. Until 058 the only thing this system could
   do with that was take the room out of service — the wrong answer
   for a tap, and it costs a night's revenue.

   A WORK ORDER IS NOT A ROOM BLOCK. Most take no room out at all. A
   broken air conditioner in July does, and then there are two rows:
   the block says the room cannot be sold, the order says who is
   fixing it, and the order points at the block.
   ══════════════════════════════════════════════════════════════════ */

housekeeping.get("/:code/work-orders", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const { rows } = await client.query<{
      id: string; room: string | null; title: string; detail: string | null;
      category: string; priority: string; status: string;
      raised_by: string | null; raised_at: string;
      assigned_to: string | null; days_open: number; blocks_room: boolean;
    }>(
      `select id::text, room, title, detail, category, priority, status,
              raised_by, to_char(raised_at,'YYYY-MM-DD') as raised_at,
              assigned_to, days_open, blocks_room
         from app.work_orders_open($1)`,
      [hotel.id],
    );

    /* Closed work is asked for separately. "How many times have we fixed
       this room this year" is a different question from "what is
       outstanding", and mixing them buries the second. */
    const { rows: done } = await client.query<{ n: string }>(
      `select count(*)::text as n from work_orders
        where hotel_id = $1 and status in ('done','cancelled')`,
      [hotel.id],
    );

    return {
      orders: rows.map((r) => ({
        id: r.id, room: r.room, title: r.title, detail: r.detail,
        category: r.category, priority: r.priority, status: r.status,
        raisedBy: r.raised_by, raisedAt: r.raised_at,
        assignedTo: r.assigned_to, daysOpen: r.days_open,
        blocksRoom: r.blocks_room,
      })),
      closed: Number(done[0]!.n),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

housekeeping.post("/:code/work-orders", async (c) => {
  type Body = {
    roomNumber?: string; title?: string; detail?: string;
    category?: string; priority?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const title = input.title?.trim();
  if (!title) {
    return c.json({ ok: false, reason: "What needs fixing?" }, 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    let roomId: string | null = null;
    const number = input.roomNumber?.trim();
    if (number) {
      const { rows } = await client.query<{ id: string }>(
        `select id::text from rooms where hotel_id = $1 and number = $2`,
        [hotel.id, number]);
      if (!rows[0]) {
        return { ok: false as const, reason: `There is no room ${number} here.` };
      }
      roomId = rows[0].id;
    }
    /* No room is a real answer, not a missing one — a lift, a generator,
       the lobby door. */

    /* THE CLIENT'S KEY, minted when somebody TAPPED — not when the
       request was sent. A tablet that loses signal in a lift resends,
       and without this a dripping tap becomes two dripping taps in the
       maintenance list. 011 wrote the same mechanism for the ledger and
       said why; 062 adds it here.

       `on conflict do nothing` then returns no row, so the existing
       order is fetched and reported as success. It IS success: the work
       order the person asked for exists. */
    const idem = c.req.header("idempotency-key") ?? null;

    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into work_orders
           (hotel_id, room_id, title, detail, category, priority, raised_by,
            idempotency_key)
         values ($1,$2,$3,nullif($4,''),$5,$6,$7,$8)
         on conflict (hotel_id, idempotency_key)
           where idempotency_key is not null do nothing
         returning id::text`,
        [hotel.id, roomId, title, input.detail?.trim() ?? "",
         input.category ?? "maintenance", input.priority ?? "normal",
         session.staffId, idem]);

      if (!rows[0]) {
        const { rows: already } = await client.query<{ id: string }>(
          `select id::text from work_orders
            where hotel_id = $1 and idempotency_key = $2`, [hotel.id, idem]);
        /* Already raised by an earlier attempt of this same tap. */
        return { ok: true as const, id: already[0]!.id, duplicate: true };
      }
      return { ok: true as const, id: rows[0].id };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      if (e?.code === "23514") {
        return { ok: false as const,
                 reason: "That category or priority is not one this uses." };
      }
      if (e?.code === "P0001" && e.message) {
        return { ok: false as const, reason: e.message };
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

housekeeping.patch("/:code/work-orders/:id", async (c) => {
  type Body = { status?: string; assignedTo?: string | null; resolution?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const closing = input.status === "done" || input.status === "cancelled";
  if (closing && !input.resolution?.trim()) {
    /* The database refuses this too. Naming it here means the person sees a
       sentence rather than a constraint name — and "fixed" is what people
       write when the field is optional, which is useless in November. */
    return c.json({ ok: false,
      reason: "Say what was done. It is the line somebody reads next time." },
      409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const { rows } = await client.query<{ title: string }>(
      `update work_orders
          set status      = coalesce($1, status),
              assigned_to = case when $2::text is null then assigned_to
                                 when $2 = '' then null
                                 else $2::uuid end,
              resolution  = case when $3::text is null then resolution
                                 else $3 end,
              closed_by   = case when $1 in ('done','cancelled')
                                 then $4::uuid else closed_by end,
              closed_at   = case when $1 in ('done','cancelled')
                                 then now() else closed_at end
        where id = $5 and hotel_id = $6
        returning title`,
      [input.status ?? null,
       input.assignedTo === undefined ? null : (input.assignedTo ?? ""),
       input.resolution?.trim() ?? null, session.staffId,
       c.req.param("id"), hotel.id]);

    if (!rows[0]) return { ok: false as const, reason: "No such work order." };
    return { ok: true as const, title: rows[0].title };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
