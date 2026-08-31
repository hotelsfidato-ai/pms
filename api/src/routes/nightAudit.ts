import { Hono } from "hono";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE NIGHT AUDIT — closing a day

   Everything else in this system reads a business date. This is the
   only thing that MOVES one, and until now no property had ever
   closed a day: `app.business_date()` returned each hotel's configured
   date because `night_audit_runs` was empty.

   WHAT IT DOES, IN ORDER, IN ONE TRANSACTION

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
    `select coalesce(rm.number, '—') as number, g.full_name as guest
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
        `showing due out. Check them out, or extend the stay — the audit ` +
        `will not decide which.`,
      rooms: rows.map((r) => `${r.number} · ${r.guest}`),
    });
  }

  return blockers;
}

/* ── Can this day be closed? ─────────────────────────────────────── */

nightAudit.get("/:code/night-audit/can-run", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);
    const blockers = await blockersFor(client, hotelId, businessDate);

    const { rows: already } = await client.query<{ status: string }>(
      `select status from night_audit_runs
        where hotel_id = $1 and business_date = $2::date`,
      [hotelId, businessDate],
    );

    if (already[0]?.status === "completed") {
      return {
        allowed: false,
        reason: `${businessDate} is already closed.`,
        businessDate,
        blockers: [],
      };
    }

    return {
      allowed: blockers.length === 0,
      /* Shown DISABLED with its reason, never hidden. Rule 6. */
      reason: blockers.length ? blockers.map((b) => b.reason).join(" ") : null,
      businessDate,
      blockers,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Close the day ───────────────────────────────────────────────── */

nightAudit.post("/:code/night-audit/run", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);

    /* ── Already closed? ─────────────────────────────────────────────
       Answer with what that run did, rather than an error. A second
       press of the button, or a retried request, is not a mistake
       worth punishing — and the caller wants the same answer either
       way. */
    const { rows: prior } = await client.query<{
      status: string; rooms_posted: string | null;
      revenue_posted: string | null; no_shows: string | null;
      completed_at: string | null;
    }>(
      `select status, rooms_posted::text, revenue_posted::text,
              no_shows::text, completed_at::text
         from night_audit_runs
        where hotel_id = $1 and business_date = $2::date`,
      [hotelId, businessDate],
    );

    if (prior[0]?.status === "completed") {
      return {
        ok: true, duplicate: true, businessDate,
        roomsPosted: Number(prior[0].rooms_posted ?? 0),
        revenuePosted: Number(prior[0].revenue_posted ?? 0),
        noShows: Number(prior[0].no_shows ?? 0),
        completedAt: prior[0].completed_at,
      } as Record<string, unknown>;
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
      `insert into night_audit_runs (hotel_id, business_date, status)
       values ($1, $2::date, 'running')
       on conflict (hotel_id, business_date)
         do update set status = 'running', started_at = now(),
                       error_message = null
       returning id::text`,
      [hotelId, businessDate],
    );
    const runId = run[0]!.id;

    /* ── Tax, from the property ───────────────────────────────────── */
    const { rows: tax } = await client.query<{ total: string }>(
      "select (cgst_rate + sgst_rate)::text as total from hotels where id = $1",
      [hotelId],
    );
    const taxRate = Number(tax[0]?.total ?? 0);

    /* ── One night's room charge, per in-house stay ────────────────── */
    const { rows: stays } = await client.query<{
      folio_id: string; room: string; rate: string; comp: boolean;
    }>(
      `select f.id as folio_id,
              coalesce(rm.number, '—') as room,
              r.agreed_rate::text as rate,
              r.is_complimentary as comp
         from reservations r
         join folios f on f.reservation_id = r.id and f.status = 'open'
         left join room_assignments ra on ra.reservation_id = r.id
                                      and ra.released_at is null
         left join rooms rm on rm.id = ra.room_id
        where r.hotel_id = $1
          and r.status = 'checked_in'
          -- A day-use room is sold and vacated inside one day. It has
          -- no night to charge for.
          and not r.is_day_use
          -- Not already charged for tonight. This is what makes an
          -- interrupted audit safe to restart: the charge is the thing
          -- that must not happen twice, so the check is on the charge,
          -- not on the run.
          and not exists (
            select 1 from folio_postings fp
             where fp.folio_id = f.id
               and fp.category = 'room'
               and fp.business_date = $2::date
          )
        order by rm.number`,
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
      const taxAmount = Math.round(amount * taxRate) / 100;

      await client.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, source_type, posted_by)
         values ($1,$2,$3::date,'room',$4,$5,$6,$7,'night_audit',
                 app.current_user_id())`,
        [hotelId, stay.folio_id, businessDate,
         `Room ${stay.room} · 1 night`,
         amount, taxRate, taxAmount],
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
                app.retention_for(r.id, 'no_show')::text as retention`,
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
      const retTax = Math.round(amount * taxRate) / 100;
      await client.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, source_type, posted_by)
         values ($1,$2,$3::date,'misc',$4,$5,$6,$7,'night_audit',
                 app.current_user_id())`,
        [hotelId, m.folio_id, businessDate,
         "Retention — no-show", amount, taxRate, retTax],
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

    const next = await businessDateFor(client, hotelId);

    return {
      ok: true,
      businessDate,
      nextBusinessDate: next,
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

nightAudit.get("/:code/night-audit/runs", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      business_date: string; status: string; rooms_posted: string | null;
      revenue_posted: string | null; no_shows: string | null;
      started_at: string; completed_at: string | null;
      error_message: string | null;
    }>(
      `select to_char(business_date,'YYYY-MM-DD') as business_date,
              status, rooms_posted::text, revenue_posted::text,
              no_shows::text, started_at::text, completed_at::text,
              error_message
         from night_audit_runs
        where hotel_id = $1
        order by business_date desc
        limit 60`,
      [hotelId],
    );

    return rows.map((r) => ({
      businessDate: r.business_date,
      status: r.status,
      /* null, not 0. A run that failed before posting anything posted
         NOTHING, which is a different fact from having posted zero
         rooms — and a dash is the honest way to show it. */
      roomsPosted: r.rooms_posted === null ? null : Number(r.rooms_posted),
      revenuePosted: r.revenue_posted === null ? null : Number(r.revenue_posted),
      noShows: r.no_shows === null ? null : Number(r.no_shows),
      startedAt: r.started_at,
      completedAt: r.completed_at,
      error: r.error_message,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
