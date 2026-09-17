import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { checkRepairable, setRepairStatus, REPAIR_WAITING } from "../equipment/index.ts";
import {
  roleAt, may, REPAIR_REPORTERS, REPORT_REFUSED, COST_RECORDERS, COST_VIEWERS,
} from "./repairRoles.ts";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

interface OrderRow {
  id: string; room: string | null; title: string; detail: string | null;
  category: string; priority: string; status: string;
  raised_by: string | null; raised_at: string;
  assigned_to: string | null; days_open: number; blocks_room: boolean;
  closed_by: string | null; closed_at: string | null; resolution: string | null;
  equipment_id: string | null; equipment_name: string | null; equipment_tag: string | null;
}

interface CostRow {
  id: string; work_order_id: string; amount: string; note: string | null;
  recorded_by: string | null; recorded_at: string;
  proof_id: string; proof_name: string; proof_type: string;
  cancelled_by: string | null; cancelled_at: string | null; cancel_reason: string | null;
}

/* ONE QUERY FOR THE THREE LISTS — outstanding work, closed work, and every
   repair on one piece of equipment (its page, phase 2B) — so the three
   cannot describe an order three ways. Names come from `staff` with a LEFT
   join: a name the viewer may not see is a dash, never a missing row
   (root MEMORY 283). */
const ORDER_SELECT = `
  select w.id::text, rm.number as room, w.title, w.detail, w.category,
         w.priority, w.status,
         rs.full_name as raised_by, to_char(w.raised_at,'YYYY-MM-DD') as raised_at,
         asg.full_name as assigned_to,
         (current_date - w.raised_at::date)::int as days_open,
         w.block_id is not null as blocks_room,
         cl.full_name as closed_by, to_char(w.closed_at,'YYYY-MM-DD') as closed_at,
         w.resolution,
         w.equipment_item_id::text as equipment_id,
         ei.name as equipment_name, ei.tag as equipment_tag
    from work_orders w
    left join rooms rm on rm.id = w.room_id
    left join staff rs on rs.id = w.raised_by
    left join staff asg on asg.id = w.assigned_to
    left join staff cl on cl.id = w.closed_by
    left join equipment_items ei on ei.id = w.equipment_item_id
   where w.hotel_id = $1`;

/* Most urgent first, oldest first within that — a maintenance list exists
   to surface what has been ignored (058's own order, kept). */
const OUTSTANDING_ORDER = `
   order by case w.priority when 'urgent' then 0 when 'high' then 1
                            when 'normal' then 2 else 3 end,
            w.raised_at`;

/** How many closed repairs the Closed list shows, newest first. */
const CLOSED_SHOWN = 100;

housekeeping.get("/:code/work-orders", async (c) => {
  const view = c.req.query("view") === "closed" ? "closed" : "open";
  const item = c.req.query("item");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    const role = await roleAt(client, hotel.id);

    let rows: OrderRow[];
    if (item !== undefined) {
      /* Every repair on one thing, open or closed, newest first. */
      rows = isId(item)
        ? (await client.query<OrderRow>(
            `${ORDER_SELECT} and w.equipment_item_id = $2 order by w.raised_at desc, w.id`,
            [hotel.id, item])).rows
        : [];
    } else if (view === "closed") {
      rows = (await client.query<OrderRow>(
        `${ORDER_SELECT} and w.status in ('done','cancelled')
          order by w.closed_at desc, w.id limit ${CLOSED_SHOWN}`,
        [hotel.id])).rows;
    } else {
      rows = (await client.query<OrderRow>(
        `${ORDER_SELECT} and w.status in ('open','in_progress') ${OUTSTANDING_ORDER}`,
        [hotel.id])).rows;
    }

    /* Closed work is counted separately. "How many times have we fixed
       this room this year" is a different question from "what is
       outstanding", and mixing them buries the second. */
    const { rows: counts } = await client.query<{ open: string; closed: string }>(
      `select count(*) filter (where status in ('open','in_progress'))::text as open,
              count(*) filter (where status in ('done','cancelled'))::text as closed
         from work_orders where hotel_id = $1`,
      [hotel.id],
    );

    /* THE MONEY ONLY TO THOSE WHO MAY SEE IT (the owner, 17 September):
       the five who record costs, and the accountant. Everybody else gets
       the repair without a `costs` field at all — not an empty list, which
       would read as "it cost nothing". */
    const seesMoney = may(role, COST_VIEWERS);
    const costsFor = new Map<string, CostRow[]>();
    if (seesMoney && rows.length > 0) {
      const { rows: costs } = await client.query<CostRow>(
        `select k.id::text, k.work_order_id::text, k.amount::text, k.note,
                rb.full_name as recorded_by,
                to_char(k.recorded_at,'YYYY-MM-DD') as recorded_at,
                k.proof_id::text, a.filename as proof_name, a.content_type as proof_type,
                cb.full_name as cancelled_by,
                to_char(k.cancelled_at,'YYYY-MM-DD') as cancelled_at,
                k.cancel_reason
           from work_order_costs k
           join attachments a on a.id = k.proof_id
           left join staff rb on rb.id = k.recorded_by
           left join staff cb on cb.id = k.cancelled_by
          where k.hotel_id = $1 and k.work_order_id = any($2::uuid[])
          order by k.recorded_at, k.id`,
        [hotel.id, rows.map((r) => r.id)],
      );
      for (const k of costs) {
        costsFor.set(k.work_order_id, [...(costsFor.get(k.work_order_id) ?? []), k]);
      }
    }

    return {
      view: item !== undefined ? "item" : view,
      orders: rows.map((r) => {
        const costs = costsFor.get(r.id) ?? [];
        const standing = costs.filter((k) => k.cancelled_at === null);
        return {
          id: r.id, room: r.room, title: r.title, detail: r.detail,
          category: r.category, priority: r.priority, status: r.status,
          raisedBy: r.raised_by, raisedAt: r.raised_at,
          assignedTo: r.assigned_to, daysOpen: r.days_open,
          blocksRoom: r.blocks_room,
          closedBy: r.closed_by, closedAt: r.closed_at, resolution: r.resolution,
          equipment: r.equipment_id
            ? { id: r.equipment_id, name: r.equipment_name, tag: r.equipment_tag }
            : null,
          ...(seesMoney ? {
            costs: costs.map((k) => ({
              id: k.id, amount: Number(k.amount), note: k.note,
              recordedBy: k.recorded_by, recordedAt: k.recorded_at,
              proof: { id: k.proof_id, filename: k.proof_name, contentType: k.proof_type },
              cancelled: k.cancelled_at
                ? { by: k.cancelled_by, at: k.cancelled_at, reason: k.cancel_reason }
                : null,
            })),
            /* NULL when nothing stands — a dash on the screen, never ₹0. */
            costTotal: standing.length
              ? Math.round(standing.reduce((s, k) => s + Number(k.amount), 0) * 100) / 100
              : null,
          } : {}),
        };
      }),
      open: Number(counts[0]!.open),
      closed: Number(counts[0]!.closed),
      closedShown: CLOSED_SHOWN,
      mayRecordCosts: may(role, COST_RECORDERS),
      maySeeCosts: seesMoney,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

housekeeping.post("/:code/work-orders", async (c) => {
  type Body = {
    roomNumber?: string; title?: string; detail?: string;
    category?: string; priority?: string; equipmentItemId?: string | null;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const title = input.title?.trim();
  if (!title) {
    return c.json({ ok: false, reason: "What needs fixing?" }, 409);
  }
  const itemId = input.equipmentItemId?.trim() || null;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;

    /* THE CLIENT'S KEY, minted when somebody TAPPED — not when the
       request was sent. A tablet that loses signal in a lift resends,
       and without this a dripping tap becomes two dripping taps in the
       maintenance list. 011 wrote the same mechanism for the ledger and
       said why; 062 adds it here.

       Asked FIRST, before any check: a retry of a repair that already
       exists is a success, even if the thing it names has since gone
       into the approvals inbox. */
    const idem = c.req.header("idempotency-key") ?? null;
    if (idem) {
      const { rows: already } = await client.query<{ id: string }>(
        `select id::text from work_orders
          where hotel_id = $1 and idempotency_key = $2`, [hotel.id, idem]);
      if (already[0]) return { ok: true as const, id: already[0].id, duplicate: true };
    }

    /* ── Every refusal before the first write (root MEMORY 243) ───────
       Inside withSession a refusal is a COMMIT, so nothing is written
       until everything that could say no has had its say. */
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

    /* A REPAIR ON A PIECE OF EQUIPMENT (phase 2B). Who may: the plan's
       table (repairRoles.ts). What the thing allows: the register's own
       rules, asked through its front door — which also LOCKS it, so
       nothing changes it between this answer and the write below. */
    if (itemId) {
      if (!may(await roleAt(client, hotel.id), REPAIR_REPORTERS)) {
        return { forbidden: REPORT_REFUSED };
      }
      const check = await checkRepairable(client, hotel.id, itemId);
      if (!check.ok) return { ok: false as const, reason: check.reason };
    }

    try {
      /* `on conflict do nothing` still, for two retries of one tap racing
         each other past the lookup above: the second finds the first. */
      const { rows } = await client.query<{ id: string }>(
        `insert into work_orders
           (hotel_id, room_id, title, detail, category, priority, raised_by,
            idempotency_key, equipment_item_id)
         values ($1,$2,$3,nullif($4,''),$5,$6,$7,$8,$9)
         on conflict (hotel_id, idempotency_key)
           where idempotency_key is not null do nothing
         returning id::text`,
        [hotel.id, roomId, title, input.detail?.trim() ?? "",
         input.category ?? "maintenance", input.priority ?? "normal",
         session.staffId, idem, itemId]);

      if (!rows[0]) {
        const { rows: already } = await client.query<{ id: string }>(
          `select id::text from work_orders
            where hotel_id = $1 and idempotency_key = $2`, [hotel.id, idem]);
        /* Already raised by an earlier attempt of this same tap. */
        return { ok: true as const, id: already[0]!.id, duplicate: true };
      }

      /* D17-7: opening a repair sets the thing "Under repair" — through
         the register's door, in this transaction, so a repair never exists
         without its item saying so. Already under repair (by hand, or by
         another open repair) changes nothing. */
      if (itemId) {
        await setRepairStatus(client, hotel.id, itemId, "under_repair", `Repair raised: ${title}`);
      }
      return { ok: true as const, id: rows[0].id };
    } catch (error) {
      /* A statement that FAILED leaves this transaction aborted, and the
         commit withSession then sends becomes a rollback — so answering the
         failure as a refusal keeps nothing, the repair included. */
      const e = error as { code?: string; message?: string; constraint?: string } | undefined;
      if (e?.code === "23514" && e.constraint) {
        return { ok: false as const,
                 reason: "That category or priority is not one this uses." };
      }
      if ((e?.code === "23514" || e?.code === "P0001") && e.message) {
        return { ok: false as const, reason: e.message };
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json({ ok: false, reason: result.forbidden }, 403);
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
    if (!isId(c.req.param("id"))) return { ok: false as const, reason: "No such work order." };

    /* ── Every refusal before the first write (root MEMORY 243) ─────── */
    const { rows: found } = await client.query<{
      title: string; status: string; equipment_item_id: string | null;
    }>(
      `select title, status, equipment_item_id::text
         from work_orders where id = $1 and hotel_id = $2 for update`,
      [c.req.param("id"), hotel.id]);
    const order = found[0];
    if (!order) return { ok: false as const, reason: "No such work order." };

    /* A closed repair stays as it was closed. Closing it again would
       overwrite who closed it, when, and what they said was done. */
    if (order.status === "done" || order.status === "cancelled") {
      return { ok: false as const, reason: "This repair is already closed." };
    }

    /* D17-7: closing a repair puts the thing back "In use" — once no OTHER
       repair on it is still open. A retired thing stays retired. A thing
       waiting in the approvals inbox is decided there first, the owner's
       rule for raising a repair applied to closing one. */
    let backInUse = false;
    if (closing && order.equipment_item_id) {
      const { rows: others } = await client.query<{ n: number }>(
        `select count(*)::int as n from work_orders
          where hotel_id = $1 and equipment_item_id = $2 and id <> $3
            and status in ('open','in_progress')`,
        [hotel.id, order.equipment_item_id, c.req.param("id")]);
      if (others[0]!.n === 0) {
        const check = await checkRepairable(client, hotel.id, order.equipment_item_id);
        if (check.ok) backInUse = true;
        else if (check.reason === REPAIR_WAITING) return { ok: false as const, reason: check.reason };
      }
    }

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

    if (backInUse) {
      await setRepairStatus(client, hotel.id, order.equipment_item_id!, "in_use",
        `Repair closed: ${input.resolution?.trim() ?? ""}`);
    }
    return { ok: true as const, title: rows[0]!.title };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
