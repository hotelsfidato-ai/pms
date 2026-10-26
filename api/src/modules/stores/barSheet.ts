import { Hono } from "hono";
import { barStockGate } from "./barGate.ts";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { BAR_KEEPERS, holdsRoleAt, mayStock, STOCK_REFUSED, STOCK_ROLES } from "./stockGrants.ts";
import {
  addBarDrink, barCounter, barStore, countLinesProblem, editBarDrink, saveCount, type BarDrinkInput, type CountAs,
} from "./stores.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BAR'S DAILY SHEET (the owner's D27-354; two places, D27-361)

   The bar register on paper, in the system: per drink, grouped by its menu
   section, the day's Opening, Received, Total, what was Sold (the issues the
   sending of each line made, 235/238) split NIP / 30 / 60 / 90 ml and loose
   ml, Closing, the Rate and the Amount - and what was counted. Two formats,
   a setting (locations.bar_sheet): "paper", the register's columns;
   "simple", opening, received, sold, closing, counted.

   TWO PLACES (D27-361): the BAR COUNTER, which every KOT takes from and which
   receives from the store, and the BAR STORE, which receives the supplier
   bills and sends to the counter. Each has its sheet and its count; both are
   counted before the night audit (the closing count), and the bar manager
   counts at opening (the morning count) - a difference from the night's
   count shows in red. A drink is counted as it is kept (stock_items.count_as):
   poured - NIPs/bottles and the open one's ml; whole - bottles; packet -
   packets and the open one's sticks.

   GET  /:code/bar/sheet?date=&place=counter|store
   POST /:code/bar/count                 { place, moment: closing|morning, lines }
   PUT  /:code/bar/sheet-format          "paper" or "simple": owner, admin, GM
   POST /:code/bar/drinks                a drink added on Set up   } the Store's
   PUT  /:code/bar/drinks/:id            a drink changed           } edit grant
   POST /:code/bar/closed                "Bar closed today", a reason: owner, admin, GM
   POST /:code/bar/closed/undo           the bar opened after all

   Who counts: BAR_KEEPERS (stockGrants.ts). Who reads the sheet: they, and
   whoever sees the Store - Inventory's Bar tab is theirs too.
   ══════════════════════════════════════════════════════════════════ */

export const barSheet = new Hono<{ Variables: { subject: string } }>();
/* Bar stock switched off: every route here refused (D27-367). */
barSheet.use("/:code/bar/*", barStockGate);

const refuse = (reason: string) => ({ ok: false as const, reason });
const SHEET_REFUSED = "Counting the bar is for the owner, an administrator, the general manager, "
  + "the bar manager (the Bar role) and the Inventory Manager.";
const READ_REFUSED = "The bar's sheet is for whoever sees the Store, and the bar manager.";
const FORMAT_SETTERS: readonly string[] = ["owner", "admin", "gm"];
const FORMAT_REFUSED = "How the bar's sheet looks is set by the owner, an administrator or the general manager.";
const CLOSED_REFUSED = "\"Bar closed today\" is for the owner, an administrator or the general manager.";
const NO_STORE = "This hotel has no bar store. Mark one in Places and suppliers first.";

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

type Place = "counter" | "store";
const placeOf = (v: unknown): Place | null => (v === undefined || v === "counter" ? "counter" : v === "store" ? "store" : null);

/** The place a sheet or a count is for: the counter (else the store, for a
    hotel with no counter) or the store. */
async function placeFor(client: Client, hotelId: string, place: Place) {
  const store = await barStore(client, hotelId);
  const counter = await barCounter(client, hotelId);
  const at = place === "counter" ? counter ?? store : store;
  return { store, counter, at };
}

const LIVE = `m.reverses_id is null
  and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`;

/** The day's lines of one drink, as the sheet shows them. */
export interface SheetDrink {
  id: string; name: string; unit: string; sizeMl: number | null;
  countAs: CountAs; packSize: number | null;
  /** Poured in ml: shown in NIPs and ml. */
  poured: boolean;
  /** received: bills into the store, or the store's stock into the counter.
      moved: what the store sent to the counter. */
  opening: number; received: number; moved: number; sold: number; other: number; corrected: number; closing: number;
  /** What the sold were: whole bottles, 30, 60 and 90 ml pegs, and the ml of every peg. */
  sell: { nip: number; p30: number; p60: number; p90: number; ml: number };
  /** The day's last closing count, and the book it was counted against; null when not counted. */
  counted: number | null; countBook: number | null;
  /** The day's morning count: a difference from the book is a difference from last night's count. */
  morning: number | null; morningBook: number | null;
  /** The menu price of the dish that takes one whole bottle; the day's sales of it, billed. */
  rate: number | null; amount: number | null;
  /** What the place holds now: the book a count today is against. */
  onHand: number;
}

barSheet.get("/:code/bar/sheet", async (c) => {
  const asked = c.req.query("date");
  if (asked !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asked)) return c.json(refuse("Pick a date."), 409);
  const place = placeOf(c.req.query("place"));
  if (!place) return c.json(refuse("The counter or the store."), 409);
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, [...STOCK_ROLES.view, ...BAR_KEEPERS]))) return { forbidden: READ_REFUSED };
    const keeper = await holdsRoleAt(client, hotelId, BAR_KEEPERS);
    const businessDate = await businessDateFor(client, hotelId);
    const date = asked ?? businessDate;
    const { store, counter, at } = await placeFor(client, hotelId, place);
    const maySetFormat = await holdsRoleAt(client, hotelId, FORMAT_SETTERS);
    const mayApprove = await holdsRoleAt(client, hotelId, ["owner", "admin", "gm", "stores"]);
    const { rows: [closed] } = await client.query<{ reason: string; by: string | null }>(
      `select d.reason, s.full_name as by from bar_closed_days d left join staff s on s.id = d.closed_by
        where d.hotel_id = $1 and d.business_date = $2::date`, [hotelId, date]);
    const { rows: [asks] } = await client.query<{ n: string }>(
      "select count(*)::text as n from bar_requests where hotel_id = $1 and status = 'pending'", [hotelId]);
    const head = {
      place, businessDate, date, maySetFormat, mayApprove, mayCloseBar: maySetFormat,
      closedToday: closed ? { reason: closed.reason, by: closed.by } : null,
      pendingRequests: Number(asks!.n),
      places: { counter: counter ? { id: counter.id, name: counter.name } : null, store: store ? { id: store.id, name: store.name } : null },
    };
    if (!at || !store) return { ...head, store: null, format: "paper", mayCount: false, groups: [] };
    const { rows: [loc] } = await client.query<{ bar_sheet: string }>(
      "select bar_sheet from locations where id = $1", [store.id]);

    const { rows: drinks } = await client.query<{
      id: string; name: string; unit: string; size_ml: number | null; count_as: CountAs | null; pack_size: number | null;
      opening: string; received: string; moved: string; sold: string; other: string; corrected: string; closing: string;
      on_hand: string; counted: string | null; count_book: string | null; morning: string | null; morning_book: string | null;
      section: string | null;
    }>(
      `with mv as (
         select m.item_id, m.business_date, m.kind, m.quantity, m.pos_line_id
           from stock_movements m
          where m.hotel_id = $1 and m.location_id = $2 and not m.empty and m.business_date <= $3::date and ${LIVE})
       select i.id::text, i.name, i.unit, i.size_ml, i.count_as, i.pack_size,
              coalesce(sum(mv.quantity) filter (where mv.business_date < $3::date), 0)::text as opening,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date
                and (mv.kind = 'receipt' or (mv.kind = 'transfer' and mv.quantity > 0))), 0)::text as received,
              coalesce(-sum(mv.quantity) filter (where mv.business_date = $3::date
                and mv.kind = 'transfer' and mv.quantity < 0), 0)::text as moved,
              coalesce(-sum(mv.quantity) filter (where mv.business_date = $3::date and mv.pos_line_id is not null), 0)::text as sold,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date
                and mv.kind not in ('receipt', 'adjustment', 'transfer') and mv.pos_line_id is null), 0)::text as other,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind = 'adjustment'), 0)::text as corrected,
              coalesce(sum(mv.quantity), 0)::text as closing,
              app.stock_on_hand(i.id, $2)::text as on_hand,
              cl.counted::text, cl.book::text as count_book,
              mo.counted::text as morning, mo.book::text as morning_book,
              (select c.name from bar_pours p
                 join pos_menu_items d on d.id = p.item_id
                 join pos_menu_categories c on c.id = d.category_id
                where p.stock_item_id = i.id
                order by c.sort_order nulls last, c.name limit 1) as section
         from stock_items i
         left join mv on mv.item_id = i.id
         left join lateral (
           select counted, book from stock_count_lines
            where item_id = i.id and location_id = $2 and business_date = $3::date and not empty and moment = 'closing'
            order by counted_at desc limit 1) cl on true
         left join lateral (
           select counted, book from stock_count_lines
            where item_id = i.id and location_id = $2 and business_date = $3::date and not empty and moment = 'morning'
            order by counted_at desc limit 1) mo on true
        where i.hotel_id = $1 and ((i.category = 'Bar' and i.is_active) or mv.item_id is not null)
        group by i.id, i.name, i.unit, i.size_ml, i.count_as, i.pack_size, cl.counted, cl.book, mo.counted, mo.book
       having bool_or(i.category = 'Bar' and i.is_active)
           or coalesce(sum(mv.quantity), 0) <> 0
           or count(*) filter (where mv.business_date = $3::date) > 0
        order by i.name`,
      [hotelId, at.id, date]);

    /* What each sale was: the ml one dish took of the bottle, from the issue
       the line made (0.333 of a 180 ml bottle is a 60 ml peg). */
    const { rows: sales } = await client.query<{ item_id: string; ml_each: number | null; qty: string }>(
      `select m.item_id::text, round(-m.quantity * i.size_ml / nullif(l.qty, 0))::int as ml_each,
              sum(l.qty)::text as qty
         from stock_movements m
         join pos_order_lines l on l.id = m.pos_line_id
         join stock_items i on i.id = m.item_id
        where m.hotel_id = $1 and m.location_id = $2 and m.business_date = $3::date and ${LIVE}
        group by 1, 2`,
      [hotelId, at.id, date]);

    /* The money: what the lines that took from each drink were billed at, on a
       bill that is neither void nor no charge; and the price of the dish that
       takes one whole bottle. */
    const { rows: money } = await client.query<{ item_id: string; amount: string | null; rate: string | null }>(
      `select i.id::text as item_id,
              (select sum(l.qty * l.unit_price)::text
                 from stock_movements m
                 join pos_order_lines l on l.id = m.pos_line_id
                 join pos_orders o on o.id = l.order_id
                where m.item_id = i.id and m.location_id = $2 and m.business_date = $3::date and ${LIVE}
                  and not l.voided and o.status not in ('void', 'no_charge', 'abandoned')) as amount,
              (select coalesce(v.price, d.price)::text
                 from bar_pours p
                 join pos_menu_items d on d.id = p.item_id
                 left join pos_item_variations v on v.id = p.variation_id
                where p.stock_item_id = i.id and p.units = 1
                order by p.variation_id nulls last limit 1) as rate
         from stock_items i where i.hotel_id = $1 and i.id::text = any($4)`,
      [hotelId, at.id, date, drinks.map((d) => d.id)]);
    const moneyOf = new Map(money.map((r) => [r.item_id, r]));
    const num = (v: string | null) => (v === null ? null : Number(v));

    const groups = new Map<string, SheetDrink[]>();
    for (const d of drinks) {
      const sell = { nip: 0, p30: 0, p60: 0, p90: 0, ml: 0 };
      for (const s of sales.filter((x) => x.item_id === d.id)) {
        const qty = Number(s.qty);
        if (s.ml_each === null || s.ml_each === d.size_ml) { sell.nip += qty; continue; }
        sell.ml += qty * s.ml_each;
        if (s.ml_each === 30) sell.p30 += qty;
        else if (s.ml_each === 60) sell.p60 += qty;
        else if (s.ml_each === 90) sell.p90 += qty;
      }
      const countAs: CountAs = d.count_as ?? (d.size_ml ? "poured" : "whole");
      const m = moneyOf.get(d.id);
      const section = d.section ?? "Not on the menu";
      groups.set(section, [...(groups.get(section) ?? []), {
        id: d.id, name: d.name, unit: d.unit, sizeMl: d.size_ml, countAs, packSize: d.pack_size,
        poured: countAs === "poured" && d.size_ml !== null,
        opening: Number(d.opening), received: Number(d.received), moved: Number(d.moved), sold: Number(d.sold),
        other: Number(d.other), corrected: Number(d.corrected), closing: Number(d.closing), sell,
        counted: num(d.counted), countBook: num(d.count_book), morning: num(d.morning), morningBook: num(d.morning_book),
        rate: m?.rate == null ? null : Number(m.rate), amount: m?.amount == null ? null : Number(m.amount),
        onHand: Number(d.on_hand),
      }]);
    }
    return {
      ...head, store: at, format: loc!.bar_sheet,
      mayCount: keeper && date === businessDate && at.isActive,
      /* The sections in the menu's order; drinks no dish takes from, last. */
      groups: [...groups.entries()]
        .sort(([a], [b]) => (a === "Not on the menu" ? 1 : b === "Not on the menu" ? -1 : 0))
        .map(([section, list]) => ({ section, drinks: list })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden as string), 403);
  return c.json(body);
});

barSheet.post("/:code/bar/count", async (c) => {
  type Line = { itemId?: string; book?: number; counted?: number };
  const input = await c.req.json<{ place?: string; moment?: string; lines?: Line[] }>()
    .catch(() => ({}) as { place?: string; moment?: string; lines?: Line[] });
  const place = placeOf(input.place);
  if (!place) return c.json(refuse("The counter or the store."), 409);
  const moment = input.moment === undefined || input.moment === "closing" ? "closing"
    : input.moment === "morning" ? "morning" : null;
  if (!moment) return c.json(refuse("The closing count or the morning count."), 409);
  const lines = input.lines ?? [];
  const problem = countLinesProblem(lines);
  if (problem) return c.json(refuse(problem), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, BAR_KEEPERS))) return { forbidden: SHEET_REFUSED };
    const { at } = await placeFor(client, hotelId, place);
    if (!at) return refuse(NO_STORE);
    return saveCount(client, hotelId, session.staffId, at.id, lines, moment);
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

barSheet.put("/:code/bar/sheet-format", async (c) => {
  const input = await c.req.json<{ format?: string }>().catch(() => ({}) as { format?: string });
  if (input.format !== "paper" && input.format !== "simple") {
    return c.json(refuse("The sheet is like the paper register, or simple."), 409);
  }
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, FORMAT_SETTERS))) return { forbidden: FORMAT_REFUSED };
    const { rowCount } = await client.query(
      "update locations set bar_sheet = $2 where hotel_id = $1 and is_bar_store", [hotelId, input.format]);
    return rowCount ? { ok: true as const } : refuse(NO_STORE);
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── A drink added or changed on Set up (D27-361) ──────────────────── */
function drinkFrom(input: Record<string, unknown>): BarDrinkInput {
  const countAs = input.countAs as CountAs | undefined;
  return {
    name: typeof input.name === "string" ? input.name : "",
    unit: countAs === "packet" ? "packet" : "bottle",
    sizeMl: typeof input.sizeMl === "number" ? input.sizeMl : null,
    countAs, packSize: typeof input.packSize === "number" ? input.packSize : null,
    brand: typeof input.brand === "string" && input.brand.trim() ? input.brand : null,
    liquor: (typeof input.liquor === "string" && input.liquor ? input.liquor : null) as BarDrinkInput["liquor"],
    imported: input.imported === true,
  };
}

barSheet.post("/:code/bar/drinks", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "edit"))) return { forbidden: STOCK_REFUSED.edit };
    return addBarDrink(client, hotelId, drinkFrom(input));
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

barSheet.put("/:code/bar/drinks/:id", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "edit"))) return { forbidden: STOCK_REFUSED.edit };
    return editBarDrink(client, hotelId, c.req.param("id"), drinkFrom(input));
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── "Bar closed today": the night audit does not wait for its count ─ */
barSheet.post("/:code/bar/closed", async (c) => {
  const input = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 300) return c.json(refuse("Say why the bar did not open today."), 409);
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, FORMAT_SETTERS))) return { forbidden: CLOSED_REFUSED };
    await client.query(
      `insert into bar_closed_days (hotel_id, business_date, reason, closed_by)
       values ($1, app.business_date($1), $2, $3)
       on conflict (hotel_id, business_date) do update set reason = excluded.reason,
         closed_by = excluded.closed_by, closed_at = now()`,
      [hotelId, reason, session.staffId]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result);
});

barSheet.post("/:code/bar/closed/undo", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, FORMAT_SETTERS))) return { forbidden: CLOSED_REFUSED };
    await client.query(
      "delete from bar_closed_days where hotel_id = $1 and business_date = app.business_date($1)", [hotelId]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result);
});
