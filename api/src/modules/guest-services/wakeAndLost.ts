import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Role } from "../../permissions.ts";
import { DESK, placeAndRole } from "./requests.ts";

/* ══════════════════════════════════════════════════════════════════
   WAKE-UP CALLS AND LOST PROPERTY (D27-239; the owner's answers D27-241)

   Wake-up calls: the desk sets one; a guest may ask from their own page
   (api/src/routes/guestWakeUp.ts), and it waits "asked" until the desk
   confirms or cancels it. Due from fifteen minutes before until marked
   done - the bell says so (notifications.ts). No "missed" state. Times are
   the hotel's own clock (app.hotel_moment / app.hotel_clock, MEMORY 297).

   Lost property: the desk and housekeeping log what was found; only the
   desk marks it returned (to whom) or disposed (why). Days kept shown;
   nothing goes by itself; no photo.

   WHO: wake-up calls - the desk (owner, admin, GM, hotel manager,
   reception). Lost property - the desk and housekeeping log and see; the
   desk alone clears. Everybody else: 403, one sentence.
   ══════════════════════════════════════════════════════════════════ */

export const wakeAndLost = new Hono<{ Variables: { subject: string } }>();

export const LOST_LOGGERS: readonly Role[] = [...DESK, "housekeeping"];
const WAKE_REFUSED = "Wake-up calls are for the front desk. Ask one of them.";
const LOST_REFUSED = "Lost property is for the front desk and housekeeping. Ask one of them.";
const CLEAR_REFUSED = "Returning or disposing of lost property is for the front desk. Ask one of them.";
const desk = (role: Role | null) => role !== null && DESK.includes(role);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ── Wake-up calls ─────────────────────────────────────────────── */

wakeAndLost.get("/:code/wake-up-calls", async (c) => {
  const done = c.req.query("view") === "done";
  const body = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    if (!desk(at.role)) return { forbidden: true as const };
    const { rows } = await client.query(
      `select w.id::text, w.status, w.from_guest as "fromGuest", rm.number as room, g.full_name as guest,
              app.hotel_clock(w.hotel_id, w.call_at) as "callAt", w.note,
              app.colleague_name(w.created_by, w.hotel_id) as "setBy",
              app.colleague_name(w.handled_by, w.hotel_id) as "handledBy",
              app.hotel_clock(w.hotel_id, w.handled_at) as "handledAt", w.cancel_reason as "cancelReason",
              (w.status = 'set' and w.call_at <= now() + interval '15 minutes') as due
         from wake_up_calls w
         left join rooms rm       on rm.id = w.room_id
         left join reservations r on r.id = w.reservation_id
         left join guests g       on g.id = r.guest_id
        where w.hotel_id = $1 and ${done
          ? `w.status in ('done', 'cancelled') and w.handled_at > now() - interval '1 day'
             order by w.handled_at desc`
          : `w.status in ('asked', 'set') order by w.call_at`}`, [at.hotelId]);
    const { rows: rooms } = await client.query(
      `select r.id::text as "reservationId", rm.number as room, g.full_name as guest
         from reservations r
         join room_assignments ra on ra.reservation_id = r.id and ra.released_at is null
         join rooms rm            on rm.id = ra.room_id
         left join guests g       on g.id = r.guest_id
        where r.hotel_id = $1 and r.status = 'checked_in'
        order by rm.number`, [at.hotelId]);
    const { rows: [today] } = await client.query(
      "select app.hotel_clock($1, now(), 'YYYY-MM-DD') as day", [at.hotelId]);
    return { calls: rows, rooms, today: today.day as string };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json({ ok: false, reason: WAKE_REFUSED }, 403);
  return c.json(body);
});

wakeAndLost.post("/:code/wake-up-calls", async (c) => {
  type Body = { reservationId?: string; day?: string; time?: string; note?: string };
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const note = b.note?.trim() ?? "";
  if (!DAY.test(b.day ?? "") || !TIME.test(b.time ?? "") || note.length > 200) {
    return c.json({ ok: false, reason: "Choose the day and the time." }, 409);
  }
  const result = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    if (!desk(at.role)) return { forbidden: true as const };
    /* Every refusal before the write (root MEMORY 243). */
    const { rows } = await client.query<{ room_id: string; call_at: string; future: boolean }>(
      `select ra.room_id::text, app.hotel_moment($2, $3) as call_at,
              app.hotel_moment($2, $3) > now() as future
         from reservations r
         join room_assignments ra on ra.reservation_id = r.id and ra.released_at is null
        where r.id::text = $1 and r.hotel_id = $2 and r.status = 'checked_in'
        order by ra.from_date desc, ra.created_at desc limit 1`,
      [b.reservationId ?? "", at.hotelId, `${b.day}T${b.time}`]);
    const stay = rows[0];
    if (!stay) return { ok: false as const, reason: "That guest is not in house now." };
    if (!stay.future) return { ok: false as const, reason: "That time has passed." };
    await client.query(
      `insert into wake_up_calls (hotel_id, reservation_id, room_id, call_at, note, created_by)
       values ($1, $2, $3, $4, nullif($5, ''), $6)`,
      [at.hotelId, b.reservationId, stay.room_id, stay.call_at, note, session.staffId]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json({ ok: false, reason: WAKE_REFUSED }, 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* confirm (a guest's ask), done, or cancel with a reason. */
wakeAndLost.patch("/:code/wake-up-calls/:id", async (c) => {
  const b = await c.req.json<{ action?: string; reason?: string }>()
    .catch(() => ({}) as { action?: string; reason?: string });
  const reason = b.reason?.trim() ?? "";
  if (!["confirm", "done", "cancel"].includes(b.action ?? "")) {
    return c.json({ ok: false, reason: "Confirm, done, or cancel?" }, 409);
  }
  if (b.action === "cancel" && reason === "") return c.json({ ok: false, reason: "Say why it is cancelled." }, 409);
  const result = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    if (!desk(at.role)) return { forbidden: true as const };
    const from = b.action === "confirm" ? ["asked"] : ["asked", "set"];
    const { rowCount } = await client.query(
      b.action === "confirm"
        ? `update wake_up_calls set status = 'set' where id::text = $1 and hotel_id = $2 and status = any($3)`
        : `update wake_up_calls set status = $4, handled_by = $5, handled_at = now(),
                  cancel_reason = nullif($6, '')
            where id::text = $1 and hotel_id = $2 and status = any($3)`,
      b.action === "confirm" ? [c.req.param("id"), at.hotelId, from]
        : [c.req.param("id"), at.hotelId, from, b.action === "done" ? "done" : "cancelled", session.staffId, reason]);
    return rowCount ? { ok: true as const } : { ok: false as const, reason: "That call is already closed." };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json({ ok: false, reason: WAKE_REFUSED }, 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Lost property ─────────────────────────────────────────────── */

wakeAndLost.get("/:code/lost-property", async (c) => {
  const cleared = c.req.query("view") === "cleared";
  const body = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    if (at.role === null || !LOST_LOGGERS.includes(at.role)) return { forbidden: true as const };
    const { rows } = await client.query(
      `select l.id::text, l.what, l.found_where as "foundWhere", rm.number as room, l.kept_where as "keptWhere",
              app.hotel_clock(l.hotel_id, l.found_at, 'YYYY-MM-DD') as "foundOn",
              (app.hotel_day(l.hotel_id, now()) - app.hotel_day(l.hotel_id, l.found_at))::int as "daysKept",
              app.colleague_name(l.found_by, l.hotel_id) as "foundBy", l.status,
              l.returned_to as "returnedTo", l.dispose_reason as "disposeReason",
              app.colleague_name(l.handled_by, l.hotel_id) as "handledBy",
              app.hotel_clock(l.hotel_id, l.handled_at, 'YYYY-MM-DD') as "handledOn"
         from lost_items l left join rooms rm on rm.id = l.room_id
        where l.hotel_id = $1 and ${cleared
          ? `l.status <> 'kept' order by l.handled_at desc limit 100`
          : `l.status = 'kept' order by l.found_at`}`, [at.hotelId]);
    return { items: rows, mayClear: desk(at.role) };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json({ ok: false, reason: LOST_REFUSED }, 403);
  return c.json(body);
});

wakeAndLost.post("/:code/lost-property", async (c) => {
  type Body = { what?: string; foundWhere?: string; roomNumber?: string; keptWhere?: string };
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const what = b.what?.trim() ?? "";
  const where = b.foundWhere?.trim() ?? "";
  if (!what || !where || what.length > 200 || where.length > 200 || (b.keptWhere?.length ?? 0) > 200) {
    return c.json({ ok: false, reason: "Say what was found, and where." }, 409);
  }
  const result = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    if (at.role === null || !LOST_LOGGERS.includes(at.role)) return { forbidden: true as const };
    let roomId: string | null = null;
    if (b.roomNumber?.trim()) {
      const { rows } = await client.query<{ id: string }>(
        "select id::text from rooms where hotel_id = $1 and upper(number) = upper($2)", [at.hotelId, b.roomNumber.trim()]);
      if (!rows[0]) return { ok: false as const, reason: `There is no room ${b.roomNumber.trim()} here.` };
      roomId = rows[0].id;
    }
    await client.query(
      `insert into lost_items (hotel_id, what, found_where, room_id, kept_where, found_by)
       values ($1, $2, $3, $4, nullif($5, ''), $6)`,
      [at.hotelId, what, where, roomId, b.keptWhere?.trim() ?? "", session.staffId]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json({ ok: false, reason: LOST_REFUSED }, 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* returned (to whom) or disposed (why) - the desk only. */
wakeAndLost.patch("/:code/lost-property/:id", async (c) => {
  const b = await c.req.json<{ action?: string; to?: string; reason?: string }>()
    .catch(() => ({}) as { action?: string; to?: string; reason?: string });
  const words = (b.action === "returned" ? b.to : b.reason)?.trim() ?? "";
  if (b.action !== "returned" && b.action !== "disposed") {
    return c.json({ ok: false, reason: "Returned, or disposed?" }, 409);
  }
  if (!words || words.length > 200) {
    return c.json({ ok: false, reason: b.action === "returned" ? "Say who it went to." : "Say why." }, 409);
  }
  const result = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    if (!desk(at.role)) return { forbidden: true as const };
    const { rowCount } = await client.query(
      `update lost_items set status = $3, handled_by = $4, handled_at = now(),
              returned_to = case when $3 = 'returned' then $5 end,
              dispose_reason = case when $3 = 'disposed' then $5 end
        where id::text = $1 and hotel_id = $2 and status = 'kept'`,
      [c.req.param("id"), at.hotelId, b.action, session.staffId, words]);
    return rowCount ? { ok: true as const } : { ok: false as const, reason: "That item is already cleared." };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json({ ok: false, reason: CLEAR_REFUSED }, 403);
  return c.json(result, result.ok ? 200 : 409);
});
