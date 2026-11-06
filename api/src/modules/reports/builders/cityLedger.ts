import type { Client } from "../../../db.ts";
import { col, row, total, band, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, LIVE, type Property } from "../figures.ts";
import { COMPANY_PAYMENT_METHODS } from "../../finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   CITY LEDGER - SUMMARY

   The owner's decision of 17 September: money a company or booking site
   owes starts when a bill is settled "Bill to company", a transfer to
   the city ledger (payments.method 'city_ledger'). That is the Debit.
   What the account pays back is recorded on Company accounts (finance's
   company_payments, 189; D27-239), by the day the money reached the
   hotel: that is the Credit. Opening Balance is everything sent less
   everything paid before the period; Closing Balance is Opening + Debit
   - Credit. A payment names the same account the ledger does: the
   company, or the booking site a booking came through.

   The account is the one the bill was sent to: the bill's own company,
   else the booking's, else where the booking came from
   (app.booking_source_label). Contact and phone come from the company's
   record, on the company's own row only (MEMORY 266); a dash elsewhere.
   ══════════════════════════════════════════════════════════════════ */

/**
 * THE LEDGER'S MOVES, one line each, as common table expressions ending in
 * `moves` (account, company_id, business_date, debit, credit) for the hotel
 * `hotel` up to the day `to` (SQL expressions, e.g. "$1" and "$3::date").
 * ⚠ A TWIN: app.company_owes (migration 203) is the same closing balance for
 * one company over every hotel, for its credit limit (D27-279). A change to
 * what counts here is a change there.
 */
const cityLedgerMoves = (hotel: string, to: string) =>
    `with transfers as (
       select coalesce(fc.name, app.booking_source_label(bs.name, rc.name, r.source)) as account,
              coalesce(fc.id, rc.id)                                                  as company_id,
              fp.business_date,
              -fp.amount                                                              as amount,
              fp.created_at as at, fp.folio_id, r.reference, g.full_name as guest
         from folio_postings fp
         join payments p on p.posting_id = fp.id and p.method = 'city_ledger'
         join folios f on f.id = fp.folio_id
         left join companies fc on fc.id = f.company_id
         left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
         left join companies rc on rc.id = r.company_id
         left join booking_sources bs on bs.id = r.booking_source_id
         left join guests g on g.id = r.guest_id
        where fp.hotel_id = ${hotel}
          and fp.category = 'payment'
          and ${LIVE}
          and fp.business_date <= ${to}
     ),
     paid as (
       select coalesce(co.name, bs.name) as account, cp.company_id,
              cp.received_on as business_date, cp.amount,
              cp.recorded_at as at, cp.method, cp.reference,
              case when cp.reverses_id is null then cp.note else cp.reason end as note,
              cp.reverses_id is not null as reversal
         from company_payments cp
         left join companies co on co.id = cp.company_id
         left join booking_sources bs on bs.id = cp.booking_source_id
        where cp.hotel_id = ${hotel} and cp.received_on <= ${to}
     ),
     /* The columns after credit are the statement's (companyStatement): what
        each line was. The summaries add up the first five and nothing else. */
     moves as (
       select account, company_id, business_date, amount as debit, 0 as credit,
              at, 'bill' as kind, folio_id, reference, guest, null::text as method, null::text as note
         from transfers
       union all
       select account, company_id, business_date, 0, amount,
              at, case when reversal then 'reversal' else 'payment' end, null, reference, null, method, note
         from paid
     )`;

export async function cityLedgerReport(
  client: Client, property: Property, from: string, to: string, ignoreZero: boolean,
): Promise<ReportDoc> {
  const { rows } = await client.query<{
    account: string | null; contact: string | null; phone: string | null;
    opening: string; debit: string; credit: string;
  }>(
    `${cityLedgerMoves("$1", "$3::date")}
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

/* ══════════════════════════════════════════════════════════════════
   MONEY OWED BY AGE (D27-383 item 2)

   The City ledger's own moves (one definition, above), as on a date. What
   an account has paid is set against its oldest bills first - a company
   payment names the account, never a bill, so first in, first out is the
   only allocation the records allow (decided under D27-396). What is left
   of each bill is aged by the days since it was sent to the account (its
   "Bill to company" day): 0-30, 31-60, 61-90, over 90. Paid more than it
   was sent: "Paid ahead", below zero, so the Total is the City ledger's
   Closing Balance on that date to the paisa.
   ══════════════════════════════════════════════════════════════════ */

const BUCKETS = ["d30", "d60", "d90", "over90"] as const;
type Bucket = (typeof BUCKETS)[number];
export const bucketOf = (age: number): Bucket =>
  (age <= 30 ? "d30" : age <= 60 ? "d60" : age <= 90 ? "d90" : "over90");
const KIND_TITLE: Record<string, string> = {
  corporate: "Companies", travel_agent: "Travel agents", site: "Booking sites",
};

export async function duesByAge(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  const { rows } = await client.query<{
    account: string | null; kind: string; credit_days: number | null;
    age: number; debit: string; credit: string;
  }>(
    `${cityLedgerMoves("$1", "$2::date")}
     select t.account, coalesce(co.kind, 'site') as kind, co.credit_days,
            ($2::date - t.business_date) as age, t.debit::text, t.credit::text
       from moves t
       left join companies co on co.id = t.company_id
      order by t.account, t.business_date, t.at`,
    [property.id, asOn],
  );

  type Account = { account: string | null; kind: string; creditDays: number | null;
                   aged: Record<Bucket, number>; ahead: number; total: number };
  const accounts = new Map<string, Account>();
  const bills = new Map<string, Array<{ age: number; left: number }>>();
  for (const r of rows) {
    const key = r.account ?? "";
    if (!accounts.has(key)) {
      accounts.set(key, { account: r.account, kind: "site", creditDays: null,
        aged: { d30: 0, d60: 0, d90: 0, over90: 0 }, ahead: 0, total: 0 });
      bills.set(key, []);
    }
    const a = accounts.get(key)!;
    /* A company's row names its kind and credit days; a payment line may not. */
    if (r.kind !== "site") a.kind = r.kind;
    if (r.credit_days !== null) a.creditDays = r.credit_days;
    if (Number(r.debit)) bills.get(key)!.push({ age: r.age, left: Number(r.debit) });
    a.ahead = round2(a.ahead + Number(r.credit));
  }
  /* First in, first out: the rows came oldest first. */
  for (const [key, a] of accounts) {
    for (const b of bills.get(key)!) {
      const take = Math.max(0, Math.min(b.left, a.ahead));
      a.ahead = round2(a.ahead - take);
      const left = round2(b.left - take);
      if (left) a.aged[bucketOf(b.age)] = round2(a.aged[bucketOf(b.age)] + left);
    }
    a.total = round2(BUCKETS.reduce((t, k) => t + a.aged[k], 0) - a.ahead);
  }

  const shown = [...accounts.values()].filter((a) => a.total !== 0 || a.ahead !== 0);
  const cells = (label: string, list: Account[], creditDays: number | null) => ({
    account: label, creditDays,
    ...Object.fromEntries(BUCKETS.map((k) => [k, round2(list.reduce((t, a) => t + a.aged[k], 0))])),
    ahead: round2(-list.reduce((t, a) => t + a.ahead, 0)),
    total: round2(list.reduce((t, a) => t + a.total, 0)),
  });
  const lines: ReportRow[] = [];
  for (const kind of ["corporate", "travel_agent", "site"]) {
    const mine = shown.filter((a) => a.kind === kind);
    if (!mine.length) continue;
    lines.push(band("account", KIND_TITLE[kind]!));
    for (const a of mine) lines.push(row(cells(a.account ?? "-", [a], a.creditDays), { indent: 1 }));
    lines.push(total(cells(`${KIND_TITLE[kind]}, total`, mine, null)));
  }
  if (shown.length) lines.push(total(cells("Total owed", shown, null)));

  return {
    report: "dues-by-age",
    title: "Money owed by age",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "As on Date", value: asOn, kind: "date" }],
    sections: [{
      key: "aged",
      title: "Owed by each company, agent and booking site",
      columns: [
        col("account", "Account", "text"),
        col("creditDays", "Credit days", "count"),
        col("d30", "0-30 days"),
        col("d60", "31-60 days"),
        col("d90", "61-90 days"),
        col("over90", "Over 90 days"),
        col("ahead", "Paid ahead"),
        col("total", "Total owed"),
      ],
      rows: lines,
      empty: "No company, agent or booking site owed anything on this date.",
    }],
    footnotes: [
      "What each account owed on the date, by how many days ago each bill was sent to it (\"Bill to company\").",
      "An account's payments are set against its oldest bills first: a payment is recorded against the account, not a bill.",
      "Paid ahead is what an account paid beyond its bills. Total owed is the City ledger's Closing Balance on this date.",
      "A credit note does not change what an account owes; correcting the bill that was sent to it does. Credit days are the company's, a dash where none is set.",
    ],
  };
}

/* ══════════════════════════════════════════════════════════════════
   A STATEMENT OF ACCOUNT (D27-383 item 2)

   One account's moves, the City ledger's own, for the days chosen: the
   opening balance, each bill sent (its booking, guest and the bill's tax
   invoice), each payment and reversal, a running balance, the closing
   balance - the City ledger's Closing Balance for the account on the last
   day. The account is named as the City ledger names it.

   Credit notes on the account's bills are LISTED, in their own section,
   and change no balance: a credit note cancels a tax invoice, and the
   ledger counts the bill sent to the account, not the invoice (decided
   under D27-396; the CA confirms).
   ══════════════════════════════════════════════════════════════════ */

export async function companyStatement(
  client: Client, property: Property, account: string, from: string, to: string,
): Promise<ReportDoc> {
  const { rows } = await client.query<{
    day: string; kind: string; folio: string | null; reference: string | null; guest: string | null;
    method: string | null; note: string | null; debit: string; credit: string; invoice: string | null;
  }>(
    `${cityLedgerMoves("$1", "$3::date")}
     select to_char(t.business_date, 'YYYY-MM-DD') as day, t.kind, t.folio_id::text as folio,
            t.reference, t.guest, t.method, t.note, t.debit::text, t.credit::text,
            (select i.number from invoices i
              where i.folio_id = t.folio_id and i.credits_id is null
                and not exists (select 1 from invoices c where c.credits_id = i.id)
              order by i.issued_at desc limit 1) as invoice
       from moves t
      where t.account = $2
      order by t.business_date, t.at`,
    [property.id, account, to],
  );

  const opening = round2(rows.filter((r) => r.day < from)
    .reduce((t, r) => t + Number(r.debit) - Number(r.credit), 0));
  let balance = opening;
  const lines: ReportRow[] = [row({ on: from, what: "Opening balance", balance: opening })];
  for (const r of rows.filter((x) => x.day >= from)) {
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    balance = round2(balance + debit - credit);
    const how = r.method ? COMPANY_PAYMENT_METHODS[r.method] ?? r.method : null;
    lines.push(row({
      on: r.day,
      what: r.kind === "bill" ? `Bill sent${r.reference ? `: ${r.reference}` : ""}`
        : r.kind === "reversal" ? "Payment reversed" : "Payment received",
      detail: r.kind === "bill"
        ? [r.guest, r.invoice ? `invoice ${r.invoice}` : "no tax invoice yet"].filter(Boolean).join(", ")
        : [how, r.reference, r.note].filter(Boolean).join(", ") || null,
      debit: r.kind === "bill" ? debit : null,
      credit: r.kind === "bill" ? null : credit,
      balance,
    }));
  }
  lines.push(total({ on: to, what: "Closing balance", balance }));

  /* The credit notes on the bills this account was sent, issued in the window. */
  const folios = [...new Set(rows.map((r) => r.folio).filter((f): f is string => Boolean(f)))];
  const { rows: notes } = await client.query<{
    day: string; number: string; credits: string; total: string; reason: string | null;
  }>(
    `select to_char(coalesce(c.business_date, c.issued_at::date), 'YYYY-MM-DD') as day, c.number,
            o.number as credits, (-c.total)::text as total, c.reason
       from invoices c join invoices o on o.id = c.credits_id
      where c.hotel_id = $1 and c.folio_id = any($2::uuid[])
        and coalesce(c.business_date, c.issued_at::date) between $3::date and $4::date
      order by 1, c.number`,
    [property.id, folios, from, to],
  );

  return {
    /* The account is in the facts: the title names the Excel sheet, which takes no ":" (exceljs). */
    report: "company-statement",
    title: "Statement of account",
    property: heading(property),
    orientation: "landscape",
    facts: [
      { label: "Account", value: account, kind: "text" },
      { label: "From", value: from, kind: "date" },
      { label: "To", value: to, kind: "date" },
    ],
    sections: [
      {
        key: "ledger",
        title: "Bills sent, payments and reversals",
        columns: [
          col("on", "Date", "date"), col("what", "Entry", "text"), col("detail", "Detail", "text"),
          col("debit", "Sent to the account"), col("credit", "Received"), col("balance", "Balance"),
        ],
        rows: lines,
      },
      {
        key: "credit-notes",
        title: "Credit notes on this account's bills",
        columns: [
          col("on", "Date", "date"), col("number", "Credit note", "text"),
          col("credits", "Cancels invoice", "text"), col("reason", "Why", "text"), col("total", "Value"),
        ],
        rows: notes.map((n) => row({
          on: n.day, number: n.number, credits: n.credits, reason: n.reason, total: Number(n.total),
        })),
        empty: "No credit note was issued on this account's bills in these days.",
        note: "Listed, not counted: a credit note cancels a tax invoice; what the account owes changes when the bill sent to it is corrected.",
      },
    ],
    footnotes: [
      "The City ledger's own figures: the Closing balance is its Closing Balance for this account on the last day.",
      "A bill sent is a bill settled \"Bill to company\"; a payment is what the account paid, by the day it reached the hotel.",
      "A bill sent and later reversed is not shown, as on the City ledger.",
    ],
  };
}
