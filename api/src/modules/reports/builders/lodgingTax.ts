import type { Client } from "../../../db.ts";
import { col, row, total, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, LIVE, type Property } from "../figures.ts";
import { monthWindow } from "./statistics.ts";

/* ══════════════════════════════════════════════════════════════════
   LODGING TAX — the one that is filed

   The owner's export is an Excel sheet, one row per day, banded under
   "Check Out Bills", with CGST and SGST each spanning a net and a tax
   column. The format is not ours to redesign: an accountant reconciles
   this month's sheet against last month's.

   It is built from the INVOICES, because a lodging tax return is filed
   from the bills that were issued, not from the ledger's own totals.
   A day with no invoice has no row, and bill numbers are contiguous per
   day and continuous across the month — a gap is an audit finding, not
   a display quirk, which is why the first and last number of each day
   are printed rather than a count.

   Credit notes are left out of the band: they cancel a bill that was
   filed, and belong to the month they were raised in, on their own
   line. None exists in this property yet, so the section prints its
   heading and says so.
   ══════════════════════════════════════════════════════════════════ */

export async function lodgingTaxReport(
  client: Client, property: Property, month: string,
): Promise<ReportDoc> {
  const w = monthWindow(month);

  const { rows } = await client.query<{
    date: string; from_bill: string; to_bill: string; bills: string;
    total_bill: string; room_rent: string; non_taxable: string;
    room_tax: string; other_bills: string; discount: string; round_off: string;
  }>(
    /* Per invoice first: what its own bill holds, from the ledger the
       invoice was made from. Then per day, as the sheet prints it. */
    `with bills as (
       select i.id, i.number, i.folio_id,
              coalesce(i.business_date, i.issued_at::date) as date,
              i.total, i.taxable_value, i.cgst_total, i.sgst_total
         from invoices i
        where i.hotel_id = $1
          and i.credits_id is null
          and coalesce(i.business_date, i.issued_at::date) between $2::date and $3::date
     ),
     ledger as (
       select b.id,
              coalesce(sum(fp.amount) filter (where fp.category = 'room'), 0)            as room,
              coalesce(sum(fp.tax_amount) filter (where fp.category = 'room'), 0)        as room_tax,
              coalesce(-sum(fp.amount) filter (where fp.category = 'discount'), 0)       as discount,
              coalesce(sum(fp.amount + fp.tax_amount) filter (where fp.category not in
                    ('room', 'payment', 'discount', 'refund')), 0)                       as other,
              coalesce(sum(fp.amount) filter (where fp.category not in
                    ('room', 'payment', 'discount', 'refund') and fp.tax_rate = 0), 0)   as non_taxable
         from bills b
         left join folio_postings fp
                on fp.folio_id = b.folio_id and fp.hotel_id = $1 and ${LIVE}
        group by b.id
     )
     select to_char(b.date, 'YYYY-MM-DD')                    as date,
            min(b.number)                                    as from_bill,
            max(b.number)                                    as to_bill,
            count(*)::text                                   as bills,
            sum(b.total)::text                               as total_bill,
            sum(l.room)::text                                as room_rent,
            sum(l.non_taxable)::text                         as non_taxable,
            sum(l.room_tax)::text                            as room_tax,
            sum(l.other)::text                               as other_bills,
            sum(l.discount)::text                            as discount,
            sum(b.total - b.taxable_value - b.cgst_total - b.sgst_total)::text as round_off
       from bills b join ledger l on l.id = b.id
      group by b.date
      order by b.date`,
    [property.id, w.from, w.to],
  );

  const lines: ReportRow[] = rows.map((r) => {
    const roomRent = round2(Number(r.room_rent));
    const discount = round2(Number(r.discount));
    const roomTax = round2(Number(r.room_tax));
    /* CGST and SGST are the same half each, as the sheet is filed: two
       columns that must always be equal are two chances to disagree. An
       odd paisa in the ledger's tax is left on the ledger rather than
       pushed onto one of the halves. */
    const half = round2(roomTax / 2);
    return row({
      date: r.date,
      fromBill: r.from_bill,
      toBill: r.to_bill,
      totalBill: round2(Number(r.total_bill)),
      roomRent,
      nonTaxable: round2(Number(r.non_taxable)),
      /* The tax the room rent carries, on what was actually charged for
         it: the rent less the discount given on it. */
      cgstNet: round2(roomRent - discount),
      cgstTax: half,
      sgstNet: round2(roomRent - discount),
      sgstTax: half,
      /* Not recorded in this system: a dash, never a zero. */
      serviceCharges: null,
      otherBills: round2(Number(r.other_bills)),
      lessDiscount: discount ? -discount : 0,
      roundOff: round2(Number(r.round_off)),
    });
  });

  if (lines.length > 0) {
    const sum = (k: string) => round2(lines.reduce((t, x) => t + Number(x.cells[k] ?? 0), 0));
    lines.push(total({
      date: "TOTAL",
      fromBill: lines[0]!.cells["fromBill"] ?? null,
      toBill: lines.at(-1)!.cells["toBill"] ?? null,
      totalBill: sum("totalBill"), roomRent: sum("roomRent"), nonTaxable: sum("nonTaxable"),
      cgstNet: sum("cgstNet"), cgstTax: sum("cgstTax"),
      sgstNet: sum("sgstNet"), sgstTax: sum("sgstTax"),
      serviceCharges: null, otherBills: sum("otherBills"),
      lessDiscount: sum("lessDiscount"), roundOff: sum("roundOff"),
    }));
  }

  /* "2.5%", as the sheet's heading reads - not "2.50%". */
  const rate = (n: number) => `${Number(n)}%`;

  return {
    report: "lodging-tax",
    title: "Lodging tax",
    property: heading(property),
    orientation: "landscape",
    facts: [
      { label: "Date From", value: w.from, kind: "date" },
      { label: "To", value: w.to, kind: "date" },
    ],
    sections: [{
      key: "check-out-bills",
      title: "Check Out Bills",
      columns: [
        col("date", "Date", "date"),
        col("fromBill", "From Bill No.", "text"),
        col("toBill", "To Bill No.", "text"),
        col("totalBill", "Total Bill Amount", "money"),
        col("roomRent", "Total Room Rent", "money"),
        col("nonTaxable", "Non-Taxable Amount", "money"),
        col("cgstNet", "Net Amt.", "money", `CGST @${rate(Number(property.cgstRate))}`),
        col("cgstTax", "Tax Amt.", "money", `CGST @${rate(Number(property.cgstRate))}`),
        col("sgstNet", "Net Amt.", "money", `SGST @${rate(Number(property.sgstRate))}`),
        col("sgstTax", "Tax Amt.", "money", `SGST @${rate(Number(property.sgstRate))}`),
        col("serviceCharges", "Service Charges", "money"),
        col("otherBills", "Other Bills", "money"),
        col("lessDiscount", "Less Discount", "money"),
        col("roundOff", "Round-Off", "money"),
      ],
      rows: lines,
      empty: "No bill was issued in this month.",
    }],
    footnotes: [
      "Bill numbers are contiguous per day and continuous across the month. A gap is an audit finding, not a display quirk.",
      "The tax columns carry the room rent less its discount. CGST and SGST are half the tax the bills carried, each.",
      "Everything else charged to those bills is in Other Bills.",
      "Service charges are not recorded in this system and show \"-\".",
      "The group's accountant confirms this sheet before anything is filed from it (the owner, 17 September). Nothing here is filed on this system's word alone.",
    ],
  };
}
