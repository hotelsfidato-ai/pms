import { Hono } from "hono";
import type { Context, Next } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { PoolClient as Client } from "pg";
import { attachableFunctions } from "./attach.ts";
import { emailProblem, phoneProblem, priceProblem } from "../../validate.ts";
import {
  folioBalance, issueFolioInvoice, postFolioCharge, reverseFolioCharge, takeFolioPayment,
} from "../finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BANQUET HALL

   `041_hotel_modules.sql` has carried a flag called `banquet` since it
   was written, defaulting OFF, with a comment saying why: "banquet is
   not built." These are the routes it was waiting for.

   THE SHAPE, from the group's own description: a hall is booked for an
   explicit TIME RANGE — "it needs to be specified till when the hall is
   booked till" — the GM registers it, the price is agreed per function,
   and food is optional with both a package and the POS menu open.

   THE GUARD THAT MATTERS is that a hall cannot be sold twice, and it
   lives in `app.confirm_banquet_event`, not here. Rule 6: the server
   refuses independently of the interface, and the refusal NAMES the
   function standing in the way rather than saying "unavailable".

   AND NOTHING HERE WRITES A PRICE NOBODY TYPED. A venue's default_rate
   is a starting point the screen offers; an event with no agreed amount
   is UNPRICED, which reads as a dash and makes the total NULL.
   ══════════════════════════════════════════════════════════════════ */

export const banquet = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

/* Once "Bill the function" has put it on its bill (status 'completed',
   D27-138), what was billed is fixed: a correction is a credit note. */
const BILLED =
  "This function is on its bill, so its price, courses and times are fixed.";

/* THE OWNER'S D27-124: a function may be set up while the property has no
   banquet GST rule, and it is told so; its bill is refused until the rule
   is set (the bill's own check). Asked with finance's own question,
   app.gst_rate_or_null - null is "not set", never a rate of zero. */
export const BANQUET_TAX_NOT_SET =
  "Banquet tax is not set: ask the GM to set it before the bill.";

async function banquetTaxWarning(client: Client, hotelId: string): Promise<string | null> {
  const { rows } = await client.query<{ rate: string | null }>(
    "select app.gst_rate_or_null($1, 'banquet', 1)::text as rate", [hotelId]);
  return rows[0]?.rate == null ? BANQUET_TAX_NOT_SET : null;
}

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── The module gate ──────────────────────────────────────────────
   HIDING A SCREEN IS NOT DISABLING IT — 041's own words. The
   navigation stops showing banquet and these routes refuse it,
   independently, because a hidden screen whose endpoint still answers
   is a screen anybody can reach by typing the URL. */
async function moduleGate(
  c: Context<{ Variables: { subject: string } }>,
  next: Next,
) {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "No such property." }, 404);

  /* The one route that answers while banquet is off. The till asks it
     at every property, and "this property has no hall" is an answer it
     acts on (no way to attach an order), not a refusal. It gives nothing
     away: an empty list, and `enabled: false`. */
  if (c.req.path.endsWith("/banquet/attachable")) return next();

  const allowed = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return null;
    const { rows } = await client.query<{ enabled: boolean }>(
      `select app.module_enabled($1, 'banquet') as enabled`, [hotelId]);
    return rows[0]!.enabled;
  });

  if (allowed === null) return c.json({ error: "No such property." }, 404);
  if (!allowed) {
    return c.json(refuse(
      "This property has no banquet hall. Turn it on in the property's "
      + "settings if that is wrong."), 403);
  }
  await next();
}

banquet.use("/:code/banquet", moduleGate);
banquet.use("/:code/banquet/*", moduleGate);


/* ── The calendar ─────────────────────────────────────────────────
   Every active hall over a window, with whatever is in it. A hall with
   nothing booked comes back as a venue with an empty list, because an
   empty hall is the answer somebody is looking for. */
banquet.get("/:code/banquet", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);
    const from = c.req.query("from") ?? businessDate;
    const to = c.req.query("to")
      ?? new Date(new Date(from).getTime() + 30 * 864e5)
           .toISOString().slice(0, 10);

    const { rows } = await client.query<{
      venue_id: string; venue_name: string;
      event_id: string | null; reference: string | null; title: string | null;
      status: string | null; starts_at: string | null; ends_at: string | null;
      host_name: string | null; pax_expected: number | null;
      agreed_amount: string | null;
    }>(
      `select venue_id::text, venue_name, event_id::text, reference, title,
              status,
              app.hotel_clock($1, starts_at) as starts_at,
              app.hotel_clock($1, ends_at)   as ends_at,
              host_name, pax_expected, agreed_amount::text
         from app.banquet_calendar($1, $2::date, $3::date)`,
      [hotelId, from, to],
    );

    /* WHO REGISTERED EACH, for the diary's line (BQ-7). 060's calendar
       reads the name through `staff`, which is row-secured, so a GM got
       no name for a function the owner registered. 096's colleague_name
       answers for anybody at this property, and null where the viewer may
       not know. The calendar's own column is not read. */
    const { rows: names } = await client.query<{ id: string; name: string | null }>(
      `select e.id::text, app.colleague_name(e.registered_by, e.hotel_id) as name
         from banquet_events e
        where e.hotel_id = $1 and e.id = any($2::uuid[])`,
      [hotelId, rows.flatMap((r) => (r.event_id ? [r.event_id] : []))],
    );
    const registeredBy = new Map(names.map((n) => [n.id, n.name]));

    const venues = new Map<string, {
      id: string; name: string;
      events: Array<Record<string, unknown>>;
    }>();

    for (const r of rows) {
      if (!venues.has(r.venue_id)) {
        venues.set(r.venue_id, { id: r.venue_id, name: r.venue_name, events: [] });
      }
      if (!r.event_id) continue;      // an empty hall, deliberately kept
      venues.get(r.venue_id)!.events.push({
        id: r.event_id,
        reference: r.reference,
        title: r.title,
        status: r.status,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        hostName: r.host_name,
        pax: r.pax_expected,
        /* NULL stays NULL all the way to the screen. Coercing it to 0
           here would turn "nobody has priced this" into "this is free"
           three layers away from anyone who could notice. */
        agreedAmount: r.agreed_amount === null ? null : Number(r.agreed_amount),
        registeredBy: registeredBy.get(r.event_id) ?? null,
      });
    }

    return { businessDate, from, to, venues: [...venues.values()] };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});


/* ── The functions a restaurant order may be attached to ─────────────
   For the till (D17-21). The rule and why it is shaped so are in
   attach.ts, which the till's server also asks before it writes. */
banquet.get("/:code/banquet/attachable", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    return attachableFunctions(client, hotelId);
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});


/* ── One function, in full ────────────────────────────────────────── */
banquet.get("/:code/banquet/events/:id", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* NO JOIN TO staff (BQ-7). `staff` is row-secured: a GM cannot read
       the owner's row, a clerk only their own. `join staff` for the name
       dropped the WHOLE FUNCTION for them — "No such function" for one
       that exists. A name is a label, and a label never hides a row (root
       MEMORY.md 283); 096's colleague_name gives it, or null where the
       viewer may not know. */
    const { rows: ev } = await client.query<Record<string, string | null>>(
      `select e.id::text, e.reference, e.title, e.event_type, e.status,
              app.hotel_clock(e.hotel_id, e.starts_at) as starts_at,
              app.hotel_clock(e.hotel_id, e.ends_at)   as ends_at,
              e.business_date::text, e.host_name, e.host_phone, e.host_email,
              e.pax_expected::text, e.pax_guaranteed::text,
              e.agreed_amount::text, e.notes, e.cancel_reason,
              v.id::text as venue_id, v.name as venue_name,
              v.seated_capacity::text, v.floating_capacity::text,
              v.default_rate::text,
              app.colleague_name(e.registered_by, e.hotel_id) as registered_by,
              to_char(e.registered_at, 'YYYY-MM-DD"T"HH24:MI') as registered_at,
              app.colleague_name(e.confirmed_by, e.hotel_id) as confirmed_by,
              f.id::text as folio_id
         from banquet_events e
         join banquet_venues v on v.id = e.venue_id
         left join folios f on f.event_id = e.id and f.status = 'open'
        where e.id = $1 and e.hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    if (!ev[0]) return "missing" as const;
    const e = ev[0];

    /* Every course, whoever added it (BQ-7): a join to `staff` here hid
       the courses a colleague added while the total still counted them. */
    const { rows: food } = await client.query<{
      id: string; name: string; pax: number; rate: string | null;
      notes: string | null; added_by: string | null;
    }>(
      `select p.id::text, p.name, p.pax, p.rate_per_head::text as rate,
              p.notes, app.colleague_name(p.added_by, p.hotel_id) as added_by
         from banquet_event_packages p
        where p.event_id = $1 order by p.created_at`,
      [e.id],
    );

    const { rows: total } = await client.query<{
      venue_amount: string | null; food_amount: string | null;
      pos_amount: string | null; total: string | null; unpriced: string | null;
    }>(
      `select venue_amount::text, food_amount::text, pos_amount::text,
              total::text, unpriced from app.banquet_event_total($1)`,
      [e.id],
    );
    const t = total[0]!;

    /* THE RESTAURANT ORDERS ON THIS FUNCTION'S BILL (D17-21). Open ones
       are listed too, with their status: an order still being added to
       is real food, and hiding it would let the bill look finished. Only
       settled ones are in the total — app.banquet_event_total's rule, so
       the list and the total cannot disagree about what counts.

       Abandoned orders are left out: nothing was charged. The outlet is
       a LEFT join because it is a label, and a label never hides a row
       (root MEMORY.md 283). */
    const { rows: orders } = await client.query<{
      id: string; order_no: string; table_ref: string | null;
      outlet: string | null; status: string; opened_at: string;
      settled_at: string | null; payable: string | null;
    }>(
      `select o.id::text, o.order_no, o.table_ref, po.name as outlet, o.status,
              to_char(o.opened_at,  'YYYY-MM-DD"T"HH24:MI') as opened_at,
              to_char(o.settled_at, 'YYYY-MM-DD"T"HH24:MI') as settled_at,
              t.payable::text
         from pos_orders o
         left join pos_outlets po on po.id = o.outlet_id
         cross join lateral app.pos_order_total(o.id) t
        where o.event_id = $1 and o.hotel_id = $2 and o.status <> 'abandoned'
        order by o.opened_at, o.order_no`,
      [e.id, hotelId],
    );

    const num = (v: string | null | undefined) =>
      (v === null || v === undefined ? null : Number(v));

    return {
      id: e.id, reference: e.reference, title: e.title,
      eventType: e.event_type, status: e.status,
      startsAt: e.starts_at, endsAt: e.ends_at, businessDate: e.business_date,
      hostName: e.host_name, hostPhone: e.host_phone, hostEmail: e.host_email,
      pax: num(e.pax_expected), paxGuaranteed: num(e.pax_guaranteed),
      agreedAmount: num(e.agreed_amount),
      notes: e.notes, cancelReason: e.cancel_reason,
      venue: {
        id: e.venue_id, name: e.venue_name,
        seated: num(e.seated_capacity), floating: num(e.floating_capacity),
        defaultRate: num(e.default_rate),
      },
      registeredBy: e.registered_by, registeredAt: e.registered_at,
      confirmedBy: e.confirmed_by,
      folioId: e.folio_id,
      /* BQ-1: the bill as finance adds it up, and its standing invoice. */
      bill: e.folio_id ? await folioBalance(client, e.folio_id) : null,
      invoice: e.folio_id ? await standingInvoice(client, e.folio_id) : null,
      /* D27-124: said on the function while the banquet GST rule is unset. */
      taxWarning: await banquetTaxWarning(client, hotelId),
      catering: food.map((f) => ({
        id: f.id, name: f.name, pax: f.pax,
        ratePerHead: num(f.rate), notes: f.notes, addedBy: f.added_by,
      })),
      restaurantOrders: orders.map((o) => ({
        id: o.id, orderNo: o.order_no, table: o.table_ref, outlet: o.outlet,
        status: o.status, openedAt: o.opened_at, settledAt: o.settled_at,
        amount: num(o.payable),
      })),
      /* The total is NULL when anything is unpriced, and `unpriced` says
         which. A quotation short by two hundred plates is worse than no
         quotation, so the screen shows the sentence, not a number. */
      money: {
        venue: num(t.venue_amount), food: num(t.food_amount),
        pos: num(t.pos_amount), total: num(t.total), unpriced: t.unpriced,
      },
    };
  });

  if (body === null) return c.json({ error: "No such property." }, 404);
  if (body === "missing") return c.json({ error: "No such function." }, 404);
  return c.json(body);
});


/* ── Registering a function ───────────────────────────────────────
   It lands as an ENQUIRY. Registering does not take the hall; confirming
   does, which is why they are two acts and not one. */
banquet.post("/:code/banquet/events", async (c) => {
  type Body = {
    venueId?: string; title?: string; eventType?: string;
    startsAt?: string; endsAt?: string;
    hostName?: string; hostPhone?: string; hostEmail?: string;
    guestId?: string; companyId?: string;
    pax?: number; agreedAmount?: number | null; free?: boolean; notes?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  /* Round D's rules (X-1, X-2, D27-120): an impossible telephone or email
     is refused, and a hall price of 0 only when ticked Free. */
  const typed = phoneProblem(input.hostPhone) ?? emailProblem(input.hostEmail)
    ?? priceProblem(input.agreedAmount, input.free === true);
  if (typed) return c.json(refuse(typed), 409);

  if (!input.venueId) return c.json(refuse("Which hall?"), 409);
  if (!input.title?.trim()) return c.json(refuse("What is the function?"), 409);
  if (!input.hostName?.trim()) return c.json(refuse("Who is it for?"), 409);
  if (!input.startsAt) return c.json(refuse("When does it start?"), 409);
  /* TILL WHEN. The whole module exists because this question was not
     being asked, so it is not optional and the refusal says why. */
  if (!input.endsAt) {
    return c.json(refuse(
      "Until when? A hall booked with no end is a hall nobody else can "
      + "be sold."), 409);
  }
  if (new Date(input.endsAt) <= new Date(input.startsAt)) {
    return c.json(refuse("A function ends after it starts."), 409);
  }

  /* Bound here, not read from `input` below: the checks above narrow these
     to strings, and that narrowing does not survive into the closure. */
  const title = input.title.trim();
  const hostName = input.hostName.trim();
  const startsAt = input.startsAt;
  const endsAt = input.endsAt;
  const venueId = input.venueId;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);

    /* Warn about a clash at REGISTRATION without refusing it. An enquiry
       may overlap a confirmed booking — the GM is often taking a second
       option on purpose — but they should know before they promise. */
    const { rows: clash } = await client.query<{
      title: string; reference: string; starts_at: string; ends_at: string;
    }>(
      `select title, reference,
              app.hotel_clock($4, starts_at, 'DD Mon HH24:MI') as starts_at,
              app.hotel_clock($4, ends_at,   'DD Mon HH24:MI') as ends_at
         from app.banquet_conflicts($1, app.hotel_moment($4, $2), app.hotel_moment($4, $3))`,
      [venueId, startsAt, endsAt, hotelId],
    );

    /* BQ-6: two registrations in one moment read the same maximum, and
       `lpad` CUTS a number longer than its width (root MEMORY 280), so the
       10,000th was refused as a duplicate. One at a time per property, for
       this transaction, and a number is only padded when it is short. */
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('banquet-reference:' || $1, 0))",
      [hotelId]);
    const { rows: refRows } = await client.query<{ reference: string }>(
      `select 'BQ-' || to_char($2::date, 'YYMM') || '-' || lpad(n, greatest(length(n), 4), '0')
              as reference
         from (select (coalesce(max(substring(reference from '[0-9]+$')::bigint), 1000) + 1)::text as n
                 from banquet_events where hotel_id = $1) m`,
      [hotelId, businessDate],
    );

    /* One telephone call is one enquiry, however many times a tablet
       that lost signal resends it. See 062. */
    const idem = c.req.header("idempotency-key") ?? null;

    if (idem) {
      const { rows: already } = await client.query<{ id: string; reference: string }>(
        `select id::text, reference from banquet_events
          where hotel_id = $1 and idempotency_key = $2`, [hotelId, idem]);
      if (already[0]) {
        return {
          ok: true as const, id: already[0].id,
          reference: already[0].reference, warning: null,
        };
      }
    }

    try {
      const { rows } = await client.query<{ id: string; reference: string }>(
        `insert into banquet_events
           (hotel_id, venue_id, reference, title, event_type, business_date,
            starts_at, ends_at, host_name, host_phone, host_email,
            guest_id, company_id, pax_expected, agreed_amount, notes,
            registered_by, idempotency_key)
         values ($1,$2,$3,$4,$5,$6::date,
                 app.hotel_moment($1, $7), app.hotel_moment($1, $8),
                 $9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         returning id::text, reference`,
        [hotelId, venueId, refRows[0]!.reference, title,
         input.eventType ?? null, businessDate, startsAt, endsAt,
         hostName, input.hostPhone ?? null, input.hostEmail ?? null,
         input.guestId ?? null, input.companyId ?? null,
         input.pax ?? null,
         /* NOT DEFAULTED FROM THE VENUE. The screen may OFFER the venue's
            default rate; only what a person actually submitted is stored,
            and undefined means unpriced. */
         input.agreedAmount ?? null,
         input.notes ?? null, session.staffId, idem],
      );
      const warnings = [
        clash[0]
          ? `Registered as an enquiry. Note the hall is already confirmed for `
            + `${clash[0].title} (${clash[0].reference}), `
            + `${clash[0].starts_at} to ${clash[0].ends_at}.`
          : null,
        await banquetTaxWarning(client, hotelId),
      ].filter(Boolean);
      return {
        ok: true as const, id: rows[0]!.id, reference: rows[0]!.reference,
        warning: warnings.length ? warnings.join(" ") : null,
      };
    } catch (error) {
      const e = error as { message?: string } | undefined;
      return refuse(e?.message ?? "That function could not be registered.");
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── Confirming — the moment the hall is taken ────────────────────── */
banquet.post("/:code/banquet/events/:id/confirm", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: owned } = await client.query<{ id: string }>(
      `select id::text from banquet_events where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    if (!owned[0]) return "missing" as const;

    try {
      const { rows } = await client.query<{ folio_id: string }>(
        `select app.confirm_banquet_event($1, $2)::text as folio_id`,
        [c.req.param("id"), session.staffId]);
      return { ok: true as const, folioId: rows[0]!.folio_id };
    } catch (error) {
      /* The database already wrote the sentence, and it names the
         function standing in the way. Replacing it with "unavailable"
         here would throw away the only actionable half. */
      const e = error as { message?: string } | undefined;
      return refuse(e?.message ?? "That function could not be confirmed.");
    }
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such function." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── Cancelling ───────────────────────────────────────────────────── */
banquet.post("/:code/banquet/events/:id/cancel", async (c) => {
  const input = await c.req.json<{ reason?: string }>()
    .catch(() => ({}) as { reason?: string });
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse(
      "Why is it cancelled? This is the line somebody asks about."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* A billed function is not cancelled (D27-135): its bill is corrected
       with a credit note. An advance on a confirmed one stays on its bill
       as the host's credit. */
    const { rows } = await client.query<{ id: string }>(
      `update banquet_events
          set status = 'cancelled', cancel_reason = $3,
              cancelled_by = $4, cancelled_at = now()
        where id = $1 and hotel_id = $2 and status in ('enquiry', 'confirmed')
        returning id::text`,
      [c.req.param("id"), hotelId, reason, session.staffId]);
    if (!rows[0]) {
      const { rows: now } = await client.query<{ status: string }>(
        "select status from banquet_events where id = $1 and hotel_id = $2",
        [c.req.param("id"), hotelId]);
      return now[0]?.status === "completed" ? refuse(BILLED) : "missing" as const;
    }
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") {
    return c.json(refuse("That function is not open to cancel."), 409);
  }
  return c.json(result, result.ok ? 200 : 409);
});


/* ── Amending: the price, the times, the heads ────────────────────── */
banquet.patch("/:code/banquet/events/:id", async (c) => {
  type Body = {
    agreedAmount?: number | null; pax?: number | null;
    paxGuaranteed?: number | null; startsAt?: string; endsAt?: string;
    notes?: string; title?: string; free?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const badPrice = priceProblem(input.agreedAmount, input.free === true);
  if (badPrice) return c.json(refuse(badPrice), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: cur } = await client.query<{
      id: string; venue_id: string; status: string;
      starts_at: string; ends_at: string;
    }>(
      /* On the PROPERTY's clock, because these come back as the times an
         unchanged field keeps - and a moment read in the server's zone would
         be written back as a different one (BQ-8). */
      `select id::text, venue_id::text, status,
              app.hotel_clock(hotel_id, starts_at) as starts_at,
              app.hotel_clock(hotel_id, ends_at)   as ends_at
         from banquet_events where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    if (!cur[0]) return "missing" as const;
    if (cur[0].status === "completed") return refuse(BILLED);

    const startsAt = input.startsAt ?? cur[0].starts_at;
    const endsAt = input.endsAt ?? cur[0].ends_at;
    if (new Date(endsAt) <= new Date(startsAt)) {
      return refuse("A function ends after it starts.");
    }

    /* Moving a CONFIRMED function has to answer the same question
       confirming did, or the hall quietly ends up double-booked by an
       edit rather than by a booking. */
    if (cur[0].status === "confirmed"
        && (input.startsAt || input.endsAt)) {
      const { rows: clash } = await client.query<{
        title: string; reference: string; starts_at: string; ends_at: string;
      }>(
        `select title, reference,
                app.hotel_clock($5, starts_at, 'DD Mon HH24:MI') as starts_at,
                app.hotel_clock($5, ends_at,   'DD Mon HH24:MI') as ends_at
           from app.banquet_conflicts($1, app.hotel_moment($5, $2),
                                      app.hotel_moment($5, $3), $4)`,
        [cur[0].venue_id, startsAt, endsAt, cur[0].id, hotelId]);
      if (clash[0]) {
        return refuse(
          `The hall is taken then: ${clash[0].title} (${clash[0].reference}), `
          + `${clash[0].starts_at} to ${clash[0].ends_at}.`);
      }
    }

    try {
      await client.query(
        `update banquet_events set
            agreed_amount  = case when $3::boolean then $4::numeric else agreed_amount end,
            pax_expected   = case when $5::boolean then $6::int     else pax_expected end,
            pax_guaranteed = case when $7::boolean then $8::int     else pax_guaranteed end,
            starts_at = app.hotel_moment($2, $9),
            ends_at   = app.hotel_moment($2, $10),
            notes = coalesce($11, notes),
            title = coalesce($12, title)
          where id = $1 and hotel_id = $2`,
        [cur[0].id, hotelId,
         /* "agreedAmount" present and null means CLEAR THE PRICE, which
            is a real act — a quote withdrawn. Absent means leave it
            alone. Collapsing the two would make every other edit wipe
            the price. */
         Object.hasOwn(input, "agreedAmount"), input.agreedAmount ?? null,
         Object.hasOwn(input, "pax"), input.pax ?? null,
         Object.hasOwn(input, "paxGuaranteed"), input.paxGuaranteed ?? null,
         startsAt, endsAt, input.notes ?? null, input.title?.trim() || null]);
      return { ok: true as const };
    } catch (error) {
      const e = error as { message?: string } | undefined;
      return refuse(e?.message ?? "That change was refused.");
    }
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such function." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── Catering ─────────────────────────────────────────────────────
   Optional entirely. A hall let for a meeting has no rows here and is a
   complete booking. */
banquet.post("/:code/banquet/events/:id/catering", async (c) => {
  type Body = {
    packageId?: string; name?: string; pax?: number;
    ratePerHead?: number | null; free?: boolean; notes?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const badRate = priceProblem(input.ratePerHead, input.free === true);
  if (badRate) return c.json(refuse(badRate), 409);
  if (!input.name?.trim()) return c.json(refuse("What is being served?"), 409);
  if (!Number.isInteger(input.pax) || (input.pax ?? 0) <= 0) {
    return c.json(refuse(
      "For how many? A per-head rate with no head count is not a price."), 409);
  }

  const courseName = input.name.trim();
  const pax = input.pax;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: owned } = await client.query<{ id: string; status: string }>(
      `select id::text, status from banquet_events where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    if (!owned[0]) return "missing" as const;
    if (owned[0].status === "completed") return refuse(BILLED);

    try {
      await client.query(
        `insert into banquet_event_packages
           (hotel_id, event_id, package_id, name, pax, rate_per_head, notes,
            added_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [hotelId, owned[0].id, input.packageId ?? null, courseName,
         pax,
         /* Snapshotted, and NULL if nobody has agreed a rate. Reading it
            off the package here would reprice every function the day
            somebody edits the package. */
         input.ratePerHead ?? null,
         input.notes ?? null, session.staffId]);
      return { ok: true as const };
    } catch (error) {
      const e = error as { message?: string } | undefined;
      return refuse(e?.message ?? "That course could not be added.");
    }
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such function." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

banquet.delete("/:code/banquet/events/:id/catering/:lineId", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows: billed } = await client.query(
      `select 1 from banquet_events where id = $1 and hotel_id = $2 and status = 'completed'`,
      [c.req.param("id"), hotelId]);
    if (billed[0]) return refuse(BILLED);
    const { rows } = await client.query<{ id: string }>(
      `delete from banquet_event_packages
        where id = $1 and event_id = $2 and hotel_id = $3 returning id::text`,
      [c.req.param("lineId"), c.req.param("id"), hotelId]);
    if (!rows[0]) return "missing" as const;
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such course." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});


/* ══════════════════════════════════════════════════════════════════
   THE FUNCTION'S BILL (BQ-1, QA 28 September; the owner's D27-132 to
   D27-138)

   Confirming opened a bill (a folio with event_id). These three put money
   on it and take it off, through FINANCE's doors - the same charge, the
   same payment and the same tax invoice a stay's bill goes through
   (round A's per-bill exports). Nothing here adds tax up itself.

     bill       the hall and every course, under the Banquet GST rule;
                refused while anything is unpriced, while the rule is not
                set (D27-124), or while a restaurant order on it is open.
                The function becomes 'completed': its price is fixed.
     payments   an advance before that (a payment on the bill, as a
                room's is - no GST receipt voucher until the CA answers,
                B5), or a payment after; the cash limit counts this
                function's bill, s.186's "one event"
     invoice    finance's tax invoice for the bill, to the company or the
                host, SAC 996334 with food and 997212 for a hall alone
                (D27-134, CA to confirm)
   Who: api/src/roleGate.ts (owner, admin and GM; the invoice also the
   accountant).
   ══════════════════════════════════════════════════════════════════ */

/** The tax invoice standing for a bill: issued and not credited. */
async function standingInvoice(client: Client, folioId: string): Promise<string | null> {
  const { rows } = await client.query<{ number: string }>(
    `select i.number from invoices i
      where i.folio_id = $1 and i.credits_id is null
        and not exists (select 1 from invoices c where c.credits_id = i.id)
      order by i.issued_at desc limit 1`, [folioId]);
  return rows[0]?.number ?? null;
}

type BillRow = {
  id: string; status: string; title: string; reference: string;
  agreed_amount: string | null; venue: string; folio_id: string | null;
};

/** The function, LOCKED for this transaction, with its open bill. */
async function functionForBill(client: Client, hotelId: string, id: string) {
  const { rows } = await client.query<BillRow>(
    `select e.id::text, e.status, e.title, e.reference, e.agreed_amount::text,
            v.name as venue,
            (select f.id::text from folios f
              where f.event_id = e.id and f.status = 'open') as folio_id
       from banquet_events e
       join banquet_venues v on v.id = e.venue_id
      where e.id = $1 and e.hotel_id = $2
        for update of e`, [id, hotelId]);
  return rows[0];
}

banquet.post("/:code/banquet/events/:id/bill", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const e = await functionForBill(client, hotelId, c.req.param("id"));
    if (!e) return "missing" as const;

    /* Every refusal above the first posting (MEMORY 243). */
    if (e.status === "completed") return refuse("This function is already on its bill.");
    if (e.status !== "confirmed") {
      return refuse("Only a confirmed function is billed. Confirm it first: that opens its bill.");
    }
    if (!e.folio_id) return refuse(`The bill for ${e.title} is closed.`);
    const folioId = e.folio_id;

    const { rows: total } = await client.query<{ total: string | null; unpriced: string | null }>(
      "select total::text, unpriced from app.banquet_event_total($1)", [e.id]);
    if (total[0]!.total === null) {
      return refuse(`${total[0]!.unpriced} Price it before the function is billed.`);
    }
    /* D27-124: the bill is refused until the GM sets the banquet rule. */
    const noTax = await banquetTaxWarning(client, hotelId);
    if (noTax) return refuse(noTax);

    const { rows: open } = await client.query<{ n: number }>(
      `select count(*)::int as n from pos_orders
        where event_id = $1 and hotel_id = $2 and status = 'open'`, [e.id, hotelId]);
    if (open[0]!.n > 0) {
      return refuse(open[0]!.n === 1
        ? "A restaurant order on this function is still open. Settle it to the function first."
        : `${open[0]!.n} restaurant orders on this function are still open. Settle them to the function first.`);
    }

    const { rows: courses } = await client.query<{ name: string; pax: number; rate: string }>(
      `select name, pax, rate_per_head::text as rate from banquet_event_packages
        where event_id = $1 order by created_at`, [e.id]);

    /* The hall and each course, at their agreed figures; a Free one (0)
       is not a charge and is left off. Restaurant orders are on the bill
       already - the till posts them as it settles (D27-133). */
    const lines = [
      { description: `Hall: ${e.venue} - ${e.title} (${e.reference})`,
        amount: Number(e.agreed_amount), category: "Miscellaneous" },
      ...courses.map((k) => ({
        description: `${k.name}: ${k.pax} plates at ₹${Number(k.rate)}`.slice(0, 240),
        amount: Math.round(k.pax * Number(k.rate) * 100) / 100, category: "Food",
      })),
    ].filter((l) => l.amount > 0);

    for (const line of lines) {
      const posted = await postFolioCharge(client, hotelId, folioId, {
        ...line, taxKind: "banquet",
      });
      /* Every refusal postFolioCharge has was asked above, so this cannot
         happen - and if it did, a throw rolls back the lines before it
         rather than committing half a bill (MEMORY 243). */
      if (!posted.ok) throw new Error(posted.reason);
    }

    await client.query(
      "update banquet_events set status = 'completed' where id = $1", [e.id]);
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such function." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Reopening a billed function (the owner's D27-150, D27-154) ─────
   Only while no tax invoice stands on its bill; after that, only a credit
   note corrects it. A reason is required, and a bill posted on a day the
   night audit has closed is refused. Every refusal comes before any write
   (MEMORY 243). The hall and course lines "Bill the function" posted are
   reversed through finance's one reversal, with the reason on each;
   advances, payments and settled restaurant orders stay on the bill. */
banquet.post("/:code/banquet/events/:id/reopen", async (c) => {
  const reason = ((await c.req.json().catch(() => ({}))) as { reason?: string }).reason?.trim();

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const e = await functionForBill(client, hotelId, c.req.param("id"));
    if (!e) return "missing" as const;

    if (e.status !== "completed") return refuse("Only a billed function is reopened.");
    if (!e.folio_id) return refuse(`The bill for ${e.title} is closed.`);
    const invoice = await standingInvoice(client, e.folio_id);
    if (invoice) {
      return refuse(`Tax invoice ${invoice} stands on this bill. Only a credit note corrects it now.`);
    }
    if (!reason) return refuse("Say why the bill is reopened. The reason stays on each line taken off.");

    const { rows: billed } = await client.query<{ id: string; day_closed: boolean }>(
      `select fp.id::text,
              exists (select 1 from night_audit_runs na
                       where na.hotel_id = fp.hotel_id and na.business_date = fp.business_date
                         and na.status = 'completed') as day_closed
         from folio_postings fp
        where fp.folio_id = $1 and fp.source_type is null and fp.reverses_id is null
          and fp.category not in ('payment', 'refund', 'discount', 'tax')
          and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)
        order by fp.id`, [e.folio_id]);
    if (billed.some((b) => b.day_closed)) {
      return refuse("This function was billed on a day that is closed - correct it on Closed days.");
    }

    for (const b of billed) {
      const done = await reverseFolioCharge(client, hotelId, b.id, reason, { folioId: e.folio_id });
      /* Every refusal it has was asked above; a throw rolls back the lines
         already taken off rather than committing half a reopen. */
      if (!done.ok) throw new Error(done.reason);
    }
    await client.query("update banquet_events set status = 'confirmed' where id = $1", [e.id]);
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such function." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

banquet.post("/:code/banquet/events/:id/payments", async (c) => {
  type Body = {
    method?: string; amount?: number; pan?: string; form97?: boolean; heldAsCredit?: boolean;
  };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const e = await functionForBill(client, hotelId, c.req.param("id"));
    if (!e) return "missing" as const;
    if (e.status !== "confirmed" && e.status !== "completed") {
      return refuse("Money is taken on a confirmed function's bill. Confirm it first.");
    }
    if (!e.folio_id) return refuse(`The bill for ${e.title} is closed.`);
    const folioId = e.folio_id;

    return takeFolioPayment(client, hotelId, folioId, {
      method: body.method, amount: body.amount, pan: body.pan, form97: body.form97,
      /* Before the bill, everything paid is an advance held on it (D27-137);
         after, more than the bill waits for the desk's tick (D27-4). */
      heldAsCredit: e.status === "confirmed" ? true : body.heldAsCredit,
      idempotencyKey: c.req.header("idempotency-key") ?? null,
    }, {
      locks: [`payment-event:${e.id}`],
      /* Cash already received on this function's bill: s.186's one event. */
      cashTaken: async () => Number((await client.query<{ n: string }>(
        `select coalesce(sum(p.amount), 0)::text as n
           from payments p join folio_postings fp on fp.id = p.posting_id
          where fp.folio_id = $1 and p.method = 'cash'
            and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)`,
        [folioId])).rows[0]!.n),
      foreign: false,
    });
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such function." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

banquet.post("/:code/banquet/events/:id/invoice", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      status: string; host_name: string; company: string | null;
      company_gstin: string | null; company_address: string | null;
      folio_id: string | null; food: boolean;
    }>(
      `select e.status, e.host_name, co.name as company, co.gstin as company_gstin,
              nullif(concat_ws(', ', nullif(co.address_line, ''), nullif(co.city, '')), '')
                as company_address,
              f.id::text as folio_id,
              exists (select 1 from banquet_event_packages p where p.event_id = e.id)
              or exists (select 1 from folio_postings fp
                          where fp.folio_id = f.id and fp.source_type = 'pos') as food
         from banquet_events e
         left join companies co on co.id = e.company_id
         left join lateral (select id from folios where event_id = e.id
                             order by opened_at desc limit 1) f on true
        where e.id = $1 and e.hotel_id = $2`, [c.req.param("id"), hotelId]);
    const e = rows[0];
    if (!e) return "missing" as const;
    if (e.status !== "completed" || !e.folio_id) {
      return refuse("Bill the function first: the tax invoice is made from its bill.");
    }
    /* D27-134: catering at a function 996334; a hall with no food 997212
       (CA to confirm). */
    return issueFolioInvoice(client, hotelId, e.folio_id,
      e.company
        ? { name: e.company, gstin: e.company_gstin, address: e.company_address }
        : { name: e.host_name, gstin: null, address: null },
      e.food ? "996334" : "997212");
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such function." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── The halls, and the packages ──────────────────────────────────── */
banquet.get("/:code/banquet/setup", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: venues } = await client.query<{
      id: string; name: string; seated: number | null; floating: number | null;
      rate: string | null; is_active: boolean; notes: string | null;
    }>(
      `select id::text, name, seated_capacity as seated,
              floating_capacity as floating, default_rate::text as rate,
              is_active, notes
         from banquet_venues where hotel_id = $1
        order by sort_order, name`, [hotelId]);

    const { rows: packages } = await client.query<{
      id: string; name: string; description: string | null;
      rate: string | null; meal_type: string | null; is_active: boolean;
    }>(
      `select id::text, name, description, rate_per_head::text as rate,
              meal_type, is_active
         from banquet_packages where hotel_id = $1
        order by sort_order, name`, [hotelId]);

    return {
      venues: venues.map((v) => ({
        id: v.id, name: v.name, seated: v.seated, floating: v.floating,
        /* A dash on the screen, not a zero. Nothing here ships a price. */
        defaultRate: v.rate === null ? null : Number(v.rate),
        isActive: v.is_active, notes: v.notes,
      })),
      packages: packages.map((p) => ({
        id: p.id, name: p.name, description: p.description,
        ratePerHead: p.rate === null ? null : Number(p.rate),
        mealType: p.meal_type, isActive: p.is_active,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

banquet.post("/:code/banquet/venues", async (c) => {
  type Body = {
    name?: string; seated?: number | null; floating?: number | null;
    defaultRate?: number | null; free?: boolean; notes?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const badRate = priceProblem(input.defaultRate, input.free === true);
  if (badRate) return c.json(refuse(badRate), 409);
  if (!input.name?.trim()) return c.json(refuse("What is the hall called?"), 409);
  const venueName = input.name.trim();

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into banquet_venues
           (hotel_id, name, seated_capacity, floating_capacity, default_rate,
            notes)
         values ($1,$2,$3,$4,$5,$6) returning id::text`,
        [hotelId, venueName, input.seated ?? null,
         input.floating ?? null, input.defaultRate ?? null,
         input.notes ?? null]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      if (e?.code === "23505") {
        return refuse("There is already a hall with that name here.");
      }
      return refuse(e?.message ?? "That hall could not be added.");
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

banquet.patch("/:code/banquet/venues/:id", async (c) => {
  type Body = {
    name?: string; seated?: number | null; floating?: number | null;
    defaultRate?: number | null; free?: boolean; isActive?: boolean; notes?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const badRate = priceProblem(input.defaultRate, input.free === true);
  if (badRate) return c.json(refuse(badRate), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ id: string }>(
      `update banquet_venues set
          name = coalesce($3, name),
          seated_capacity   = case when $4::boolean then $5::int else seated_capacity end,
          floating_capacity = case when $6::boolean then $7::int else floating_capacity end,
          default_rate      = case when $8::boolean then $9::numeric else default_rate end,
          is_active = coalesce($10, is_active),
          notes = coalesce($11, notes)
        where id = $1 and hotel_id = $2 returning id::text`,
      [c.req.param("id"), hotelId, input.name?.trim() || null,
       Object.hasOwn(input, "seated"), input.seated ?? null,
       Object.hasOwn(input, "floating"), input.floating ?? null,
       /* Clearing a default rate is a real act: the property decided not
          to publish one. Present-and-null means clear, absent means leave. */
       Object.hasOwn(input, "defaultRate"), input.defaultRate ?? null,
       input.isActive ?? null, input.notes ?? null]);
    if (!rows[0]) return "missing" as const;
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such hall." }, 404);
  return c.json(result);
});

banquet.post("/:code/banquet/packages", async (c) => {
  type Body = {
    name?: string; description?: string; ratePerHead?: number | null;
    free?: boolean; mealType?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const badRate = priceProblem(input.ratePerHead, input.free === true);
  if (badRate) return c.json(refuse(badRate), 409);
  if (!input.name?.trim()) {
    return c.json(refuse("What is the package called?"), 409);
  }
  const packageName = input.name.trim();

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into banquet_packages
           (hotel_id, name, description, rate_per_head, meal_type)
         values ($1,$2,$3,$4,$5) returning id::text`,
        [hotelId, packageName, input.description ?? null,
         input.ratePerHead ?? null, input.mealType ?? null]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      if (e?.code === "23505") {
        return refuse("There is already a package with that name here.");
      }
      return refuse(e?.message ?? "That package could not be added.");
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
