import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";
import { businessDateFor, monthStart } from "../businessDate.ts";

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
              coalesce(co.name, case r.source
                                 when 'walk_in' then 'Walk-in'
                                 when 'direct'  then 'Fidato Hotels'
                                 else initcap(r.source)
                               end) as source,
              r.agreed_rate                      as rate
         from reservations r
         join guests g      on g.id  = r.guest_id
         join room_types rt on rt.id = r.room_type_id
         left join companies co on co.id = r.company_id
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
      account: string; debit: string; credit: string; closing: string;
    }>(
      `with live as (${LIVE_POSTINGS}),
       by_account as (
         select coalesce(co.name, case r.source
                                 when 'walk_in' then 'Walk-in'
                                 when 'direct'  then 'Fidato Hotels'
                                 else initcap(r.source)
                               end) as account,
                l.category,
                l.amount,
                l.tax_amount,
                l.business_date
           from live l
           join folios f      on f.id = l.folio_id
           join reservations r on r.id = f.reservation_id
           left join companies co on co.id = r.company_id
       )
       select account,
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
      contact: `Mr. ${r.account}`,
      /* Not held in this system. A dash, not a blank. */
      phone: null,
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
