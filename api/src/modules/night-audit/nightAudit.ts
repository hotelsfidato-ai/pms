import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { POSTING_NIGHTS } from "../reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE NIGHT AUDIT — closing a day

   Everything else in this system reads a business date. This is the
   only thing that MOVES one, and until now no property had ever
   closed a day: `app.business_date()` returned each hotel's configured
   date because `night_audit_runs` was empty.

   WHAT IT DOES, IN ORDER, IN ONE TRANSACTION

     0. waits for any other audit at this property to finish (NA-3);
        then, before anything is written, answers a day already closed
        with the record that was made (NA-2, D17-12), and refuses a day
        the property is not on
     1. refuses if a human decision is outstanding
     2. opens a run row, status 'running'
     3. posts one night's room charge for every in-house stay
     4. marks the arrivals that never came as no-shows
     5. marks the run 'completed' — which is what advances the date

   WHY THE ORDER MATTERS

   Step 5 is not bookkeeping. `app.business_date()` is
   `max(completed run date) + 1`, so the day advances at the moment
   that status flips, and not before. And 012_integrity.sql puts a
   trigger on folio_postings that rejects any posting onto a date with
   a COMPLETED run — so the audit's own charges have to land while the
   run is still 'running'. Flip the status first and the audit would
   refuse its own work.

   IDEMPOTENCE, TWICE OVER

   A unique index on (hotel_id, business_date) stops a second run.
   Inside a run, each stay is skipped if a room charge already exists
   for that folio on that date — so an audit interrupted halfway and
   restarted does not charge anyone twice.

   WHAT IT WILL NOT DO

   It will not check anybody out. A guest still showing due-out at
   roll-over is a question for a person: did they leave and nobody
   pressed the button, or are they staying another night? Those have
   opposite consequences for the room and the bill, and a system that
   guesses is a system that silently overcharges someone. The audit
   refuses and says which rooms.
   ══════════════════════════════════════════════════════════════════ */

export const nightAudit = new Hono<{ Variables: { subject: string } }>();

interface Blocker {
  id: string;
  reason: string;
  rooms: string[];
}

/** Rule 6 — a refusal always names itself and what to do about it. */
const refuse = (reason: string, extra: Record<string, unknown> = {}) => ({
  ok: false as const, reason, ...extra,
});

/** A real calendar day written YYYY-MM-DD — "2026-02-31" is not one. */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

async function hotelIdFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── What must be settled by a person before a day can close ─────── */

export async function blockersFor(
  client: Client, hotelId: string, businessDate: string,
): Promise<Blocker[]> {
  const blockers: Blocker[] = [];

  /* Departures that never checked out.

     The only genuinely blocking condition. Everything else the audit
     either handles itself or merely reports:

       · outstanding arrivals    it marks them no-show — that IS the
                                 audit's job, not a reason to stop
       · in-house balances       normal; they roll forward
       · dirty rooms             housekeeping's tomorrow, not tonight's
       · reversals today         evidence of a correction, not a fault

     A due-out guest who has not checked out is different because the
     two possible truths — they left, or they are staying — lead to
     opposite postings, and nobody but a person at the desk knows
     which. */
  const { rows } = await client.query<{ number: string; guest: string }>(
    `select coalesce(rm.number, '-') as number, g.full_name as guest
       from reservations r
       join guests g on g.id = r.guest_id
       left join room_assignments ra on ra.reservation_id = r.id
                                    and ra.released_at is null
       left join rooms rm on rm.id = ra.room_id
      where r.hotel_id = $1
        and r.status = 'checked_in'
        and r.check_out = $2::date
      order by rm.number`,
    [hotelId, businessDate],
  );

  if (rows.length > 0) {
    blockers.push({
      id: "departures",
      reason:
        `${rows.length} ${rows.length === 1 ? "room is" : "rooms are"} still ` +
        `showing due out. Check them out, or extend the stay - the audit ` +
        `will not decide which.`,
      rooms: rows.map((r) => `${r.number} · ${r.guest}`),
    });
  }

  /* ── Is there a rate to charge tax at? ─────────────────────────────
     The audit posts a room charge for every occupied room, and every
     one of those needs a GST rate. Until 067 that rate came from
     `hotels.cgst_rate + sgst_rate` read once, with `?? 0` behind it —
     so a property with no tax configured did not fail, it posted a
     whole night's revenue at nought percent and reported success.

     Asked HERE rather than discovered halfway through the run: an
     audit that stops after charging nine rooms of eighteen leaves a
     day that is neither open nor closed, and Rule 6 says a blocked
     action is shown with its reason before it is attempted. */
  const { rows: taxed } = await client.query<{ n: string }>(
    `select count(*)::text as n from tax_rules
      where hotel_id = $1 and kind = 'room'`,
    [hotelId],
  );
  if (taxed[0]!.n === "0") {
    blockers.push({
      id: "no-tax-rule",
      reason:
        "This property has no GST rule for rooms, so a room charge has no " +
        "rate to carry. Set it in the GST card, under Rooms and rates → Room types or Finance → Invoices. A missing rate is not " +
        "zero - the audit will not invent one.",
      rooms: [],
    });
  }

  /* ── Two drawers, and both have to be counted ────────────────
     A hotel has cash in two places and they are not the same drawer.
     The front desk takes deposits and settles folios; the till takes
     money for food. They are counted by different people, at different
     times, and a variance in one says nothing about the other — which
     is exactly why they must not be added together anywhere.

     The audit closes the DAY, and a day whose cash has not been counted
     is not closed, it is abandoned. Both are blockers for the same
     reason a due-out guest is: only a person knows the answer, and the
     two possible truths lead to opposite postings.

     Named separately, because "the cash is not counted" sends somebody
     to the wrong drawer half the time. */
  const { rows: openShifts } = await client.query<{
    who: string; opened: string;
  }>(
    `select coalesce(s.full_name, 'somebody') as who,
            to_char(cs.opened_at, 'HH24:MI') as opened
       from cashier_shifts cs
       left join staff s on s.id = cs.staff_id
      where cs.hotel_id = $1
        and cs.business_date <= $2::date
        and cs.closed_at is null
      order by cs.opened_at`,
    [hotelId, businessDate],
  );

  if (openShifts.length > 0) {
    blockers.push({
      id: "front-desk-drawer",
      reason:
        `${openShifts.length === 1 ? "A front-desk drawer is" : `${openShifts.length} front-desk drawers are`}`
        + " still open. Count the cash and close the shift - the audit"
        + " cannot say what was taken at the desk until somebody has.",
      rooms: openShifts.map((x) => `${x.who} · opened ${x.opened}`),
    });
  }

  /* The till's day, per outlet. An outlet with no orders at all today
     never opened, and closing a day nobody worked is a formality worth
     skipping — so only outlets that actually sold something count. */
  const { rows: openTills } = await client.query<{
    outlet: string; orders: string;
  }>(
    `select o.name as outlet, count(po.id)::text as orders
       from pos_outlets o
       join pos_orders po on po.outlet_id = o.id
                         and po.business_date = $2::date
       where o.hotel_id = $1 and o.is_active
         and not exists (
           select 1 from pos_day_ends d
            where d.outlet_id = o.id and d.business_date = $2::date
              and d.closed_at is not null)
       group by o.name
       order by o.name`,
    [hotelId, businessDate],
  );

  if (openTills.length > 0) {
    blockers.push({
      id: "till-drawer",
      reason:
        "The till has not been closed for today. Run the day end on it"
        + " first - the restaurant's takings belong in this audit, and"
        + " they are not final until the drawer is counted.",
      rooms: openTills.map((x) => `${x.outlet} · ${x.orders} orders today`),
    });
  }

  return blockers;
}

/* ── Can this day be closed? ─────────────────────────────────────
   GET /:code/night-audit/can-run was here until 17 September. No screen ever
   called it (NA-1); the owner's D17-42 removed it. Whether a day may close is
   answered once, by blockersFor, and served in the Night audit checklist
   (checklist.ts, `canRun.blockers`), which POST /run also obeys. */

/* ── Close the day ───────────────────────────────────────────────── */

nightAudit.post("/:code/night-audit/run", async (c) => {
  /* ── The day the screen says it is closing ─────────────────────────
     NA-2. The browser learns the business date at sign-in, so a screen
     left open while the day closed somewhere else — another device,
     another tab, a first press whose answer was lost on a bad line —
     still says "closing D". This route closes the day the SERVER is on,
     so that screen's Run used to close D+1: tomorrow night's room
     charges, tomorrow's arrivals marked no-show and their rooms
     released. Proved on 16 September.

     The owner's decision, the same day: the button sends the day it
     shows, and a day that is already closed is refused, changing
     nothing. And on 17 September (D17-12): a second press — at the
     same moment or later — changes nothing and SHOWS THE RECORD THAT
     WAS MADE. So the day is required: a caller that names none would
     be answered with whatever day the server is on, which a moment
     after somebody else closed it is tomorrow.

     Every refusal below comes before the first write — inside
     withSession a refusal is a commit (MEMORY 243). */
  const body = (await c.req.json().catch(() => ({}))) as { businessDate?: unknown };
  const closing = body.businessDate;
  if (closing === undefined) {
    return c.json({
      error: "Say which day is being closed: businessDate, YYYY-MM-DD.",
    }, 400);
  }
  if (!isIsoDate(closing)) {
    return c.json({ error: "businessDate must be a date, YYYY-MM-DD." }, 400);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* ── One audit at a time per property (NA-3, D17-12) ──────────────
       Two presses at the same moment could not see each other's
       uncommitted run row, so both passed every check below; the second
       waited on the unique index and, when the first committed, took the
       COMPLETED row back to 'running', found nothing left to post, and
       completed it again with zeros. 006 described this lock and nothing
       took it. Held to the end of the transaction, so the second press
       waits for the first to finish and then meets the check below. */
    await client.query(
      "select pg_advisory_xact_lock(hashtext('night_audit:' || $1::text))",
      [hotelId],
    );

    /* ── Already closed: change nothing, show what was done ─────────── */
    const made = await closedDays(client, hotelId, { day: closing });
    if (made[0]) {
      return refuse(
        `${dayMonth(closing)} was already closed. Reload to see today.`,
        { businessDate: closing, alreadyClosed: true, record: made[0] },
      ) as unknown as Record<string, unknown>;
    }

    const businessDate = await businessDateFor(client, hotelId);

    /* ── Not the day this property is on ─────────────────────────────
       Closing a day other than the one the screen names is the fault
       NA-2 was, from the other side. A screen cannot be AHEAD of the
       server in normal use; refused all the same, changing nothing. */
    if (closing !== businessDate) {
      return refuse(
        `This property is on ${dayMonth(businessDate)}, not `
          + `${dayMonth(closing)}. Reload to see today.`,
        { businessDate: closing },
      ) as unknown as Record<string, unknown>;
    }

    const blockers = await blockersFor(client, hotelId, businessDate);
    if (blockers.length > 0) {
      return refuse(blockers.map((b) => b.reason).join(" "), {
        businessDate, blockers,
      }) as unknown as Record<string, unknown>;
    }

    /* ── Open the run ────────────────────────────────────────────────
       'running', not 'completed'. The trigger in 012_integrity.sql
       rejects postings onto a CLOSED date, so the charges below must
       land before the status flips. It also means a crash here leaves
       a 'running' row that never advanced the date — which is the
       correct failure: the day stays open. */
    const { rows: run } = await client.query<{ id: string }>(
      /* `run_by` has been a column since 006 and nothing wrote it, so
         no closed day could say who closed it (D17-13). */
      `insert into night_audit_runs (hotel_id, business_date, status, run_by)
       values ($1, $2::date, 'running', app.current_user_id())
       on conflict (hotel_id, business_date)
         do update set status = 'running', started_at = now(),
                       error_message = null, run_by = app.current_user_id()
       returning id::text`,
      [hotelId, businessDate],
    );
    const runId = run[0]!.id;

    /* ── Tax is no longer a number this function holds ──────────────
       It used to be: one rate for the whole run, read from the
       property, with `?? 0` as its fallback. Two things were wrong
       with that. A property with no rate configured posted the night
       at zero percent rather than refusing — the blocker above now
       catches that. And a single rate cannot express a slab: rooms at
       or under ₹7,500 are 5% and above it 18%, so a house with a suite
       and a standard room needs two different answers on the same
       night.

       `app.gst_rate()` is asked per posting, inside the statement that
       writes it, so the amount and the rate cannot drift apart. */

    /* ── One night's room charge, per in-house stay ────────────────── */
    const { rows: stays } = await client.query<{
      reservation_id: string; folio_id: string; room: string;
      rate: string; comp: boolean; routed: boolean;
    }>(
      `select r.id::text as reservation_id,
              /* WHERE THE CHARGE GOES, in one definition. A stay routed to
                 its group posts to the master folio; everything else posts
                 to its own. */
              app.folio_for_room_charge(r.id)::text as folio_id,
              coalesce(a.number, '-') as room,
              r.agreed_rate::text as rate,
              r.is_complimentary as comp,
              (r.route_room_to_group and r.group_id is not null) as routed
         from reservations r
         join folios f on f.reservation_id = r.id and f.status = 'open'
         /* THE ROOM THIS STAY IS IN **TONIGHT**, and exactly one of them.

            ⚠ THIS WAS A PLAIN LEFT JOIN ON "released_at is null", WITH NO
            DATE, AND IT POSTED THE NIGHT TWICE.

            A room move does not release anything. It is modelled as two
            live assignments over adjoining half-open ranges - 302 for
            [5 Sep, 6 Sep), then 303 for [6 Sep, 10 Sep) - because both
            are true, on different nights. "released_at is null" is true
            of both, so one stay came back as TWO rows, the "not exists"
            guard below was evaluated once per row before either insert,
            and the loop inserted a room charge for each.

            One guest, one night, charged twice, every night for the rest
            of the stay. It was invisible here only because the one moved
            stay at Akkalkot happens to be complimentary, so the loop
            skips before posting and the miscount surfaced as
            "complimentary: 2" for a property with one complimentary
            room. Make that guest a paying one and it is money.

            The predicate is the half-open range this schema uses
            everywhere: "from <= D < to". LATERAL with "limit 1" on top,
            because a query that posts money must not depend on the data
            never producing an overlap - belt and braces are cheap here
            and a double charge on a guest's bill is not. */
         left join lateral (
           select rm.number
             from room_assignments ra
             join rooms rm on rm.id = ra.room_id
            where ra.reservation_id = r.id
              and ra.released_at is null
              and ra.from_date <= $2::date
              and (ra.to_date is null or ra.to_date > $2::date)
            order by ra.from_date desc
            limit 1
         ) a on true
        where r.hotel_id = $1
          and r.status = 'checked_in'
          -- A day-use room is sold and vacated inside one day. It has
          -- no night to charge for.
          and not r.is_day_use
          /* Not already charged for tonight. This is what makes an
             interrupted audit safe to restart: the charge is the thing
             that must not happen twice, so the check is on the charge,
             not on the run.

             PER STAY, NOT PER FOLIO. It used to ask whether the folio
             held a room charge for tonight, which is identical while
             every stay has its own folio - and silently wrong the moment
             a group routes twelve rooms to one master: charge the first,
             skip the other eleven, every night, and the run's summary
             reports what it posted so nothing looks amiss.

             AND NOT ONLY A LINE DATED TONIGHT (D24-14). A walk-in posts
             its whole stay on arrival, "Room 201 · 2 nights" (D17-33), and
             this asked only for a line dated tonight - so every night
             after the first was charged twice. A line counts for every
             night it pays for, read the way the reports read it. */
          and not exists (
            select 1 from folio_postings fp
             where fp.reservation_id = r.id
               and fp.category = 'room'
               and fp.business_date <= $2::date
               and fp.business_date + ${POSTING_NIGHTS} > $2::date
          )
        order by a.number`,
      [hotelId, businessDate],
    );

    let roomsPosted = 0;
    let revenuePosted = 0;
    let complimentary = 0;

    for (const stay of stays) {
      if (stay.comp) {
        /* A complimentary room is SOLD and earns nothing. No posting
           at all — which is what the loaded demo does, and why 132
           room-nights divide into ₹4,19,578.76 rather than into a
           figure inflated by a zero-value line. Counted so the run
           can explain why rooms posted is smaller than rooms
           occupied. */
        complimentary += 1;
        continue;
      }

      const amount = Number(stay.rate);

      await client.query(
        /* The rate and the tax it produces are BOTH derived here, from
           this room's own charge. Computing the rate in TypeScript and
           the amount in SQL is how the two stop agreeing. */
        `insert into folio_postings
           (hotel_id, folio_id, reservation_id, business_date, category,
            description, amount, tax_rate, tax_amount, source_type, posted_by)
         select $1::uuid, $2::uuid, $3::uuid, $4::date, 'room',
                $5::text, $6::numeric,
                t.rate, round($6::numeric * t.rate / 100.0, 2),
                'night_audit', app.current_user_id()
           from (select app.gst_rate($1, 'room', $6::numeric) as rate) t`,
        [hotelId, stay.folio_id, stay.reservation_id, businessDate,
         /* The room number is on every line, and it has to be: a master
            folio holding twelve of these is unreadable otherwise. */
         `Room ${stay.room} · 1 night`,
         amount],
      );

      roomsPosted += 1;
      revenuePosted += amount;
    }

    /* ── Arrivals that never came ─────────────────────────────────────
       A confirmed reservation whose arrival date has now passed did
       not happen. Marking it no-show is the audit's job — leaving it
       'confirmed' would carry it into tomorrow's arrivals list, where
       a clerk would look for a guest who is a day gone.

       Retention comes from the terms FROZEN ON THE BOOKING (036), and
       only from there. A booking made before the property wrote its
       terms down carries none, `app.retention_for` returns null for
       it, and the audit charges nothing — which is what it did for
       every booking until now. Null is not zero: zero is a decision
       that nothing is owed, null is the absence of any agreement, and
       they are counted separately below so the run can say which. */
    const { rows: missed } = await client.query<{
      id: string; folio_id: string | null; retention: string | null;
      agreed_rate: string | null;
    }>(
      `update reservations r
          set status = 'no_show'
        where r.hotel_id = $1
          and r.status = 'confirmed'
          and r.check_in <= $2::date
      returning r.id::text,
                (select f.id::text from folios f
                  where f.reservation_id = r.id
                  order by f.opened_at limit 1) as folio_id,
                app.retention_for(r.id, 'no_show')::text as retention,
                /* The room's OWN nightly rate, not the retention. See
                   the posting below: the slab is decided by what the
                   accommodation was worth, not by what is being kept
                   of it. */
                r.agreed_rate::text as agreed_rate`,
      [hotelId, businessDate],
    );
    const noShows = missed.length;

    /* A retention is a CHARGE on the guest's folio, posted like any
       other. Not a separate ledger and not a note: the guest owes it,
       and the city ledger and the GST register both have to see it. */
    let retained = 0;
    let untermed = 0;
    for (const m of missed) {
      const amount = m.retention === null ? null : Number(m.retention);
      if (amount === null) { untermed += 1; continue; }
      if (amount <= 0 || !m.folio_id) continue;

      /* Category `misc`, deliberately NOT `room`. No room was
         occupied, and posting this as room revenue would put it in
         ADR and occupancy — inflating the rate the hotel thinks it
         achieved on a night nobody slept there.

         Taxed at the same rate as the accommodation would have been.
         That is the treatment CBIC set out in circular 178/10/2022:
         a cancellation charge is ancillary to the principal supply
         and carries its rate. Posting it at zero would be a tax
         determination too — that it is exempt — and a wrong one.

         No idempotency key: the update above matches `status =
         'confirmed'` and has already moved these rows to `no_show`,
         so a second run of the audit selects none of them. */
      /* THE SLAB IS DECIDED BY THE ROOM, NOT BY THE RETENTION.
         A ₹9,000 suite held on a 25% term retains ₹2,250. Asking the
         rule about ₹2,250 answers 5%; asking it about the ₹9,000 the
         charge is ancillary TO answers 18%, which is the rate the
         accommodation would have carried and therefore the rate this
         carries. Circular 178/10/2022 again: ancillary to the
         principal supply, at the principal supply's rate. */
      await client.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, source_type, posted_by)
         select $1::uuid, $2::uuid, $3::date, 'misc', $4::text, $5::numeric,
                t.rate, round($5::numeric * t.rate / 100.0, 2),
                'night_audit', app.current_user_id()
           from (select app.gst_rate($1, 'room', $6::numeric) as rate) t`,
        [hotelId, m.folio_id, businessDate,
         "Retention - no-show", amount, Number(m.agreed_rate ?? 0)],
      );
      retained += amount;
    }

    /* ── Close it. THIS is what moves the date. ───────────────────── */
    await client.query(
      `update night_audit_runs
          set status = 'completed', completed_at = now(),
              rooms_posted = $2, revenue_posted = $3, no_shows = $4
        where id = $1`,
      [runId, roomsPosted, revenuePosted, noShows],
    );

    /* ── What the day actually took, from both drawers ──────────
       The audit used to report rooms and no-shows and stop there, which
       described a hotel with no restaurant in it. The owner asked for
       the day's sales to be IN the audit, and they are the reason the
       two drawers above have to be counted before it runs.

       READ, NEVER RE-POSTED. Every figure below is summed from rows the
       till and the desk already wrote. The audit does not create a
       single one of them — a second copy of the restaurant's takings on
       the folio ledger would double the day, and the money is already
       there. This is a statement of the day, not an entry in it.

       Reported side by side and never added together: a variance at the
       desk and a variance at the till are different people's counts and
       different conversations. */
    const { rows: pos } = await client.query<{
      orders: string; net: string; tax: string; gross: string;
      covers: string;
    }>(
      `select count(*)::text                                as orders,
              coalesce(sum(t.net), 0)::text                 as net,
              coalesce(sum(t.tax), 0)::text                 as tax,
              coalesce(sum(t.net + t.tax), 0)::text         as gross,
              coalesce(sum(o.covers), 0)::text              as covers
         from pos_orders o
         cross join lateral (
           select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) as net,
                  coalesce(sum(round(l.qty * l.unit_price
                                     * l.tax_rate / 100.0, 2)), 0) as tax
             from pos_order_lines l
            where l.order_id = o.id and not l.voided
         ) t
        where o.hotel_id = $1
          and o.business_date = $2::date
          and o.status = 'settled'`,
      [hotelId, businessDate],
    );

    /* By tender, because "what did we take" and "what is in the drawer"
       are different questions and only the cash line answers the second. */
    const { rows: tenders } = await client.query<{
      method: string; amount: string;
    }>(
      `select t.method, sum(t.amount)::text as amount
         from pos_order_tenders t
         join pos_orders o on o.id = t.order_id
        where t.hotel_id = $1 and o.business_date = $2::date
        group by t.method
        order by t.method`,
      [hotelId, businessDate],
    );

    const { rows: deskDrawer } = await client.query<{
      shifts: string; opening: string; counted: string; variances: string;
    }>(
      `select count(*)::text                                   as shifts,
              coalesce(sum(opening_cash), 0)::text             as opening,
              coalesce(sum(counted_cash), 0)::text             as counted,
              count(*) filter (where variance_reason is not null)::text
                                                               as variances
         from cashier_shifts
        where hotel_id = $1 and business_date = $2::date
          and closed_at is not null`,
      [hotelId, businessDate],
    );

    const { rows: tillDrawer } = await client.query<{
      outlets: string; opening: string; counted: string; variances: string;
    }>(
      `select count(*)::text                                   as outlets,
              coalesce(sum(opening_cash), 0)::text             as opening,
              coalesce(sum(counted_cash), 0)::text             as counted,
              count(*) filter (where variance_reason is not null)::text
                                                               as variances
         from pos_day_ends
        where hotel_id = $1 and business_date = $2::date
          and closed_at is not null`,
      [hotelId, businessDate],
    );

    const num = (x: string | undefined) => Math.round(Number(x ?? 0) * 100) / 100;

    const next = await businessDateFor(client, hotelId);

    return {
      ok: true,
      businessDate,
      nextBusinessDate: next,
      /* The restaurant's day, read from settled orders. */
      restaurant: {
        orders: Number(pos[0]?.orders ?? 0),
        covers: Number(pos[0]?.covers ?? 0),
        net: num(pos[0]?.net),
        tax: num(pos[0]?.tax),
        gross: num(pos[0]?.gross),
        byTender: tenders.map((t) => ({
          method: t.method, amount: num(t.amount),
        })),
      },
      /* Two drawers, side by side, never summed. */
      drawers: {
        frontDesk: {
          shifts: Number(deskDrawer[0]?.shifts ?? 0),
          opening: num(deskDrawer[0]?.opening),
          counted: num(deskDrawer[0]?.counted),
          variances: Number(deskDrawer[0]?.variances ?? 0),
        },
        till: {
          outlets: Number(tillDrawer[0]?.outlets ?? 0),
          opening: num(tillDrawer[0]?.opening),
          counted: num(tillDrawer[0]?.counted),
          variances: Number(tillDrawer[0]?.variances ?? 0),
        },
      },
      roomsPosted,
      revenuePosted: Math.round(revenuePosted * 100) / 100,
      complimentary,
      noShows,
      /* Reported apart. `retentionCharged` is money now owed;
         `noShowsWithoutTerms` is the count the property could have
         billed for and cannot, because the booking carries no terms.
         Rolling them together would hide the second entirely. */
      retentionCharged: Math.round(retained * 100) / 100,
      noShowsWithoutTerms: untermed,
    } as Record<string, unknown>;
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result["ok"] ? 200 : 409);
});

/* ── What has been closed ────────────────────────────────────────── */

/* The Night audit screen's history (D17-13, the owner, 17 September): who
   ran it, rooms posted, revenue and no-shows, newest first. Closed days
   only — a run that has not completed has closed nothing. */
nightAudit.get("/:code/night-audit/runs", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    return closedDays(client, hotelId, { limit: 60 });
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/** What one closed day's night audit did — the record a second press is
    shown (D17-12) and a line of the history (D17-13). */
export interface ClosedDay {
  businessDate: string;
  /** null where the run recorded nobody (every run before 17 September)
      or the viewer may not see the name — a dash, never a guess. */
  ranBy: string | null;
  startedAt: string;
  completedAt: string | null;
  /* null, not 0, wherever the record holds nothing: posting nothing and
     posting zero rooms are different facts, and a dash tells them apart. */
  roomsPosted: number | null;
  revenuePosted: number | null;
  noShows: number | null;
  /** How many corrections the day has had (D24-6). The record above stays
      as the audit made it. */
  corrections: number;
  /** The audit's room revenue after corrections of the room charges it
      posted: null where none was corrected, or the record holds no revenue. */
  correctedRevenue: number | null;
}

async function closedDays(
  client: Client, hotelId: string, only: { day?: string; limit?: number } = {},
): Promise<ClosedDay[]> {
  const { rows } = await client.query<{
    business_date: string; ran_by: string | null;
    started_at: Date; completed_at: Date | null;
    rooms_posted: number | null; revenue_posted: string | null;
    no_shows: number | null; corrections: number; room_change: string | null;
  }>(
    /* The name through app.colleague_name (096), never a join to `staff`:
       staff is row-secured, and most roles read only their own row, so a
       join hides the name — or, inner, the whole day (MEMORY 283). */
    `select to_char(na.business_date, 'YYYY-MM-DD') as business_date,
            app.colleague_name(na.run_by, na.hotel_id) as ran_by,
            na.started_at, na.completed_at,
            na.rooms_posted, na.revenue_posted::text as revenue_posted,
            na.no_shows,
            (select count(*)::int from closed_day_corrections c
              where c.hotel_id = na.hotel_id
                and c.business_date = na.business_date) as corrections,
            /* The record's figure is what the AUDIT posted, so only a
               correction of one of its room charges - or of a correction
               made of one - moves it. A walk-in's charge posted at check-in
               was never in it. */
            (with recursive audited(posting_id) as (
               select fp.id from folio_postings fp
                where fp.hotel_id = na.hotel_id and fp.business_date = na.business_date
                  and fp.category = 'room' and fp.source_type = 'night_audit'
               union all
               select n.id from audited a
                 join closed_day_corrections c on c.posting_id = a.posting_id
                 join folio_postings n on n.source_type = 'correction'
                                      and n.source_id = c.id and n.reverses_id is null)
             select sum(c.new_amount - c.old_amount)::text
               from closed_day_corrections c
              where c.posting_id in (select posting_id from audited)) as room_change
       from night_audit_runs na
      where na.hotel_id = $1
        and na.status = 'completed'
        and ($2::date is null or na.business_date = $2::date)
      order by na.business_date desc
      limit $3`,
    [hotelId, only.day ?? null, only.limit ?? 1],
  );

  return rows.map((r) => ({
    businessDate: r.business_date,
    ranBy: r.ran_by,
    startedAt: r.started_at.toISOString(),
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    roomsPosted: r.rooms_posted,
    revenuePosted: r.revenue_posted === null ? null : Number(r.revenue_posted),
    noShows: r.no_shows,
    corrections: r.corrections,
    correctedRevenue: r.revenue_posted === null || r.room_change === null
      ? null
      : Math.round((Number(r.revenue_posted) + Number(r.room_change)) * 100) / 100,
  }));
}

/* ── Correcting a closed day ─────────────────────────────────────────
   D22-18, the owner: "a GM screen; a reason is required, and the old and
   new figures are both kept". Their answers of 24 September
   (docs/briefs/decisions-2026-09-24.md):

     D24-1  a room charge or the audit's no-show charge, put right or taken off
     D24-2  on the closed day itself: its reports show the corrected figure
     D24-3  the owner, an administrator or the GM (roleGate; 134 in the database)
     D24-4  a bill with a tax invoice is refused: a credit note is for that
     D24-5  this month and the month before
     D24-8  a guest who has left and paid may be owed money back: allowed

   Nothing is edited. The wrong line stays; a reversal and the right charge
   sit beside it on the same day, both naming the correction row, which the
   database lets onto a closed day and nothing else (134). The reports drop a
   reversed line and its reversal (reports/figures.ts, LIVE), so that day's
   figures move by exactly the difference. */

/** What can be corrected (D24-1): a room charge, or a no-show charge the
    audit posted (or a correction made of either), still standing. */
const CORRECTABLE = `
  fp.reverses_id is null and fp.amount > 0
  and (fp.category = 'room' or fp.source_type in ('night_audit', 'correction'))
  and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)`;

/** The tax invoice standing on the line's bill: issued and not credited -
    finance's own test before it issues another (invoices.ts). */
const STANDING_INVOICE = `(
  select i.number from invoices i
   where i.folio_id = fp.folio_id and i.credits_id is null
     and not exists (select 1 from invoices cn where cn.credits_id = i.id)
   order by i.issued_at desc limit 1)`;

nightAudit.get("/:code/night-audit/days/:date/charges", async (c) => {
  const day = c.req.param("date");
  if (!isIsoDate(day)) return c.json({ error: "The day must be a date, YYYY-MM-DD." }, 400);

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: charges } = await client.query<{
      id: string; description: string; category: string; amount: string;
      tax: string; guest: string | null; invoice: string | null;
    }>(
      `select fp.id::text as id, fp.description, fp.category,
              fp.amount::text as amount, fp.tax_amount::text as tax,
              g.full_name as guest, ${STANDING_INVOICE} as invoice
         from folio_postings fp
         join folios f on f.id = fp.folio_id
         left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
         left join guests g on g.id = r.guest_id
        where fp.hotel_id = $1 and fp.business_date = $2::date and ${CORRECTABLE}
        order by fp.description, fp.id`,
      [hotelId, day],
    );

    const { rows: corrections } = await client.query<{
      id: string; description: string; old_amount: string; new_amount: string;
      reason: string; by: string | null; at: Date;
    }>(
      `select c.id::text, fp.description, c.old_amount::text, c.new_amount::text,
              c.reason, app.colleague_name(c.corrected_by, c.hotel_id) as by,
              c.corrected_at as at
         from closed_day_corrections c
         join folio_postings fp on fp.id = c.posting_id
        where c.hotel_id = $1 and c.business_date = $2::date
        order by c.corrected_at`,
      [hotelId, day],
    );

    return {
      charges: charges.map((r) => ({
        id: r.id,
        description: r.description,
        kind: r.category === "room" ? "room" : "no-show",
        guest: r.guest,
        amount: Number(r.amount),
        tax: Number(r.tax),
        invoice: r.invoice,
      })),
      corrections: corrections.map((r) => ({
        id: r.id,
        description: r.description,
        oldAmount: Number(r.old_amount),
        newAmount: Number(r.new_amount),
        reason: r.reason,
        by: r.by,
        at: r.at.toISOString(),
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

nightAudit.post("/:code/night-audit/days/:date/corrections", async (c) => {
  const day = c.req.param("date");
  const body = (await c.req.json().catch(() => ({}))) as {
    postingId?: unknown; newAmount?: unknown; reason?: unknown;
  };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!isIsoDate(day)) return c.json({ error: "The day must be a date, YYYY-MM-DD." }, 400);
  if (typeof body.postingId !== "string" || !/^\d+$/.test(body.postingId)) {
    return c.json({ error: "Choose the charge to correct." }, 400);
  }
  if (typeof body.newAmount !== "number" || !Number.isFinite(body.newAmount) || body.newAmount < 0) {
    return c.json({ error: "The right figure is a number, 0 or more. 0 takes the charge off." }, 400);
  }
  if (!reason) {
    return c.json({ error: "Say why the charge was wrong. A correction is not kept without its reason." }, 400);
  }
  const amount = Math.round(body.newAmount * 100) / 100;
  const postingId = body.postingId;

  /* Every refusal before the first write: inside withSession a refusal is a
     commit (MEMORY 243). */
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: state } = await client.query<{ closed: boolean; recent: boolean }>(
      `select exists (select 1 from night_audit_runs
                       where hotel_id = $1 and business_date = $2::date
                         and status = 'completed') as closed,
              $2::date >= (date_trunc('month', app.business_date($1))
                           - interval '1 month')::date as recent`,
      [hotelId, day],
    );
    if (!state[0]!.closed) {
      return refuse(`${dayMonth(day)} is not closed. Its charges are changed at the desk.`);
    }
    if (!state[0]!.recent) {
      return refuse(`Only this month's and last month's days can be corrected. ${dayMonth(day)} is older.`);
    }

    const { rows: found } = await client.query<{
      folio_id: string; reservation_id: string | null; category: string;
      description: string; amount: string; tax_rate: string; tax_amount: string;
      invoice: string | null;
    }>(
      `select fp.folio_id::text, fp.reservation_id::text, fp.category, fp.description,
              fp.amount::text, fp.tax_rate::text, fp.tax_amount::text,
              ${STANDING_INVOICE} as invoice
         from folio_postings fp
        where fp.hotel_id = $1 and fp.business_date = $2::date and fp.id = $3::bigint
          and ${CORRECTABLE}`,
      [hotelId, day, postingId],
    );
    const p = found[0];
    if (!p) {
      return refuse(`That is not a room charge or a no-show charge still standing on ${dayMonth(day)}.`);
    }
    if (p.invoice) {
      return refuse(`This bill has tax invoice ${p.invoice}. Issue a credit note instead.`);
    }
    if (amount === Number(p.amount)) {
      return refuse("That is the figure the charge already has.");
    }

    /* The GST, as the audit decides it. A room charge's slab follows its own
       amount, so a new figure can change the rate. A no-show charge's rate was
       decided by the room it was ancillary to, which has not changed: kept. */
    let rate = Number(p.tax_rate);
    if (amount > 0 && p.category === "room") {
      const { rows } = await client.query<{ rate: string | null }>(
        "select app.gst_rate_or_null($1, 'room', $2::numeric)::text as rate",
        [hotelId, amount],
      );
      if (rows[0]?.rate == null) {
        return refuse(
          "This property has no GST rule for rooms. Set it under Rooms and rates → Room types, "
          + "in the GST card. A missing rate is not zero.");
      }
      rate = Number(rows[0].rate);
    }

    const { rows: made } = await client.query<{ id: string }>(
      `insert into closed_day_corrections
         (hotel_id, business_date, posting_id, old_amount, new_amount, reason)
       values ($1, $2::date, $3::bigint, $4::numeric, $5::numeric, $6)
       returning id::text`,
      [hotelId, day, postingId, p.amount, amount, reason],
    );
    const correction = made[0]!.id;

    try {
      await client.query(
        `insert into folio_postings
           (hotel_id, folio_id, reservation_id, business_date, category, description,
            amount, tax_rate, tax_amount, reverses_id, source_type, source_id)
         values ($1, $2, $3, $4::date, $5, $6, $7::numeric, $8::numeric, $9::numeric,
                 $10::bigint, 'correction', $11::uuid)`,
        [hotelId, p.folio_id, p.reservation_id, day, p.category,
         `Reversal - ${p.description}`, -Number(p.amount), p.tax_rate,
         -Number(p.tax_amount), postingId, correction],
      );
    } catch (error) {
      /* 021's index caught a reversal made a moment ago; the transaction is
         spoiled, so nothing above is kept. */
      if ((error as { code?: string }).code === "23505") {
        return refuse("That charge has just been corrected or reversed. Reload to see it.");
      }
      throw error;
    }

    if (amount > 0) {
      await client.query(
        `insert into folio_postings
           (hotel_id, folio_id, reservation_id, business_date, category, description,
            amount, tax_rate, tax_amount, source_type, source_id)
         values ($1, $2, $3, $4::date, $5, $6, $7::numeric, $8::numeric,
                 round($7::numeric * $8::numeric / 100.0, 2), 'correction', $9::uuid)`,
        [hotelId, p.folio_id, p.reservation_id, day, p.category, p.description,
         amount, rate, correction],
      );
    }

    return { ok: true, id: correction } as Record<string, unknown>;
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result["ok"] ? 200 : 409);
});

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

/** "16 September" — how a refusal names a day. */
function dayMonth(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}
