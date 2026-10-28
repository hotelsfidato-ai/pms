import type { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import { readOrder } from "./till.ts";

/* ══════════════════════════════════════════════════════════════════
   TABLE SHIFTING (the owner's D27-370, 27 October): two separate acts,
   for whoever takes orders (roleGate TILL), and no printed slip for
   either - the Kitchen screen re-reads the order live (075).

   POST /:code/till/orders/:id/move  { tableId }  this order to a FREE
        table of its section. Its KOTs and its bill hang off the order
        and go with it; the old table is free.
   POST /:code/till/orders/:id/join  { tableId }  the open order on that
        table comes onto this one - its lines, and so its KOTs - and is
        closed as JOINED (no sale, no void, not closed unpaid). For good.

   Each is kept in pos_table_moves (244): who, when, from which table to
   which. Every refusal comes before the first write (MEMORY 243). What the
   owner has not settled - another section, a discount, a held order, a
   function, a booked table - is refused in a plain sentence for now.

   Registered on the till's router by till.ts, as the KOT section is.
   ══════════════════════════════════════════════════════════════════ */

type App = Hono<{ Variables: { subject: string } }>;
type HotelFor = (client: Client, code: string) => Promise<string | null>;

const refuse = (reason: string) => ({ ok: false as const, reason });

type Side = {
  id: string; order_no: string; status: string; order_type: string; outlet_id: string;
  business_date: string; table_id: string | null; table_ref: string | null;
  section_id: string | null; section: string | null;
  held: boolean; event: boolean; adjusted: boolean;
};

/** The order and its floor table, locked, as both acts read it. */
async function orderSide(client: Client, hotelId: string, where: string, arg: string): Promise<Side | undefined> {
  const { rows } = await client.query<Side>(
    `select o.id::text, o.order_no, o.status, o.order_type, o.outlet_id::text,
            to_char(o.business_date, 'YYYY-MM-DD') as business_date,
            o.table_id::text, o.table_ref, t.section_id::text, s.name as section,
            o.held_at is not null as held, o.event_id is not null as event,
            (o.discount_amount <> 0 or o.promotion_id is not null
             or coalesce(o.round_off, 0) <> 0) as adjusted
       from pos_orders o
       left join pos_tables t on t.id = o.table_id
       left join pos_sections s on s.id = t.section_id
      where o.hotel_id = $1 and ${where}
      for update of o`,
    [hotelId, arg]);
  return rows[0];
}

/** Why this order cannot leave its table, or null. Both acts ask it. */
function notMovable(o: Side | undefined): string | null {
  if (!o) return "No such order.";
  if (o.status !== "open") return `Bill ${o.order_no} is not open.`;
  if (o.order_type !== "dine_in") return "Only a dine-in order sits at a table. A parcel or room-service order has none to change.";
  if (!o.table_id) return `Bill ${o.order_no} is not on one of the floor's tables.`;
  return null;
}

/** The table asked for, in this order's section. */
async function targetTable(
  client: Client, hotelId: string, from: Side, tableId: string,
): Promise<{ id: string; label: string } | string> {
  const { rows: [t] } = await client.query<{ id: string; label: string; section_id: string; outlet_id: string }>(
    `select t.id::text, t.label, t.section_id::text, s.outlet_id::text
       from pos_tables t join pos_sections s on s.id = t.section_id
      where t.id::text = $1 and t.hotel_id = $2 and t.is_active and s.is_active`,
    [tableId, hotelId]);
  if (!t) return "No such table.";
  if (t.id === from.table_id) return `Bill ${from.order_no} is already on ${t.label}.`;
  if (t.outlet_id !== from.outlet_id) return "That table is in another restaurant. An order stays in its own restaurant.";
  if (t.section_id !== from.section_id) {
    return `${t.label} is in another section. For now an order moves or joins only within ${from.section ?? "its section"}.`;
  }
  return { id: t.id, label: t.label };
}

export function registerTableMoves(till: App, hotelFor: HotelFor): void {
  till.post("/:code/till/orders/:id/move", async (c) => {
    const input = await c.req.json<{ tableId?: unknown }>().catch(() => ({} as { tableId?: unknown }));
    if (typeof input.tableId !== "string" || !input.tableId) return c.json(refuse("Which table does it move to?"), 409);
    const tableId = input.tableId;

    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const order = await orderSide(client, hotelId, "o.id::text = $2", c.req.param("id"));
      const why = notMovable(order);
      if (why) return refuse(why);
      const o = order!;
      const t = await targetTable(client, hotelId, o, tableId);
      if (typeof t === "string") return refuse(t);

      /* FREE: nothing on it - an open bill, or a finished one not yet cleared,
         which Tables would show over this order. */
      const { rows: [busy] } = await client.query<{ order_no: string; status: string }>(
        `select order_no, status from pos_orders where table_id = $1 and cleared_at is null
          order by opened_at desc limit 1`, [t.id]);
      if (busy) {
        return refuse(busy.status === "open"
          ? `${t.label} already has ${busy.order_no} running on it. Join it instead, or choose a free table.`
          : `${t.label} still has bill ${busy.order_no} on it. Clear the table first.`);
      }
      /* A table a hotel guest has booked for today (172) is not taken here. */
      const { rows: [booked] } = await client.query<{ n: number }>(
        `select count(*)::int as n from table_bookings b
          where b.table_id = $1 and b.status = 'confirmed'
            and app.hotel_clock(b.hotel_id, b.at, 'YYYY-MM-DD') = $2`,
        [t.id, await businessDateFor(client, hotelId)]);
      if (booked!.n > 0) return refuse(`${t.label} is booked by a hotel guest today. Choose another table.`);

      await client.query(
        `update pos_orders set table_id = $2, table_ref = $3, updated_at = now() where id = $1`,
        [o.id, t.id, t.label]);
      await client.query(
        `insert into pos_table_moves (hotel_id, order_id, from_table, to_table, moved_by)
         values ($1, $2, $3, $4, $5)`,
        [hotelId, o.id, o.table_ref ?? "-", t.label, session.staffId]);
      return { ok: true as const, ...(await readOrder(client, o.id))! };
    });

    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  });

  till.post("/:code/till/orders/:id/join", async (c) => {
    const input = await c.req.json<{ tableId?: unknown }>().catch(() => ({} as { tableId?: unknown }));
    if (typeof input.tableId !== "string" || !input.tableId) return c.json(refuse("Which table joins this one?"), 409);
    const tableId = input.tableId;

    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const order = await orderSide(client, hotelId, "o.id::text = $2", c.req.param("id"));
      const why = notMovable(order);
      if (why) return refuse(why);
      const keep = order!;
      const t = await targetTable(client, hotelId, keep, tableId);
      if (typeof t === "string") return refuse(t);

      const other = await orderSide(client, hotelId,
        "o.table_id::text = $2 and o.status = 'open' and o.cleared_at is null", t.id);
      if (!other) return refuse(`${t.label} has no open bill to join. Move this order there instead.`);
      const whyOther = notMovable(other);
      if (whyOther) return refuse(whyOther);

      /* Not settled by the owner yet (D27-370): refused, each in a sentence. */
      for (const o of [keep, other]) {
        if (o.held) return refuse(`Bill ${o.order_no} is held. Resume it before joining.`);
        if (o.event) return refuse(`Bill ${o.order_no} is on a function's bill. A function's order is not joined.`);
        if (o.adjusted) return refuse(`Bill ${o.order_no} has a discount or a round-off on it. Take it off before joining.`);
      }
      if (keep.business_date !== other.business_date) {
        return refuse(`Bill ${other.order_no} is of another business day. Only bills of the same day are joined.`);
      }
      const { rows: [waits] } = await client.query<{ tenders: number; requests: number; prints: number }>(
        `select (select count(*)::int from pos_order_tenders where order_id = any($1::uuid[])) as tenders,
                (select count(*)::int from pos_requests
                  where order_id = any($1::uuid[]) and status = 'pending') as requests,
                (select count(*)::int from pos_bill_prints
                  where order_id = $2 and printed_at is null and not printed_here)
              + (select count(*)::int from pos_kot_reprints
                  where order_id = $2 and printed_at is null) as prints`,
        [[keep.id, other.id], other.id]);
      if (waits!.tenders > 0) return refuse("A payment has been taken on one of these bills. They are not joined.");
      if (waits!.requests > 0) return refuse("A request to the GM is waiting on one of these bills. Wait for the answer first.");
      if (waits!.prints > 0) return refuse(`Something of bill ${other.order_no} is waiting at a printer. Let it print first.`);

      /* Its lines, and with them its KOTs (a KOT number is the outlet's for
         the day, 049); the KOTs' printed marks too, or the KOT computer
         prints them again under this order - no slip (D27-370). */
      await client.query("update pos_order_lines set order_id = $1 where order_id = $2", [keep.id, other.id]);
      await client.query("update pos_kot_prints set order_id = $1 where order_id = $2", [keep.id, other.id]);
      await client.query(
        `update pos_orders set status = 'joined', joined_into = $1, cleared_at = now(), updated_at = now()
          where id = $2`, [keep.id, other.id]);
      await client.query(
        `insert into pos_table_moves (hotel_id, order_id, joined_order_id, from_table, to_table, moved_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [hotelId, keep.id, other.id, other.table_ref ?? t.label, keep.table_ref ?? "-", session.staffId]);
      return { ok: true as const, ...(await readOrder(client, keep.id))! };
    });

    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  });
}
