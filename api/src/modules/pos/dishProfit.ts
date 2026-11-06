import type { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../../auth.ts";

/* ══════════════════════════════════════════════════════════════════
   PROFIT PER DISH (D27-383 item 9; built under D27-396)

   GET /:code/till/dish-profit?from=&to=

   What a dish costs to make is its recipe (251, D27-374/D27-378) at each
   Store item's average cost today (app.stock_unit_cost, the running average
   the Store keeps): a dish sold by size, its own lines and the size's. Its
   margin is the menu price less that. A dish with no recipe, or with an
   ingredient nobody has priced yet, has no cost: a dash, never zero - and
   so no margin either.

   The period's sales: the dishes on PAID bills of those business days, at
   the price each was sold (before the bill's discount; NC, voided and
   closed-unpaid bills are not sales), with the same cost per dish.
   ponytail: today's average cost, not the cost on the day of each sale, and
   sides and add-ons are left out (their own lines); a cost at the moment of
   sale is stock_movements' issues, if the owner wants that reading.

   WHO: the owner, an administrator or the GM (roleGate DISH_PROFIT) - costs
   are not the kitchen's (D27-141).

   Registered on the till's router by till.ts, behind the module gate.
   ══════════════════════════════════════════════════════════════════ */

type App = Hono<{ Variables: { subject: string } }>;
type HotelFor = (client: Client, code: string) => Promise<string | null>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const money = (n: number) => Math.round(n * 100) / 100;

export function registerDishProfit(till: App, hotelFor: HotelFor): void {
  till.get("/:code/till/dish-profit", async (c) => {
    const from = c.req.query("from") ?? "";
    const to = c.req.query("to") ?? "";
    if (!DAY.test(from) || !DAY.test(to)) {
      return c.json({ ok: false, reason: "Dates are written 2026-11-06." }, 409);
    }
    if (from > to) return c.json({ ok: false, reason: "The first date is after the last." }, 409);
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) {
      return c.json({ ok: false, reason: "At most a year at a time." }, 409);
    }

    const body = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows } = await client.query<{
        item_id: string; variation_id: string | null; section: string; name: string;
        price: string | null; on_menu: boolean; lines: number; cost: string | null;
        qty: string | null; sales: string | null;
      }>(
        `with costs as (
           select s.stock_item_id, app.stock_unit_cost(s.stock_item_id) as unit_cost
             from (select distinct stock_item_id from recipe_lines where hotel_id = $1) s
         ),
         recipe as (
           select r.item_id, r.variation_id, r.quantity * k.unit_cost as cost, k.unit_cost is null as unpriced
             from recipe_lines r join costs k on k.stock_item_id = r.stock_item_id
            where r.hotel_id = $1 and r.item_id is not null
         ),
         on_menu as (
           /* A dish, or each size of one sold by size: the first type carries the price. */
           select i.id as item_id, v.id as variation_id, coalesce(v.price, i.price) as price
             from pos_menu_items i
             left join pos_item_variations v on v.item_id = i.id and v.is_active and v.type_no = 1
            where i.hotel_id = $1 and i.is_active
         ),
         sold as (
           select l.item_id, l.variation_id, sum(l.qty) as qty, sum(round(l.qty * l.unit_price, 2)) as sales
             from pos_order_lines l
             join pos_orders o on o.id = l.order_id
            where o.hotel_id = $1 and o.status = 'settled'
              and o.business_date between $2::date and $3::date
              and not l.voided and l.parent_line_id is null and not l.packing
              and l.item_id is not null and l.addon_id is null and l.extra_kind is null
            group by l.item_id, l.variation_id
         ),
         pairs as (
           select item_id, variation_id from on_menu
           union
           select item_id, variation_id from sold
         )
         select p.item_id::text, p.variation_id::text, coalesce(c.name, 'Other') as section,
                i.name || coalesce(' (' || v.label || ')', '') as name,
                m.price::text, m.item_id is not null as on_menu,
                k.n as lines,
                case when k.n > 0 and not k.unpriced then round(k.cost, 2) end::text as cost,
                s.qty::text, s.sales::text
           from pairs p
           join pos_menu_items i on i.id = p.item_id
           left join pos_menu_categories c on c.id = i.category_id
           left join pos_item_variations v on v.id = p.variation_id
           left join on_menu m on m.item_id = p.item_id and m.variation_id is not distinct from p.variation_id
           left join sold s on s.item_id = p.item_id and s.variation_id is not distinct from p.variation_id
           cross join lateral (
             select count(*)::int as n, coalesce(bool_or(r.unpriced), false) as unpriced, sum(r.cost) as cost
               from recipe r
              where r.item_id = p.item_id
                and (r.variation_id is null or r.variation_id is not distinct from p.variation_id)
           ) k
          order by c.sort_order nulls last, c.name, i.sort_order, i.name, v.sort_order nulls first`,
        [hotelId, from, to]);

      const of = (r: (typeof rows)[number]) => {
        const cost = r.cost === null ? null : Number(r.cost);
        return { itemId: r.item_id, variationId: r.variation_id, section: r.section, name: r.name, cost,
                 /* Why there is no cost, for the dash's note. */
                 noCost: cost !== null ? null : r.lines === 0 ? "no recipe" as const : "an ingredient has no cost" as const };
      };
      const dishes = rows.filter((r) => r.on_menu).map((r) => {
        const d = of(r);
        const price = Number(r.price);
        const margin = d.cost === null ? null : money(price - d.cost);
        return { ...d, price, margin,
                 marginPct: margin === null || price <= 0 ? null : Math.round((margin / price) * 1000) / 10 };
      });
      const sold = rows.filter((r) => r.qty !== null).map((r) => {
        const d = of(r);
        const qty = Number(r.qty);
        const sales = Number(r.sales);
        const cost = d.cost === null ? null : money(d.cost * qty);
        return { ...d, qty, sales, cost, margin: cost === null ? null : money(sales - cost) };
      });
      const costed = sold.filter((s) => s.cost !== null);
      const sum = (xs: number[]) => money(xs.reduce((a, b) => a + b, 0));
      return {
        from, to, dishes, sold,
        totals: {
          sales: sum(sold.map((s) => s.sales)),
          /* Only the dishes that have a cost add up to a margin. */
          costedSales: sum(costed.map((s) => s.sales)),
          cost: sum(costed.map((s) => s.cost!)),
          margin: sum(costed.map((s) => s.margin!)),
          uncostedSales: sum(sold.filter((s) => s.cost === null).map((s) => s.sales)),
        },
      };
    });
    return body ? c.json(body) : c.json({ error: "No such property." }, 404);
  });
}
