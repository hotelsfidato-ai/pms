import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import { can, type Role } from "../../permissions.ts";
import { postCharge } from "../finance/index.ts";
import { issueFromStore } from "../stores/index.ts";
import { roleAt, may } from "./repairRoles.ts";
import { readAmount } from "./repairs.ts";

/* ══════════════════════════════════════════════════════════════════
   THE MINIBAR (D27-383 item 10, built under D27-396) - migration 270

   The list: per hotel, each item a STORE item with the selling price the
   hotel typed (none until typed, and then it cannot be charged) and the
   store its refill comes from. Owner, administrator, GM (the gate's
   room_config edit - they set prices).

   A record: what was taken from one room's minibar, by housekeeping when
   cleaning or the desk at check-out (MINIBAR_RECORDERS, asked here). In ONE
   transaction:
     each line's refill is ISSUED from its store (the Store's door: never
     below zero), so the stock moves;
     the guest in the room: each line goes on their bill through FINANCE'S
     DOOR (postCharge) - food and soft drinks on the restaurant's GST rule,
     as the restaurant's food on a room bill is taxed; a drink (a Store item
     with a `liquor` register row, 238) on the alcohol rule as VAT, never
     GST, exactly as the till posts a bar dish to a room (D21-91) - refused
     where the property does not serve alcohol;
     "not sure" (disputed), or nobody in the room any more (the stay that
     left it): NOTHING is charged - a closed bill is never added to - and the
     record waits for the desk.
   The desk (whoever may add to a bill, the gate's invoice create) decides a
   waiting one once: Charge (finance's door, which refuses a checked-out
   stay's closed bill in its own words) or Not charged with a reason.
   Taking a minibar charge off is the bill's own Reverse, under its own
   rules (a reason; a closed day on Closed days; a tax invoice by a credit
   note) - nothing here.

   A REFUSAL AFTER A WRITE IS THROWN (`Refused`), so the transaction rolls
   back whole: returning it inside `withSession` would commit the refills
   already written (MEMORY 243).
   ══════════════════════════════════════════════════════════════════ */

export const minibar = new Hono<{ Variables: { subject: string } }>();

export const MINIBAR_RECORDERS: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "front_desk", "housekeeping",
];
export const RECORD_REFUSED =
  "Recording what was taken from a minibar is for the owner, an administrator, the general "
  + "manager, the hotel manager, reception or housekeeping. Ask one of them.";

class Refused extends Error {}
const refuse = (reason: string) => ({ ok: false as const, reason });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/** A price as typed: null for none, a positive figure, or undefined for nonsense. */
function priceOf(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  return readAmount(raw) ?? undefined;
}
const PRICE_SANE = "A price is more than zero, in rupees and paise. Leave it empty while nobody has said.";

interface Line { item: string; name: string; quantity: number; price: number; alcohol: boolean; movement: string }

/** What a line puts on the bill: the guest reads the item and how many. */
const words = (l: Line) => `Minibar - ${l.name}${l.quantity > 1 ? ` x ${l.quantity}` : ""}`;

async function charge(client: Client, hotelId: string, stayId: string, recordId: string, lines: Line[]) {
  for (const l of lines) {
    const posted = await postCharge(client, hotelId, stayId, {
      description: words(l),
      amount: Math.round(l.price * l.quantity * 100) / 100,
      category: "Minibar",
      taxKind: l.alcohol ? "alcohol" : "restaurant",
      source: { type: "minibar", id: recordId },
    });
    if (!posted.ok) throw new Refused(posted.reason);
  }
}

/* ── The list, the records, and who may ───────────────────────────── */
minibar.get("/:code/minibar", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const role = (await roleAt(client, hotelId)) as Role | null;
    const mayKeep = role !== null && can(role, "edit", "room_config");

    const { rows: items } = await client.query(
      `select mi.id::text, mi.stock_item_id::text as "stockItemId", si.name, si.unit,
              mi.price::float8 as price, mi.store_id::text as "storeId", l.name as store,
              si.liquor is not null as alcohol, mi.is_active as active,
              app.stock_on_hand(si.id, mi.store_id)::float8 as "onHand"
         from minibar_items mi
         join stock_items si on si.id = mi.stock_item_id
         join locations l on l.id = mi.store_id
        where mi.hotel_id = $1
        order by mi.is_active desc, si.name`, [hotelId]);

    const { rows: records } = await client.query(
      `select r.id::text, rm.number as room, r.recorded_at as "recordedAt",
              app.colleague_name(r.recorded_by, r.hotel_id) as "recordedBy",
              r.status, r.waiting_why as "waitingWhy", r.lines,
              res.reference, g.full_name as guest, res.status as "stayStatus",
              app.colleague_name(r.decided_by, r.hotel_id) as "decidedBy",
              r.decided_at as "decidedAt", r.decided_note as "decidedNote",
              (select sum(fp.amount + fp.tax_amount)::float8 from folio_postings fp
                where fp.hotel_id = r.hotel_id and fp.source_type = 'minibar' and fp.source_id = r.id) as charged,
              exists (select 1 from folio_postings fp join folio_postings rev on rev.reverses_id = fp.id
                       where fp.hotel_id = r.hotel_id and fp.source_type = 'minibar'
                         and fp.source_id = r.id) as reversed
         from minibar_records r
         join rooms rm on rm.id = r.room_id
         left join reservations res on res.id = r.reservation_id
         left join guests g on g.id = res.guest_id
        where r.hotel_id = $1
          and (r.status = 'waiting' or r.recorded_at > now() - interval '14 days')
        order by r.status = 'waiting' desc, r.recorded_at desc
        limit 200`, [hotelId]);

    /* What may be added, for those who keep the list. */
    const { rows: stock } = mayKeep ? await client.query(
      `select si.id::text, si.name, si.unit, si.liquor is not null as alcohol
         from stock_items si
        where si.hotel_id = $1 and si.is_active
          and not exists (select 1 from minibar_items mi where mi.stock_item_id = si.id)
        order by si.name`, [hotelId]) : { rows: [] };
    const { rows: stores } = mayKeep ? await client.query(
      `select id::text, name, is_bar_store as bar from locations
        where hotel_id = $1 and kind = 'store' and is_active order by name`, [hotelId]) : { rows: [] };

    return {
      items, records, stock, stores, mayKeep,
      mayRecord: may(role, MINIBAR_RECORDERS),
      mayDecide: role !== null && can(role, "create", "invoice"),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── The list: add an item, price it, move its store, switch it off ── */
minibar.post("/:code/minibar/items", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as { stockItemId?: string; price?: unknown; storeId?: string };
  const price = priceOf(input.price);
  if (price === undefined) return c.json(refuse(PRICE_SANE), 409);
  if (!UUID.test(input.stockItemId ?? "")) return c.json(refuse("Which Store item is it?"), 409);
  if (!UUID.test(input.storeId ?? "")) return c.json(refuse("Which store is it refilled from?"), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows: item } = await client.query<{ name: string; on: boolean }>(
      `select si.name, exists (select 1 from minibar_items mi where mi.stock_item_id = si.id) as on
         from stock_items si where si.id = $1 and si.hotel_id = $2`, [input.stockItemId, hotelId]);
    if (!item[0]) return refuse("That is not an item in this hotel's Store.");
    if (item[0].on) return refuse(`${item[0].name} is already on the minibar list.`);
    const { rows: store } = await client.query(
      "select 1 from locations where id = $1 and hotel_id = $2 and kind = 'store'", [input.storeId, hotelId]);
    if (!store[0]) return refuse("That is not a store at this property.");
    const { rows } = await client.query<{ id: string }>(
      `insert into minibar_items (hotel_id, stock_item_id, price, store_id, created_by)
       values ($1, $2, $3, $4, $5) returning id::text`,
      [hotelId, input.stockItemId, price, input.storeId, session.staffId]);
    return { ok: true as const, data: { id: rows[0]!.id } };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

minibar.patch("/:code/minibar/items/:id", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as { price?: unknown; storeId?: string; active?: boolean };
  const price = "price" in input ? priceOf(input.price) : null;
  if (price === undefined) return c.json(refuse(PRICE_SANE), 409);
  if (input.storeId !== undefined && !UUID.test(input.storeId)) return c.json(refuse("Which store is it refilled from?"), 409);
  if (!UUID.test(c.req.param("id"))) return c.json(refuse("That is not on this hotel's minibar list."), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (input.storeId !== undefined) {
      const { rows: store } = await client.query(
        "select 1 from locations where id = $1 and hotel_id = $2 and kind = 'store'", [input.storeId, hotelId]);
      if (!store[0]) return refuse("That is not a store at this property.");
    }
    const { rowCount } = await client.query(
      `update minibar_items
          set price = case when $3 then $4::numeric else price end,
              store_id = coalesce($5::uuid, store_id),
              is_active = coalesce($6::boolean, is_active)
        where id = $2 and hotel_id = $1`,
      [hotelId, c.req.param("id"), "price" in input, price, input.storeId ?? null,
       typeof input.active === "boolean" ? input.active : null]);
    return rowCount ? { ok: true as const } : refuse("That is not on this hotel's minibar list.");
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── What was taken from a room ───────────────────────────────────── */
minibar.post("/:code/minibar/records", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as {
    room?: string; lines?: { itemId?: string; quantity?: number }[]; disputed?: boolean;
  };
  const room = String(input.room ?? "").trim().toUpperCase();
  const asked = (Array.isArray(input.lines) ? input.lines : []).filter((l) => l && Number(l.quantity) !== 0);
  if (!room) return c.json(refuse("Which room?"), 409);
  if (asked.length === 0) return c.json(refuse("Nothing was taken? Say how many of each item."), 409);
  if (asked.some((l) => !UUID.test(l.itemId ?? "")
      || !Number.isInteger(Number(l.quantity)) || Number(l.quantity) < 1 || Number(l.quantity) > 99)) {
    return c.json(refuse("Each item is taken a whole number of times, 1 to 99."), 409);
  }
  if (new Set(asked.map((l) => l.itemId)).size !== asked.length) {
    return c.json(refuse("Each item once, with how many."), 409);
  }

  /* ONE TAKE, ONE RECORD (D27-396): the window's key, minted when it opened
     and sent with every tap, is the record's id. A double tap or a resend
     waits its turn, then is answered with the first record - never a second
     refill or charge - as finance answers a repeated payment. */
  const key = c.req.header("idempotency-key") ?? "";
  const pressed = UUID.test(key) ? key.toLowerCase() : null;

  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      if (!may(await roleAt(client, hotelId), MINIBAR_RECORDERS)) return { forbidden: true as const };
      if (pressed) {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`minibar-take:${pressed}`]);
        const { rows: done } = await client.query<{ status: string; why: string | null }>(
          "select status, waiting_why as why from minibar_records where id = $1 and hotel_id = $2",
          [pressed, hotelId]);
        if (done[0]) {
          return { ok: true as const, duplicate: true, data: { id: pressed, status: done[0].status, waitingWhy: done[0].why } };
        }
      }

      const { rows: rm } = await client.query<{ id: string; number: string }>(
        "select id::text, number from rooms where hotel_id = $1 and upper(number) = $2 and is_active",
        [hotelId, room]);
      if (!rm[0]) return refuse(`There is no room ${room} here.`);

      const { rows: items } = await client.query<{
        id: string; stock: string; store: string; name: string; price: string | null; alcohol: boolean;
      }>(
        `select mi.id::text, mi.stock_item_id::text as stock, mi.store_id::text as store, si.name,
                mi.price::text, si.liquor is not null as alcohol
           from minibar_items mi join stock_items si on si.id = mi.stock_item_id
          where mi.hotel_id = $1 and mi.is_active and mi.id = any($2::uuid[])`,
        [hotelId, asked.map((l) => l.itemId)]);
      if (items.length !== asked.length) return refuse("That is not on this hotel's minibar list.");
      /* NO DEFAULT PRICES: an item nobody has priced is never charged. */
      const unpriced = items.find((i) => i.price === null);
      if (unpriced) {
        return refuse(`${unpriced.name} has no price yet, so it cannot be charged. The owner, an `
          + "administrator or the general manager types it on the minibar list.");
      }
      if (items.some((i) => i.alcohol)) {
        const { rows: on } = await client.query<{ on: boolean }>(
          "select app.module_enabled($1, 'alcohol') as on", [hotelId]);
        if (!on[0]?.on) return refuse("This property is not switched on for alcohol, so a drink cannot be billed.");
      }

      /* WHO IS IN THE ROOM: the held assignment of a checked-in stay. */
      const { rows: inRoom } = await client.query<{ id: string }>(
        `select r.id::text from room_assignments ra join reservations r on r.id = ra.reservation_id
          where ra.room_id = $1 and ra.released_at is null and r.status = 'checked_in'`, [rm[0].id]);
      if (inRoom.length > 1) {
        return refuse(`Room ${rm[0].number} has ${inRoom.length} stays checked in. The desk records it on the right guest's bill.`);
      }
      /* NOBODY: the stay that left it last - its bill is closed, so the desk decides. */
      const { rows: left } = inRoom.length ? { rows: [] } : await client.query<{ id: string }>(
        `select r.id::text from room_assignments ra join reservations r on r.id = ra.reservation_id
          where ra.room_id = $1 and r.status = 'checked_out'
          order by ra.released_at desc nulls last limit 1`, [rm[0].id]);
      const stay = inRoom[0]?.id ?? left[0]?.id;
      if (!stay) return refuse(`Nobody has stayed in room ${rm[0].number}, so there is nobody to charge.`);

      const status = inRoom[0] && !input.disputed ? "charged" : "waiting";
      const why = status === "charged" ? null : inRoom[0] ? "disputed" : "after_checkout";
      const id = pressed ?? randomUUID();

      /* The refill, from each item's store. */
      const lines: Line[] = [];
      for (const a of asked) {
        const i = items.find((x) => x.id === a.itemId)!;
        const issued = await issueFromStore(client, hotelId, session.staffId, {
          itemId: i.stock, storeId: i.store, quantity: Number(a.quantity),
          department: "Minibar", note: `Minibar refill - room ${rm[0].number}`,
        });
        if (!issued.ok) throw new Refused(issued.reason);
        lines.push({ item: i.id, name: i.name, quantity: Number(a.quantity), price: Number(i.price),
                     alcohol: i.alcohol, movement: issued.id });
      }
      if (status === "charged") await charge(client, hotelId, stay, id, lines);

      await client.query(
        `insert into minibar_records (id, hotel_id, room_id, reservation_id, business_date, lines,
                                      status, waiting_why, recorded_by)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [id, hotelId, rm[0].id, stay, await businessDateFor(client, hotelId), JSON.stringify(lines),
         status, why, session.staffId]);
      return { ok: true as const, data: { id, status, waitingWhy: why } };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    if ("forbidden" in result) return c.json(refuse(RECORD_REFUSED), 403);
    return c.json(result, result.ok ? 200 : 409);
  } catch (error) {
    if (error instanceof Refused) return c.json(refuse(error.message), 409);
    throw error;
  }
});

/* ── The desk decides a waiting one, once ─────────────────────────── */
minibar.post("/:code/minibar/records/:id/decide", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as { charge?: boolean; note?: string };
  const note = input.note?.trim() || null;
  if (typeof input.charge !== "boolean") return c.json(refuse("Charge it, or say why not."), 409);
  if (!input.charge && !note) return c.json(refuse("Say why it is not charged. The reason stays on the record."), 409);
  if (!UUID.test(c.req.param("id"))) return c.json(refuse("No such minibar record."), 409);

  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows } = await client.query<{ status: string; stay: string | null; lines: Line[] }>(
        `select status, reservation_id::text as stay, lines from minibar_records
          where id = $1 and hotel_id = $2 for update`, [c.req.param("id"), hotelId]);
      const r = rows[0];
      if (!r) return refuse("No such minibar record.");
      if (r.status !== "waiting") return refuse("This minibar record is already decided.");
      if (input.charge) await charge(client, hotelId, r.stay!, c.req.param("id"), r.lines);
      await client.query(
        `update minibar_records set status = $3, decided_by = $4, decided_at = now(), decided_note = $5
          where id = $1 and hotel_id = $2`,
        [c.req.param("id"), hotelId, input.charge ? "charged" : "not_charged", session.staffId, note]);
      return { ok: true as const };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  } catch (error) {
    if (error instanceof Refused) return c.json(refuse(error.message), 409);
    throw error;
  }
});
