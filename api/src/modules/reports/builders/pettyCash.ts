import type { Client } from "../../../db.ts";
import { band, col, row, total, round2, reportDate, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   THE PETTY CASH BOOK (the owner's D27-370, 27 October)

   Every paid-out over a window, the restaurant's tins and the front desk's
   drawers together: by day, each with where, its category, what it was
   for, how much, who recorded it, its yes and whether its bill's photo is
   on it; then by category.

   A TOTAL COUNTS WHAT THE DRAWER COUNTS: an expense approved, or recorded
   before approvals began (app.cash_expense_counts, 189 - D27-242). One
   waiting for a yes or refused is listed and left out of the totals, and
   the category table shows it in its own column. Whether that is right is
   the owner's question (D27-370); it is how the tin and the drawer count.

   The restaurant's by its business day; the front desk's by the business
   day its drawer opened on (cashier_shifts.business_date - a movement
   carries no date of its own). A category is null on an expense from
   before 27 October: a dash.
   ══════════════════════════════════════════════════════════════════ */

const STATE: Record<string, string> = {
  pending: "Waiting", clarify: "Asked for more", approved: "Approved", rejected: "Refused",
};
const CATEGORIES = ["Kitchen", "Housekeeping", "Maintenance", "Office", "Other"];

type Line = {
  day: string; place: string; category: string | null; reason: string; amount: string;
  by: string | null; status: string | null; counts: boolean; photo: boolean;
};

export async function pettyCashReport(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  const { rows } = await client.query<Line>(
    `with e as (
       select m.business_date as day, o.name as place, m.category, m.reason, m.amount,
              m.recorded_by, m.recorded_at, m.id, 'pos_cash_movements' as tbl
         from pos_cash_movements m join pos_outlets o on o.id = m.outlet_id
        where m.hotel_id = $1 and m.kind = 'expense' and m.business_date between $2::date and $3::date
       union all
       select cs.business_date, 'Front desk', m.category, m.reason, m.amount,
              m.recorded_by, m.recorded_at, m.id, 'cashier_movements'
         from cashier_movements m join cashier_shifts cs on cs.id = m.shift_id
        where m.hotel_id = $1 and m.kind = 'expense' and cs.business_date between $2::date and $3::date)
     select to_char(e.day, 'YYYY-MM-DD') as day, e.place, e.category, e.reason, e.amount::text as amount,
            /* A colleague's name through app.hotel_people (149), as Cashier shift reads it. */
            coalesce(s.full_name, hp.full_name) as by,
            (select a.status from approvals a where a.subject_table = e.tbl and a.subject_id = e.id
              order by a.requested_at desc limit 1) as status,
            app.cash_expense_counts(e.tbl, e.id) as counts,
            exists (select 1 from attachments a where a.subject_table = e.tbl and a.subject_id = e.id) as photo
       from e
       left join staff s on s.id = e.recorded_by
       left join app.hotel_people($1) hp on hp.id = e.recorded_by
      order by e.day, e.place, e.recorded_at`,
    [property.id, from, to]);

  const counted = (ls: Line[]) => round2(ls.filter((l) => l.counts).reduce((s, l) => s + Number(l.amount), 0));

  const byDay: ReportRow[] = [];
  for (const day of [...new Set(rows.map((r) => r.day))]) {
    const lines = rows.filter((r) => r.day === day);
    byDay.push(band("date", reportDate(day)));
    for (const l of lines) {
      byDay.push(row({
        date: l.day, place: l.place, category: l.category, reason: l.reason, amount: Number(l.amount),
        by: l.by, approval: l.status === null ? "Not asked" : STATE[l.status] ?? l.status,
        photo: l.photo ? "Yes" : null,
      }));
    }
    byDay.push(total({ date: `Total, ${reportDate(day)}`, amount: counted(lines) }));
  }
  if (rows.length) byDay.push(total({ date: "Total", amount: counted(rows) }));

  /* By category: the five, then the expenses from before them (a dash). */
  const sum = (ls: Line[], keep: (l: Line) => boolean) =>
    ls.some(keep) ? round2(ls.filter(keep).reduce((s, l) => s + Number(l.amount), 0)) : null;
  const waits = (l: Line) => l.status === "pending" || l.status === "clarify";
  const refused = (l: Line) => l.status === "rejected";
  const catRow = (category: string | null, ls: Line[]) => row({
    category, count: ls.length, counted: sum(ls, (l) => l.counts), waiting: sum(ls, waits), refused: sum(ls, refused),
  });
  const byCategory = [
    ...CATEGORIES.map((k) => catRow(k, rows.filter((r) => r.category === k))),
    ...(rows.some((r) => r.category === null) ? [catRow(null, rows.filter((r) => r.category === null))] : []),
  ];
  if (rows.length) {
    const t = catRow("Total", rows);
    byCategory.push({ ...t, kind: "total" });
  }

  return {
    report: "petty-cash",
    title: "Petty cash",
    property: heading(property),
    orientation: "landscape",
    facts: [
      { label: "From", value: from, kind: "date" },
      { label: "To", value: to, kind: "date" },
    ],
    sections: [
      {
        key: "by-day",
        title: "Expenses, by day",
        columns: [
          col("date", "Date", "date"), col("place", "Where", "text"), col("category", "Category", "text"),
          col("reason", "What it was for", "text"), col("amount", "Amount", "money"),
          col("by", "Recorded by", "text"), col("approval", "Approval", "text"), col("photo", "Photo", "text"),
        ],
        rows: byDay,
        empty: "Nothing was paid out of a drawer or a tin in these days.",
      },
      {
        key: "by-category",
        title: "By category",
        columns: [
          col("category", "Category", "text"), col("count", "Expenses", "count"),
          col("counted", "Counted", "money"), col("waiting", "Waiting for a yes", "money"),
          col("refused", "Refused", "money"),
        ],
        rows: rows.length ? byCategory : [],
        empty: "Nothing was paid out of a drawer or a tin in these days.",
      },
    ],
    footnotes: [
      "A total counts an expense once it is approved, as the drawer and the tin count it; one recorded before approvals began counts as it is. One waiting for a yes or refused is listed and not added.",
      "The restaurant's expenses by their business day; the front desk's by the business day the drawer opened on.",
      "A dash for the category is an expense recorded before categories began (27 October 2026).",
    ],
  };
}
