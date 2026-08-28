import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   DIRECTORY — guests, companies, staff, and the audit trail

   A guest is grouped by NAME, which is what the interface has always
   done and what the data supports. `guests` has a row per booking
   because a walk-in has no record to look up, so two visits by one
   person are two rows until somebody merges them — and the merge rules
   are not decided.

   Duplicates are SHOWN, not merged. The signal is stays that OVERLAP:
   one person cannot be in two rooms on the same night, so either these
   are two people sharing a name or something was entered twice. A
   guest who simply booked through Agoda once and walked in the next
   month is not flagged — a warning that fires on half the list is a
   warning nobody reads.
   ══════════════════════════════════════════════════════════════════ */

export const directory = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

const SOURCE_LABEL = `case r.source
    when 'walk_in' then 'Walk-in'
    when 'direct'  then 'Fidato Hotels'
    else initcap(r.source)
  end`;

const LIVE = `
  fp.reverses_id is null
  and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
`;

/* ── Guests ──────────────────────────────────────────────────────── */

directory.get("/:code/guests", async (c) => {
  const asOn = c.req.query("asOn") ?? "2026-08-25";

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; name: string; stays: string; nights: string;
      last_stay: string | null; next_stay: string | null;
      total_spend: string; open_balance: string;
      sources: string[]; overlapping: boolean;
    }>(
      `with mine as (
         select r.*, g.full_name, lower(trim(g.full_name)) as key,
                coalesce(co.name, ${SOURCE_LABEL}) as source_label
           from reservations r
           join guests g on g.id = r.guest_id
           left join companies co on co.id = r.company_id
          where r.hotel_id = $1
       ),
       spend as (
         select f.reservation_id, sum(fp.amount + fp.tax_amount) as amount
           from folio_postings fp
           join folios f on f.id = fp.folio_id
          where fp.hotel_id = $1 and ${LIVE}
          group by f.reservation_id
       ),
       charges as (
         select f.reservation_id, sum(fp.amount + fp.tax_amount) as amount
           from folio_postings fp
           join folios f on f.id = fp.folio_id
          where fp.hotel_id = $1 and ${LIVE} and fp.category <> 'payment'
          group by f.reservation_id
       ),
       /* One person cannot be in two rooms on the same night. Any pair
          of live stays under one name whose date ranges intersect is
          worth a look before anyone merges them. */
       /* Named overlapping_names, not the obvious word: OVERLAPS is a
          reserved operator in Postgres and fails with a bare syntax
          error naming the word rather than the reason. */
       overlapping_names as (
         select distinct a.key
           from mine a
           join mine b
             on b.key = a.key
            and b.id <> a.id
            and a.status not in ('cancelled','no_show')
            and b.status not in ('cancelled','no_show')
            and a.check_in < greatest(b.check_out, b.check_in + 1)
            and b.check_in < greatest(a.check_out, a.check_in + 1)
       )
       select m.key                                             as id,
              min(m.full_name)                                  as name,
              count(*)::text                                    as stays,
              sum(greatest(m.check_out - m.check_in, 0))::text  as nights,
              max(m.check_out) filter (where m.check_out <= $2::date)::text as last_stay,
              min(m.check_in)  filter (where m.check_in  >  $2::date
                                         and m.status <> 'cancelled')::text as next_stay,
              coalesce(sum(charges.amount), 0)::text            as total_spend,
              coalesce(sum(spend.amount), 0)::text              as open_balance,
              array_agg(distinct m.source_label)                as sources,
              bool_or(o.key is not null)                        as overlapping
         from mine m
         left join spend   on spend.reservation_id   = m.id
         left join charges on charges.reservation_id = m.id
         left join overlapping_names o on o.key = m.key
        group by m.key
        order by count(*) desc, min(m.full_name)`,
      [hotelId, asOn],
    );

    const round = (n: number) => Math.round(n * 100) / 100;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      stays: Number(r.stays),
      nights: Number(r.nights),
      lastStay: r.last_stay,
      nextStay: r.next_stay,
      totalSpend: round(Number(r.total_spend)),
      openBalance: round(Number(r.open_balance)),
      sources: r.sources,
      possibleDuplicate: r.overlapping,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Companies ───────────────────────────────────────────────────── */

const OTA = ["Agoda", "Booking.com", "Expedia", "go-MMT"];
const DIRECT = ["Walk-in", "Fidato Hotels"];

directory.get("/:code/companies", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      name: string; bookings: string; room_nights: string;
      revenue: string; open_balance: string;
    }>(
      `with mine as (
         select r.*, coalesce(co.name, ${SOURCE_LABEL}) as account
           from reservations r
           left join companies co on co.id = r.company_id
          where r.hotel_id = $1
       ),
       money as (
         select f.reservation_id,
                sum(fp.amount + fp.tax_amount) as balance,
                sum(fp.amount + fp.tax_amount)
                  filter (where fp.category <> 'payment') as charged
           from folio_postings fp
           join folios f on f.id = fp.folio_id
          where fp.hotel_id = $1 and ${LIVE}
          group by f.reservation_id
       )
       select m.account                                        as name,
              count(*)::text                                   as bookings,
              sum(greatest(m.check_out - m.check_in, 0))::text  as room_nights,
              coalesce(sum(money.charged), 0)::text            as revenue,
              coalesce(sum(money.balance), 0)::text            as open_balance
         from mine m
         left join money on money.reservation_id = m.id
        group by m.account
        order by coalesce(sum(money.charged), 0) desc`,
      [hotelId],
    );

    const round = (n: number) => Math.round(n * 100) / 100;

    return rows.map((r) => ({
      id: r.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: r.name,
      kind: OTA.includes(r.name) ? "OTA" : DIRECT.includes(r.name) ? "Direct" : "Corporate",
      bookings: Number(r.bookings),
      roomNights: Number(r.room_nights),
      revenue: round(Number(r.revenue)),
      openBalance: round(Number(r.open_balance)),
      /* Charged outside this system today. A dash, not a zero. */
      commissionPct: null,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Room types and rate plans ───────────────────────────────────── */

directory.get("/:code/room-types", async (c) => {
  const asOn = c.req.query("asOn") ?? "2026-08-25";

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      type: string; rooms: string; sellable: string;
      max_occupancy: number; rack_rate: string; numbers: string[];
    }>(
      `select rt.name                                   as type,
              count(rm.id)::text                        as rooms,
              count(rm.id) filter (where not exists (
                select 1 from room_blocks b
                 where b.room_id = rm.id
                   and $2::date >= b.from_date
                   and (b.to_date is null or $2::date <= b.to_date)
              ))::text                                  as sellable,
              rt.max_occupancy,
              rt.base_rate                              as rack_rate,
              array_agg(rm.number order by rm.number)   as numbers
         from room_types rt
         join rooms rm on rm.room_type_id = rt.id and rm.is_active
        where rt.hotel_id = $1 and rt.is_active
        group by rt.id, rt.name, rt.max_occupancy, rt.base_rate, rt.sort_order
        order by rt.sort_order, rt.name`,
      [hotelId, asOn],
    );

    return rows.map((r) => ({
      type: r.type,
      rooms: Number(r.rooms),
      sellable: Number(r.sellable),
      maxOccupancy: r.max_occupancy,
      rackRate: Number(r.rack_rate),
      numbers: r.numbers,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

directory.get("/rate-plans", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{
      code: string; name: string; includes: string;
    }>("select code, name, includes from meal_plans order by code");

    /* Where the live eZee system shows each plan. Presentation, not
       schema — the export prints "Deluxe CP", room type and meal plan
       together, and only two of these appear in it at all. */
    const SEEN: Record<string, string> = { CP: "Deluxe CP", RO: "Room Only" };

    return rows.map((r) => ({
      code: r.code === "RO" ? "Room Only" : r.code,
      name: r.name,
      includes: r.includes,
      seenAs: SEEN[r.code] ?? null,
    }));
  });

  return c.json(body ?? []);
});

/* ── Staff and access ────────────────────────────────────────────── */

directory.get("/:code/staff", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Readable only by a group admin — `staff_hotels_admin`, migration
       020. A clerk sees their own row and nothing else, which is why
       this list is short or empty for them rather than an error. */
    const { rows } = await client.query<{
      staff_id: string; role: string; hotel_name: string;
    }>(
      `select sh.staff_id, sh.role, h.name as hotel_name
         from staff_hotels sh
         join hotels h on h.id = sh.hotel_id
        order by h.name, sh.role`,
    );

    return rows.map((r) => ({
      staffId: r.staff_id,
      role: r.role,
      property: r.hotel_name,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Audit log ───────────────────────────────────────────────────── */

directory.get("/:code/audit-log", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The ledger IS the audit trail for money. It is append-only, so
       every posting and every reversal is already a permanent record —
       nothing is stored twice to produce this. */
    const { rows } = await client.query<{
      id: string; at: string; business_date: string; category: string;
      description: string; guest: string; room: string | null;
      reverses_id: string | null;
    }>(
      `select fp.id::text, fp.created_at::text as at,
              fp.business_date::text, fp.category, fp.description,
              g.full_name as guest,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id
                order by ra.released_at nulls first, ra.from_date desc
                limit 1) as room,
              fp.reverses_id::text
         from folio_postings fp
         join folios f       on f.id = fp.folio_id
         join reservations r on r.id = f.reservation_id
         join guests g       on g.id = r.guest_id
        where fp.hotel_id = $1
        order by fp.created_at desc, fp.id desc
        limit 500`,
      [hotelId],
    );

    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      businessDate: r.business_date,
      actor: "admin",
      action: r.reverses_id
        ? "Reversed a posting"
        : r.category === "payment"
          ? "Took a payment"
          : "Posted a charge",
      subject: `${r.guest}${r.room ? ` · room ${r.room}` : ""}`,
      detail: r.description,
      kind: r.reverses_id ? "reversal" : r.category === "payment" ? "payment" : "charge",
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Settings ────────────────────────────────────────────────────── */

directory.get("/:code/settings", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      name: string; address_line: string | null; city: string;
      gstin: string | null; currency: string; timezone: string;
      check_in: string; check_out: string;
      cgst_rate: string; sgst_rate: string;
      sellable: string; room_types: string[]; plans: string[];
    }>(
      `select h.name, h.address_line, h.city, h.gstin, h.currency, h.timezone,
              to_char(h.check_in_time,  'HH24:MI') as check_in,
              to_char(h.check_out_time, 'HH24:MI') as check_out,
              h.cgst_rate, h.sgst_rate,
              (select count(*) from rooms r
                where r.hotel_id = h.id and r.is_active
                  and r.housekeeping_status <> 'out_of_service')::text as sellable,
              (select array_agg(rt.name order by rt.sort_order)
                 from room_types rt where rt.hotel_id = h.id and rt.is_active) as room_types,
              (select array_agg(mp.code order by mp.code) from meal_plans mp)  as plans
         from hotels h where h.id = $1`,
      [hotelId],
    );

    const h = rows[0];
    if (!h) return null;

    return [
      {
        title: "Property",
        rows: [
          { label: "Name", value: h.name },
          { label: "Address", value: h.address_line ?? h.city },
          { label: "GSTIN", value: `${h.gstin ?? "—"} — demo, not a real GSTIN` },
          { label: "Currency", value: h.currency },
          { label: "Time zone", value: h.timezone },
        ],
      },
      {
        title: "Operations",
        rows: [
          { label: "Check-in", value: h.check_in },
          { label: "Check-out", value: h.check_out },
          { label: "Sellable rooms", value: h.sellable },
          { label: "Room types", value: (h.room_types ?? []).join(" · ") },
          { label: "Rate plans", value: (h.plans ?? []).join(" · ") },
        ],
      },
      {
        title: "Tax and billing",
        note:
          "Rates are fixed by statute. Changing them is an administrative act, " +
          "not a preference — they become editable at Stage 8.",
        rows: [
          { label: "CGST", value: `${Number(h.cgst_rate)}%`, editableAt: "Stage 8" },
          { label: "SGST", value: `${Number(h.sgst_rate)}%`, editableAt: "Stage 8" },
          { label: "Financial year starts", value: "1 April" },
        ],
      },
    ];
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
