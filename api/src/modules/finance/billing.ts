import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   BILLING — receipts, and the stays ready to invoice

   Two reads, and nothing here writes:

   GET /:code/payments   every receipt, newest first. A reversed one
                         stays on the list.
   GET /:code/billable   departed stays, with what they were charged,
                         what was paid, the balance, and the number of
                         any tax invoice already issued against them.

   Issuing is not here. A tax invoice and a credit note are numbered
   in invoices.ts, through app.next_invoice_number() — one gapless
   series per hotel per financial year. The night audit, which posts
   room charges and moves the business date, is the night-audit
   service's.

   (Until 17 September this header said no invoice number was issued
   and the night audit did not run. Both have been built since
   stage 8 — FIN-1.)
   ══════════════════════════════════════════════════════════════════ */

/* Split on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md). Receipts and billable folios stay here,
   in finance. The rates grid went to inventory (rateGrid.ts), the night
   audit's checklist to night-audit (checklist.ts) and the notifications
   to the core (api/src/routes/notifications.ts). Nothing inside an
   endpoint changed. */

export const billing = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** How the interface labels each stored payment method. */
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", upi: "UPI", card: "Credit Card", netbanking: "Net Banking",
  wallet: "Wallet", cheque: "Cheque", bank_transfer: "Bank Transfer",
  city_ledger: "City Ledger",
};

/* ── Payments ────────────────────────────────────────────────────── */

billing.get("/:code/payments", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* A reversed receipt STAYS on the list, struck through. The ledger
       is append-only and a receipt that disappeared is one somebody
       would go looking for. */
    const { rows } = await client.query<{
      id: string; business_date: string; at: string; guest: string;
      room: string | null; reference: string; method: string | null;
      description: string; amount: string; reversed: boolean;
      taken_by: string | null;
    }>(
      `select fp.id::text, fp.business_date::text, fp.created_at::text as at,
              g.full_name as guest,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id
                order by ra.released_at desc nulls first, ra.from_date desc
                limit 1) as room,
              r.reference, p.method, fp.description, fp.amount,
              exists (select 1 from folio_postings rev
                       where rev.reverses_id = fp.id) as reversed,
              -- WHO TOOK IT, by name (101), as a bill line names who posted
              -- it. This column printed the word "admin" for every receipt.
              app.posted_by_name(fp.id) as taken_by
         from folio_postings fp
         join folios f       on f.id = fp.folio_id
         join reservations r on r.id = f.reservation_id
         join guests g       on g.id = r.guest_id
         left join payments p on p.posting_id = fp.id
        where fp.hotel_id = $1
          and fp.category = 'payment'
          and fp.reverses_id is null
        order by fp.created_at desc, fp.id desc`,
      [hotelId],
    );

    return rows.map((p) => ({
      id: p.id,
      businessDate: p.business_date,
      at: p.at,
      guest: p.guest,
      roomNumber: p.room ?? "",
      reference: p.reference,
      /* A posting without a `payments` row is money whose method was
         never recorded. Said plainly rather than guessed at. */
      method: p.method ? METHOD_LABEL[p.method] ?? p.method : "Unrecorded",
      description: p.description,
      amount: round(-Number(p.amount)),
      /* Null where nobody was recorded: the screen prints a dash. */
      user: p.taken_by,
      reversed: p.reversed,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Billable folios ─────────────────────────────────────────────── */

billing.get("/:code/billable", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      stay_id: string; reference: string; guest: string; room: string | null;
      room_type: string; source: string; arrival: string; departure: string;
      nights: number; charges: string; tax: string; paid: string; balance: string;
      invoice: string | null;
    }>(
      `with live as (
         select fp.*
           from folio_postings fp
           join folios f on f.id = fp.folio_id
          where fp.hotel_id = $1
            and fp.reverses_id is null
            and not exists (
              select 1 from folio_postings rev where rev.reverses_id = fp.id
            )
       )
       select r.id::text as stay_id, r.reference, g.full_name as guest,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id
                order by ra.released_at desc nulls first, ra.from_date desc
                limit 1) as room,
              rt.name as room_type,
              app.booking_source_label(bs.name, co.name, r.source) as source,
              r.check_in::text as arrival, r.check_out::text as departure,
              greatest(r.check_out - r.check_in, 0) as nights,
              coalesce((select sum(amount) from live
                         where reservation_id = r.id and category <> 'payment'), 0)::text as charges,
              coalesce((select sum(tax_amount) from live
                         where reservation_id = r.id), 0)::text                            as tax,
              coalesce((select -sum(amount) from live
                         where reservation_id = r.id and category = 'payment'), 0)::text   as paid,
              coalesce((select sum(amount + tax_amount) from live
                         where reservation_id = r.id), 0)::text                            as balance,
              -- The invoice already issued against this stay, if any.
              -- A departed folio that has been billed is not "ready to
              -- bill", and showing it as such invites a clerk to press a
              -- button that can only tell them off. Reported rather than
              -- filtered out, so the stay keeps its link to the number.
              (select i.number from invoices i
                 join folios f2 on f2.id = i.folio_id
                where f2.reservation_id = r.id and i.credits_id is null
                  and not exists (select 1 from invoices cn
                                   where cn.credits_id = i.id)
                limit 1) as invoice
         from reservations r
         join guests g      on g.id  = r.guest_id
         join room_types rt on rt.id = r.room_type_id
         left join booking_sources bs on bs.id = r.booking_source_id
              left join companies co on co.id = r.company_id
        where r.hotel_id = $1 and r.status = 'checked_out'
        order by r.check_out desc`,
      [hotelId],
    );

    return rows.map((b) => {
      const balance = round(Number(b.balance));
      return {
        stayId: b.stay_id,
        reference: b.reference,
        guest: b.guest,
        roomNumber: b.room ?? "",
        roomType: b.room_type,
        source: b.source,
        arrival: b.arrival,
        departure: b.departure,
        nights: b.nights,
        charges: round(Number(b.charges)),
        tax: round(Number(b.tax)),
        paid: round(Number(b.paid)),
        balance,
        status:
          balance > 0.5 ? "outstanding" : balance < -0.5 ? "overpaid" : "settled",
        /* Null until a tax invoice has been issued against this stay. */
        invoice: b.invoice,
      };
    });
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
