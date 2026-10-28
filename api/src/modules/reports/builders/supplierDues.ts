import type { Client } from "../../../db.ts";
import { col, row, total, band, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   SUPPLIER DUES, TDS AND THE SUPPLIER STATEMENT
   (the owner's D27-370, 27 October; D27-372, 28 October)

   Read from purchasing's tables: `supplier_bills` (246), and since 249
   `supplier_payments` (part payments, each with any TDS deducted),
   `supplier_credit_notes` and `supplier_reversals`. What is left on a bill
   on a date is the database's own `app.supplier_bill_owed(bill, date)`: its
   amount less the payments, TDS and credit notes dated by then and not
   reversed by then. Amounts as recorded; nothing here works out a figure.
   ══════════════════════════════════════════════════════════════════ */

const METHOD: Record<string, string> = { cash: "Cash", cheque: "Cheque", bank: "Bank", upi: "UPI" };
const sum = (list: number[]) => round2(list.reduce((s, n) => s + n, 0));
/** Reversed by the date: a row of supplier_reversals for it, dated by then. */
const REVERSED_BY = (column: string, alias: string, date: string) =>
  `exists (select 1 from supplier_reversals x where x.${column} = ${alias}.id and x.reversed_on <= ${date})`;

/* ── Supplier dues: owed on a date, paid in a window ──────────────── */

export async function supplierDuesReport(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  /* Each bill with something left on it on the date, and each credit note
     against a supplier (not a bill) standing on it, negative. */
  const { rows: owed } = await client.query<{
    who: string; supplier: string; what: string; bill_date: string | null; due_on: string | null;
    late: number | null; amount: string | null; owed: string;
  }>(
    `select coalesce(b.supplier_id::text, lower(btrim(b.supplier))) as who, coalesce(s.name, b.supplier) as supplier,
            'Bill ' || b.bill_no as what, to_char(b.bill_date, 'YYYY-MM-DD') as bill_date,
            to_char(b.due_on, 'YYYY-MM-DD') as due_on, greatest($2::date - b.due_on, 0) as late,
            b.amount::text, app.supplier_bill_owed(b.id, $2::date)::text as owed
       from supplier_bills b left join suppliers s on s.id = b.supplier_id
      where b.hotel_id = $1 and b.bill_date <= $2::date and app.supplier_bill_owed(b.id, $2::date) > 0
     union all
     select n.supplier_id::text, s.name, 'Credit note ' || n.note_no, to_char(n.note_date, 'YYYY-MM-DD'),
            null, null, null, (-n.amount)::text
       from supplier_credit_notes n join suppliers s on s.id = n.supplier_id
      where n.hotel_id = $1 and n.bill_id is null and n.note_date <= $2::date
        and not ${REVERSED_BY("credit_note_id", "n", "$2::date")}
      order by 2, 1, 5 nulls last, 4, 3`,
    [property.id, to]);

  const { rows: paid } = await client.query<{
    supplier: string; bill_no: string; paid_on: string; method: string; reference: string | null;
    handed: string | null; paid_by: string | null; tds: string | null; amount: string;
  }>(
    `select coalesce(s.name, b.supplier) as supplier, b.bill_no, to_char(p.paid_on, 'YYYY-MM-DD') as paid_on,
            p.method, p.reference, p.handed_over_by as handed,
            app.colleague_name(p.recorded_by, p.hotel_id) as paid_by, p.tds_amount::text as tds, p.amount::text
       from supplier_payments p
       join supplier_bills b on b.id = p.bill_id
       left join suppliers s on s.id = b.supplier_id
      where p.hotel_id = $1 and p.paid_on between $2::date and $3::date
        and not ${REVERSED_BY("payment_id", "p", "$3::date")}
      order by p.paid_on, lower(coalesce(s.name, b.supplier)), b.bill_no, p.recorded_at`,
    [property.id, from, to]);

  /* Each supplier: a band, its bills and credit notes, its total; then the total owed. */
  const owedRows: ReportRow[] = [];
  const bySupplier = new Map<string, typeof owed>();
  for (const r of owed) bySupplier.set(r.who, [...(bySupplier.get(r.who) ?? []), r]);
  for (const lines of bySupplier.values()) {
    owedRows.push(band("supplier", lines[0]!.supplier));
    for (const b of lines) {
      owedRows.push(row({ supplier: b.what, billDate: b.bill_date, dueOn: b.due_on, late: b.late,
        amount: b.amount === null ? null : Number(b.amount), owed: Number(b.owed) }, { indent: 1 }));
    }
    owedRows.push(total({ supplier: `${lines[0]!.supplier}, owed`, owed: sum(lines.map((b) => Number(b.owed))) }));
  }
  if (owed.length) owedRows.push(total({ supplier: "Total owed", owed: sum(owed.map((b) => Number(b.owed))) }));

  return {
    report: "supplier-dues", title: "Supplier dues", property: heading(property), orientation: "landscape",
    facts: [{ label: "Owed On", value: to, kind: "date" }, { label: "Paid From", value: from, kind: "date" },
            { label: "Paid To", value: to, kind: "date" }],
    sections: [
      {
        key: "owed", title: "Owed to each supplier",
        columns: [col("supplier", "Supplier and bill", "text"), col("billDate", "Date", "date"),
          col("dueOn", "Due", "date"), col("late", "Days overdue", "count"), col("amount", "Billed"),
          col("owed", "Owed")],
        rows: owedRows,
        empty: "Nothing was owed to a supplier on this date.",
      },
      {
        key: "paid", title: "Payments made",
        columns: [col("paidOn", "Paid on", "date"), col("supplier", "Supplier", "text"),
          col("bill", "Bill", "text"), col("method", "How", "text"), col("reference", "Reference", "text"),
          col("handedOverBy", "Handed over by", "text"), col("paidBy", "Recorded by", "text"),
          col("tds", "TDS"), col("amount", "Paid")],
        rows: paid.length ? [
          ...paid.map((p) => row({ paidOn: p.paid_on, supplier: p.supplier, bill: p.bill_no,
            method: METHOD[p.method] ?? p.method, reference: p.reference, handedOverBy: p.handed, paidBy: p.paid_by,
            tds: p.tds === null ? null : Number(p.tds), amount: Number(p.amount) })),
          total({ paidOn: "Total paid", tds: sum(paid.map((p) => Number(p.tds ?? 0))),
            amount: sum(paid.map((p) => Number(p.amount))) }),
        ] : [],
        empty: "No supplier was paid in this window.",
      },
    ],
    footnotes: [
      "Bills taken on credit, from deliveries and bar bills, at the amount on each. Owed is what is left after the "
      + "payments, the TDS deducted and the credit notes; a credit note against the supplier, not one bill, lowers its total.",
      "A bill, payment or credit note reversed by the date is left out; the Supplier statement shows both.",
    ],
  };
}

/* ── TDS deducted, by section and supplier (for the quarterly 26Q) ── */

export async function tdsReport(client: Client, property: Property, from: string, to: string): Promise<ReportDoc> {
  const { rows } = await client.query<{
    section: string; who: string; supplier: string; gstin: string | null; paid_on: string; bill_no: string;
    amount: string; rate: string; tds: string;
  }>(
    `select p.tds_section as section, coalesce(b.supplier_id::text, lower(btrim(b.supplier))) as who,
            coalesce(s.name, b.supplier) as supplier, s.gstin, to_char(p.paid_on, 'YYYY-MM-DD') as paid_on,
            b.bill_no, p.amount::text, p.tds_rate::text as rate, p.tds_amount::text as tds
       from supplier_payments p
       join supplier_bills b on b.id = p.bill_id
       left join suppliers s on s.id = b.supplier_id
      where p.hotel_id = $1 and p.tds_amount is not null and p.paid_on between $2::date and $3::date
        and not exists (select 1 from supplier_reversals x where x.payment_id = p.id)
      order by p.tds_section, lower(coalesce(s.name, b.supplier)), p.paid_on, p.recorded_at`,
    [property.id, from, to]);

  /* The amount credited is what was paid and what was deducted together. */
  const gross = (r: (typeof rows)[number]) => round2(Number(r.amount) + Number(r.tds));
  const out: ReportRow[] = [];
  for (const section of [...new Set(rows.map((r) => r.section))]) {
    const inSection = rows.filter((r) => r.section === section);
    out.push(band("supplier", `Section ${section}`));
    for (const who of [...new Set(inSection.map((r) => r.who))]) {
      const mine = inSection.filter((r) => r.who === who);
      for (const r of mine) {
        out.push(row({ supplier: r.supplier, gstin: r.gstin, paidOn: r.paid_on, bill: r.bill_no,
          gross: gross(r), rate: Number(r.rate), tds: Number(r.tds), amount: Number(r.amount) }, { indent: 1 }));
      }
      out.push(total({ supplier: `${mine[0]!.supplier}, ${section}`, gross: sum(mine.map(gross)),
        tds: sum(mine.map((r) => Number(r.tds))), amount: sum(mine.map((r) => Number(r.amount))) }, { indent: 1 }));
    }
    out.push(total({ supplier: `Section ${section}`, gross: sum(inSection.map(gross)),
      tds: sum(inSection.map((r) => Number(r.tds))), amount: sum(inSection.map((r) => Number(r.amount))) }));
  }
  if (rows.length) {
    out.push(total({ supplier: "Total TDS", gross: sum(rows.map(gross)), tds: sum(rows.map((r) => Number(r.tds))),
      amount: sum(rows.map((r) => Number(r.amount))) }));
  }

  return {
    report: "tds", title: "TDS deducted", property: heading(property), orientation: "landscape",
    facts: [{ label: "From", value: from, kind: "date" }, { label: "To", value: to, kind: "date" }],
    sections: [{
      key: "tds", title: "By section and supplier",
      columns: [col("supplier", "Section and supplier", "text"), col("gstin", "GSTIN", "text"),
        col("paidOn", "Paid on", "date"), col("bill", "Bill", "text"), col("gross", "Amount credited"),
        col("rate", "Rate %", "ratio"), col("tds", "TDS"), col("amount", "Paid to supplier")],
      rows: out,
      empty: "No TDS was deducted from a supplier's payment in this window.",
    }],
    footnotes: [
      "TDS as the accountant entered it on each payment: the section, rate and amount are theirs; the system works out nothing.",
      "Amount credited is the payment and the TDS together. A payment reversed is left out.",
    ],
  };
}

/* ── A supplier's statement: a ledger with a running balance ──────── */

export async function supplierStatement(
  client: Client, property: Property, supplierId: string, from: string, to: string,
): Promise<ReportDoc> {
  const { rows: [who] } = await client.query<{ name: string; gstin: string | null }>(
    "select name, gstin from suppliers where hotel_id = $1 and id = $2", [property.id, supplierId]);
  if (!who) throw new Error(`[reports] no supplier ${supplierId} at this property.`);

  /* Every entry for the supplier, each signed as it moves what we owe:
     a bill adds; a payment, its TDS and a credit note take away; a reversal
     undoes what it reverses, on the day it was reversed. */
  const { rows } = await client.query<{ day: string; what: string; detail: string | null; amount: string }>(
    `with bills as (select * from supplier_bills where hotel_id = $1 and supplier_id = $2),
          pays as (select p.*, b.bill_no from supplier_payments p join bills b on b.id = p.bill_id),
          notes as (select * from supplier_credit_notes where hotel_id = $1 and supplier_id = $2)
     select to_char(day, 'YYYY-MM-DD') as day, what, detail, amount from (
     select bill_date as day, recorded_at as at,
            -- A correction is written with its reversal: it follows it.
            case when replaces_id is null then 1 else 6 end as ord, 'Bill ' || bill_no as what,
            case when replaces_id is null then null else 'corrects a reversed bill' end as detail, amount::text
       from bills
     union all
     select note_date, recorded_at, 2, 'Credit note ' || note_no || case when bill_id is null then '' else
              ' on bill ' || (select bill_no from bills where id = notes.bill_id) end,
            reason, (-amount)::text from notes
     union all
     select paid_on, recorded_at, 3, 'Payment on bill ' || bill_no,
            case method when 'upi' then 'UPI' else initcap(method) end || coalesce(', ' || reference, '')
              || coalesce(', handed over by ' || handed_over_by, ''),
            (-amount)::text from pays
     union all
     select paid_on, recorded_at, 4, 'TDS ' || tds_section || ' at ' || trim_scale(tds_rate) || '% on bill ' || bill_no, null,
            (-tds_amount)::text from pays where tds_amount is not null
     union all
     select x.reversed_on, x.reversed_at, 5, 'Reversed: bill ' || b.bill_no, x.reason, (-b.amount)::text
       from supplier_reversals x join bills b on b.id = x.bill_id
     union all
     select x.reversed_on, x.reversed_at, 5, 'Reversed: payment on bill ' || p.bill_no, x.reason,
            (p.amount + coalesce(p.tds_amount, 0))::text
       from supplier_reversals x join pays p on p.id = x.payment_id
     union all
     select x.reversed_on, x.reversed_at, 5, 'Reversed: credit note ' || n.note_no, x.reason, n.amount::text
       from supplier_reversals x join notes n on n.id = x.credit_note_id
     ) e order by e.day, e.at, e.ord`,
    [property.id, supplierId]);

  const dated = rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  const opening = sum(dated.filter((r) => r.day < from).map((r) => r.amount));
  let balance = opening;
  const lines: ReportRow[] = [row({ on: from, what: "Opening balance", balance: opening })];
  for (const r of dated.filter((e) => e.day >= from && e.day <= to)) {
    balance = round2(balance + r.amount);
    lines.push(row({ on: r.day, what: r.what, detail: r.detail,
      billed: r.amount > 0 ? r.amount : null, settled: r.amount < 0 ? -r.amount : null, balance }));
  }
  lines.push(total({ on: to, what: "Closing balance", balance }));

  return {
    /* The supplier is in the facts: the title names the Excel sheet, which takes no ":" (exceljs). */
    report: "supplier-statement", title: "Supplier statement", property: heading(property),
    orientation: "landscape",
    facts: [{ label: "Supplier", value: who.name, kind: "text" }, { label: "GSTIN", value: who.gstin, kind: "text" },
            { label: "From", value: from, kind: "date" }, { label: "To", value: to, kind: "date" }],
    sections: [{
      key: "ledger", title: "Bills, payments, TDS, credit notes and reversals",
      columns: [col("on", "Date", "date"), col("what", "Entry", "text"), col("detail", "Detail", "text"),
        col("billed", "Owed more"), col("settled", "Paid or credited"), col("balance", "Balance")],
      rows: lines,
    }],
    footnotes: [
      "The balance is what is owed to the supplier after each entry. A reversal keeps the wrong entry and undoes it on the day it was reversed.",
      "Only bills recorded with the supplier picked from the list are here; a bar bill typed before 28 October under a name not on the list is not.",
    ],
  };
}
