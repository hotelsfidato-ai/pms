import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";
import { businessDateFor } from "../businessDate.ts";

/* Split out of billing.ts on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md). The core's: the bell reads arrivals,
   balances, refunds, blocked rooms and reversals, which belong to several
   services, and is owned by none. The endpoint is unchanged; `hotelIdFor`
   is a copy of billing's. */

export const notifications = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}


/* ── Notifications ───────────────────────────────────────────────
   Derived, never stored — so nothing here can go stale while the
   thing it describes changes. Check a guest in and the arrival notice
   disappears, because nothing keeps it alive.

   These began as hand-written prose citing a ₹45,000 settlement and a
   ₹1,24,500 night audit, neither of which existed anywhere in the
   ledger. Anyone comparing the bell against the Manager Report would
   have found two different hotels.
   ═══════════════════════════════════════════════════════════════ */

notifications.get("/:code/notifications", async (c) => {
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
                /* app.stay_room (086), not the HELD assignment: a refund
                   is owed to somebody who has LEFT, and their room was
                   released at check-out — this printed "—" for them. */
                app.stay_room(r.id) as room,
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
