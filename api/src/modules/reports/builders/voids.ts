import type { Client } from "../../../db.ts";
import {
  col, row, total, band, round2, reportDate, type Cell, type ReportDoc, type ReportRow,
} from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   THE VOIDS REPORT (the owner's D27-370, 27 October)

   "Every voided bill, order closed unpaid and struck dish, per outlet and
   day: what, how much, who, when and why." Three things the till already
   records, read here and changed nowhere:

     a voided paid bill     pos_orders status 'void' (222): who, when, why,
                            and the refund reference of a card or UPI bill;
     an order closed unpaid pos_orders status 'abandoned' (028): the reason
                            ONLY - the order records neither who closed it
                            nor when, so both print "-" (see the footnote);
     a struck dish          pos_order_lines voided (028, 151, 210): who,
                            when, why, and whether the kitchen had it.

   A NC bill is not a void, a discount is not a void, and the front desk's
   folios are not the restaurant: none is here (the owner has not said
   otherwise). Grouped by the order's business day, as every sales figure.
   ══════════════════════════════════════════════════════════════════ */

const KIND = { bill: "Voided bill", unpaid: "Closed unpaid", dish: "Struck dish" } as const;
type Kind = keyof typeof KIND;
const KINDS = Object.keys(KIND) as Kind[];

interface Void {
  kind: Kind; outlet: string; day: string; order_no: string; table_ref: string | null;
  dish: string | null; qty: string | null; amount: string; by: string | null; asked: string | null;
  at: string | null; reason: string | null; reference: string | null; sent: boolean | null;
}

/* UTC with a Z: the renderers print it in the property's time, and a bare "+00"
   offset (what OF gives in a UTC session) is not a date to JavaScript. */
const AT = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

export async function voidsReport(client: Client, property: Property, from: string, to: string): Promise<ReportDoc> {
  const { rows } = await client.query<Void>(
    `with who as (
       /* A colleague's name through app.hotel_people (149): staff shows a clerk
          only their own row. */
       select distinct on (id) id, full_name
         from (select id, full_name from app.hotel_people($1) union all select id, full_name from staff) p
        order by id),
     voids as (
       select 'bill' as kind, o.outlet_id, o.id as order_id, o.business_date, o.order_no, o.table_ref,
              null::text as dish, null::text as qty,
              (select payable from app.pos_order_total(o.id)) as amount,
              o.voided_by as by, (select r.requested_by from pos_requests r
                where r.order_id = o.id and r.kind = 'void_bill' and r.status = 'approved' limit 1) as asked,
              o.voided_at as at, o.void_reason as reason, o.void_reference as reference, null::boolean as sent
         from pos_orders o where o.hotel_id = $1 and o.status = 'void'
       union all
       select 'unpaid', o.outlet_id, o.id, o.business_date, o.order_no, o.table_ref, null, null,
              (select payable from app.pos_order_total(o.id)), null::uuid, null::uuid, null::timestamptz,
              o.abandoned_reason, null, null
         from pos_orders o where o.hotel_id = $1 and o.status = 'abandoned'
       union all
       select 'dish', o.outlet_id, o.id, o.business_date, o.order_no, o.table_ref,
              case when l.extra_kind is null then l.name
                   else '+ ' || l.name || ' (for ' || coalesce(p.numbered_addons ->> 'dish', p.name) || ')' end,
              l.qty::text, round(l.qty * l.unit_price, 2), l.voided_by,
              (select r.requested_by from pos_requests r
                where r.line_id = l.id and r.kind = 'strike_line' and r.status = 'approved' limit 1),
              l.voided_at, l.void_reason, null, l.was_sent_when_voided
         from pos_order_lines l
         join pos_orders o on o.id = l.order_id
         left join pos_order_lines p on p.id = l.parent_line_id
        where o.hotel_id = $1 and l.voided and (l.parent_line_id is null or l.extra_kind is not null))
     select v.kind, ou.name as outlet, to_char(v.business_date, 'YYYY-MM-DD') as day,
            v.order_no, v.table_ref, v.dish, v.qty, v.amount::text, w.full_name as by, a.full_name as asked,
            to_char(v.at at time zone 'UTC', ${AT}) as at, v.reason, v.reference, v.sent
       from voids v
       join pos_outlets ou on ou.id = v.outlet_id
       left join who w on w.id = v.by
       left join who a on a.id = v.asked
      where v.business_date between $2::date and $3::date
      order by ou.name, v.business_date, v.at nulls last, v.order_no, v.kind`,
    [property.id, from, to]);

  const sum = (list: Void[], k: Kind) => {
    const mine = list.filter((v) => v.kind === k);
    return { n: mine.length, amount: round2(mine.reduce((s, v) => s + Number(v.amount), 0)) };
  };
  const summaryRow = (label: Cell, day: string | null, list: Void[], isTotal = false): ReportRow => {
    const cells: Record<string, Cell> = { outlet: label, day };
    for (const k of KINDS) { const s = sum(list, k); cells[`${k}N`] = s.n; cells[`${k}Amount`] = s.amount; }
    return isTotal ? total(cells) : row(cells);
  };

  const outlets = [...new Set(rows.map((v) => v.outlet))];
  const summary: ReportRow[] = [];
  const detail: ReportRow[] = [];
  for (const outlet of outlets) {
    const mine = rows.filter((v) => v.outlet === outlet);
    for (const day of [...new Set(mine.map((v) => v.day))]) {
      const today = mine.filter((v) => v.day === day);
      summary.push(summaryRow(outlet, day, today));
      detail.push(band("kind", `${outlet}, ${reportDate(day)}`));
      for (const v of today) {
        detail.push(row({
          kind: KIND[v.kind], bill: v.order_no, table: v.table_ref, dish: v.dish,
          qty: v.qty === null ? null : String(Number(v.qty)),
          amount: round2(Number(v.amount)), by: v.by, asked: v.asked, at: v.at, reason: v.reason,
          reference: v.reference, sent: v.sent === null ? null : v.sent ? "Yes" : "No",
        }));
      }
    }
    summary.push(summaryRow(`${outlet}, all days`, null, mine, true));
  }
  if (outlets.length > 1) summary.push(summaryRow("All outlets", null, rows, true));

  const kindCols = KINDS.flatMap((k) => [
    col(`${k}N`, k === "dish" ? "Dishes" : "Bills", "count", KIND[k]),
    col(`${k}Amount`, "Amount", "money", KIND[k]),
  ]);

  return {
    report: "voids", title: "Voids", property: heading(property), orientation: "landscape",
    facts: [{ label: "From", value: from, kind: "date" }, { label: "To", value: to, kind: "date" }],
    sections: [
      { key: "voids-summary", title: "Totals, by outlet and day",
        columns: [col("outlet", "Outlet", "text"), col("day", "Day", "date"), ...kindCols],
        rows: summary,
        empty: "No bill was voided, no order closed unpaid and no dish struck in these days." },
      { key: "voids-detail", title: "Every one, by outlet and day",
        columns: [
          col("kind", "What", "text"), col("bill", "Bill", "text"), col("table", "Table", "text"),
          col("dish", "Dish", "text"), col("qty", "Qty", "text"), col("amount", "Amount", "money"),
          col("by", "Done by", "text"), col("asked", "Asked by", "text"), col("at", "When", "datetime"),
          col("reason", "Why", "text"), col("reference", "Refund reference", "text"),
          col("sent", "Kitchen had it", "text"),
        ],
        rows: detail,
        empty: "Nothing to list for these days." },
    ],
    footnotes: [
      "A voided bill's and a closed-unpaid order's amount is what the guest would have paid (after any discount, with GST). A struck dish's is its price times its quantity, before GST. The three are never added together.",
      "An order closed unpaid keeps its reason only: the system does not record who closed it or when, so both show \"-\".",
      "Done by is the person who voided or struck. Asked by is the waiter whose request to the GM it was, when it was one.",
      "Kitchen had it: Yes when the dish was struck after its KOT was sent (the GM's yes, and a reason, are needed); No when it was struck before.",
      "Days are business days. A bill given free (NC) and a discount are not voids and are not here.",
    ],
  };
}
