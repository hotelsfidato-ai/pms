import { Hono } from "hono";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { withUser, type Client } from "../../db.ts";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   POS BRIDGE — the connector a point of sale calls

   THE POS IS NOT BUILT HERE. Sattva runs inside eZee today and its
   replacement is being built by the owner. This file is the boundary
   it posts across, and nothing on this side of the boundary knows
   what a menu, a table, a KOT or a waiter is.

   THREE THINGS A POS NEEDS, AND NOTHING ELSE:

     GET  /api/pos/rooms            which rooms can I charge?
     POST /api/pos/tickets          charge this bill to that room
     POST /api/pos/tickets/:ref/void  that bill was voided

   And one more that matters more than it looks:

     GET  /api/pos/tickets/:ref     did my last request land?

   A POS whose request times out does not know whether the charge went
   through. Without a way to ASK, its only options are to retry (double
   charge) or not to (lost revenue). That endpoint is what makes the
   integration safe to write against, and it is why `ticket_ref` is
   the POS's own bill number rather than ours: after a timeout, ours is
   the one identifier the POS never received.

   AUTHENTICATION. `x-pos-key: <key>`. The key is hashed and resolved
   to an outlet's SERVICE ACCOUNT, and every query then runs through
   withUser() as that account — so Row Level Security scopes a POS to
   its own hotel exactly as it scopes a clerk. There is no second
   authorisation path to keep in step.
   ══════════════════════════════════════════════════════════════════ */

export const pos = new Hono<{ Variables: { outlet: Outlet } }>();

/**
 * The PERSON-facing half of the POS bridge.
 *
 * Mounted under /api/hotels, so it goes through the bearer-token
 * gate like every other screen. `pos` is the machine's door and
 * takes an outlet key; the two must not share a router, or a
 * settings screen would need an outlet key to read a list.
 */
export const posAdmin = new Hono<{ Variables: { subject: string } }>();

export interface Outlet {
  outletId: string;
  hotelId: string;
  staffId: string;
  code: string;
  name: string;
  category: string;
}

/** sha256 hex. The key never reaches the database, only this digest. */
export const hashKey = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");

/**
 * Issue a key. Returned once, to the person configuring the outlet.
 *
 * 32 random bytes, not a uuid: a uuid is 122 bits of which some are
 * structural, and it reads like an identifier rather than a secret,
 * which invites it into logs and URLs.
 */
export const issueKey = (): string => `pos_${randomBytes(32).toString("hex")}`;

/**
 * Resolve the caller, or null.
 *
 * Uses its own short-lived connection with no session set, because
 * app.pos_outlet_for_key is SECURITY DEFINER — this is the one read
 * that must happen before anyone is authenticated.
 *
 * Called by the /api/* middleware in server.ts, not by the handlers
 * below. Authentication belongs in one place: a handler that
 * authenticates itself is a handler that can forget to.
 */
export async function outletFor(key: string | undefined): Promise<Outlet | null> {
  if (!key) return null;

  /* No session: the resolver runs as owner by design. Passing a staff
     id here would be circular — that is what we are looking up. */
  return withUser("", async (client) => {
    const { rows } = await client.query<{
      outlet_id: string; hotel_id: string; staff_id: string;
      code: string; name: string; category: string;
    }>(`select * from app.pos_outlet_for_key($1)`, [hashKey(key)]);

    const r = rows[0];
    if (!r) return null;

    /* The module gate reaches the OUTSIDE till too. A property whose POS
       has been turned off must not keep accepting bills through the
       bridge — that would be the interface hiding a screen while the
       door behind it stayed open, which is the exact failure the gate on
       till.ts exists to prevent.

       Resolving to null makes it indistinguishable from an unknown key,
       and that is right: a key that must not work should not be told
       whether it is the key or the property that is wrong. */
    const { rows: gate } = await client.query<{ enabled: boolean }>(
      `select app.module_enabled($1, 'pos') as enabled`, [r.hotel_id]);
    if (!gate[0]!.enabled) return null;

    return { outletId: r.outlet_id, hotelId: r.hotel_id, staffId: r.staff_id,
             code: r.code, name: r.name, category: r.category };
  });
}

/**
 * Every refusal names itself.
 *
 * Rule 6: a blocked action is shown with its reason, never hidden. A
 * POS shows this string to a waiter standing at a table, so it has to
 * say what to do — "Room 204 is not checked in" is actionable, "403"
 * is not.
 */
const refuse = (reason: string) => ({ ok: false as const, reason });

/* ── Which rooms can I charge? ────────────────────────────────────── */

pos.get("/rooms", async (c) => {
  const outlet = c.get("outlet");

  const rooms = await withUser(outlet.staffId, async (client) => {
    const { rows } = await client.query<{
      room_number: string; guest_name: string; folio_id: string; balance: string;
    }>(`select * from app.pos_chargeable_rooms($1)`, [outlet.hotelId]);

    return rows.map((r) => ({
      room: r.room_number,
      guest: r.guest_name,
      folioId: r.folio_id,
      balance: Number(r.balance),
    }));
  });

  return c.json({ outlet: outlet.code, rooms });
});

/* ── Charge a bill to a room ──────────────────────────────────────── */

interface TicketBody {
  ticketRef?: string;
  room?: string;
  /* Only needed when a room has more than one open folio — a same-day
     changeover. The PMS refuses rather than guessing, and this is how
     the POS answers. */
  folioId?: string;
  amount?: number;
  taxRate?: number;
  taxAmount?: number;
  category?: string;
  description?: string;
  items?: unknown;
}

pos.post("/tickets", async (c) => {
  const outlet = c.get("outlet");

  const body = await c.req.json<TicketBody>().catch(() => ({} as TicketBody));

  const ticketRef = body.ticketRef?.trim();
  if (!ticketRef) {
    return c.json(
      refuse(
        "A bill number is required. It is your number, not ours — it is what " +
          "lets a retry after a timeout be recognised instead of charged twice.",
      ),
      409,
    );
  }

  const room = body.room?.trim();
  if (!room) return c.json(refuse("Which room is this bill for?"), 409);

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json(refuse("A charge must be a positive amount."), 409);
  }

  const result = await withUser(outlet.staffId, async (client) => {
    /* ── Already seen? ──────────────────────────────────────────────
       Checked BEFORE anything is written, so the common case of a
       retry costs one query and returns the original posting. The
       unique index is still the guarantee — this is the courteous
       answer, not the safety mechanism. Two POS terminals racing the
       same bill number will find this check empty and one of them
       will lose at the index, below. */
    const seen = await client.query<{
      id: string; status: string; posting_id: string | null;
      business_date: string; amount: string; reject_reason: string | null;
    }>(
      `select id::text, status, posting_id::text,
              to_char(business_date,'YYYY-MM-DD') as business_date,
              amount::text, reject_reason
         from pos_tickets
        where outlet_id = $1 and ticket_ref = $2`,
      [outlet.outletId, ticketRef],
    );

    if (seen.rows[0]) {
      const t = seen.rows[0];
      return {
        ok: t.status !== "rejected",
        duplicate: true,
        ticketRef,
        status: t.status,
        postingId: t.posting_id,
        businessDate: t.business_date,
        amount: Number(t.amount),
        reason: t.reject_reason ?? undefined,
      } as Record<string, unknown>;
    }

    /* ── The hotel's day, not the POS's ─────────────────────────────
       A restaurant closing at 01:30 has a clock reading tomorrow. The
       hotel is still operating in yesterday until its night audit
       runs. Resolved inside this transaction so an audit completing
       mid-request cannot move the date out from under the posting. */
    const businessDate = await businessDateFor(client, outlet.hotelId);

    const chargeable = await client.query<{ folio_id: string; guest_name: string }>(
      `select folio_id, guest_name from app.pos_chargeable_rooms($1)
        where room_number = $2`,
      [outlet.hotelId, room],
    );

    /* ── ONE ROOM, TWO GUESTS ────────────────────────────────────────
       A same-day turnover leaves both folios open: the departing guest
       has not checked out yet and the arriving one is already in. On
       25 August the demo property has exactly this — Rekha Gaikwad due
       out of 201, Tanvi Bhide arrived into 201, both `checked_in`.

       This code originally took rows[0] and charged whoever the
       database happened to return first. It would have been right most
       days and silently wrong on turnover days, which is the worst
       shape a bug can have.

       The PMS cannot know which guest ate. It must not guess, and it
       must not hide the situation — so it refuses, names both, and
       gives the POS the folio ids to choose from. `folioId` in the
       body settles it.

       NOT recorded as a rejected ticket, unlike the refusals below.
       The POS is expected to resend this bill with the SAME number
       once a person picks the guest, and a `rejected` row would hit
       the unique index and block it permanently. The rule is: a
       FINAL refusal is recorded; one that asks a question is not. */
    if (chargeable.rows.length > 1 && !body.folioId) {
      const reason =
        `Room ${room} has ${chargeable.rows.length} open folios today ` +
        `(${chargeable.rows.map((r) => r.guest_name).join(", ")}) — a same-day ` +
        `changeover. Send folioId to say which guest this bill is for.`;
      return {
        ok: false,
        reason,
        status: "ambiguous",
        choices: chargeable.rows.map((r) => ({
          folioId: r.folio_id, guest: r.guest_name,
        })),
      } as Record<string, unknown>;
    }

    const target = body.folioId
      ? chargeable.rows.find((r) => r.folio_id === body.folioId)
      : chargeable.rows[0];

    if (!target) {
      /* FINAL refusals are RECORDED, not merely returned. This is how
         anyone later settles "the restaurant says they charged it, the
         folio says otherwise" — the refusal sits in the same table as
         the charges, with its reason and its timestamp.
         Final, because there is nothing the POS can add that would
         make this bill land: the room is empty. Contrast the
         ambiguity above, which is a question, not an answer. */
      const reason = body.folioId
        ? `Folio ${body.folioId} is not open in room ${room}.`
        : `Room ${room} cannot be charged: nobody is checked in there, ` +
          `or the folio is closed.`;
      await client.query(
        `insert into pos_tickets (hotel_id, outlet_id, ticket_ref, business_date,
                                  amount, tax_rate, tax_amount, status,
                                  reject_reason, items)
         values ($1,$2,$3,$4,$5,$6,$7,'rejected',$8,$9)`,
        [outlet.hotelId, outlet.outletId, ticketRef, businessDate, amount,
         body.taxRate ?? 0, body.taxAmount ?? 0, reason,
         body.items ? JSON.stringify(body.items) : null],
      );
      return { ok: false, reason, status: "rejected" } as Record<string, unknown>;
    }

    const category = body.category ?? outlet.category;
    const description = body.description?.trim() || `${outlet.name} — ${ticketRef}`;
    const taxRate = Number(body.taxRate ?? 0);
    const taxAmount = Number(body.taxAmount ?? 0);

    /* The ticket's id is generated HERE, before either insert, so the
       posting can name the ticket it came from in one pass.

       The obvious shape — insert the posting, insert the ticket, then
       `update folio_postings set source_id` — is exactly what the
       ledger forbids: 014_simulation_fixes.sql revokes UPDATE on
       folio_postings from pms_app because the ledger is append-only.
       The database refused it, correctly, with `permission denied for
       table folio_postings`. A convenience write is still a write. */
    const ticketId = randomUUID();

    const posted = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount, source_type, source_id, posted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'pos',$9,$10)
       returning id::text`,
      [outlet.hotelId, target.folio_id, businessDate, category, description,
       amount, taxRate, taxAmount, ticketId, outlet.staffId],
    );

    await client.query(
      `insert into pos_tickets (id, hotel_id, outlet_id, ticket_ref, folio_id,
                                posting_id, business_date, amount, tax_rate,
                                tax_amount, status, items)
       values ($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9,$10,'posted',$11)`,
      [ticketId, outlet.hotelId, outlet.outletId, ticketRef, target.folio_id,
       posted.rows[0]!.id, businessDate, amount, taxRate, taxAmount,
       body.items ? JSON.stringify(body.items) : null],
    );

    return {
      ok: true,
      ticketRef,
      status: "posted",
      postingId: posted.rows[0]!.id,
      folioId: target.folio_id,
      guest: target.guest_name,
      room,
      businessDate,
      amount,
    } as Record<string, unknown>;
  }).catch((error: unknown) => {
    /* The index fired: two terminals sent the same bill number at the
       same moment and this one lost. That is the guarantee working —
       answer as a duplicate rather than an error, because from the
       POS's side the charge did land. */
    if (isUniqueViolation(error)) {
      return { ok: true, duplicate: true, ticketRef, status: "posted" } as
        Record<string, unknown>;
    }
    throw error;
  });

  return c.json(result, result["ok"] ? 200 : 409);
});

/* ── Did my last request land? ────────────────────────────────────── */

pos.get("/tickets/:ref", async (c) => {
  const outlet = c.get("outlet");

  const found = await withUser(outlet.staffId, async (client) => {
    const { rows } = await client.query<{
      ticket_ref: string; status: string; posting_id: string | null;
      business_date: string; amount: string; reject_reason: string | null;
      received_at: string;
    }>(
      `select ticket_ref, status, posting_id::text,
              to_char(business_date,'YYYY-MM-DD') as business_date,
              amount::text, reject_reason, received_at::text
         from pos_tickets
        where outlet_id = $1 and ticket_ref = $2`,
      [outlet.outletId, c.req.param("ref")],
    );
    return rows[0] ?? null;
  });

  if (!found) {
    /* Not an error. "We never received it" is the answer a POS needs
       in order to send it — and it is a different answer from "it
       failed", which would tell it to give up. */
    return c.json({ ticketRef: c.req.param("ref"), status: "not-received" }, 404);
  }

  return c.json({
    ticketRef: found.ticket_ref,
    status: found.status,
    postingId: found.posting_id,
    businessDate: found.business_date,
    amount: Number(found.amount),
    reason: found.reject_reason ?? undefined,
    receivedAt: found.received_at,
  });
});

/* ── That bill was voided ─────────────────────────────────────────── */

pos.post("/tickets/:ref/void", async (c) => {
  const outlet = c.get("outlet");

  const ref = c.req.param("ref");

  const result = await withUser(outlet.staffId, async (client) => {
    const { rows } = await client.query<{
      id: string; status: string; posting_id: string | null;
      folio_id: string | null; business_date: string; amount: string;
      tax_rate: string; tax_amount: string;
    }>(
      `select id::text, status, posting_id::text, folio_id::text,
              to_char(business_date,'YYYY-MM-DD') as business_date,
              amount::text, tax_rate::text, tax_amount::text
         from pos_tickets
        where outlet_id = $1 and ticket_ref = $2`,
      [outlet.outletId, ref],
    );

    const t = rows[0];
    if (!t) return refuse(`No bill ${ref} was received from this outlet.`);
    if (t.status === "rejected") {
      return refuse(`Bill ${ref} was refused and never charged. Nothing to void.`);
    }
    if (t.status === "voided") {
      /* Idempotent, deliberately. A POS retrying a void must not post
         a second reversal, which would re-charge the guest. */
      return { ok: true, ticketRef: ref, status: "voided", duplicate: true };
    }

    /* A REVERSAL, not a delete. folio_postings is append-only and a
       trigger enforces it against every role, superuser included. The
       ledger will show both rows, which is the point: the guest can
       see the charge and its cancellation. */
    const reversal = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount, reverses_id, source_type, source_id,
          posted_by)
       select $1, fp.folio_id, $2, fp.category,
              'Void — ' || fp.description,
              -fp.amount, fp.tax_rate, -fp.tax_amount, fp.id, 'pos', $4, $5
         from folio_postings fp
        where fp.id = $3::bigint
       returning id::text`,
      [outlet.hotelId,
       /* The day the VOID happens, which may not be the day of the
          charge. A bill raised yesterday and voided today belongs to
          today — backdating it would move revenue across a night
          audit that has already closed. */
       await businessDateFor(client, outlet.hotelId),
       t.posting_id, t.id, outlet.staffId],
    );

    await client.query(
      `update pos_tickets
          set status = 'voided', voided_at = now(), void_posting_id = $1::bigint
        where id = $2`,
      [reversal.rows[0]!.id, t.id],
    );

    return {
      ok: true, ticketRef: ref, status: "voided",
      reversalPostingId: reversal.rows[0]!.id,
    };
  });

  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Helpers ──────────────────────────────────────────────────────── */

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/** Used by scripts/tests that need a client without a route. */
export type PosClient = Client;

/* ── The outlets configured at a property ─────────────────────────── */

/**
 * Read by the settings screen, which listed outlets from a FIXTURE
 * until this existed — with a note saying "the POS outlet is a
 * migration off eZee, not a configured thing". The bridge made it a
 * configured thing.
 *
 * Mounted on the hotels router, not the POS one: this is a PERSON
 * asking what is configured at their property, authenticated as a
 * person. The `/api/pos` routes are the machine's door and take an
 * outlet key.
 */
posAdmin.get("/:code/pos/outlets", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows: hotel } = await client.query<{ id: string }>(
      "select id from hotels where code = $1",
      [c.req.param("code").toUpperCase()],
    );
    if (!hotel[0]) return null;

    const { rows } = await client.query<{
      code: string; name: string; category: string;
      has_key: boolean; is_active: boolean; bills: string;
    }>(
      `select o.code, o.name, o.category,
              (o.api_key_hash is not null) as has_key,
              o.is_active,
              (select count(*) from pos_tickets t
                where t.outlet_id = o.id)::text as bills
         from pos_outlets o
        where o.hotel_id = $1
        order by o.code`,
      [hotel[0].id],
    );

    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      category: r.category,
      /* Never the key, and never the hash. A settings screen has no
         reason to carry either, and the hash is what an attacker would
         need to know they had guessed right. */
      hasKey: r.has_key,
      isActive: r.is_active,
      bills: Number(r.bills),
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Every bill an outlet sent, refusals included ─────────────────── */

/**
 * What the POS screen reads.
 *
 * The REFUSALS are the point. A charge that landed is visible on the
 * guest's folio already; a charge that was refused is visible nowhere
 * else, and "the restaurant says they charged it, the folio says
 * otherwise" is the argument this table exists to settle.
 *
 * Person-facing, so it goes through the bearer gate. The `/api/pos`
 * routes are the machine's door.
 */
posAdmin.get("/:code/pos/tickets", async (c) => {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const body = await withSession(c.get("subject"), async (client) => {
    const { rows: hotel } = await client.query<{ id: string }>(
      "select id from hotels where code = $1",
      [c.req.param("code").toUpperCase()],
    );
    if (!hotel[0]) return null;
    const hotelId = hotel[0].id;

    const { rows: bd } = await client.query<{ d: string }>(
      "select to_char(app.business_date($1), 'YYYY-MM-DD') as d", [hotelId],
    );
    const to = toParam ?? bd[0]!.d;
    const from = fromParam ?? `${to.slice(0, 7)}-01`;

    const { rows } = await client.query<{
      id: string; outlet: string; outlet_name: string; ticket_ref: string;
      status: string; reject_reason: string | null; amount: string;
      tax_amount: string; business_date: string; received_at: string;
      guest: string | null; room: string | null; posting_id: string | null;
      void_posting_id: string | null; items: string | null;
    }>(
      `select t.id::text, o.code as outlet, o.name as outlet_name,
              t.ticket_ref, t.status, t.reject_reason,
              t.amount::text, t.tax_amount::text,
              to_char(t.business_date,'YYYY-MM-DD') as business_date,
              to_char(t.received_at, 'DD Mon, HH24:MI') as received_at,
              g.full_name as guest,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id
                order by ra.released_at nulls first, ra.from_date desc
                limit 1) as room,
              t.posting_id::text, t.void_posting_id::text,
              t.items::text
         from pos_tickets t
         join pos_outlets o on o.id = t.outlet_id
         left join folios f on f.id = t.folio_id
         left join reservations r on r.id = f.reservation_id
         left join guests g on g.id = r.guest_id
        where t.hotel_id = $1
          and t.business_date between $2::date and $3::date
        order by t.received_at desc
        limit 500`,
      [hotelId, from, to],
    );

    return {
      from, to,
      rows: rows.map((r) => ({
        id: r.id,
        outlet: r.outlet,
        outletName: r.outlet_name,
        /* The POS's own bill number, which is also the idempotency key.
           Shown because it is what a waiter reads off their terminal
           when they ring the front desk. */
        ticketRef: r.ticket_ref,
        status: r.status,
        reason: r.reject_reason,
        amount: Math.round(Number(r.amount) * 100) / 100,
        tax: Math.round(Number(r.tax_amount) * 100) / 100,
        businessDate: r.business_date,
        receivedAt: r.received_at,
        /* Null on a refused bill — it never reached a folio, which is
           the whole reason somebody is looking at this screen. */
        guest: r.guest,
        room: r.room,
        postingId: r.posting_id,
        voidPostingId: r.void_posting_id,
        items: r.items ? (JSON.parse(r.items) as unknown) : null,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
