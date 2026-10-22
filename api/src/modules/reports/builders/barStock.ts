import type { Client } from "../../../db.ts";
import { col, row, total, round2, type ReportDoc, type ReportSection } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BAR STOCK REPORT (the owner's D27-354, 21 October)

   "What's the total inventory, what's been sold" - and what was bought.
   One business day of the bar's store, read from the Store's one ledger:
   per drink, what it opened with, the bar bills that came, what the bar
   sold (the issues the sending of a line made, migration 235), anything
   else that moved, the count's corrections, what it closed with, and what
   was counted. In bottles and ml (D27-354): "3 + 420 ml" is three full
   bottles and 420 ml of the next. Then each dish sold and what it took,
   the bar dishes sold that nothing is set up for, the drinks struck after
   the bar had them, and the day's bar bills. Emailed after the night
   audit when switched on (reportEmails.ts).
   ══════════════════════════════════════════════════════════════════ */

const LIVE = `m.reverses_id is null
  and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`;

/** "3 + 420 ml" or "120 ml" for what is poured, "12" for what is not; a dash
    for nothing. Under a bottle it is the ml alone - "-30 ml", never "-0 + 30 ml". */
export function inBottles(q: number | null, sizeMl: number | null): string | null {
  if (q === null) return null;
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  if (!sizeMl) return `${sign}${Math.round(a * 1000) / 1000}`;
  const whole = Math.floor(a + 1e-9);
  const ml = Math.round((a - whole) * sizeMl);
  if (ml === 0) return `${sign}${whole}`;
  return whole === 0 ? `${sign}${ml} ml` : `${sign}${whole} + ${ml} ml`;
}

export async function barStockReport(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  const { rows: [store] } = await client.query<{ id: string; name: string }>(
    "select id::text, name from locations where hotel_id = $1 and is_bar_store", [property.id]);

  const { rows: drinks } = store ? await client.query<{
    item: string; unit: string; size_ml: number | null; opening: string; purchased: string; sold: string;
    other: string; corrected: string; closing: string; counted: string | null;
  }>(
    `with mv as (
       select m.item_id, m.business_date, m.kind, m.quantity, m.pos_line_id
         from stock_movements m
        where m.hotel_id = $1 and m.location_id = $2 and not m.empty and m.business_date <= $3::date and ${LIVE})
     select i.name as item, i.unit, i.size_ml,
            coalesce(sum(mv.quantity) filter (where mv.business_date < $3::date), 0)::text as opening,
            coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind = 'receipt'), 0)::text as purchased,
            coalesce(-sum(mv.quantity) filter (where mv.business_date = $3::date and mv.pos_line_id is not null), 0)::text as sold,
            coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind not in ('receipt', 'adjustment')
                                                and mv.pos_line_id is null), 0)::text as other,
            coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind = 'adjustment'), 0)::text as corrected,
            coalesce(sum(mv.quantity), 0)::text as closing,
            (select cl.counted::text from stock_count_lines cl
              where cl.item_id = i.id and cl.location_id = $2 and cl.business_date = $3::date and not cl.empty
              order by cl.counted_at desc limit 1) as counted
       from stock_items i
       left join mv on mv.item_id = i.id
      where i.hotel_id = $1 and (i.category = 'Bar' or mv.item_id is not null)
      group by i.id, i.name, i.unit, i.size_ml
     having coalesce(sum(mv.quantity), 0) <> 0
         or count(*) filter (where mv.business_date = $3::date) > 0
      order by i.name`,
    [property.id, store.id, asOn]) : { rows: [] };

  const { rows: dishes } = store ? await client.query<{
    dish: string; qty: string; drink: string; size_ml: number | null; took: string;
  }>(
    `select l.name as dish, sum(l.qty)::text as qty, i.name as drink, i.size_ml, (-sum(m.quantity))::text as took
       from stock_movements m
       join pos_order_lines l on l.id = m.pos_line_id
       join stock_items i on i.id = m.item_id
      where m.hotel_id = $1 and m.location_id = $2 and m.business_date = $3::date and ${LIVE}
      group by l.name, i.name, i.size_ml
      order by l.name`,
    [property.id, store.id, asOn]) : { rows: [] };

  const { rows: notSet } = await client.query<{ dish: string; qty: string }>(
    `select l.name as dish, sum(l.qty)::text as qty
       from pos_order_lines l
       join pos_orders o on o.id = l.order_id
       join pos_menu_items i on i.id = l.item_id
       join pos_menu_categories c on c.id = i.category_id
      where o.hotel_id = $1 and o.business_date = $2::date and c.tax_kind in ('bar', 'alcohol')
        and l.kot_status <> 'pending' and l.parent_line_id is null
        and not (l.voided and not l.was_sent_when_voided)
        and not exists (select 1 from stock_movements m where m.pos_line_id = l.id)
      group by l.name order by l.name`,
    [property.id, asOn]);

  const { rows: struck } = await client.query<{ dish: string; qty: string; reason: string | null }>(
    `select l.name as dish, l.qty::text, l.void_reason as reason
       from pos_order_lines l
       join pos_orders o on o.id = l.order_id
       join pos_menu_items i on i.id = l.item_id
       join pos_menu_categories c on c.id = i.category_id
      where o.hotel_id = $1 and o.business_date = $2::date and c.tax_kind in ('bar', 'alcohol')
        and l.voided and l.was_sent_when_voided
      order by l.voided_at`,
    [property.id, asOn]);

  const { rows: bills } = await client.query<{ supplier: string; bill_no: string; drinks: number; total: string | null }>(
    `select p.supplier, p.bill_no,
            (select count(*)::int from stock_movements m where m.bar_purchase_id = p.id) as drinks,
            /* The total printed on the bill (its lines, handling and TCS). */
            p.bill_total::text as total
       from bar_purchases p
      where p.hotel_id = $1 and p.business_date = $2::date
      order by p.recorded_at`,
    [property.id, asOn]);

  const q = (v: string) => Number(v);
  const sections: ReportSection[] = [
    { key: "bar-stock", title: store ? `${store.name}, by drink (full bottles + ml)` : "The bar's stock",
      columns: [
        col("drink", "Drink", "text"), col("opening", "Opening", "text"), col("purchased", "Purchased", "text"),
        col("sold", "Sold", "text"), col("other", "Other moves", "text"), col("corrected", "Count corrections", "text"),
        col("closing", "Closing", "text"), col("counted", "Counted", "text"),
      ],
      rows: drinks.map((d) => row({
        drink: d.item, opening: inBottles(q(d.opening), d.size_ml), purchased: inBottles(q(d.purchased), d.size_ml),
        sold: inBottles(q(d.sold), d.size_ml), other: inBottles(q(d.other), d.size_ml),
        corrected: inBottles(q(d.corrected), d.size_ml), closing: inBottles(q(d.closing), d.size_ml),
        counted: d.counted === null ? null : inBottles(q(d.counted), d.size_ml),
      })),
      empty: store ? "The bar's store held nothing and nothing moved on this day."
        : "This hotel has no bar store marked." },
    { key: "bar-sold", title: "Sold, by dish",
      columns: [col("dish", "Dish", "text"), col("qty", "Sold", "count"), col("drink", "Taken from", "text"),
                col("took", "Took", "text")],
      rows: dishes.map((d) => row({ dish: d.dish, qty: q(d.qty), drink: d.drink, took: inBottles(q(d.took), d.size_ml) })),
      empty: "No drink was taken off the bar's stock on this day." },
    { key: "bar-not-set", title: "Sold, but nothing set up for the dish",
      columns: [col("dish", "Dish", "text"), col("qty", "Sold", "count")],
      rows: notSet.map((d) => row({ dish: d.dish, qty: q(d.qty) })),
      empty: "Every bar dish sold took its drink off the stock.",
      ...(notSet.length ? { note: "These took nothing off the stock: set what each takes in Bar stock, Set up." } : {}) },
    { key: "bar-struck", title: "Struck after the bar had them (they stay off the stock, as poured)",
      columns: [col("dish", "Dish", "text"), col("qty", "Quantity", "count"), col("reason", "Reason", "text")],
      rows: struck.map((d) => row({ dish: d.dish, qty: q(d.qty), reason: d.reason })),
      empty: "No drink was struck after the bar had it." },
    { key: "bar-bills", title: "Bar bills recorded",
      columns: [col("supplier", "Supplier", "text"), col("bill", "Bill", "text"), col("drinks", "Drinks", "count"),
                col("total", "Total", "money")],
      rows: bills.length ? [
        ...bills.map((b) => row({ supplier: b.supplier, bill: b.bill_no, drinks: b.drinks,
          total: b.total === null ? null : round2(Number(b.total)) })),
        total({ supplier: "Total", bill: null, drinks: bills.reduce((s, b) => s + b.drinks, 0),
          total: bills.every((b) => b.total !== null) ? round2(bills.reduce((s, b) => s + Number(b.total), 0)) : null }),
      ] : [],
      empty: "No bar bill was recorded on this day." },
  ];

  return {
    report: "bar-stock", title: "Bar stock", property: heading(property), orientation: "landscape",
    facts: [{ label: "As On Date", value: asOn, kind: "date" }],
    sections,
    footnotes: [
      "Sold is what the sending of each line took off the bar's store (Bar stock, Set up: what each dish takes).",
      "Full bottles + ml: \"3 + 420 ml\" is three full bottles and 420 ml of the next.",
    ],
  };
}
