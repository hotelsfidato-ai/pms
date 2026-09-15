import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";
import { businessDateFor, monthStart } from "../businessDate.ts";

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

/* ── No show ─────────────────────────────────────────────────────── */

reports.get("/:code/reports/no-show", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? monthStart(bd);
    const to = toParam ?? bd;

    const { rows } = await client.query<{
      reference: string; guest: string; room_type: string;
      arrival: string; departure: string; source: string; rate: string;
    }>(
      `select r.reference,
              g.full_name                        as guest,
              rt.name                            as room_type,
              r.check_in::text                   as arrival,
              r.check_out::text                  as departure,
              app.booking_source_label(bs.name, co.name, r.source) as source,
              r.agreed_rate                      as rate
         from reservations r
         join guests g      on g.id  = r.guest_id
         join room_types rt on rt.id = r.room_type_id
         left join companies co on co.id = r.company_id
         left join booking_sources bs on bs.id = r.booking_source_id
        where r.hotel_id = $1
          and r.status = 'no_show'
          and r.check_in between $2::date and $3::date
        order by r.check_in, r.reference`,
      [hotelId, from, to],
    );

    /* An empty array is the answer, not a missing one. The real export
       prints headers and no rows for exactly this case. */
    return rows.map((r) => ({
      reference: r.reference,
      guest: r.guest,
      roomType: r.room_type,
      arrival: r.arrival,
      departure: r.departure,
      source: r.source,
      rate: Number(r.rate),
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── City ledger ─────────────────────────────────────────────────── */

reports.get("/:code/reports/city-ledger", async (c) => {
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

/* ── Lodging tax ─────────────────────────────────────────────────── */

reports.get("/:code/reports/lodging-tax", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? monthStart(bd);
    const to = toParam ?? bd;

    /* CGST and SGST are half the total each, by statute — 2.5 + 2.5
       below the ₹7,500 tariff threshold, where every property in this
       group sits. Split from the ONE tax figure the ledger holds
       rather than stored twice, because two columns that must always
       be equal are two chances to disagree. */
    const { rows } = await client.query<{
      date: string; bills: string; total_bill: string; room_rent: string;
      tax: string; extras: string; discount: string;
    }>(
      `with live as (${LIVE_POSTINGS})
       select l.business_date::text                                       as date,
              count(distinct l.folio_id)::text                            as bills,
              coalesce(sum(l.amount + l.tax_amount) filter (
                where l.category <> 'payment'), 0)::text                  as total_bill,
              coalesce(sum(l.amount) filter (where l.category = 'room'), 0)::text
                                                                          as room_rent,
              coalesce(sum(l.tax_amount), 0)::text                        as tax,
              coalesce(sum(l.amount) filter (where l.category not in
                ('room','payment','discount','tax','refund')), 0)::text   as extras,
              coalesce(-sum(l.amount) filter (
                where l.category = 'discount'), 0)::text                  as discount
         from live l
        where l.business_date between $2::date and $3::date
        group by l.business_date
        order by l.business_date`,
      [hotelId, from, to],
    );

    const round = (n: number) => Math.round(n * 100) / 100;

    return rows.map((r) => {
      const tax = round(Number(r.tax));
      const roomRent = round(Number(r.room_rent));
      return {
        date: r.date,
        /* The real export prints a bill-number range. Invoice numbers
           are not issued yet — see the Invoices screen — so the count
           stands in and the range is a dash rather than a made-up
           pair of numbers that would land in a filed return. */
        fromBill: "—",
        toBill: "—",
        totalBill: round(Number(r.total_bill)),
        totalRoomRent: roomRent,
        nonTaxable: 0,
        cgstNet: roomRent,
        cgstTax: round(tax / 2),
        sgstNet: roomRent,
        sgstTax: round(tax / 2),
        serviceCharges: 0,
        otherBills: round(Number(r.extras)),
        lessDiscount: round(Number(r.discount)),
        roundOff: 0,
      };
    });
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

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
        room: r.room ?? "—",
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

/* ── Form C / C-Form ─────────────────────────────────────────────── */

reports.get("/:code/reports/c-form", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? monthStart(bd);
    const to = toParam ?? bd;

    /* The printable form of the register. `app.form_c_due()` answers
       who owes a filing today; this answers what happened across a
       period, which is what an inspection asks to see.

       Every field the FRRO form wants comes from guest_documents —
       which nothing wrote to until Phase 1 item 1, and which is why
       this report carried the note "needs passport capture at
       check-in" for the whole project. */
    const { rows } = await client.query<{
      guest: string; nationality: string; passport: string | null;
      passport_expiry: string | null; visa_number: string | null;
      visa_expiry: string | null; address: string | null;
      room: string | null; arrived: string; departed: string;
      reference: string | null; filed_at: string | null;
    }>(
      `select g.full_name as guest, g.nationality,
              gd.id_number as passport,
              to_char(gd.passport_expiry,'YYYY-MM-DD') as passport_expiry,
              gd.visa_number,
              to_char(gd.visa_expiry,'YYYY-MM-DD') as visa_expiry,
              gd.address_line as address,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id
                order by ra.released_at nulls first, ra.from_date desc
                limit 1) as room,
              to_char(r.check_in,'YYYY-MM-DD') as arrived,
              to_char(r.check_out,'YYYY-MM-DD') as departed,
              f.reference,
              to_char(f.filed_at, 'YYYY-MM-DD HH24:MI') as filed_at
         from reservations r
         join guests g on g.id = r.guest_id
         left join guest_documents gd on gd.guest_id = g.id
         left join form_c_filings f on f.reservation_id = r.id
        where r.hotel_id = $1
          and g.nationality <> 'IN'
          and r.status in ('checked_in','checked_out')
          and r.check_in between $2::date and $3::date
        order by r.check_in, g.full_name`,
      [hotelId, from, to],
    );

    return {
      from, to,
      note:
        "This system does not file with the FRRO. Filing happens on the " +
        "government portal; this is the record of what was filed.",
      rows: rows.map((r) => ({
        guest: r.guest,
        nationality: r.nationality,
        /* Null where nothing was captured. A blank on a form that must
           be filed is somebody's job this morning, and hiding it would
           make the report look complete when it is not. */
        passport: r.passport,
        passportExpiry: r.passport_expiry,
        visaNumber: r.visa_number,
        visaExpiry: r.visa_expiry,
        address: r.address,
        room: r.room ?? "—",
        arrived: r.arrived,
        departed: r.departed,
        reference: r.reference,
        filedAt: r.filed_at,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
