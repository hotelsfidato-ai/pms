import type { Client } from "../../../db.ts";
import { col, row, total, band, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   ITEM SALES (the owner, 16 November: "we are getting sale as per
   category; we need the sale of each item sold")

   Each dish, drink and add-on sold over a range of days, by outlet and
   menu category: how many, and for how much. A dish's sizes are separate
   lines - "Paneer Tikka (Half)", "(Full)". Paid bills only, and every line
   the Manager report's "Category -" figures add up, read the same way
   (price x quantity, before the bill's discount and GST), so a category's
   total here is the Manager report's for the same days.
   ══════════════════════════════════════════════════════════════════ */

interface Sold { outlet: string; category: string; item: string; qty: string; amount: string }

export async function itemSalesReport(client: Client, property: Property, from: string, to: string): Promise<ReportDoc> {
  const { rows } = await client.query<Sold>(
    `select ou.name as outlet, coalesce(c.name, 'Other') as category,
            coalesce(i.name || coalesce(' (' || v.label || ')', ''), l.name) as item,
            sum(l.qty)::text as qty, sum(round(l.qty * l.unit_price, 2))::text as amount
       from pos_orders o
       join pos_outlets ou on ou.id = o.outlet_id
       join pos_order_lines l on l.order_id = o.id and not l.voided
       left join pos_menu_items i on i.id = l.item_id
       left join pos_item_variations v on v.id = l.variation_id
       left join pos_menu_categories c on c.id = i.category_id
      where o.hotel_id = $1 and o.status = 'settled'
        and o.business_date between $2::date and $3::date
      group by 1, 2, 3
      order by 1, 2, 3`,
    [property.id, from, to]);

  const sold = rows.map((r) => ({
    outlet: r.outlet, category: r.category, item: r.item, qty: Number(r.qty), amount: round2(Number(r.amount)),
  }));
  const sum = (list: typeof sold) => ({
    qty: round2(list.reduce((s, x) => s + x.qty, 0)),
    amount: round2(list.reduce((s, x) => s + x.amount, 0)),
  });

  const out: ReportRow[] = [];
  const summary: ReportRow[] = [];
  const outlets = [...new Set(sold.map((x) => x.outlet))];
  for (const outlet of outlets) {
    const mine = sold.filter((x) => x.outlet === outlet);
    for (const category of [...new Set(mine.map((x) => x.category))]) {
      const these = mine.filter((x) => x.category === category);
      out.push(band("item", `${outlet}, ${category}`));
      for (const x of these) out.push(row({ item: x.item, qty: round2(x.qty), amount: x.amount }));
      out.push(total({ item: `${category}, all items`, ...sum(these) }));
      summary.push(row({ outlet, category, ...sum(these) }));
    }
    summary.push(total({ outlet: `${outlet}, all categories`, category: null, ...sum(mine) }));
  }
  if (outlets.length > 1) summary.push(total({ outlet: "All outlets", category: null, ...sum(sold) }));

  return {
    report: "item-sales", title: "Item sales", property: heading(property), orientation: "portrait",
    facts: [{ label: "From", value: from, kind: "date" }, { label: "To", value: to, kind: "date" }],
    sections: [
      { key: "item-sales-summary", title: "By outlet and category",
        columns: [col("outlet", "Outlet", "text"), col("category", "Category", "text"),
          col("qty", "Quantity", "ratio"), col("amount", "Amount", "money")],
        rows: summary,
        empty: "Nothing was sold on a paid bill in these days." },
      { key: "item-sales-items", title: "Every item sold, by outlet and category",
        columns: [col("item", "Item", "text"), col("qty", "Quantity", "ratio"), col("amount", "Amount", "money")],
        rows: out,
        empty: "Nothing to list for these days." },
    ],
    footnotes: [
      "Paid bills only. A bill given free (NC), a voided bill, an order closed unpaid and a struck dish are not sales and are not here.",
      "Amount is price x quantity, before the bill's discount, service charge and GST: the same figure the Manager report's categories add up, so a category's total here is its total there for the same days.",
      "An add-on charged as a line of its own is an item of its own. An item no longer on the menu, or typed in at the till, is under Other.",
      "Days are business days.",
    ],
  };
}
