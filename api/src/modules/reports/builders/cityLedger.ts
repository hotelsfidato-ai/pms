import type { Client } from "../../../db.ts";
import { col, row, total, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, LIVE, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   CITY LEDGER - SUMMARY

   The owner's decision of 17 September: money a company or booking site
   owes starts when a bill is settled "Bill to company", a transfer to
   the city ledger (payments.method 'city_ledger'). That is the Debit.
   Nothing in this system records the company paying it later, so
   Opening Balance, Credit and Closing Balance print "-" until Finance
   can record it. A balance built on the guess that nobody has paid would
   be wrong the day somebody does.

   The account is the one the bill was sent to: the bill's own company,
   else the booking's, else where the booking came from
   (app.booking_source_label). Contact and phone come from the company's
   record, on the company's own row only (MEMORY 266); a dash elsewhere.
   ══════════════════════════════════════════════════════════════════ */

export async function cityLedgerReport(
  client: Client, property: Property, from: string, to: string, ignoreZero: boolean,
): Promise<ReportDoc> {
  const { rows } = await client.query<{
    account: string | null; contact: string | null; phone: string | null; debit: string;
  }>(
    `with transfers as (
       select coalesce(fc.name, app.booking_source_label(bs.name, rc.name, r.source)) as account,
              coalesce(fc.id, rc.id)                                                  as company_id,
              fp.business_date,
              -fp.amount                                                              as amount
         from folio_postings fp
         join payments p on p.posting_id = fp.id and p.method = 'city_ledger'
         join folios f on f.id = fp.folio_id
         left join companies fc on fc.id = f.company_id
         left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
         left join companies rc on rc.id = r.company_id
         left join booking_sources bs on bs.id = r.booking_source_id
        where fp.hotel_id = $1
          and fp.category = 'payment'
          and ${LIVE}
          and fp.business_date <= $3::date
     )
     select t.account,
            max(co.contact_name) filter (where co.name = t.account) as contact,
            max(co.phone)        filter (where co.name = t.account) as phone,
            coalesce(sum(t.amount) filter (where t.business_date between $2::date and $3::date), 0)::text as debit
       from transfers t
       left join companies co on co.id = t.company_id
      group by t.account
      order by t.account`,
    [property.id, from, to],
  );

  const accounts = rows
    .map((r) => ({ ...r, debit: round2(Number(r.debit)) }))
    .filter((r) => !ignoreZero || r.debit !== 0);

  const lines: ReportRow[] = accounts.map((r) => row({
    account: r.account,
    contact: r.contact,
    phone: r.phone,
    opening: null,
    debit: r.debit,
    credit: null,
    closing: null,
  }));
  if (lines.length > 0) {
    lines.push(total({
      account: "Total", contact: null, phone: null,
      opening: null,
      debit: round2(accounts.reduce((t, r) => t + r.debit, 0)),
      credit: null,
      closing: null,
    }));
  }

  return {
    report: "city-ledger",
    title: "City ledger",
    property: heading(property),
    orientation: "portrait",
    facts: [
      { label: "Date From", value: from, kind: "date" },
      { label: "To", value: to, kind: "date" },
      { label: "Ignore zero balance account", value: ignoreZero ? "Yes" : "No", kind: "text" },
    ],
    sections: [{
      key: "accounts",
      title: "City Ledger - Summary",
      columns: [
        col("account", "Account Name", "text"),
        col("contact", "Contact Person", "text"),
        col("phone", "Phone", "text"),
        col("opening", "Opening Balance", "money"),
        col("debit", "Debit", "money"),
        col("credit", "Credit", "money"),
        col("closing", "Closing Balance", "money"),
      ],
      rows: lines,
      empty: "No bill was transferred to a company or booking site in this period.",
    }],
    footnotes: [
      "Debit is the bills transferred to the account (settled \"Bill to company\") in the period.",
      "Opening Balance, Credit and Closing Balance show \"-\": this system does not record a company's payment yet.",
    ],
  };
}
