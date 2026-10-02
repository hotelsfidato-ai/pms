import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   A COMPANY PAYS WHAT IT OWES - the owner's D27-152, D27-239

   A bill settled "Bill to company" is owed by its account (the City
   ledger's Debit). The desk or accounts records the company's payment
   here - against the company, or the booking site a booking came through,
   whichever the ledger names - and the City ledger's Opening, Credit and
   Closing fill in. Plain payments: no GST receipt voucher (the CA, B5/C2).

   Append-only (187): a wrong line is reversed by its own line, once, with
   a reason, by the four who may reverse a payment (D27-125). Who may do
   what is roleGate's: record `payment` create, reverse `payment` edit.
   ══════════════════════════════════════════════════════════════════ */

export const companyPayments = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* How a company pays. ⚠ Q1 OF THE PLAN (cash?) IS WITH THE OWNER: cash is
   not offered until it is answered - it would belong in a drawer. */
export const COMPANY_PAYMENT_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer", cheque: "Cheque", upi: "UPI", card: "Card",
};

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/* The account a line belongs to, named the way the City ledger names it. */
const ACCOUNT = `coalesce(co.name, bs.name)`;

/** One company receipt, as the accountant's day book lists it (D27-242). */
export interface CompanyReceipt {
  date: string; account: string; method: string; reference: string | null; amount: number;
}

/**
 * What companies and booking sites paid, by the day it reached the hotel,
 * for the day book (the owner's D27-242, Q4): receipts, apart from sales.
 * Only lines that still count: not a reversal, and not reversed - the day
 * book's rule for every other line (reports' LIVE). One receipt is one
 * future Tally receipt voucher (ACC-4): party, bank, amount, reference.
 */
export async function companyReceipts(
  client: Client, hotelId: string, from: string, to: string,
): Promise<CompanyReceipt[]> {
  const { rows } = await client.query<{
    date: string; account: string; method: string; reference: string | null; amount: string;
  }>(
    `select cp.received_on::text as date, ${ACCOUNT} as account, cp.method, cp.reference,
            cp.amount::text
       from company_payments cp
       left join companies co on co.id = cp.company_id
       left join booking_sources bs on bs.id = cp.booking_source_id
      where cp.hotel_id = $1 and cp.received_on between $2::date and $3::date
        and cp.reverses_id is null
        and not exists (select 1 from company_payments r where r.reverses_id = cp.id)
      order by cp.received_on, cp.recorded_at`,
    [hotelId, from, to]);
  return rows.map((r) => ({
    date: r.date, account: r.account, method: COMPANY_PAYMENT_METHODS[r.method] ?? r.method,
    reference: r.reference, amount: Number(r.amount),
  }));
}

companyPayments.get("/:code/company-payments", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; account: string; company_id: string | null; booking_source_id: string | null;
      amount: string; received_on: string; method: string; reference: string | null;
      note: string | null; reverses_id: string | null; reason: string | null;
      recorded_by: string | null; recorded_at: string; reversed: boolean;
    }>(
      `select cp.id::text, ${ACCOUNT} as account, cp.company_id::text, cp.booking_source_id::text,
              cp.amount::text, cp.received_on::text, cp.method, cp.reference, cp.note,
              cp.reverses_id::text, cp.reason,
              coalesce(s.full_name, hp.full_name) as recorded_by,
              to_char(cp.recorded_at, 'DD Mon, HH24:MI') as recorded_at,
              exists (select 1 from company_payments r where r.reverses_id = cp.id) as reversed
         from company_payments cp
         left join companies co on co.id = cp.company_id
         left join booking_sources bs on bs.id = cp.booking_source_id
         left join staff s on s.id = cp.recorded_by
         left join app.hotel_people($1) hp on hp.id = cp.recorded_by
        where cp.hotel_id = $1
        order by cp.recorded_at desc`,
      [hotelId]);

    /* The accounts a payment can be recorded against: every one the ledger
       has sent a bill to, or that has paid before. */
    const { rows: accounts } = await client.query<{
      company_id: string | null; booking_source_id: string | null; name: string;
    }>(
      `with sent as (
         select distinct coalesce(f.company_id, r.company_id) as company_id,
                case when coalesce(f.company_id, r.company_id) is null
                     then r.booking_source_id end as booking_source_id
           from folio_postings fp
           join payments p on p.posting_id = fp.id and p.method = 'city_ledger'
           join folios f on f.id = fp.folio_id
           left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
          where fp.hotel_id = $1
         union
         select company_id, booking_source_id from company_payments where hotel_id = $1
       )
       select x.company_id::text, x.booking_source_id::text, ${ACCOUNT} as name
         from sent x
         left join companies co on co.id = x.company_id
         left join booking_sources bs on bs.id = x.booking_source_id
        where x.company_id is not null or x.booking_source_id is not null
        order by 3`,
      [hotelId]);

    return {
      businessDate: await businessDateFor(client, hotelId),
      methods: COMPANY_PAYMENT_METHODS,
      accounts: accounts.map((a) => ({
        companyId: a.company_id, bookingSourceId: a.booking_source_id, name: a.name })),
      payments: rows.map((r) => ({
        id: r.id, account: r.account, companyId: r.company_id, bookingSourceId: r.booking_source_id,
        amount: Number(r.amount), receivedOn: r.received_on,
        method: COMPANY_PAYMENT_METHODS[r.method] ?? r.method, reference: r.reference, note: r.note,
        reversesId: r.reverses_id, reason: r.reason,
        recordedBy: r.recorded_by, recordedAt: r.recorded_at, reversed: r.reversed,
      })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

companyPayments.post("/:code/company-payments", async (c) => {
  type Body = {
    companyId?: string; bookingSourceId?: string; amount?: unknown; receivedOn?: string;
    method?: string; reference?: string; note?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const companyId = input.companyId || null;
  const sourceId = input.bookingSourceId || null;
  if ((companyId === null) === (sourceId === null)) {
    return c.json(refuse("Which company or booking site paid? Choose one account."), 409);
  }
  if (![companyId, sourceId].every((x) => x === null || UUID.test(x))) {
    return c.json(refuse("That account is not on record."), 409);
  }
  const amount = input.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return c.json(refuse("How much was paid?"), 409);
  }
  if (!input.receivedOn || !ISO.test(input.receivedOn)) {
    return c.json(refuse("On what date did the money reach the hotel?"), 409);
  }
  if (!input.method || !COMPANY_PAYMENT_METHODS[input.method]) {
    return c.json(refuse("How was it paid - bank transfer, cheque, UPI or card?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (input.receivedOn! > await businessDateFor(client, hotelId)) {
      return refuse("A payment cannot be dated after today's business date.");
    }
    const { rows: known } = await client.query(
      companyId ? "select 1 from companies where id = $1::uuid"
                : "select 1 from booking_sources where id = $1::uuid",
      [companyId ?? sourceId]);
    if (!known.length) return refuse("That account is not on record.");

    const { rows } = await client.query<{ id: string }>(
      `insert into company_payments (hotel_id, company_id, booking_source_id, amount, received_on,
                                     method, reference, note, recorded_by)
       values ($1, $2::uuid, $3::uuid, $4, $5::date, $6, nullif($7, ''), nullif($8, ''), app.current_user_id())
       returning id::text`,
      [hotelId, companyId, sourceId, amount.toFixed(2), input.receivedOn, input.method,
       input.reference?.trim() ?? "", input.note?.trim() ?? ""]);
    return { ok: true as const, id: rows[0]!.id };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

companyPayments.post("/:code/company-payments/:id/reverse", async (c) => {
  const input = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = input.reason?.trim();
  if (!reason) return c.json(refuse("Why is it being reversed? This is the line somebody asks about."), 409);
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json(refuse("No such payment."), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* One reversal of a line at a time. Not FOR UPDATE: the table is
       insert-only (187), and a row lock needs the right to update it. The
       unique reverses_id is the backstop. */
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`company-payment:${id}`]);
    const { rows } = await client.query<{ reverses_id: string | null; reversed: boolean }>(
      `select reverses_id::text,
              exists (select 1 from company_payments r where r.reverses_id = cp.id) as reversed
         from company_payments cp where cp.id = $1::uuid and cp.hotel_id = $2`,
      [id, hotelId]);
    const line = rows[0];
    if (!line) return refuse("No such payment.");
    if (line.reverses_id) return refuse("That line is itself a reversal.");
    if (line.reversed) return refuse("That payment is already reversed.");

    await client.query(
      `insert into company_payments (hotel_id, company_id, booking_source_id, amount, received_on,
                                     method, reference, reverses_id, reason, recorded_by)
       select hotel_id, company_id, booking_source_id, -amount, received_on,
              method, reference, id, $2, app.current_user_id()
         from company_payments where id = $1::uuid`,
      [id, reason]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
