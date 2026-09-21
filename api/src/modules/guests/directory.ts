import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   DIRECTORY — guests and companies

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

/* Split by service on 15 September (docs/SERVICE-FOLDERS-PLAN.md); this
   is the guests half. Staff, the audit log and settings are in
   modules/admin/adminLists.ts, the room-type and rate-plan lists in
   modules/inventory/roomTypesAndPlans.ts. No endpoint changed. */

export const directory = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/* ⚠ THIS WAS THE THIRD OF FIVE COPIES of "what do we call where the
   booking came from". They disagreed — see the note in stays.ts. The
   rule is now `app.booking_source_label`, written once in 082, and
   what is left here is only the JOIN it needs. */
const SOURCE_LABEL = "app.booking_source_label(bs.name, co.name, r.source)";
const SOURCE_JOIN =
  "left join booking_sources bs on bs.id = r.booking_source_id";

const LIVE = `
  fp.reverses_id is null
  and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
`;

/* ── Guests ──────────────────────────────────────────────────────── */

directory.get("/:code/guests", async (c) => {
  const asOnParam = c.req.query("asOn");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const asOn = asOnParam ?? bd;

    const { rows } = await client.query<{
      id: string; name: string; stays: string; nights: string;
      last_stay: string | null; next_stay: string | null;
      total_spend: string; open_balance: string;
      sources: string[]; overlapping: boolean;
    }>(
      `with mine as (
         select r.*, g.full_name, lower(trim(g.full_name)) as key,
                ${SOURCE_LABEL} as source_label
           from reservations r
           join guests g on g.id = r.guest_id
           left join companies co on co.id = r.company_id
           ${SOURCE_JOIN}
          where r.hotel_id = $1
       ),
       spend as (
         select f.reservation_id, sum(fp.amount + fp.tax_amount) as amount
           from folio_postings fp
           join folios f on f.id = fp.folio_id
          where fp.hotel_id = $1 and ${LIVE}
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
              /* ONE DEFINITION OF WHAT A STAY WAS CHARGED, shared with Guest
                 360 (the owner, 21 September): app.stay_charged, migration
                 "one guest, one record". Its body is the CTE that stood here. */
              coalesce(sum(app.stay_charged(m.id)), 0)::text   as total_spend,
              coalesce(sum(spend.amount), 0)::text              as open_balance,
              array_agg(distinct m.source_label)                as sources,
              bool_or(o.key is not null)                        as overlapping
         from mine m
         left join spend   on spend.reservation_id   = m.id
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

/* ── Marking a guest ───────────────────────────────────────────────
   `guests.is_vip` has been read by the stay panel since 043 and written by
   NOTHING — half a feature, with the visible half being the wrong half: a
   clerk could see the mark and never make one.

   IT TRAVELS WITH THE GUEST, not the booking. Somebody who is a VIP this
   visit was one last visit, which is the whole reason the column is on
   `guests` and not on `reservations`. */
directory.post("/:code/guests/:id/vip", async (c) => {
  const input = await c.req.json<{ isVip?: boolean }>()
    .catch(() => ({}) as { isVip?: boolean });
  const isVip = input.isVip === true;

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* A guest carries no hotel_id — they belong to the group, so a returning
       one does not re-present their passport at another property. The scope
       check is therefore "has this guest ever stayed with us", which RLS
       already answers through `reservations`. */
    const { rows } = await client.query<{ name: string }>(
      `update guests set is_vip = $1
        where id = $2
          and exists (select 1 from reservations r
                       where r.guest_id = guests.id and r.hotel_id = $3)
       returning full_name as name`,
      [isVip, c.req.param("id"), hotelId],
    );
    if (!rows[0]) {
      return { ok: false as const,
               reason: "That guest has never stayed here." };
    }

    return { ok: true as const, guest: rows[0].name, isVip };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

directory.get("/:code/companies", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      name: string; bookings: string; room_nights: string;
      revenue: string; open_balance: string;
    }>(
      `with mine as (
         select r.*, ${SOURCE_LABEL} as account
           from reservations r
           left join companies co on co.id = r.company_id
           ${SOURCE_JOIN}
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
