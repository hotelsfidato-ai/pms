import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   BOOKING SOURCES — the list is the group's, the rate is the hotel's

   Every path here is under `/:code`, and that is about where the user
   is standing rather than what the row belongs to. Adding "Agoda"
   adds it for the whole group; setting 18% against Agoda sets it for
   this property only. The screen says so in as many words, because a
   path that reads `/h/AKK/booking-sources` invites the opposite
   assumption.

   NO COMMISSION IS INVENTED HERE. A source with no rate against this
   property returns `commissionPct: null` and the screen renders a
   dash. Zero would say "this booking cost us nothing", which is a
   claim about money nobody at the hotel has made — the same rule that
   keeps `base_rate` NULL on a new room type.

   WHO MAY CHANGE WHAT is the database's answer, not this file's.
   `booking_sources` carries an insert policy of `app.is_manager()`,
   so a clerk's INSERT is refused by Postgres whether or not anything
   here checks. What this file adds is the READABLE refusal: an RLS
   violation reaching the browser as a 500 tells a manager nothing.
   ══════════════════════════════════════════════════════════════════ */

export const bookingSources = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

const KINDS = ["ota", "direct", "corporate", "travel_agent",
               "walk_in", "other"] as const;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

type Row = {
  id: string; name: string; kind: string;
  channel_code: string | null; is_active: boolean;
  commission_pct: string | null; bookings: string;
};

/* ⚠ THE LEFT JOIN IS THE WHOLE POINT. A source this property has never
   agreed a rate with has NO row in booking_source_rates, and an inner
   join would drop it off the list — the sources you have not dealt
   with yet are exactly the ones a manager is looking for.

   One source when $2 is given, all of them when it is null. One query
   with a predicate rather than two queries, because two queries is two
   places for the shape of a row to drift apart. */
const LIST = `
  select bs.id::text, bs.name, bs.kind, bs.channel_code, bs.is_active,
         r.commission_pct::text as commission_pct,
         (select count(*) from reservations res
           where res.hotel_id = $1 and res.booking_source_id = bs.id)::text
           as bookings
    from booking_sources bs
    left join booking_source_rates r
           on r.booking_source_id = bs.id and r.hotel_id = $1
   where $2::uuid is null or bs.id = $2::uuid
   order by bs.is_active desc, lower(bs.name)`;

const shape = (r: Row) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  channelCode: r.channel_code,
  isActive: r.is_active,
  /* NULL travels as null all the way to the screen. Converting it to 0
     here would be the defect this whole file is careful about, one
     layer further in where nobody would look for it. */
  commissionPct: r.commission_pct === null ? null : Number(r.commission_pct),
  bookings: Number(r.bookings),
});

bookingSources.get("/:code/booking-sources", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<Row>(LIST, [hotelId, null]);
    return rows.map(shape);
  });
  return body === null ? c.json({ error: "No such property" }, 404) : c.json(body);
});

bookingSources.post("/:code/booking-sources", async (c) => {
  type Body = { name?: string; kind?: string; channelCode?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const name = input.name?.trim();
  if (!name) return c.json(refuse("What is the source called?"), 409);
  if (!input.kind || !KINDS.includes(input.kind as typeof KINDS[number])) {
    return c.json(refuse(
      "What kind of source is it? An OTA, a travel agent, a corporate "
      + "account, the property's own site, or a walk-in."), 409);
  }
  /* Blank stays NULL, never "". An empty channel code would collide
     with the next empty one under the unique index and refuse a second
     source for a reason nobody could read. */
  const channelCode = input.channelCode?.trim() || null;

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    try {
      /* ⚠ RETURNING, NOT A CTE READ BACK. The first version wrapped
         the insert in a `with` and selected from `booking_sources`
         outside it — and a data-modifying CTE's rows are NOT visible
         to the same statement's outer query. It found nothing, shaped
         `undefined`, and every create answered 500. Defect 220.

         `hotelId` is still resolved above, because a POST to a
         property that does not exist has to 404 rather than quietly
         add a group-wide row. */
      void hotelId;
      const { rows } = await client.query<Row>(
        `insert into booking_sources (name, kind, channel_code)
         values ($1, $2, $3)
         returning id::text, name, kind, channel_code, is_active,
                   null::text as commission_pct, '0'::text as bookings`,
        [name, input.kind, channelCode]);
      return { ok: true as const, source: shape(rows[0]!) };
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === "23505") {
        return refuse(
          err.constraint === "booking_sources_channel_code_unique"
            ? `Another source already uses the code ${channelCode}. A `
              + "channel manager sending it would not know which you meant."
            : `${name} is already on the list.`);
      }
      /* 42501 is Postgres refusing the INSERT under the manager-only
         policy. Rule 6: the block is shown WITH its reason, and the
         reason is not "500". */
      if (err.code === "42501") {
        return refuse(
          "Adding a booking source is a manager's change — it applies to "
          + "every property in the group.");
      }
      throw e;
    }
  });
  if (result === null) return c.json({ error: "No such property" }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

bookingSources.patch("/:code/booking-sources/:id", async (c) => {
  type Body = {
    name?: string; kind?: string; channelCode?: string | null;
    isActive?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (input.kind && !KINDS.includes(input.kind as typeof KINDS[number])) {
    return c.json(refuse("That is not a kind of booking source."), 409);
  }
  if (input.name !== undefined && !input.name.trim()) {
    return c.json(refuse("A source with no name cannot be picked."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    try {
      /* coalesce, so an absent field is left alone rather than nulled.
         `channelCode` is the exception: it is the one field a manager
         may deliberately CLEAR, so an explicit null has to survive —
         hence the separate flag rather than a clever sentinel.

         ⚠ TWO STATEMENTS, NOT ONE WITH A CTE. Reading the row back
         inside the same statement returns it as it was BEFORE the
         update — the outer query runs against the snapshot the
         statement started with. That is defect 202 exactly, and it
         reappeared here in a different shape on the same afternoon:
         the rename returned the old name and the test caught it.
         Separate statements inside one transaction see each other. */
      const { rows: changed } = await client.query<{ id: string }>(
        `update booking_sources
            set name         = coalesce($1, name),
                kind         = coalesce($2, kind),
                channel_code = case when $3 then nullif(trim($4), '')
                                    else channel_code end,
                is_active    = coalesce($5, is_active)
          where id = $6
          returning id::text`,
        [input.name?.trim() ?? null, input.kind ?? null,
         input.channelCode !== undefined, input.channelCode ?? "",
         input.isActive ?? null, c.req.param("id")]);
      if (!changed[0]) return refuse("That source is not on the list.");

      const { rows } = await client.query<Row>(LIST,
        [hotelId, c.req.param("id")]);
      if (!rows[0]) return refuse("That source is not on the list.");
      return { ok: true as const, source: shape(rows[0]) };
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "23505") {
        return refuse("Another source already uses that name or code.");
      }
      if (err.code === "42501") {
        return refuse(
          "Changing a booking source is a manager's change — it applies to "
          + "every property in the group.");
      }
      throw e;
    }
  });
  if (result === null) return c.json({ error: "No such property" }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── This property's commission ───────────────────────────────────── */

bookingSources.put("/:code/booking-sources/:id/commission", async (c) => {
  type Body = { commissionPct?: number | null };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const pct = input.commissionPct;
  /* ⚠ NULL IS A REAL ANSWER AND NOT THE SAME AS ZERO. Clearing the box
     means "no rate agreed" and the screen goes back to a dash. Typing
     0 means "we agreed we pay them nothing", which is a different
     statement and one a manager is allowed to make. */
  if (pct !== null && pct !== undefined) {
    if (typeof pct !== "number" || !Number.isFinite(pct)) {
      return c.json(refuse("A percentage, or leave it blank."), 409);
    }
    if (pct < 0 || pct > 100) {
      return c.json(refuse("A commission is between 0 and 100 per cent."), 409);
    }
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: known } = await client.query(
      "select 1 from booking_sources where id = $1", [c.req.param("id")]);
    if (!known[0]) return refuse("That source is not on the list.");

    await client.query(
      `insert into booking_source_rates
         (hotel_id, booking_source_id, commission_pct)
       values ($1, $2, $3)
       on conflict (hotel_id, booking_source_id)
       do update set commission_pct = excluded.commission_pct,
                     updated_at = now()`,
      [hotelId, c.req.param("id"), pct ?? null]);

    const { rows } = await client.query<Row>(LIST, [hotelId, c.req.param("id")]);
    return { ok: true as const, source: shape(rows[0]!) };
  });
  if (result === null) return c.json({ error: "No such property" }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
