import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { phoneProblem } from "../../validate.ts";
import { openOrderFor } from "./till.ts";

/* ══════════════════════════════════════════════════════════════════
   TABLE BOOKINGS - THE RESTAURANT'S SIDE (the owner's D27-221, D27-224;
   outside diners, D27-383 item 9, built under D27-396)

   A hotel guest asks for a table from their own page (the door's
   functions, migration "a table for the guest"); a person at the
   restaurant confirms it - naming a table if they like - or declines it
   with a reason the guest reads. No capacity rules: the person decides.

   Somebody who is not staying is booked here by a person (263): a name, a
   phone, the party, the day and time, a table or an area, a note. It is
   confirmed as it is taken. On the night every confirmed booking - a hotel
   guest's too - is marked arrived, seated at a table (which opens that
   table's bill, as Tables does), a no-show once its time has come, or
   cancelled.

     GET   /:code/table-bookings?date=        waiting first, then that day (today) on
     POST  /:code/table-bookings              an outside diner's booking
     POST  /:code/table-bookings/:id/confirm  { tableId? }   only while requested
     POST  /:code/table-bookings/:id/decline  { reason }     only while requested
     POST  /:code/table-bookings/:id/arrive   confirmed -> arrived
     POST  /:code/table-bookings/:id/seat     { tableId }    confirmed or arrived -> seated
     POST  /:code/table-bookings/:id/no-show  confirmed, its time come -> no_show
     POST  /:code/table-bookings/:id/cancel   { reason? }    confirmed or arrived -> cancelled
     GET   /:code/table-bookings/hours        each restaurant's lunch and dinner hours
     PUT   /:code/table-bookings/hours        { outlet, lunch, dinner }

   WHO: everything but the hours is the till's people (roleGate TABLE_ANSWER,
   TABLE_BOOK: whoever may ring an order); the hours are Restaurant setup's
   (TABLE_HOURS: the owner, an administrator or the GM). The rows are this
   hotel's by row security, and the database checks the table is too. Every
   refusal comes before the first write (MEMORY 243).

   Kept out of till.ts on purpose (the POS lane works there).
   ══════════════════════════════════════════════════════════════════ */

export const tableBookings = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const NO_SUCH = { error: "No such property." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOURS = /^([01][0-9]|2[0-3]):[03]0-([01][0-9]|2[0-3]):[03]0$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1)", [code]);
  return rows[0]?.id ?? null;
}

tableBookings.get("/:code/table-bookings", async (c) => {
  const date = c.req.query("date") ?? "";
  if (date && !DAY.test(date)) return c.json(refuse("Dates are written 2026-11-06."), 409);
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* From the chosen day (the hotel's today unless one is asked): what is
       waiting whatever its night, and what is coming. */
    const { rows } = await client.query<{
      id: string; at: Date; date: string; time: string; party: number; note: string | null;
      status: string; answer: string | null; table_id: string | null; table_label: string | null;
      outlet: string; guest: string; reference: string | null; room: string | null; answered_by: string | null;
      phone: string | null; outside: boolean; section_id: string | null; section_name: string | null;
      arrived_at: string | null; order_id: string | null; order_no: string | null;
    }>(
      `select b.id::text, b.at,
              to_char(b.at at time zone h.timezone, 'YYYY-MM-DD') as date,
              to_char(b.at at time zone h.timezone, 'HH24:MI') as time,
              b.party, b.note, b.status, b.answer,
              b.table_id::text, t.label as table_label, o.name as outlet,
              coalesce(g.full_name, b.diner_name) as guest, r.reference, app.stay_room(r.id) as room,
              s.full_name as answered_by,
              b.diner_phone as phone, b.reservation_id is null as outside,
              b.section_id::text, sec.name as section_name,
              to_char(b.arrived_at at time zone h.timezone, 'HH24:MI') as arrived_at,
              b.order_id::text, po.order_no
         from table_bookings b
         join hotels h on h.id = b.hotel_id
         join pos_outlets o on o.id = b.outlet_id
         left join reservations r on r.id = b.reservation_id
         left join guests g on g.id = r.guest_id
         left join pos_tables t on t.id = b.table_id
         left join pos_sections sec on sec.id = b.section_id
         left join pos_orders po on po.id = b.order_id
         left join staff s on s.id = b.answered_by
        where b.hotel_id = $1
          and (b.at at time zone h.timezone)::date
              >= coalesce($2::date, (now() at time zone h.timezone)::date)
        order by (b.status = 'requested') desc, b.at`,
      [hotelId, date || null]);
    const { rows: tables } = await client.query<{ id: string; label: string; section: string | null }>(
      `select t.id::text, t.label, s.name as section from pos_tables t
         left join pos_sections s on s.id = t.section_id
        where t.hotel_id = $1 and t.is_active
        order by s.sort_order nulls last, t.row_no nulls last, t.col_no nulls last, t.label`,
      [hotelId]);
    const { rows: sections } = await client.query<{ id: string; name: string }>(
      `select s.id::text, s.name from pos_sections s
         join pos_outlets o on o.id = s.outlet_id
        where s.hotel_id = $1 and s.is_active and o.is_active and o.category = 'food'
        order by s.sort_order, s.name`,
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
        /* An outside diner (263): their own phone; no stay, room or reference. */
        outside: b.outside, phone: b.phone,
        section: b.section_id ? { id: b.section_id, name: b.section_name } : null,
        arrivedAt: b.arrived_at,
        order: b.order_id ? { id: b.order_id, orderNo: b.order_no } : null,
      })),
      tables,
      sections,
    };
  });
  return body ? c.json(body) : c.json(NO_SUCH, 404);
});

/* ── An outside diner's booking (263) ───────────────────────────────── */

tableBookings.post("/:code/table-bookings", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const text = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");
  const name = text("name");
  const phone = text("phone");
  const date = text("date");
  const time = text("time");
  const note = text("note");
  const party = Number(input["party"]);
  const tableId = text("tableId") || null;
  const sectionId = text("sectionId") || null;
  if (!name) return c.json(refuse("Whose booking is it? Type the name."), 409);
  if (name.length > 60) return c.json(refuse("A name is at most 60 characters."), 409);
  if (!phone) return c.json(refuse("A phone number, so the restaurant can call them."), 409);
  const badPhone = phoneProblem(phone);
  if (badPhone) return c.json(refuse(badPhone), 409);
  if (!Number.isInteger(party) || party < 1 || party > 20) {
    return c.json(refuse("How many people: 1 to 20. A bigger party is a banquet function."), 409);
  }
  if (!DAY.test(date) || !TIME.test(time)) return c.json(refuse("Which day, and what time?"), 409);
  if (note.length > 200) return c.json(refuse(`The note is ${note.length} characters. The most is 200.`), 409);
  if ((tableId && !UUID.test(tableId)) || (sectionId && !UUID.test(sectionId))) {
    return c.json(refuse("That table or area is not one of this restaurant's."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows: [o] } = await client.query<{ id: string; past: boolean }>(
      `select o.id::text, $3::date < (now() at time zone h.timezone)::date as past
         from pos_outlets o join hotels h on h.id = o.hotel_id
        where o.hotel_id = $1 and o.code = $2 and o.is_active and o.category = 'food'`,
      [hotelId, text("outlet").toUpperCase() || "REST", date]);
    if (!o) return refuse("This hotel has no restaurant to book. Name it on Restaurant setup.");
    if (o.past) return refuse("That day has gone. Book today or a day to come.");
    if (tableId) {
      const { rowCount } = await client.query(
        `select 1 from pos_tables t join pos_sections s on s.id = t.section_id
          where t.id = $1 and s.outlet_id = $2 and t.is_active`, [tableId, o.id]);
      if (!rowCount) return refuse("That table is not one of this restaurant's.");
    }
    if (sectionId && !tableId) {
      const { rowCount } = await client.query(
        "select 1 from pos_sections where id = $1 and outlet_id = $2 and is_active", [sectionId, o.id]);
      if (!rowCount) return refuse("That area is not one of this restaurant's.");
    }
    /* Taken by a person, so confirmed as it is made - by them. */
    const { rows: [made] } = await client.query<{ id: string }>(
      `insert into table_bookings
         (hotel_id, outlet_id, diner_name, diner_phone, party, at, note, status,
          table_id, section_id, answered_by, answered_at)
       select $1, $2, $3, $4, $5, ($6::date + $7::time) at time zone h.timezone, $8, 'confirmed',
              $9, $10, app.current_user_id(), now()
         from hotels h where h.id = $1
       returning id::text`,
      [hotelId, o.id, name, phone, party, date, time, note || null, tableId, tableId ? null : sectionId]);
    return { ok: true as const, id: made!.id };
  });
  if (!result) return c.json(NO_SUCH, 404);
  return c.json(result, result.ok ? 200 : 409);
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

/* ── On the night: arrived, seated, a no-show, cancelled (263) ──────── */

type Held = {
  id: string; status: string; party: number; due: boolean; at: string;
  outlet: string; diner_name: string | null; diner_phone: string | null; guest: string | null;
};

/** The booking, locked, if it is this hotel's. */
async function held(client: Client, hotelId: string, id: string): Promise<Held | null> {
  if (!UUID.test(id)) return null;
  const { rows: [b] } = await client.query<Held>(
    `select b.id::text, b.status, b.party, now() >= b.at as due,
            to_char(b.at at time zone h.timezone, 'HH24:MI') as at,
            o.code as outlet, b.diner_name, b.diner_phone, g.full_name as guest
       from table_bookings b
       join hotels h on h.id = b.hotel_id
       join pos_outlets o on o.id = b.outlet_id
       left join reservations r on r.id = b.reservation_id
       left join guests g on g.id = r.guest_id
      where b.id = $1 and b.hotel_id = $2
        for update of b`, [id, hotelId]);
  return b ?? null;
}

const WORDS: Record<string, string> = {
  requested: "still waiting for an answer", declined: "declined", cancelled: "cancelled",
  confirmed: "confirmed", arrived: "arrived", seated: "seated", no_show: "a no-show",
};

/** One act on the night, from the states it may be done in. */
function night(
  path: string, from: readonly string[],
  act: (client: Client, hotelId: string, b: Held, staffId: string, input: Record<string, unknown>) =>
    Promise<{ ok: true; [k: string]: unknown } | { ok: false; reason: string }>,
) {
  tableBookings.post(`/:code/table-bookings/:id/${path}`, async (c) => {
    const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const b = await held(client, hotelId, c.req.param("id"));
      if (!b) return null;
      if (!from.includes(b.status)) {
        return refuse(b.status === "requested"
          ? "This booking is still waiting for an answer: confirm it first, or decline it."
          : `This booking is ${WORDS[b.status] ?? b.status} already.`);
      }
      return act(client, hotelId, b, session.staffId, input);
    });
    if (!result) return c.json({ error: "No such booking." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });
}

night("arrive", ["confirmed"], async (client, _h, b) => {
  await client.query(
    "update table_bookings set status = 'arrived', arrived_at = now() where id = $1", [b.id]);
  return { ok: true };
});

/* SEATED: the table's bill opens as Tables opens one - the same function,
   so a busy table, a closed restaurant or a closed day refuse it the same
   way - with the party as its covers and the diner's name on it. */
night("seat", ["confirmed", "arrived"], async (client, hotelId, b, staffId, input) => {
  const tableId = typeof input["tableId"] === "string" ? input["tableId"] : "";
  if (!UUID.test(tableId)) return refuse("Which table are they seated at?");
  const { rows: [gate] } = await client.query<{ pos: boolean; may: boolean }>(
    "select app.module_enabled($1, 'pos') as pos, app.may_use_pos($1) as may", [hotelId]);
  if (!gate!.pos) return refuse("This property has no point of sale, so no bill can be opened.");
  if (!gate!.may) {
    return refuse("Reception is not set up to use the point of sale at this property, so a waiter seats them.");
  }
  const opened = await openOrderFor(client, staffId, hotelId, { outlet: b.outlet, tableId, parcel: null });
  if (!opened.ok) return opened;
  await client.query(
    `update pos_orders set covers = $2, customer_name = $3, customer_phone = $4 where id = $1`,
    [opened.id, b.party, b.diner_name ?? b.guest, b.diner_phone]);
  await client.query(
    "update table_bookings set status = 'seated', table_id = $2, order_id = $3 where id = $1",
    [b.id, tableId, opened.id]);
  return { ok: true, orderId: opened.id };
});

night("no-show", ["confirmed"], async (client, _h, b) => {
  if (!b.due) return refuse(`They are booked for ${b.at}: a no-show is marked once that time has come.`);
  await client.query("update table_bookings set status = 'no_show' where id = $1", [b.id]);
  return { ok: true };
});

night("cancel", ["confirmed", "arrived"], async (client, _h, b, _s, input) => {
  const why = typeof input["reason"] === "string" ? input["reason"].trim() : "";
  if (why.length > 200) return refuse(`The reason is ${why.length} characters. The most is 200.`);
  await client.query(
    "update table_bookings set status = 'cancelled', answer = $2 where id = $1", [b.id, why || null]);
  return { ok: true };
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
