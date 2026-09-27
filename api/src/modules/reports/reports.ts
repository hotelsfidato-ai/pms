import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor, monthStart } from "../../businessDate.ts";

/* Paise, not floating dust. Defined here as it is in billing.ts and
   manager.ts — three copies of one line, which is fine until one of
   them changes. */
const round = (n: number) => Math.round(n * 100) / 100;

/* ══════════════════════════════════════════════════════════════════
   THE STATUTORY REPORTS

   These are filed, not read. They have to reconcile to the rupee, and
   two of them print EMPTY for this property — which is the correct
   output and not a bug. A no-show report with no rows means nobody
   failed to arrive, and that is worth printing.

   Nothing here invents a figure. Where the system cannot derive
   something the real export carries — an opening balance, a
   commission — it returns null, and the interface prints an em-dash.
   An invented zero on a report an accountant reads is worse than a
   visible gap.
   ══════════════════════════════════════════════════════════════════ */

/* The label a person reads. `initcap(replace(...))` turned walk_in into
   "Walk In", which is not what every other screen calls it — the stays
   route says "Walk-in". One label, spelled one way. */
export const reports = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/** Postings that still count: not a reversal, and not reversed. */
const LIVE_POSTINGS = `
  select fp.*
    from folio_postings fp
   where fp.hotel_id = $1
     and fp.reverses_id is null
     and not exists (
       select 1 from folio_postings rev where rev.reverses_id = fp.id
     )
`;

/* No show is a report in the owner's layout now: builders/noShow.ts. */

/* ── Balances by booking source ───────────────────────────────────
   WAS "/reports/city-ledger". The City ledger is a report in the owner's
   layout now (builders/cityLedger.ts), counting bills transferred to a
   company, as the owner decided on 17 September. These by-source
   figures stay only for finance's "Company accounts" screen, which
   reads them through getCityLedger; whether that screen should move to
   the transfers is finance's question (asked through the master). */

reports.get("/:code/reports/balances-by-source", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? monthStart(bd);
    const to = toParam ?? bd;

    const { rows } = await client.query<{
      account: string; contact: string | null; phone: string | null;
      debit: string; credit: string; closing: string;
    }>(
      `with live as (${LIVE_POSTINGS}),
       by_account as (
         select app.booking_source_label(bs.name, co.name, r.source) as account,
                co.name         as company,
                co.contact_name as contact_name,
                co.phone        as company_phone,
                l.category,
                l.amount,
                l.tax_amount,
                l.business_date
           from live l
           join folios f      on f.id = l.folio_id
           join reservations r on r.id = f.reservation_id
           left join companies co on co.id = r.company_id
         left join booking_sources bs on bs.id = r.booking_source_id
       )
       select account,
              /* The company's own contact, from its record — and only on
                 the company's own row. The label puts the company first
                 (082), so account = company is exactly "this row IS the
                 company". A channel or a walk-in has no contact on file. */
              max(contact_name)  filter (where company = account) as contact,
              max(company_phone) filter (where company = account) as phone,
              coalesce(sum(amount + tax_amount) filter (
                where category <> 'payment'
                  and business_date between $2::date and $3::date), 0)::text as debit,
              coalesce(-sum(amount) filter (
                where category = 'payment'
                  and business_date between $2::date and $3::date), 0)::text as credit,
              coalesce(sum(amount + tax_amount), 0)::text                    as closing
         from by_account
        group by account
        order by account`,
      [hotelId, from, to],
    );

    return rows.map((r) => ({
      account: r.account,
      /* WAS `Mr. ${r.account}` — "Mr. Agoda", "Mr. Walk-in": a person
         invented for every account and printed as its contact, on a report
         an accountant reads, and in its CSV. The company's contact when
         its record holds one; otherwise null, which the report prints as
         a dash, like the phone beside it. */
      contact: r.contact,
      phone: r.phone,
      /* Nothing predates the demo window, so an opening balance would
         be invented rather than derived. */
      opening: null,
      debit: Math.round(Number(r.debit) * 100) / 100,
      credit: Math.round(Number(r.credit) * 100) / 100,
      closing: Math.round(Number(r.closing) * 100) / 100,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* Lodging tax is a report in the owner's layout now: builders/lodgingTax.ts. */

/* ══════════════════════════════════════════════════════════════════
   PHASE 1 · items 2 and 3 — the four reports listed and never built.

   Two carried a written condition:

     GST Sales Register  "needs the invoice series to be live first"
     Form F / C-Form     "needs passport capture at check-in"

   Both are now met — Stage 8, and Phase 1 item 1 — which is why these
   are built now rather than earlier. The other two waited on nothing
   but the work.
   ══════════════════════════════════════════════════════════════════ */

/* ── Guest ledger ────────────────────────────────────────────────── */

reports.get("/:code/reports/guest-ledger", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? monthStart(bd);
    const to = toParam ?? bd;

    /* Every folio that MOVED in the window, with what it looked like
       before and after.

       Opening is the ledger sum strictly BEFORE `from`; closing is the
       sum up to and including `to`. Both come from the same postings
       the folio screen adds up, so a balance here and a balance there
       cannot disagree.

       Reversed postings and their reversals are both excluded — a
       charge that was cancelled never moved the balance, and counting
       the pair would show two movements that net to nothing. */
    const { rows } = await client.query<{
      folio_id: string; reference: string; guest: string; room: string | null;
      status: string; opening: string; charges: string; payments: string;
      closing: string;
    }>(
      `with live as (
         select fp.folio_id, fp.business_date, fp.category,
                fp.amount + fp.tax_amount as movement
           from folio_postings fp
          where fp.hotel_id = $1
            and fp.reverses_id is null
            and not exists (
              select 1 from folio_postings rev where rev.reverses_id = fp.id
            )
       )
       select f.id::text as folio_id, r.reference, g.full_name as guest,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id
                order by ra.released_at nulls first, ra.from_date desc
                limit 1) as room,
              r.status,
              coalesce((select sum(movement) from live l
                         where l.folio_id = f.id
                           and l.business_date < $2::date), 0)::text as opening,
              coalesce((select sum(movement) from live l
                         where l.folio_id = f.id
                           and l.business_date between $2::date and $3::date
                           and l.category not in ('payment','refund')), 0)::text
                as charges,
              coalesce((select -sum(movement) from live l
                         where l.folio_id = f.id
                           and l.business_date between $2::date and $3::date
                           and l.category in ('payment','refund')), 0)::text
                as payments,
              coalesce((select sum(movement) from live l
                         where l.folio_id = f.id
                           and l.business_date <= $3::date), 0)::text as closing
         from folios f
         join reservations r on r.id = f.reservation_id
         join guests g on g.id = r.guest_id
        where f.hotel_id = $1
          and exists (select 1 from live l
                       where l.folio_id = f.id
                         and l.business_date between $2::date and $3::date)
        order by r.check_in, g.full_name`,
      [hotelId, from, to],
    );

    return {
      from, to,
      rows: rows.map((r) => ({
        folioId: r.folio_id,
        reference: r.reference,
        guest: r.guest,
        room: r.room ?? "-",
        status: r.status,
        opening: round(Number(r.opening)),
        charges: round(Number(r.charges)),
        payments: round(Number(r.payments)),
        closing: round(Number(r.closing)),
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Cashier shift ───────────────────────────────────────────────── */

reports.get("/:code/reports/cashier-shift", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? bd;
    const to = toParam ?? bd;

    /* Money taken, BY WHOM.

       The reports index said this was "waiting on real user accounts".
       `posted_by` has carried a real staff uuid since the ledger was
       built — what was missing was somebody reading it. Password
       sign-in is still stubbed; the identity on a posting is not.

       A receipt whose posting has been reversed is not money the
       cashier holds, so it is excluded — the same definition the
       Manager Report uses. */
    const { rows } = await client.query<{
      staff_id: string | null; cashier: string | null; method: string;
      n: string; amount: string;
    }>(
      `select fp.posted_by::text as staff_id,
              s.full_name as cashier,
              coalesce(p.method, 'unrecorded') as method,
              count(*)::text as n,
              (-sum(fp.amount))::text as amount
         from folio_postings fp
         left join payments p on p.posting_id = fp.id
         left join staff s on s.id = fp.posted_by
        where fp.hotel_id = $1
          and fp.category = 'payment'
          /* Money in the drawer. A bill transferred to the city ledger is
             posted as a payment, and nobody handed over any money for it
             (the owner, 17 September). */
          and coalesce(p.method, '') <> 'city_ledger'
          and fp.business_date between $2::date and $3::date
          and fp.reverses_id is null
          and not exists (
            select 1 from folio_postings rev where rev.reverses_id = fp.id
          )
        group by fp.posted_by, s.full_name, coalesce(p.method, 'unrecorded')
        order by s.full_name nulls last, method`,
      [hotelId, from, to],
    );

    return {
      from, to,
      rows: rows.map((r) => ({
        staffId: r.staff_id,
        /* Null, not "System". A posting with no staff id was made
           before this system recorded one, and naming who took the
           money when nobody knows is worse than a dash. */
        cashier: r.cashier,
        method: r.method,
        count: Number(r.n),
        amount: round(Number(r.amount)),
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── GST sales register ──────────────────────────────────────────── */

reports.get("/:code/reports/gst-sales", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? monthStart(bd);
    const to = toParam ?? bd;

    /* Invoice-level, in the order GSTR-1 wants it. Credit notes appear
       as their own rows with negative values, because that is how they
       are filed — a return that netted them into the invoice would not
       reconcile against the invoices actually issued. */
    const { rows } = await client.query<{
      number: string; issued: string; recipient: string | null;
      gstin: string | null; place_of_supply: string | null; sac: string;
      taxable: string; cgst: string; sgst: string; total: string;
      credits: string | null;
    }>(
      /* Dated by the property's BUSINESS DATE, not the wall clock.
         A GST return is filed by document date, and a hotel's document
         date is the day it was operating in — an invoice raised at
         09:00 on the 29th for a stay that closed on the 25th belongs to
         the 25th, and filtering on issued_at put it outside an August
         register entirely. `issued_at` remains the audit timestamp:
         when somebody pressed the button. */
      `select i.number,
              to_char(coalesce(i.business_date, i.issued_at::date),
                      'YYYY-MM-DD') as issued,
              i.recipient_name as recipient, i.recipient_gstin as gstin,
              i.place_of_supply, i.sac_code as sac,
              i.taxable_value::text as taxable, i.cgst_total::text as cgst,
              i.sgst_total::text as sgst, i.total::text,
              (select o.number from invoices o where o.id = i.credits_id)
                as credits
         from invoices i
        where i.hotel_id = $1
          and coalesce(i.business_date, i.issued_at::date)
              between $2::date and $3::date
        order by coalesce(i.business_date, i.issued_at::date), i.number`,
      [hotelId, from, to],
    );

    return {
      from, to,
      rows: rows.map((r) => ({
        number: r.number,
        issued: r.issued,
        recipient: r.recipient,
        /* A dash, not "URP". An unregistered recipient is a fact; a
           three-letter code invented here would be one this system
           made up. */
        gstin: r.gstin,
        placeOfSupply: r.place_of_supply,
        sac: r.sac,
        taxable: round(Number(r.taxable)),
        cgst: round(Number(r.cgst)),
        sgst: round(Number(r.sgst)),
        total: round(Number(r.total)),
        creditsInvoice: r.credits,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── The Form III register ────────────────────────────────────────── */

reports.get("/:code/reports/c-form", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? monthStart(bd);
    const to = toParam ?? bd;

    /* The record an inspection asks to see (Rule 17(2)): every foreign
       arrival in the period, in Form III's order. The guests service's
       app.form_iii (147) is the one answer, so this and the register
       cannot disagree. Blanks stay null - a gap on a form that must be
       filed is somebody's job, and hiding it makes the report look
       complete when it is not. */
    const { rows } = await client.query<Record<string, string | null>>(
      `select f.guest_name as guest, f.nationality, f.passport,
              f.passport_issued_on::text as "passportIssuedOn",
              f.passport_issue_place as "passportIssuePlace",
              f.passport_expiry::text as "passportExpiry",
              f.visa_number as "visaNumber", f.visa_type as "visaType",
              f.visa_issued_on::text as "visaIssuedOn",
              f.visa_expiry::text as "visaExpiry",
              f.phone_in_india as "phoneInIndia", f.mobile_in_india as "mobileInIndia",
              f.phone_abroad as "phoneAbroad", f.mobile_abroad as "mobileAbroad",
              f.email, f.remarks,
              f.arrived_from as "arrivedFrom",
              to_char(f.arrived_at at time zone h.timezone, 'YYYY-MM-DD HH24:MI') as "arrivedAt",
              initcap(f.purpose) as purpose, f.purpose_other as "purposeOther",
              f.previous_stay as "previousStay",
              to_char(f.departed_at at time zone h.timezone, 'YYYY-MM-DD HH24:MI') as "departedAt",
              f.next_destination as "nextDestination",
              initcap(f.gender) as gender, f.date_of_birth::text as "dateOfBirth",
              f.arrived_in_india_on::text as "arrivedInIndiaOn",
              f.arrival_port as "arrivalPort",
              concat_ws(', ', f.home_address, f.home_city, f.home_country) as address,
              concat_ws(', ', f.ref_address, f.ref_city, f.ref_state, f.ref_pincode) as "refAddress",
              case f.employed_in_india when true then 'Yes' when false then 'No' end as "employedInIndia",
              f.room_number as room,
              f.check_in::text as arrived, f.check_out::text as departed,
              array_to_string(f.arrival_numbers, ', ') as reference,
              array_to_string(f.departure_numbers, ', ') as "departureReference"
         from app.form_iii($1) f
         join hotels h on h.id = $1
        where f.check_in between $2::date and $3::date
        order by f.check_in, f.guest_name`,
      [hotelId, from, to],
    );

    return {
      from, to,
      note:
        "This system does not file with the FRRO. Filing happens on the " +
        "government portal; this is the record of what was filed.",
      /* '' from concat_ws or array_to_string is "nothing recorded". */
      rows: rows.map((r) => Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, v === "" ? null : v]))),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
