import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";
import { businessDateFor } from "../businessDate.ts";
import { blockersFor } from "./nightAudit.ts";

/* ══════════════════════════════════════════════════════════════════
   BILLING — receipts, billable folios, rates, and the night audit

   Two things here are deliberately NOT done, and each is refused with
   its reason on screen rather than quietly missing.

   NO INVOICE NUMBER IS ISSUED. 5EFH154 is the hotel's real next GST
   number. A number shown here but never printed on a filed return
   leaves a hole in a statutory sequence, and a hole in a GST series is
   a question from an assessor.

   THE NIGHT AUDIT DOES NOT RUN. It posts room charges and rolls the
   business date, and the business date is still a constant. Posting
   without advancing it would double-charge every occupied room the
   next time anyone pressed the button. Everything it would CHECK is
   computed anyway — that is the part a manager reads.
   ══════════════════════════════════════════════════════════════════ */

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
    }>(
      `select fp.id::text, fp.business_date::text, fp.created_at::text as at,
              g.full_name as guest,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id
                order by ra.released_at nulls first, ra.from_date desc
                limit 1) as room,
              r.reference, p.method, fp.description, fp.amount,
              exists (select 1 from folio_postings rev
                       where rev.reverses_id = fp.id) as reversed
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
      user: "admin",
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
                order by ra.released_at nulls first, ra.from_date desc
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

/* ── Rates ───────────────────────────────────────────────────────── */

billing.get("/:code/rates", async (c) => {
  const fromParam = c.req.query("from");
  const days = Number(c.req.query("days") ?? 14);

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? bd;

    /* Rack against achieved. Rack is flat because there is no published
       rate calendar — every difference in the achieved line is
       something a person negotiated on the day, which is exactly what
       a revenue manager wants to see.

       Sold counts PAYING rooms. A complimentary room is occupied and
       sold for nothing; counting it would disagree with the rate beside
       it and with Sold Room on the Manager Report. */
    const { rows } = await client.query<{
      room_type: string; base_rate: string; date: string;
      sold: string; sellable: string; sold_adr: string | null;
    }>(
      `with dates as (
         select d::date as date
           from generate_series($2::date, $2::date + ($3 - 1), interval '1 day') d
       ),
       types as (
         /* sort_order is SELECTED here because the query below groups and
            orders by it. It was not, so every call to this endpoint died
            on 'column t.sort_order does not exist' -- and the Rates
            screen showed an empty state that read like "Stage 9 has not
            landed yet" rather than "this request failed".

            An empty screen and a broken one look identical.

            (No backticks: this comment is inside a template literal, and
            one would end it. operations.ts already carries the same
            warning, which I had read.) */
         select id, name, base_rate, sort_order from room_types
          where hotel_id = $1 and is_active
       )
       select t.name as room_type, t.base_rate, dates.date::text,
              count(r.id) filter (where not r.is_complimentary)::text as sold,
              (select count(*) from rooms rm
                where rm.room_type_id = t.id and rm.is_active
                  and not exists (
                    select 1 from room_blocks b
                     where b.room_id = rm.id
                       and dates.date >= b.from_date
                       and (b.to_date is null or dates.date <= b.to_date)
                  ))::text                                           as sellable,
              avg(r.agreed_rate) filter (
                where not r.is_complimentary)::text                  as sold_adr
         from types t
         cross join dates
         left join reservations r
                on r.room_type_id = t.id
               and r.status in ('confirmed','checked_in','checked_out')
               and dates.date >= r.check_in
               and dates.date <  greatest(r.check_out, r.check_in + 1)
        group by t.id, t.name, t.base_rate, t.sort_order, dates.date
        order by t.sort_order, dates.date`,
      [hotelId, from, days],
    );

    const byType = new Map<string, {
      roomType: string; rackRate: number;
      cells: Array<{ date: string; rackRate: number; soldAdr: number | null; sold: number; sellable: number }>;
    }>();

    for (const r of rows) {
      const rack = Number(r.base_rate);
      if (!byType.has(r.room_type)) {
        byType.set(r.room_type, { roomType: r.room_type, rackRate: rack, cells: [] });
      }
      byType.get(r.room_type)!.cells.push({
        date: r.date,
        rackRate: rack,
        soldAdr: r.sold_adr === null ? null : round(Number(r.sold_adr)),
        sold: Number(r.sold),
        sellable: Number(r.sellable),
      });
    }

    return [...byType.values()];
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Night audit — the pre-flight checklist ──────────────────────── */

billing.get("/:code/night-audit", async (c) => {
  const asOnParam = c.req.query("asOn");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const asOn = asOnParam ?? bd;

    const { rows } = await client.query<{
      outstanding: string; due_out: string; owing: string;
      to_post: string; dirty: string; reversals: string;
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
       select
         (select count(*) from reservations r
           where r.hotel_id = $1 and r.status = 'confirmed'
             and r.check_in = $2::date)::text                          as outstanding,
         (select count(*) from reservations r
           where r.hotel_id = $1 and r.status = 'checked_in'
             and r.check_out = $2::date)::text                         as due_out,
         (select count(*) from reservations r
           where r.hotel_id = $1 and r.status = 'checked_in'
             and (select coalesce(sum(amount + tax_amount), 0) from live
                   where reservation_id = r.id) > 0.5)::text           as owing,
         (select count(*) from reservations r
           where r.hotel_id = $1 and r.status = 'checked_in'
             and not r.is_day_use)::text                               as to_post,
         (select count(*) from rooms rm
           where rm.hotel_id = $1 and rm.housekeeping_status = 'dirty')::text as dirty,
         (select count(*) from folio_postings fp
           where fp.hotel_id = $1 and fp.reverses_id is not null
             and fp.business_date = $2::date)::text                    as reversals`,
      [hotelId, asOn],
    );

    const r = rows[0]!;
    const next = new Date(`${asOn}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);

    /* ONE definition of whether the day may close, shared with
       POST /night-audit/run. Rule 6 works only if the disabled button
       and the server's refusal are the same answer. */
    const blockers = await blockersFor(client, hotelId, asOn);
    const canRun = {
      allowed: blockers.length === 0,
      ...(blockers.length
        ? { reason: blockers.map((b) => b.reason).join(" ") }
        : {}),
    };

    const { rows: last } = await client.query<{ d: string }>(
      `select to_char(max(business_date), 'DD Mon YYYY') as d
         from night_audit_runs
        where hotel_id = $1 and status = 'completed'`,
      [hotelId],
    );
    const lastRun = last[0]?.d ?? null;

    const n = (v: string) => Number(v);

    return {
      businessDate: asOn,
      nextBusinessDate: next.toISOString().slice(0, 10),
      checks: [
        {
          id: "arrivals",
          label: "Arrivals still outstanding",
          detail: "An arrival left unchecked at roll-over becomes a no-show, and the retention posts against it.",
          state: n(r.outstanding) ? "attention" : "ok",
          count: n(r.outstanding),
          link: `/h/${c.req.param("code")}/arrivals`,
        },
        {
          id: "departures",
          label: "Departures not yet checked out",
          detail: "A room still showing due out holds its inventory into tomorrow.",
          state: n(r.due_out) ? "attention" : "ok",
          count: n(r.due_out),
          link: `/h/${c.req.param("code")}/in-house/due-out`,
        },
        {
          id: "balances",
          label: "In-house folios carrying a balance",
          detail: "These roll forward. Nothing is wrong with that — it is worth seeing before it happens.",
          state: n(r.owing) ? "attention" : "ok",
          count: n(r.owing),
          link: `/h/${c.req.param("code")}/folios`,
        },
        {
          id: "room-charges",
          label: "Room charges to post",
          detail: "One night's tariff and tax per occupied room. Day-use stays are excluded — they have already been charged.",
          state: "ok",
          count: n(r.to_post),
        },
        {
          id: "housekeeping",
          label: "Rooms still marked dirty",
          detail: "Not a blocker. A room left dirty overnight is a room the morning shift inherits.",
          state: n(r.dirty) ? "attention" : "ok",
          count: n(r.dirty),
          link: `/h/${c.req.param("code")}/housekeeping`,
        },
        {
          id: "reversals",
          label: "Postings reversed today",
          detail: "Every reversal is somebody correcting something. Worth reading before the day closes.",
          state: n(r.reversals) ? "attention" : "ok",
          count: n(r.reversals),
          link: `/h/${c.req.param("code")}/admin/audit-log`,
        },
      ],
      /* Was hard-coded `allowed: false` with the reason "the business
         date is fixed in this stage, so the roll-over has nowhere to
         go". That condition was written down when the limitation was
         added, and CP11 met it — the date now comes from
         night_audit_runs. Both now come from the audit itself, so the
         button and the server cannot disagree about whether a day can
         close. */
      canRun,
      lastRun,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});


/* ── Notifications ───────────────────────────────────────────────
   Derived, never stored — so nothing here can go stale while the
   thing it describes changes. Check a guest in and the arrival notice
   disappears, because nothing keeps it alive.

   These began as hand-written prose citing a ₹45,000 settlement and a
   ₹1,24,500 night audit, neither of which existed anywhere in the
   ledger. Anyone comparing the bell against the Manager Report would
   have found two different hotels.
   ═══════════════════════════════════════════════════════════════ */

billing.get("/:code/notifications", async (c) => {
  const asOnParam = c.req.query("asOn");
  const code = c.req.param("code");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, code);
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const asOn = asOnParam ?? bd;

    const { rows } = await client.query<{
      kind: string; id: string; label: string; detail: string; amount: string | null;
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
       ),
       balances as (
         select r.id, r.reference, r.status, r.check_out, g.full_name as guest,
                (select rm.number from room_assignments ra
                   join rooms rm on rm.id = ra.room_id
                  where ra.reservation_id = r.id and ra.released_at is null
                  limit 1) as room,
                coalesce((select sum(amount + tax_amount) from live
                           where reservation_id = r.id), 0) as balance
           from reservations r
           join guests g on g.id = r.guest_id
          where r.hotel_id = $1
       )
       select 'arrival' as kind, b.id::text, b.guest as label,
              coalesce(b.room, '—') as detail, null::text as amount
         from balances b
        where b.status = 'confirmed' and b.check_out > $2::date
          and exists (select 1 from reservations r2
                       where r2.id = b.id and r2.check_in = $2::date)
       union all
       select 'owing', b.id::text, b.guest, coalesce(b.room, '—'), b.balance::text
         from balances b
        where b.status = 'checked_in' and b.check_out = $2::date and b.balance > 0.5
       union all
       select 'refund', b.id::text, b.guest, coalesce(b.room, '—'), b.balance::text
         from balances b
        where b.balance < -0.5
       union all
       select 'blocked', rm.id::text, rm.number, '', null
         from rooms rm
        where rm.hotel_id = $1
          and exists (select 1 from room_blocks bl
                       where bl.room_id = rm.id
                         and $2::date >= bl.from_date
                         and (bl.to_date is null or $2::date <= bl.to_date))
       union all
       select 'reversal', fp.id::text, fp.description, '', null
         from folio_postings fp
        where fp.hotel_id = $1 and fp.reverses_id is not null
          and fp.business_date = $2::date`,
      [hotelId, asOn],
    );

    const at = `${asOn}T09:00:00+05:30`;
    const money = (n: number) =>
      `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

    const by = (kind: string) => rows.filter((r) => r.kind === kind);
    const out: Array<Record<string, unknown>> = [];

    const arrivals = by("arrival");
    if (arrivals.length) {
      out.push({
        id: "arrivals-outstanding", hotelId: code, category: "reservation",
        title: `${arrivals.length} arrival${arrivals.length === 1 ? "" : "s"} not yet checked in`,
        body: arrivals.slice(0, 3).map((a) => `${a.label} · room ${a.detail}`).join(", ")
          + (arrivals.length > 3 ? ` and ${arrivals.length - 3} more` : ""),
        isRead: false, at, link: `/h/${code}/arrivals`, actionRequired: true,
      });
    }

    for (const o of by("owing")) {
      out.push({
        id: `balance-${o.id}`, hotelId: code, category: "payment",
        title: `${money(Number(o.amount))} outstanding on room ${o.detail}`,
        body: `${o.label} is due out today. Settle the folio before the room releases.`,
        isRead: false, at, link: `/h/${code}/folios`, actionRequired: true,
      });
    }

    for (const r of by("refund")) {
      out.push({
        id: `refund-${r.id}`, hotelId: code, category: "payment",
        title: `${money(Number(r.amount))} to refund — ${r.label}`,
        body: `Room ${r.detail} is paid beyond its charges. The hotel is holding money that is not its own.`,
        isRead: false, at, link: `/h/${code}/folios`, actionRequired: true,
      });
    }

    const blocked = by("blocked");
    if (blocked.length) {
      out.push({
        id: "rooms-out-of-service", hotelId: code, category: "system",
        title: `${blocked.length} room${blocked.length === 1 ? "" : "s"} out of service`,
        body: `Room ${blocked.map((b) => b.label).join(", ")}. Occupancy divides by the sellable house, not the physical one.`,
        isRead: false, at, link: `/h/${code}/housekeeping`, actionRequired: false,
      });
    }

    const reversals = by("reversal");
    if (reversals.length) {
      out.push({
        id: "reversals-today", hotelId: code, category: "approval",
        title: `${reversals.length} posting${reversals.length === 1 ? "" : "s"} reversed today`,
        body: "The ledger is append-only, so each reversal is its own line. Worth a look before the night audit.",
        isRead: false, at, link: `/h/${code}/admin/audit-log`, actionRequired: false,
      });
    }

    return out;
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
