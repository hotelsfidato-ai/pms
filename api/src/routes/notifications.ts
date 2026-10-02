import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";
import { businessDateFor } from "../businessDate.ts";
import { can, type Role } from "../permissions.ts";
import { teamsFor } from "../modules/guest-services/index.ts";
import { allows, WRITE_RULES } from "../roleGate.ts";

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

  const body = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, code);
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const asOn = asOnParam ?? bd;

    /* THE BELL FOLLOWS THE READ RULES (D27-153): a guest's name only for a
       role holding `customer`, a balance only for one holding `invoice`.
       Everybody else still gets the alert, without those details. */
    const role: Role | null = session.isGroupAdmin ? "owner"
      : ((await client.query<{ role: Role }>(
          "select role from staff_hotels where staff_id = $1 and hotel_id = $2",
          [session.staffId, hotelId])).rows[0]?.role ?? null);
    const names = role !== null && can(role, "view", "customer");
    const sums = role !== null && can(role, "view", "invoice");

    const { rows } = await client.query<{
      kind: string; id: string; label: string; detail: string; amount: string | null;
    }>(
      `with live as (
         /* The bill a line is ON (the owner's D27-226): a guest owes their own
            bills, not the nights their group's master carries for them. */
         select fp.*, f.reservation_id as bill_stay
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
                coalesce((select sum(amount + tax_amount) from live
                           where bill_stay = r.id), 0) as balance
           from reservations r
           join guests g on g.id = r.guest_id
          where r.hotel_id = $1
       )
       /* app.stay_room (086), not the HELD assignment: a refund is owed to
          somebody who has LEFT, and their room was released at check-out.
          Called here, on the few rows returned, not inside balances for
          every booking ever (D27-165, speed check S-1: 1.1 s to 0.1 s). */
       select 'arrival' as kind, b.id::text, b.guest as label,
              coalesce(app.stay_room(b.id), '-') as detail, null::text as amount
         from balances b
        where b.status = 'confirmed' and b.check_out > $2::date
          and exists (select 1 from reservations r2
                       where r2.id = b.id and r2.check_in = $2::date)
       union all
       select 'owing', b.id::text, b.guest, coalesce(app.stay_room(b.id), '-'), b.balance::text
         from balances b
        where b.status = 'checked_in' and b.check_out = $2::date and b.balance > 0.5
       union all
       select 'refund', b.id::text, b.guest, coalesce(app.stay_room(b.id), '-'), b.balance::text
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
        body: arrivals.slice(0, 3).map((a) => (names ? `${a.label} · room ${a.detail}` : `room ${a.detail}`)).join(", ")
          + (arrivals.length > 3 ? ` and ${arrivals.length - 3} more` : ""),
        isRead: false, at, link: `/h/${code}/arrivals`, actionRequired: true,
      });
    }

    for (const o of by("owing")) {
      out.push({
        id: `balance-${o.id}`, hotelId: code, category: "payment",
        title: sums ? `${money(Number(o.amount))} outstanding on room ${o.detail}` : `A balance is outstanding on room ${o.detail}`,
        body: `${names ? o.label : "The guest"} is due out today. Settle the folio before the room releases.`,
        isRead: false, at, link: `/h/${code}/folios`, actionRequired: true,
      });
    }

    for (const r of by("refund")) {
      out.push({
        id: `refund-${r.id}`, hotelId: code, category: "payment",
        title: `${sums ? `${money(Number(r.amount))} to refund` : "Money to refund"} - ${names ? r.label : `room ${r.detail}`}`,
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

    /* A guest's message to the desk (QA GP-5): it waited in Guest messages
       and nothing told the desk. Only for the roles that read guests'
       messages (D27-144). */
    if (names) {
      const { rows: [waiting] } = await client.query<{ n: number }>(
        `select count(*)::int as n from guest_requests
          where hotel_id = $1 and kind = 'desk' and status = 'open'`, [hotelId]);
      if (waiting!.n) {
        out.push({
          id: "guest-messages-waiting", hotelId: code, category: "customer",
          title: `${waiting!.n} guest message${waiting!.n === 1 ? "" : "s"} waiting`,
          body: "Written to the front desk from the guest's own page. Read it and mark it handled.",
          isRead: false, at, link: `/h/${code}/guest-messages`, actionRequired: true,
        });
      }
    }

    /* An in-stay request nobody has taken yet (D27-181): for the team that
       receives it, and for the desk, which sees every one. */
    const teams = teamsFor(role);
    if (teams.length) {
      const { rows: [open] } = await client.query<{ n: number }>(
        `select count(*)::int as n from work_orders
          where hotel_id = $1 and reservation_id is not null and status = 'open'
            and (case when category in ('housekeeping', 'fnb') then category
                      else 'maintenance' end) = any($2::text[])`, [hotelId, teams]);
      if (open!.n) {
        out.push({
          id: "guest-requests-waiting", hotelId: code, category: "customer",
          title: `${open!.n} guest request${open!.n === 1 ? "" : "s"} waiting`,
          body: `Nobody has taken ${open!.n === 1 ? "it" : "them"} yet. Take one on Guest requests and mark it done.`,
          isRead: false, at, link: `/h/${code}/requests`, actionRequired: true,
        });
      }
    }

    /* A guest's room-service order from their own page (D27-224): for
       whoever may ring the till, who accepts or declines it on the Terminal. */
    if (role && allows(WRITE_RULES["POST /api/hotels/:code/till/orders/batch"]!, role)) {
      const { rows: [food] } = await client.query<{ n: number }>(
        `select count(*)::int as n from guest_food_orders
          where hotel_id = $1 and status = 'waiting'`, [hotelId]);
      if (food!.n) {
        out.push({
          id: "guest-food-orders-waiting", hotelId: code, category: "customer",
          title: `${food!.n} room-service order${food!.n === 1 ? "" : "s"} waiting`,
          body: "From a guest's own page. Accept and send it, or decline it with a reason, on the Terminal.",
          isRead: false, at, link: `/h/${code}/till/terminal`, actionRequired: true,
        });
      }
    }

    /* THE MONTHLY CROCKERY COUNT (D27-242 Q11): for whoever may correct a
       count, each place holding crockery or cutlery that has not been counted
       for 30 business days or more - or ever. */
    if (role !== null && can(role, "edit", "stock")) {
      const { rows: due } = await client.query<{ place: string; last: string | null }>(
        `select l.name as place,
                (select to_char(max(c.business_date), 'FMDD Mon')
                   from stock_count_lines c join stock_items ci on ci.id = c.item_id
                  where c.location_id = l.id and ci.crockery) as last
           from locations l
          where l.hotel_id = $1 and l.is_active
            and exists (select 1 from stock_items i
                         where i.hotel_id = l.hotel_id and i.crockery
                           and app.stock_on_hand(i.id, l.id) > 0)
            and not exists (select 1 from stock_count_lines c join stock_items ci on ci.id = c.item_id
                             where c.location_id = l.id and ci.crockery
                               and c.business_date > $2::date - 30)
          order by l.name`, [hotelId, bd]);
      for (const d of due) {
        out.push({
          id: `crockery-count-${d.place}`, hotelId: code, category: "approval",
          title: `Crockery in ${d.place}: ${d.last ? `last counted ${d.last}` : "never counted"}`,
          body: "Crockery and cutlery is counted every month. On the Store, Count a store, then choose "
            + `${d.place}.`,
          isRead: false, at, link: `/h/${code}/stores`, actionRequired: true,
        });
      }
    }

    const reversals = by("reversal");
    if (reversals.length) {
      out.push({
        id: "reversals-today", hotelId: code, category: "approval",
        title: `${reversals.length} posting${reversals.length === 1 ? "" : "s"} reversed today`,
        body: "The ledger is append-only, so each reversal is its own line. Worth a look before the night audit.",
        isRead: false, at, link: "/admin/audit-log", actionRequired: false,   // ADM-4
      });
    }

    /* TABLES A GUEST ASKED FOR, WAITING FOR AN ANSWER (D27-221, D27-224): for
       the people who answer them - whoever may ring an order (roleGate
       TABLE_ANSWER) - at this hotel, among those who read the bell (a waiter
       has none and answers on the Table bookings screen). */
    if (role !== null && (can(role, "create", "payment") || role === "pos")) {
      const { rows: [tables] } = await client.query<{ n: number }>(
        "select count(*)::int as n from table_bookings where hotel_id = $1 and status = 'requested'",
        [hotelId]);
      if (tables!.n) {
        out.push({
          id: "table-bookings-waiting", hotelId: code, category: "reservation",
          title: `${tables!.n} table booking${tables!.n === 1 ? "" : "s"} waiting`,
          body: "Hotel guests asked for a table from their own page. Confirm each one, or decline it with a reason.",
          isRead: false, at, link: `/h/${code}/table-bookings`, actionRequired: true,
        });
      }
    }

    /* A HOTEL'S BANK DETAILS WERE SET, CHANGED OR REMOVED (the owner's
       D27-216): they print on every booking voucher, so the group owner is
       told - which hotel, who, when; never the account. For group
       administrators only, and for EVERY hotel whichever one is open: it is
       there to catch a change at a hotel the owner is not looking at. Read
       from the change record the table's own trigger keeps (migration 169),
       so a write through any door shows; the newest change at a hotel, for
       seven days. */
    if (session.isGroupAdmin) {
      const { rows: changed } = await client.query<{
        id: string; action: string; at: Date; code: string; name: string; who: string | null;
      }>(
        `select distinct on (a.hotel_id) a.id::text, a.action, a.at, h.code, h.name, s.full_name as who
           from audit_log a
           join hotels h on h.id = a.hotel_id
           left join staff s on s.id = a.actor
          where a.table_name = 'hotel_bank_details' and a.at > now() - interval '7 days'
          order by a.hotel_id, a.at desc`);
      const DID: Record<string, string> = { INSERT: "set", UPDATE: "changed", DELETE: "removed" };
      for (const b of changed) {
        out.push({
          id: `bank-details-${b.id}`, hotelId: code, category: "system",
          title: `${b.name}: bank details ${DID[b.action] ?? "changed"}`,
          body: `By ${b.who ?? "somebody"}. They print on this hotel's booking vouchers. `
            + "Open Settings to see them, and ask if you did not expect this.",
          isRead: false, at: b.at.toISOString(),
          link: `/h/${b.code}/settings/taxes-and-billing`, actionRequired: true,
        });
      }
    }

    return out;
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
