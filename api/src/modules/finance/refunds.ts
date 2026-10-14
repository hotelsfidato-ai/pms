import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { resolveDate } from "../../businessDate.ts";
import { inr } from "../../reportRender.ts";
import { can, type Role } from "../../permissions.ts";
import { openOwnDrawer } from "./cashier.ts";

/* ══════════════════════════════════════════════════════════════════
   A REFUND (the owner's D27-315 Part B, 13 October; migration 219)

   A bill paid more than it owes is given the difference back, as its own
   line: a `refund` posting, POSITIVE (money out brings the credit back to
   ₹0), and its `refunds` row - the way, a reference, the reason, who.

   - Only the owner, an administrator, the GM or the accountant: the four
     who may reverse a payment (D27-125). 403 for anyone else, and the
     database refuses them too (app.may_refund).
   - Back by the way it was paid: never cash for a card or UPI payment.
     Cash only below ₹20,000 on a bill (the rest by bank transfer) until
     the CA confirms the limit.
   - Only on a guest's own bill. A company's credit and a booking-site stay
     get a notice; a group's master bill is not a stay's bill at all.
   - Dated the hotel's business date. A cash refund comes out of the
     drawer of whoever gives it (app.cashier_expected_cash).

   Every refusal is above the first write (MEMORY 243), returned, never
   thrown.
   ══════════════════════════════════════════════════════════════════ */

export const refunds = new Hono<{ Variables: { subject: string } }>();

const WHO =
  "Refunds are for the owner, an administrator, the general manager or the accountant. Ask one of them.";
/** Until the CA confirms the limit (D27-315): cash below this, on a bill. */
export const CASH_REFUND_CEILING = 20000;
const CEILING_WORDS =
  "Cash is given back only below ₹20,000 on a bill; give the rest by bank transfer. "
  + "This limit stands until the hotel's CA confirms it.";

const two = (n: number) => Math.round(n * 100) / 100;

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/** The four of D27-125, by the same question a payment reversal asks. */
async function mayRefund(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ role: string | null }>(
    `select case when exists (select 1 from staff s
                               where s.id = app.current_user_id() and s.is_group_admin)
                 then 'owner'
                 else (select sh.role from staff_hotels sh
                        where sh.staff_id = app.current_user_id() and sh.hotel_id = $1)
            end as role`, [hotelId]);
  return can((rows[0]?.role ?? "") as Role, "approve", "invoice");
}

export interface RefundWay { label: string; kind: string; upTo: number }
export interface RefundBill {
  folioId: string;
  /** What the bill owes the guest: its balance below ₹0, else 0. */
  credit: number;
  /** Why this bill's credit is not refunded here, in plain words. */
  notice: string | null;
  ways: RefundWay[];
}

/** Each of the stay's bills: its credit, and the ways and amounts it may be
    given back by. The one reading both the screen and the route use. */
export async function refundBills(client: Client, hotelId: string, stayId: string): Promise<RefundBill[]> {
  const { rows: bills } = await client.query<{
    id: string; balance: string; company: boolean; ota: boolean;
  }>(
    `select f.id::text,
            coalesce((select sum(fp.amount + fp.tax_amount) from folio_postings fp
                       where fp.folio_id = f.id and fp.reverses_id is null
                         and not exists (select 1 from folio_postings v where v.reverses_id = fp.id)),
                     0)::text as balance,
            (f.bill_to = 'company' or f.company_id is not null) as company,
            coalesce(bs.kind, r.source) = 'ota' as ota
       from folios f
       join reservations r on r.id = f.reservation_id
       left join booking_sources bs on bs.id = r.booking_source_id
      where f.hotel_id = $1 and f.reservation_id = $2
      order by f.opened_at, f.id`, [hotelId, stayId]);

  const { rows: methods } = await client.query<{ label: string; kind: string }>(
    `select label, kind from payment_methods
      where hotel_id = $1 and is_active and kind <> 'city_ledger'
      order by sort_order, label`, [hotelId]);

  const out: RefundBill[] = [];
  for (const b of bills) {
    const credit = Math.max(two(-Number(b.balance)), 0);
    const notice = b.company
      ? "This credit is the company's. It is settled with the company on the City ledger, not refunded to the guest here."
      : b.ota
        ? "A booking-site stay: the booking site refunds the guest. Tell the booking site; nothing is refunded here."
        : null;

    /* What each way paid in, and what has gone back by it, on this bill. */
    const { rows: moved } = await client.query<{ kind: string; paid: string; back: string }>(
      `with live as (
         select fp.* from folio_postings fp
          where fp.folio_id = $1::uuid and fp.reverses_id is null
            and not exists (select 1 from folio_postings v where v.reverses_id = fp.id))
       select k.kind,
              coalesce((select sum(p.amount) from live l join payments p on p.posting_id = l.id
                         where l.category = 'payment' and p.method = k.kind), 0)::text as paid,
              coalesce((select sum(rf.amount) from live l join refunds rf on rf.posting_id = l.id
                         where l.category = 'refund' and rf.method = k.kind), 0)::text as back
         from (select distinct kind from payment_methods where hotel_id = $2) k`,
      [b.id, hotelId]);
    const paid = (k: string) => Number(moved.find((m) => m.kind === k)?.paid ?? 0);
    const back = (k: string) => Number(moved.find((m) => m.kind === k)?.back ?? 0);

    /* A transfer gives back a transfer, then the cash a ceiling kept from
       going back in cash; what it took from the cash leaves the cash. */
    const transferOver = Math.max(back("bank_transfer") - paid("bank_transfer"), 0);
    const cashLeft = Math.max(paid("cash") - back("cash") - transferOver, 0);
    const upTo = (kind: string) => {
      if (kind === "cash") {
        return Math.min(cashLeft, CASH_REFUND_CEILING - 0.01 - back("cash"));
      }
      if (kind === "bank_transfer") {
        return Math.max(paid("bank_transfer") - back("bank_transfer"), 0) + cashLeft;
      }
      return paid(kind) - back(kind);
    };
    const ways = notice ? [] : methods
      .map((m) => ({ label: m.label, kind: m.kind, upTo: two(Math.min(Math.max(upTo(m.kind), 0), credit)) }))
      .filter((w) => w.upTo > 0);
    out.push({ folioId: b.id, credit, notice, ways });
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── What may be refunded, for the screen ───────────────────────────── */
refunds.get("/:code/stays/:id/refunds", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");
    if (!UUID.test(stayId)) return { may: false, bills: [], ceiling: CASH_REFUND_CEILING };
    return {
      may: await mayRefund(client, hotelId),
      ceiling: CASH_REFUND_CEILING,
      bills: await refundBills(client, hotelId, stayId),
    };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

/* ── Give it back ───────────────────────────────────────────────────── */
export interface RefundToGive {
  folioId?: string;
  /** The hotel's own label for the way ("UPI", "Credit Card"…). */
  method?: string;
  amount?: number;
  reference?: string;
  reason?: string;
}

refunds.post("/:code/stays/:id/refunds", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as RefundToGive;
  const key = c.req.header("idempotency-key") ?? null;

  const result = await withSession(c.get("subject"), async (client): Promise<
    { status: 200; id: string } | { status: 403 | 409; reason: string } | null
  > => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");
    const no = (reason: string) => ({ status: 409 as const, reason });

    if (!(await mayRefund(client, hotelId))) return { status: 403, reason: WHO };
    if (!UUID.test(stayId)) return no("Reservation not found.");
    if (body.folioId !== undefined && !UUID.test(String(body.folioId))) return no("That bill is not on this stay.");

    const { rows: [stay] } = await client.query<{ guest_id: string }>(
      "select guest_id::text from reservations where hotel_id = $1 and id = $2", [hotelId, stayId]);
    if (!stay) return no("Reservation not found.");

    /* The guest's turn, as a payment takes it: a payment and a refund on the
       same bill never read its balance at the same time. */
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`payment-guest:${stay.guest_id}`]);
    if (key) {
      const { rows: done } = await client.query<{ id: string }>(
        "select id::text from folio_postings where hotel_id = $1 and idempotency_key = $2", [hotelId, key]);
      if (done[0]) return { status: 200, id: done[0].id };
    }

    const amount = two(Number(body.amount));
    if (!(amount > 0)) return no("A refund must be greater than zero.");
    const reason = (body.reason ?? "").trim();
    if (!reason) return no("Say why it is being refunded. The reason stays on the refund.");
    const reference = (body.reference ?? "").trim();

    const bills = await refundBills(client, hotelId, stayId);
    const bill = body.folioId ? bills.find((b) => b.folioId === body.folioId)
      : bills.find((b) => b.credit > 0) ?? bills[0];
    if (!bill) return no(body.folioId ? "That bill is not on this stay." : "This stay has no bill.");
    if (bill.notice) return no(bill.notice);
    if (bill.credit <= 0) return no("Nothing is owed back on this bill.");
    if (amount > bill.credit) return no(`That is more than the ₹${inr(bill.credit)} owed back on this bill.`);

    const { rows: [way] } = await client.query<{ label: string; kind: string }>(
      `select label, kind from payment_methods
        where hotel_id = $1 and is_active and label = $2`, [hotelId, body.method ?? ""]);
    if (!way || way.kind === "city_ledger") return no(`"${body.method ?? ""}" is not a way this hotel gives money back.`);
    /* The cash ceiling first, counting the cash already given back on this
       bill: two refunds of ₹15,000 are ₹30,000 in cash. */
    if (way.kind === "cash") {
      const { rows: [given] } = await client.query<{ n: string }>(
        `select coalesce(sum(rf.amount), 0)::text as n
           from refunds rf join folio_postings fp on fp.id = rf.posting_id
          where fp.folio_id = $1::uuid and rf.method = 'cash'
            and not exists (select 1 from folio_postings v where v.reverses_id = fp.id)`,
        [bill.folioId]);
      if (amount + Number(given!.n) >= CASH_REFUND_CEILING) {
        const { rows: transfer } = await client.query(
          "select 1 from payment_methods where hotel_id = $1 and is_active and kind = 'bank_transfer'",
          [hotelId]);
        return no(CEILING_WORDS + (transfer.length ? ""
          : " Bank transfer is not one of this hotel's ways of paying yet: add it in Settings first."));
      }
    }
    const fits = bill.ways.find((w) => w.label === way.label);
    if (!fits) {
      const ways = bill.ways.map((w) => w.label).join(", ");
      return no(`This bill was not paid by ${way.label}. A refund goes back the way it was paid`
        + `${ways ? `: ${ways}` : ""}; never cash for a card or UPI payment.`);
    }
    if (amount > fits.upTo) return no(`At most ₹${inr(fits.upTo)} goes back by ${way.label} on this bill.`);
    if (way.kind !== "cash" && !reference) {
      return no("Give the reference: the UPI reference, the card approval, the cheque or the transfer number.");
    }

    const businessDate = await resolveDate(client, hotelId, undefined);
    if (way.kind === "cash") await openOwnDrawer(client, hotelId, businessDate);

    const { rows: [made] } = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount, idempotency_key)
       values ($1, $2::uuid, $3, 'refund', $4, $5, 0, 0, $6)
       returning id::text`,
      [hotelId, bill.folioId, businessDate,
       `Refunded - ${way.label}${reference ? ` (${reference})` : ""}`, amount, key]);
    await client.query(
      `insert into refunds (hotel_id, posting_id, method, method_label, amount, reference, reason)
       values ($1, $2::bigint, $3, $4, $5, $6, $7)`,
      [hotelId, made!.id, way.kind, way.label, amount, reference || null, reason]);
    return { status: 200, id: made!.id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if (result.status !== 200) return c.json({ ok: false, reason: result.reason }, result.status);
  return c.json({ ok: true, data: { id: result.id } });
});

/* ── The refund receipt (a plain receipt; the GST Rule 51 voucher waits
      for the CA, B5/C2) ─────────────────────────────────────────────── */
refunds.get("/:code/stays/:id/refunds/:postingId", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!UUID.test(c.req.param("id")) || !/^\d+$/.test(c.req.param("postingId"))) return { receipt: null };
    const { rows: [r] } = await client.query<Record<string, string | null>>(
      `select fp.id::text as number, fp.business_date::text as date,
              to_char(rf.created_at at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI') as at,
              rf.amount::text as amount, rf.method_label as method, rf.reference, rf.reason,
              app.posted_by_name(fp.id) as given_by,
              g.full_name as guest, res.reference as booking, app.stay_room(res.id) as room,
              h.name as hotel, h.address_line as address, h.city, h.state, h.phone, h.gstin,
              exists (select 1 from folio_postings v where v.reverses_id = fp.id) as taken_back
         from folio_postings fp
         join refunds rf on rf.posting_id = fp.id
         join folios f on f.id = fp.folio_id
         join reservations res on res.id = f.reservation_id
         join guests g on g.id = res.guest_id
         join hotels h on h.id = fp.hotel_id
        where fp.hotel_id = $1 and res.id = $2 and fp.id = $3::bigint`,
      [hotelId, c.req.param("id"), c.req.param("postingId")]);
    if (!r) return { receipt: null };
    return {
      receipt: {
        number: r["number"], date: r["date"], at: r["at"], amount: Number(r["amount"]),
        method: r["method"], reference: r["reference"], reason: r["reason"], givenBy: r["given_by"],
        guest: r["guest"], booking: r["booking"], room: r["room"],
        takenBack: r["taken_back"] as unknown as boolean,
        hotel: { name: r["hotel"], address: r["address"], city: r["city"], state: r["state"],
                 phone: r["phone"], gstin: r["gstin"] },
      },
    };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if (!result.receipt) return c.json({ error: "No such refund." }, 404);
  return c.json(result.receipt);
});
