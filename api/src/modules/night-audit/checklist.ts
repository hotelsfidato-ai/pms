import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import { blockersFor } from "./nightAudit.ts";

/* Split out of api/src/routes/billing.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: night audit.
   What the audit would check before a day closes. The endpoint is
   unchanged; `hotelIdFor` is a copy of billing's, and `blockersFor` is
   the night audit's own, beside it. */

export const checklist = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/* ── Night audit — the pre-flight checklist ──────────────────────── */

checklist.get("/:code/night-audit", async (c) => {
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
    /* `blockers` joined on 17 September, when the unused
       GET /night-audit/can-run was removed (D17-42): this answer was already
       the one the screen and POST /run share, so it is the one kept. */
    const canRun = {
      allowed: blockers.length === 0,
      ...(blockers.length
        ? { reason: blockers.map((b) => b.reason).join(" ") }
        : {}),
      blockers,
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
