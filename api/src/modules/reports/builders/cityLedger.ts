import type { Client } from "../../../db.ts";
import { col, row, total, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, LIVE, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   CITY LEDGER - SUMMARY

   The owner's decision of 17 September: money a company or booking site
   owes starts when a bill is settled "Bill to company", a transfer to
   the city ledger (payments.method 'city_ledger'). That is the Debit.
   What the account pays back is recorded on Company accounts (finance's
   company_payments, 187; D27-239), by the day the money reached the
   hotel: that is the Credit. Opening Balance is everything sent less
   everything paid before the period; Closing Balance is Opening + Debit
   - Credit. A payment names the same account the ledger does: the
   company, or the booking site a booking came through.

   The account is the one the bill was sent to: the bill's own company,
   else the booking's, else where the booking came from
   (app.booking_source_label). Contact and phone come from the company's
   record, on the company's own row only (MEMORY 266); a dash elsewhere.
   ══════════════════════════════════════════════════════════════════ */

export async function cityLedgerReport(
  client: Client, property: Property, from: string, to: string, ignoreZero: boolean,
): Promise<ReportDoc> {
  const { rows } = await client.query<{
    account: string | null; contact: string | null; phone: string | null;
    opening: string; debit: string; credit: string;
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
     ),
     paid as (
       select coalesce(co.name, bs.name) as account, cp.company_id,
              cp.received_on as business_date, cp.amount
         from company_payments cp
         left join companies co on co.id = cp.company_id
         left join booking_sources bs on bs.id = cp.booking_source_id
        where cp.hotel_id = $1 and cp.received_on <= $3::date
     ),
     moves as (
       select account, company_id, business_date, amount as debit, 0 as credit from transfers
       union all
       select account, company_id, business_date, 0, amount from paid
     )
     select t.account,
            max(co.contact_name) filter (where co.name = t.account) as contact,
            max(co.phone)        filter (where co.name = t.account) as phone,
            coalesce(sum(t.debit - t.credit) filter (where t.business_date < $2::date), 0)::text as opening,
            coalesce(sum(t.debit)  filter (where t.business_date between $2::date and $3::date), 0)::text as debit,
            coalesce(sum(t.credit) filter (where t.business_date between $2::date and $3::date), 0)::text as credit
       from moves t
       left join companies co on co.id = t.company_id
      group by t.account
      order by t.account`,
    [property.id, from, to],
  );

  const accounts = rows
    .map((r) => {
      const opening = round2(Number(r.opening));
      const debit = round2(Number(r.debit));
      const credit = round2(Number(r.credit));
      return { ...r, opening, debit, credit, closing: round2(opening + debit - credit) };
    })
    .filter((r) => !ignoreZero || [r.opening, r.debit, r.credit, r.closing].some((x) => x !== 0));

  const sum = (k: "opening" | "debit" | "credit" | "closing") =>
    round2(accounts.reduce((t, r) => t + r[k], 0));
  const lines: ReportRow[] = accounts.map((r) => row({
    account: r.account,
    contact: r.contact,
    phone: r.phone,
    opening: r.opening,
    debit: r.debit,
    credit: r.credit,
    closing: r.closing,
  }));
  if (lines.length > 0) {
    lines.push(total({
      account: "Total", contact: null, phone: null,
      opening: sum("opening"), debit: sum("debit"), credit: sum("credit"), closing: sum("closing"),
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
      empty: "No company or booking site owed or paid anything in this period.",
    }],
    footnotes: [
      "Debit is the bills transferred to the account (settled \"Bill to company\") in the period.",
      "Credit is what the account paid, recorded on Company accounts, by the date it reached the hotel.",
      "Opening Balance is everything sent less everything paid before the period; Closing Balance is Opening + Debit - Credit.",
    ],
  };
}
