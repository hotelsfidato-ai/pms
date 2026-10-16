import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { can, type Role } from "../../permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   GUEST REQUESTS - in-stay requests (D27-178, the owner's D27-181)

   A request is a WORK ORDER that carries the stay it is for (the migration
   "a guest's request is a work order"): housekeeping's table, states and
   history, not a second system. Raised here by the desk or a team, or by the
   guest from their own page (app.guest_request_make). Three kinds, one per
   team: housekeeping, maintenance ("something broken"), fnb (food and
   drink). "Something broken" is a repair like any other, so housekeeping's
   Work orders shows it too and closing it asks what was done; the other two
   close with one tap.

   WHO (D27-181): the desk sees every request and may act on any; each team
   sees and acts on its own. Anybody who sees the screen may raise one.
     desk          owner, admin, GM, hotel manager, reception
     housekeeping  housekeeping
     maintenance   whoever updates a repair today (D22-34, the same list as
                   housekeeping/repairRoles.ts REPAIR_UPDATERS - held by the
                   API test)
     fnb           kitchen manager, chef, waiter, Bar (D27-329 (3))
   No time targets (D27-181): how long each waited and took, nothing more.
   ══════════════════════════════════════════════════════════════════ */

export const TEAMS = ["housekeeping", "maintenance", "fnb"] as const;
export type Team = (typeof TEAMS)[number];

export const DESK: readonly Role[] = ["owner", "admin", "gm", "hotel_manager", "front_desk"];
export const RECEIVERS: Record<Team, readonly Role[]> = {
  housekeeping: ["housekeeping"],
  maintenance: ["owner", "admin", "gm", "hotel_manager", "stores", "housekeeping"],
  fnb: ["kitchen_manager", "chef", "pos", "bar"],
};

/** The teams whose requests a role sees and acts on: all three for the desk. */
export const teamsFor = (role: Role | null): Team[] =>
  role === null ? [] : TEAMS.filter((t) => DESK.includes(role) || RECEIVERS[t].includes(role));

/** A work order's team, by its category (058's repair categories are maintenance). */
const TEAM_OF = `case when w.category in ('housekeeping', 'fnb') then w.category else 'maintenance' end`;
const teamOf = (category: string): Team =>
  category === "housekeeping" || category === "fnb" ? category : "maintenance";

export const REFUSED =
  "Guest requests are for the front desk, housekeeping, the kitchen and the restaurant. Ask one of them.";

export const requests = new Hono<{ Variables: { subject: string } }>();

type Session = { staffId: string; isGroupAdmin: boolean };

/** The property, and the person's role there - `owner` for a group administrator. */
export async function placeAndRole(client: Client, session: Session, code: string) {
  const { rows } = await client.query<{ id: string; role: Role | null }>(
    `select h.id::text,
            (select role from staff_hotels where staff_id = $2 and hotel_id = h.id) as role
       from hotels h where h.code = upper($1) and h.is_active`,
    [code, session.staffId]);
  const at = rows[0];
  if (!at) return null;
  return { hotelId: at.id, role: session.isGroupAdmin ? "owner" as Role : at.role };
}

requests.get("/:code/requests", async (c) => {
  const done = c.req.query("view") === "done";
  const body = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    const teams = teamsFor(at.role);
    if (teams.length === 0) return { forbidden: true as const };
    /* A guest's name only for a role that reads guests (the bell's rule, D27-153). */
    const names = can(at.role!, "view", "customer");

    const { rows } = await client.query<{
      id: string; team: Team; room: string | null; guest: string | null; what: string;
      when: string | null; status: string; from_guest: boolean; raised_by: string | null;
      raised_at: string; taken_by: string | null; closed_at: string | null;
      resolution: string | null; minutes: number;
    }>(
      `select w.id::text, ${TEAM_OF} as team, rm.number as room, g.full_name as guest,
              w.title as what, w.detail as "when", w.status, w.raised_by_guest as from_guest,
              app.colleague_name(w.raised_by, w.hotel_id) as raised_by, w.raised_at,
              app.colleague_name(w.assigned_to, w.hotel_id) as taken_by,
              w.closed_at, w.resolution,
              floor(extract(epoch from coalesce(w.closed_at, now()) - w.raised_at) / 60)::int as minutes
         from work_orders w
         left join rooms rm        on rm.id = w.room_id
         left join reservations r  on r.id = w.reservation_id
         left join guests g        on g.id = r.guest_id
        where w.hotel_id = $1 and w.reservation_id is not null
          and ${TEAM_OF} = any($2::text[])
          and ${done
            ? `w.status in ('done', 'cancelled') and w.closed_at > now() - interval '24 hours'
               order by w.closed_at desc`
            : `w.status in ('open', 'in_progress') order by w.raised_at`}`,
      [at.hotelId, teams]);

    /* Who is in which room now - the New request dialog's list. */
    const { rows: rooms } = await client.query<{ reservation_id: string; room: string; guest: string | null }>(
      `select r.id::text as reservation_id, rm.number as room, g.full_name as guest
         from reservations r
         join room_assignments ra on ra.reservation_id = r.id and ra.released_at is null
         join rooms rm            on rm.id = ra.room_id
         left join guests g       on g.id = r.guest_id
        where r.hotel_id = $1 and r.status = 'checked_in'
        order by rm.number collate app.room_order`,
      [at.hotelId]);

    return {
      teams,
      requests: rows.map((w) => ({
        id: w.id, team: w.team, room: w.room, guest: names ? w.guest : null,
        what: w.what, when: w.when, status: w.status, fromGuest: w.from_guest,
        raisedBy: w.raised_by, raisedAt: w.raised_at, takenBy: w.taken_by,
        closedAt: w.closed_at, resolution: w.resolution, minutes: w.minutes,
      })),
      rooms: rooms.map((r) => ({
        reservationId: r.reservation_id, room: r.room, guest: names ? r.guest : null,
      })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json({ ok: false, reason: REFUSED }, 403);
  return c.json(body);
});

requests.post("/:code/requests", async (c) => {
  type Body = { reservationId?: string; team?: string; what?: string; when?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const what = input.what?.trim() ?? "";
  const when = input.when?.trim() ?? "";
  if (!TEAMS.includes(input.team as Team)) {
    return c.json({ ok: false, reason: "Housekeeping, something broken, or food and drink?" }, 409);
  }
  if (what === "" || what.length > 500 || when.length > 100) {
    return c.json({ ok: false, reason: "Say what is wanted, in a sentence or two." }, 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    if (teamsFor(at.role).length === 0) return { forbidden: true as const };

    /* Every refusal before the write (root MEMORY 243). */
    const { rows: stay } = await client.query<{ room_id: string }>(
      `select ra.room_id::text
         from reservations r
         join room_assignments ra on ra.reservation_id = r.id and ra.released_at is null
        where r.id::text = $1 and r.hotel_id = $2 and r.status = 'checked_in'
        order by ra.from_date desc, ra.created_at desc limit 1`,
      [input.reservationId ?? "", at.hotelId]);
    if (!stay[0]) return { ok: false as const, reason: "That guest is not in house now." };

    const { rows } = await client.query<{ id: string }>(
      `insert into work_orders (hotel_id, room_id, reservation_id, title, detail, category, raised_by)
       values ($1, $2, $3, $4, nullif($5, ''), $6, $7)
       returning id::text`,
      [at.hotelId, stay[0].room_id, input.reservationId, what, when, input.team, session.staffId]);
    return { ok: true as const, id: rows[0]!.id };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json({ ok: false, reason: REFUSED }, 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* Take it (it is being done, by me), mark it done, or cancel it with a
   reason. Done straight from open is allowed: whoever did it took it. */
requests.patch("/:code/requests/:id", async (c) => {
  type Body = { action?: string; note?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const note = input.note?.trim() ?? "";
  if (!["take", "done", "cancel"].includes(input.action ?? "")) {
    return c.json({ ok: false, reason: "Take it, done, or cancel?" }, 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const at = await placeAndRole(client, session, c.req.param("code"));
    if (!at) return null;
    const { rows: found } = await client.query<{ category: string; status: string; taken_by: string | null }>(
      `select category, status, app.colleague_name(assigned_to, hotel_id) as taken_by
         from work_orders
        where id::text = $1 and hotel_id = $2 and reservation_id is not null
        for update`,
      [c.req.param("id"), at.hotelId]);
    const order = found[0];
    if (!order) {
      return teamsFor(at.role).length ? { ok: false as const, reason: "No such request." } : { forbidden: true as const };
    }
    const team = teamOf(order.category);
    if (!teamsFor(at.role).includes(team)) return { forbidden: true as const };

    if (order.status === "done" || order.status === "cancelled") {
      return { ok: false as const, reason: "This request is already closed." };
    }
    if (input.action === "take" && order.status === "in_progress") {
      return { ok: false as const, reason: `${order.taken_by ?? "Somebody"} has already taken it.` };
    }
    /* A broken thing is a repair: what was done is the line somebody reads
       the next time it breaks (058). The other two close with one tap. */
    if (input.action === "done" && team === "maintenance" && note === "") {
      return { ok: false as const, reason: "Say what was done. It is the line somebody reads next time." };
    }
    if (input.action === "cancel" && note === "") {
      return { ok: false as const, reason: "Say why it is cancelled." };
    }

    if (input.action === "take") {
      await client.query(
        `update work_orders set status = 'in_progress', assigned_to = $2 where id::text = $1`,
        [c.req.param("id"), session.staffId]);
    } else {
      await client.query(
        `update work_orders
            set status = $2,
                assigned_to = case when $2 = 'done' then coalesce(assigned_to, $3::uuid)
                                   else assigned_to end,
                resolution = $4, closed_by = $3::uuid, closed_at = now()
          where id::text = $1`,
        [c.req.param("id"), input.action === "done" ? "done" : "cancelled", session.staffId,
         note || "Done"]);
    }
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json({ ok: false, reason: REFUSED }, 403);
  return c.json(result, result.ok ? 200 : 409);
});
