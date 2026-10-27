import type { Client } from "../../../db.ts";
import { col, row, total, band, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   SUPPLIER DUES (the owner's D27-370, 27 October)

   What we owed each supplier on a date, bill by bill, and the payments made
   in a window. Read from purchasing's `supplier_bills` (246): a bill on
   credit from a delivery or a bar bill, paid whole once. A bill is owed on
   a date when it was dated by then and not paid by then. Amounts as printed
   on the bill; nothing here works out a figure the bill did not say.
   ══════════════════════════════════════════════════════════════════ */

const METHOD: Record<string, string> = { cash: "Cash", cheque: "Cheque", bank: "Bank", upi: "UPI" };

export async function supplierDuesReport(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  const { rows: owed } = await client.query<{
    supplier: string; bill_no: string; bill_date: string; due_on: string; amount: string; late: number;
  }>(
    `select supplier, bill_no, to_char(bill_date, 'YYYY-MM-DD') as bill_date,
            to_char(due_on, 'YYYY-MM-DD') as due_on, amount::text,
            greatest($2::date - due_on, 0) as late
       from supplier_bills
      where hotel_id = $1 and bill_date <= $2::date and (paid_on is null or paid_on > $2::date)
      order by lower(supplier), due_on, bill_date, bill_no`,
    [property.id, to]);

  const { rows: paid } = await client.query<{
    supplier: string; bill_no: string; bill_date: string; amount: string;
    paid_on: string; method: string; reference: string | null; paid_by: string | null;
  }>(
    `select supplier, bill_no, to_char(bill_date, 'YYYY-MM-DD') as bill_date, amount::text,
            to_char(paid_on, 'YYYY-MM-DD') as paid_on, paid_method as method, paid_reference as reference,
            app.colleague_name(paid_by, hotel_id) as paid_by
       from supplier_bills
      where hotel_id = $1 and paid_on between $2::date and $3::date
      order by paid_on, lower(supplier), bill_no`,
    [property.id, from, to]);

  /* Each supplier: a band, its bills, its total; then the total owed. */
  const owedRows: ReportRow[] = [];
  const bySupplier = new Map<string, typeof owed>();
  for (const r of owed) {
    const key = r.supplier.trim().toLowerCase();
    bySupplier.set(key, [...(bySupplier.get(key) ?? []), r]);
  }
  for (const bills of bySupplier.values()) {
    owedRows.push(band("supplier", bills[0]!.supplier));
    for (const b of bills) {
      owedRows.push(row({ supplier: `Bill ${b.bill_no}`, billDate: b.bill_date, dueOn: b.due_on,
        late: b.late, amount: Number(b.amount) }, { indent: 1 }));
    }
    owedRows.push(total({ supplier: `${bills[0]!.supplier}, owed`,
      amount: round2(bills.reduce((s, b) => s + Number(b.amount), 0)) }));
  }
  if (owed.length) {
    owedRows.push(total({ supplier: "Total owed", amount: round2(owed.reduce((s, b) => s + Number(b.amount), 0)) }));
  }

  return {
    report: "supplier-dues", title: "Supplier dues", property: heading(property), orientation: "landscape",
    facts: [{ label: "Owed On", value: to, kind: "date" }, { label: "Paid From", value: from, kind: "date" },
            { label: "Paid To", value: to, kind: "date" }],
    sections: [
      {
        key: "owed", title: "Owed to each supplier",
        columns: [col("supplier", "Supplier and bill", "text"), col("billDate", "Bill date", "date"),
          col("dueOn", "Due", "date"), col("late", "Days overdue", "count"), col("amount", "Amount")],
        rows: owedRows,
        empty: "Nothing was owed to a supplier on this date.",
      },
      {
        key: "paid", title: "Payments made",
        columns: [col("paidOn", "Paid on", "date"), col("supplier", "Supplier", "text"),
          col("bill", "Bill", "text"), col("billDate", "Bill date", "date"), col("method", "How", "text"),
          col("reference", "Reference", "text"), col("paidBy", "Recorded by", "text"), col("amount", "Amount")],
        rows: paid.length ? [
          ...paid.map((p) => row({ paidOn: p.paid_on, supplier: p.supplier, bill: p.bill_no, billDate: p.bill_date,
            method: METHOD[p.method] ?? p.method, reference: p.reference, paidBy: p.paid_by, amount: Number(p.amount) })),
          total({ paidOn: "Total paid", amount: round2(paid.reduce((s, p) => s + Number(p.amount), 0)) }),
        ] : [],
        empty: "No supplier was paid in this window.",
      },
    ],
    footnotes: [
      "Bills taken on credit, from deliveries and bar bills, at the amount printed on each. A payment pays its bill whole.",
    ],
  };
}
