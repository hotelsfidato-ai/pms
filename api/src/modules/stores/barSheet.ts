import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { BAR_KEEPERS, holdsRoleAt, STOCK_ROLES } from "./stockGrants.ts";
import { barStore, countLinesProblem, saveCount } from "./stores.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BAR'S DAILY SHEET (the owner's D27-354, 21 October evening)

   The bar register on paper, in the system: per drink, grouped by its menu
   section, the day's Opening, Received (bar bills), Total, what was Sold
   (the issues the sending of each line made, 235) split NIP / 30 / 60 / 90 ml
   and loose ml, Closing, the Rate and the Amount - and what was counted. Two
   formats, a setting (locations.bar_sheet): "paper", the register's columns;
   "simple", opening, received, sold, closing, counted. All spirits are NIPs
   (the owner): a drink poured in ml shows in NIPs and ml, anything else in
   its count.

   GET /:code/bar/sheet?date=YYYY-MM-DD   the sheet (the business day unless said)
   POST /:code/bar/count                  today's count from the sheet, the
                                          Store's own count (saveCount)
   PUT /:code/bar/sheet-format            "paper" or "simple": the owner, an
                                          administrator, the GM

   Who counts: BAR_KEEPERS (stockGrants.ts). Who reads the sheet: they, and
   whoever sees the Store - Inventory's Bar tab is theirs too.
   ══════════════════════════════════════════════════════════════════ */

export const barSheet = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const SHEET_REFUSED = "Counting the bar is for the owner, an administrator, the general manager, "
  + "the bar manager (the Bar role) and the Inventory Manager.";
const READ_REFUSED = "The bar's sheet is for whoever sees the Store, and the bar manager.";
const FORMAT_SETTERS: readonly string[] = ["owner", "admin", "gm"];
const FORMAT_REFUSED = "How the bar's sheet looks is set by the owner, an administrator or the general manager.";

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

const LIVE = `m.reverses_id is null
  and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`;

/** The day's lines of one drink, as the sheet shows them. */
export interface SheetDrink {
  id: string; name: string; unit: string; sizeMl: number | null;
  /** Poured in ml (a pour set in ml): shown in NIPs and ml. */
  poured: boolean;
  opening: number; received: number; sold: number; other: number; corrected: number; closing: number;
  /** What the sold were: whole bottles, 30, 60 and 90 ml pegs, and the ml of every peg. */
  sell: { nip: number; p30: number; p60: number; p90: number; ml: number };
  /** The day's last count, and the book it was counted against; null when not counted. */
  counted: number | null; countBook: number | null;
  /** The menu price of the dish that takes one whole bottle; the day's sales of it, billed. */
  rate: number | null; amount: number | null;
  /** What the store holds now: the book a count today is against. */
  onHand: number;
}

barSheet.get("/:code/bar/sheet", async (c) => {
  const asked = c.req.query("date");
  if (asked !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asked)) return c.json(refuse("Pick a date."), 409);
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, [...STOCK_ROLES.view, ...BAR_KEEPERS]))) return { forbidden: READ_REFUSED };
    const keeper = await holdsRoleAt(client, hotelId, BAR_KEEPERS);
    const businessDate = await businessDateFor(client, hotelId);
    const date = asked ?? businessDate;
    const store = await barStore(client, hotelId);
    const maySetFormat = await holdsRoleAt(client, hotelId, FORMAT_SETTERS);
    if (!store) return { store: null, businessDate, date, format: "paper", mayCount: false, maySetFormat, groups: [] };
    const { rows: [loc] } = await client.query<{ bar_sheet: string }>(
      "select bar_sheet from locations where id = $1", [store.id]);

    const { rows: drinks } = await client.query<{
      id: string; name: string; unit: string; size_ml: number | null; opening: string; received: string;
      sold: string; other: string; corrected: string; closing: string; on_hand: string;
      counted: string | null; count_book: string | null; poured: boolean; section: string | null;
    }>(
      `with mv as (
         select m.item_id, m.business_date, m.kind, m.quantity, m.pos_line_id
           from stock_movements m
          where m.hotel_id = $1 and m.location_id = $2 and not m.empty and m.business_date <= $3::date and ${LIVE})
       select i.id::text, i.name, i.unit, i.size_ml,
              coalesce(sum(mv.quantity) filter (where mv.business_date < $3::date), 0)::text as opening,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind = 'receipt'), 0)::text as received,
              coalesce(-sum(mv.quantity) filter (where mv.business_date = $3::date and mv.pos_line_id is not null), 0)::text as sold,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind not in ('receipt', 'adjustment')
                                                  and mv.pos_line_id is null), 0)::text as other,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind = 'adjustment'), 0)::text as corrected,
              coalesce(sum(mv.quantity), 0)::text as closing,
              app.stock_on_hand(i.id, $2)::text as on_hand,
              cl.counted::text, cl.book::text as count_book,
              exists (select 1 from bar_pours p where p.stock_item_id = i.id and p.ml is not null) as poured,
              (select c.name from bar_pours p
                 join pos_menu_items d on d.id = p.item_id
                 join pos_menu_categories c on c.id = d.category_id
                where p.stock_item_id = i.id
                order by c.sort_order nulls last, c.name limit 1) as section
         from stock_items i
         left join mv on mv.item_id = i.id
         left join lateral (
           select counted, book from stock_count_lines
            where item_id = i.id and location_id = $2 and business_date = $3::date and not empty
            order by counted_at desc limit 1) cl on true
        where i.hotel_id = $1 and ((i.category = 'Bar' and i.is_active) or mv.item_id is not null)
        group by i.id, i.name, i.unit, i.size_ml, cl.counted, cl.book
       having bool_or(i.category = 'Bar' and i.is_active)
           or coalesce(sum(mv.quantity), 0) <> 0
           or count(*) filter (where mv.business_date = $3::date) > 0
        order by i.name`,
      [hotelId, store.id, date]);

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
      [hotelId, store.id, date]);

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
      [hotelId, store.id, date, drinks.map((d) => d.id)]);
    const moneyOf = new Map(money.map((r) => [r.item_id, r]));

    const groups = new Map<string, SheetDrink[]>();
    for (const d of drinks) {
      const sell = { nip: 0, p30: 0, p60: 0, p90: 0, ml: 0 };
      const sold = sales.filter((x) => x.item_id === d.id);
      /* Poured: set in ml now, or sold by the peg that day. */
      const poured = d.poured || sold.some((x) => x.ml_each !== null && x.ml_each !== d.size_ml);
      for (const s of sold) {
        const qty = Number(s.qty);
        if (s.ml_each === null || s.ml_each === d.size_ml) { sell.nip += qty; continue; }
        sell.ml += qty * s.ml_each;
        if (s.ml_each === 30) sell.p30 += qty;
        else if (s.ml_each === 60) sell.p60 += qty;
        else if (s.ml_each === 90) sell.p90 += qty;
      }
      const m = moneyOf.get(d.id);
      const section = d.section ?? "Not on the menu";
      groups.set(section, [...(groups.get(section) ?? []), {
        id: d.id, name: d.name, unit: d.unit, sizeMl: d.size_ml, poured,
        opening: Number(d.opening), received: Number(d.received), sold: Number(d.sold), other: Number(d.other),
        corrected: Number(d.corrected), closing: Number(d.closing), sell,
        counted: d.counted === null ? null : Number(d.counted),
        countBook: d.count_book === null ? null : Number(d.count_book),
        rate: m?.rate == null ? null : Number(m.rate), amount: m?.amount == null ? null : Number(m.amount),
        onHand: Number(d.on_hand),
      }]);
    }
    return {
      store, businessDate, date, format: loc!.bar_sheet, maySetFormat,
      mayCount: keeper && date === businessDate && store.isActive,
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
  const input = await c.req.json<{ lines?: Line[] }>().catch(() => ({}) as { lines?: Line[] });
  const lines = input.lines ?? [];
  const problem = countLinesProblem(lines);
  if (problem) return c.json(refuse(problem), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, BAR_KEEPERS))) return { forbidden: SHEET_REFUSED };
    const store = await barStore(client, hotelId);
    if (!store) return refuse("This hotel has no bar store. Mark one in Places and suppliers first.");
    return saveCount(client, hotelId, session.staffId, store.id, lines);
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
    return rowCount ? { ok: true as const } : refuse("This hotel has no bar store. Mark one in Places and suppliers first.");
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});
