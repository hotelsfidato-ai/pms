import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   TABLE BOOKINGS - THE RESTAURANT'S SIDE (the owner's D27-221, D27-224)

   A hotel guest asks for a table from their own page (the door's
   functions, migration "a table for the guest"); a person at the
   restaurant confirms it - naming a table if they like - or declines it
   with a reason the guest reads. No capacity rules: the person decides.

     GET   /:code/table-bookings              waiting first, then today and upcoming
     POST  /:code/table-bookings/:id/confirm  { tableId? }   only while requested
     POST  /:code/table-bookings/:id/decline  { reason }     only while requested
     GET   /:code/table-bookings/hours        each restaurant's lunch and dinner hours
     PUT   /:code/table-bookings/hours        { outlet, lunch, dinner }

   WHO: answering is the till's people (roleGate TABLE_ANSWER: whoever may
   ring an order); the hours are Restaurant setup's (TABLE_HOURS: the
   owner, an administrator or the GM). The rows are this hotel's by row
   security, and the database checks the table is too.

   Kept out of till.ts on purpose (the POS lane works there).
   ══════════════════════════════════════════════════════════════════ */

export const tableBookings = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const NO_SUCH = { error: "No such property." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOURS = /^([01][0-9]|2[0-3]):[03]0-([01][0-9]|2[0-3]):[03]0$/;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1)", [code]);
  return rows[0]?.id ?? null;
}

tableBookings.get("/:code/table-bookings", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* From the start of the hotel's today: what is waiting, and what is coming. */
    const { rows } = await client.query<{
      id: string; at: Date; date: string; time: string; party: number; note: string | null;
      status: string; answer: string | null; table_id: string | null; table_label: string | null;
      outlet: string; guest: string; reference: string; room: string | null; answered_by: string | null;
    }>(
      `select b.id::text, b.at,
              to_char(b.at at time zone h.timezone, 'YYYY-MM-DD') as date,
              to_char(b.at at time zone h.timezone, 'HH24:MI') as time,
              b.party, b.note, b.status, b.answer,
              b.table_id::text, t.label as table_label, o.name as outlet,
              g.full_name as guest, r.reference, app.stay_room(r.id) as room,
              s.full_name as answered_by
         from table_bookings b
         join hotels h on h.id = b.hotel_id
         join pos_outlets o on o.id = b.outlet_id
         join reservations r on r.id = b.reservation_id
         join guests g on g.id = r.guest_id
         left join pos_tables t on t.id = b.table_id
         left join staff s on s.id = b.answered_by
        where b.hotel_id = $1
          and (b.at at time zone h.timezone)::date >= (now() at time zone h.timezone)::date
        order by (b.status = 'requested') desc, b.at`,
      [hotelId]);
    const { rows: tables } = await client.query<{ id: string; label: string }>(
      `select t.id::text, t.label from pos_tables t
         left join pos_sections s on s.id = t.section_id
        where t.hotel_id = $1 and t.is_active
        order by s.sort_order nulls last, t.row_no nulls last, t.col_no nulls last, t.label`,
      [hotelId]);
    const { rows: day } = await client.query<{ today: string }>(
      "select to_char(now() at time zone timezone, 'YYYY-MM-DD') as today from hotels where id = $1", [hotelId]);
    return {
      /* The hotel's today, so the screen says "Today" by the hotel's clock. */
      today: day[0]!.today,
      bookings: rows.map((b) => ({
        id: b.id, at: b.at.toISOString(), date: b.date, time: b.time, party: b.party,
        note: b.note, status: b.status, answer: b.answer,
        table: b.table_id ? { id: b.table_id, label: b.table_label } : null,
        outlet: b.outlet, guest: b.guest, reference: b.reference, room: b.room,
        answeredBy: b.answered_by,
      })),
      tables,
    };
  });
  return body ? c.json(body) : c.json(NO_SUCH, 404);
});

/* An answer is given once, to a request that is still waiting: a confirmed
   or declined booking is not answered again here, and a cancelled one has
   nobody to answer. */
async function answer(
  client: Client, code: string, id: string,
  set: { status: "confirmed" | "declined"; tableId: string | null; reason: string | null },
) {
  const hotelId = await hotelFor(client, code);
  if (!hotelId || !UUID.test(id)) return null;
  if (set.tableId) {
    const { rowCount } = await client.query(
      "select 1 from pos_tables where id = $1 and hotel_id = $2 and is_active", [set.tableId, hotelId]);
    if (!rowCount) return refuse("That table is not one of this restaurant's.");
  }
  const { rowCount } = await client.query(
    `update table_bookings
        set status = $3, table_id = $4, answer = $5,
            answered_by = app.current_user_id(), answered_at = now()
      where id = $1 and hotel_id = $2 and status = 'requested'`,
    [id, hotelId, set.status, set.tableId, set.reason]);
  if (rowCount === 1) return { ok: true as const };
  const { rows } = await client.query<{ status: string }>(
    "select status from table_bookings where id = $1 and hotel_id = $2", [id, hotelId]);
  if (!rows[0]) return null;
  return refuse(`This booking is ${rows[0].status} already, so it is not answered again.`);
}

tableBookings.post("/:code/table-bookings/:id/confirm", async (c) => {
  const { tableId } = await c.req.json<{ tableId?: unknown }>().catch(() => ({}) as { tableId?: unknown });
  const table = typeof tableId === "string" && tableId ? tableId : null;
  if (table && !UUID.test(table)) return c.json(refuse("That table is not one of this restaurant's."), 409);
  const result = await withSession(c.get("subject"), (client) =>
    answer(client, c.req.param("code"), c.req.param("id"), { status: "confirmed", tableId: table, reason: null }));
  if (!result) return c.json({ error: "No such booking." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

tableBookings.post("/:code/table-bookings/:id/decline", async (c) => {
  const { reason } = await c.req.json<{ reason?: unknown }>().catch(() => ({}) as { reason?: unknown });
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) return c.json(refuse("Say why, in a few words: the guest reads it."), 409);
  if (why.length > 200) return c.json(refuse(`The reason is ${why.length} characters. The most is 200.`), 409);
  const result = await withSession(c.get("subject"), (client) =>
    answer(client, c.req.param("code"), c.req.param("id"), { status: "declined", tableId: null, reason: why }));
  if (!result) return c.json({ error: "No such booking." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Each restaurant's hours (Restaurant setup) ─────────────────────── */

tableBookings.get("/:code/table-bookings/hours", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      code: string; name: string; lunch: string | null; dinner: string | null; slots: string[];
    }>(
      `select o.code, o.name, o.table_lunch as lunch, o.table_dinner as dinner,
              array(select to_char(s at time zone h.timezone, 'HH24:MI')
                      from app.table_slots(o.id, (now() at time zone h.timezone)::date) s) as slots
         from pos_outlets o join hotels h on h.id = o.hotel_id
        where o.hotel_id = $1 and o.is_active and o.category = 'food'
        order by o.code`, [hotelId]);
    /* NULL is the owner's default; it is said as the hours it gives. */
    return {
      restaurants: rows.map((o) => ({
        code: o.code, name: o.name,
        lunch: o.lunch ?? "12:30-15:00", dinner: o.dinner ?? "19:30-23:00",
        slots: o.slots,
      })),
    };
  });
  return body ? c.json(body) : c.json(NO_SUCH, 404);
});

tableBookings.put("/:code/table-bookings/hours", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const outlet = typeof input["outlet"] === "string" ? input["outlet"].trim().toUpperCase() : "";
  const hours: Record<"lunch" | "dinner", string> = { lunch: "", dinner: "" };
  for (const meal of ["lunch", "dinner"] as const) {
    const typed = typeof input[meal] === "string" ? (input[meal] as string).replace(/\s/g, "") : "";
    const [from, to] = typed.split("-");
    if (typed && (!HOURS.test(typed) || from! >= to!)) {
      return c.json(refuse(
        `${meal === "lunch" ? "Lunch" : "Dinner"} is two times on the hour or half hour, `
        + "the first before the second, such as 12:30-15:00. Leave it empty for none."), 409);
    }
    hours[meal] = typed;
  }
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return false;
    const { rowCount } = await client.query(
      `update pos_outlets set table_lunch = $3, table_dinner = $4
        where hotel_id = $1 and code = $2 and category = 'food'`,
      [hotelId, outlet || "REST", hours.lunch, hours.dinner]);
    return rowCount === 1;
  });
  return done ? c.json({ ok: true }) : c.json({ error: "No such restaurant." }, 404);
});
