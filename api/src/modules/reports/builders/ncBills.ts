import type { Client } from "../../../db.ts";
import { col, row, total, band, round2, reportDate, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   NC BILLS (the owner, 16 November: "date wise NC order list, approval
   comment")

   Every bill given free (D27-351) over a range of days, by outlet and day:
   the bill, its table and section, its value at menu prices (D27-394), the
   reason, the waiter who asked (a request to the GM, D27-363), who gave it,
   when, and the GM's note on the yes. Close restaurant day shows one day's;
   this is the same list over any days. Read only; no sales figure counts
   these bills (they read `status = 'settled'`).
   ══════════════════════════════════════════════════════════════════ */

interface Nc {
  outlet: string; day: string; order_no: string; table_ref: string | null; section: string | null;
  value: string; reason: string | null; asked: string | null; given: string | null;
  at: string | null; note: string | null;
}

/* UTC with a Z: the renderers print it in the property's time (voids.ts). */
const AT = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

export async function ncBillsReport(client: Client, property: Property, from: string, to: string): Promise<ReportDoc> {
  const { rows } = await client.query<Nc>(
    `with who as (
       /* A colleague's name through app.hotel_people (149), as the voids report. */
       select distinct on (id) id, full_name
         from (select id, full_name from app.hotel_people($1) union all select id, full_name from staff) p
        order by id)
     select ou.name as outlet, to_char(o.business_date, 'YYYY-MM-DD') as day, o.order_no, o.table_ref,
            sec.name as section, (select net from app.pos_order_total(o.id))::text as value,
            o.nc_reason as reason, a.full_name as asked, g.full_name as given,
            to_char(o.nc_at at time zone 'UTC', ${AT}) as at, rq.decision_note as note
       from pos_orders o
       join pos_outlets ou on ou.id = o.outlet_id
       left join pos_tables t on t.id = o.table_id
       left join pos_sections sec on sec.id = t.section_id
       left join lateral (
         /* The approver's note is on the approval (076); a rejection's on the request. */
         select r.requested_by, coalesce(ap.decision_note, r.decision_note) as decision_note
           from pos_requests r left join approvals ap on ap.id = r.approval_id
          where r.order_id = o.id and r.kind = 'no_charge' and r.status = 'approved'
          order by r.decided_at desc limit 1) rq on true
       left join who a on a.id = rq.requested_by
       left join who g on g.id = o.nc_by
      where o.hotel_id = $1 and o.status = 'no_charge'
        and o.business_date between $2::date and $3::date
      order by ou.name, o.business_date, o.nc_at, o.order_no`,
    [property.id, from, to]);

  const sum = (list: Nc[]) => round2(list.reduce((s, r) => s + Number(r.value), 0));
  const outlets = [...new Set(rows.map((r) => r.outlet))];
  const summary: ReportRow[] = [];
  const detail: ReportRow[] = [];
  for (const outlet of outlets) {
    const mine = rows.filter((r) => r.outlet === outlet);
    for (const day of [...new Set(mine.map((r) => r.day))]) {
      const today = mine.filter((r) => r.day === day);
      summary.push(row({ outlet, day, bills: today.length, value: sum(today) }));
      detail.push(band("bill", `${outlet}, ${reportDate(day)}`));
      for (const r of today) {
        detail.push(row({
          bill: r.order_no, table: r.table_ref, section: r.section, value: round2(Number(r.value)),
          reason: r.reason, asked: r.asked, given: r.given, at: r.at, note: r.note,
        }));
      }
    }
    summary.push(total({ outlet: `${outlet}, all days`, day: null, bills: mine.length, value: sum(mine) }));
  }
  if (outlets.length > 1) summary.push(total({ outlet: "All outlets", day: null, bills: rows.length, value: sum(rows) }));

  return {
    report: "nc-bills", title: "NC bills", property: heading(property), orientation: "landscape",
    facts: [{ label: "From", value: from, kind: "date" }, { label: "To", value: to, kind: "date" }],
    sections: [
      { key: "nc-summary", title: "Totals, by outlet and day",
        columns: [col("outlet", "Outlet", "text"), col("day", "Day", "date"),
          col("bills", "Bills", "count"), col("value", "Value at menu prices", "money")],
        rows: summary,
        empty: "No bill was given free in these days." },
      { key: "nc-detail", title: "Every NC bill, by outlet and day",
        columns: [
          col("bill", "Bill", "text"), col("table", "Table", "text"), col("section", "Section", "text"),
          col("value", "Value", "money"), col("reason", "Reason", "text"), col("asked", "Asked by", "text"),
          col("given", "Given / approved by", "text"), col("at", "When", "datetime"),
          col("note", "Approval comment", "text"),
        ],
        rows: detail,
        empty: "Nothing to list for these days." },
    ],
    footnotes: [
      "Value is the bill at menu prices before GST: what it would have been had it been charged. It is in no sales or tax figure.",
      "Asked by is the waiter or cashier whose request it was, when it was one; Given / approved by is the owner, Admin or GM who gave it or said yes. Approval comment is what they wrote on the yes, when they wrote one.",
      "Days are business days. A voided bill is not NC and is in the Voids report.",
    ],
  };
}
