import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   STAYS — a reservation joined to the room it is in

   The interface reads a flat `Stay` with a `roomNumber` on it. The
   database has no such column: migration 011 removed
   `reservations.room_id` and replaced it with `room_assignments`,
   because one column holds one room and a guest who moves mid-stay
   needs two.

   So `roomNumber` is a JOIN, and it is the join CP9 exists to get
   right. It takes the assignment that has not been released — a
   cancelled booking releases its room, and without that a cancelled
   stay would keep showing in a room it no longer holds.

   `due-out` is derived here and stored nowhere. It is `checked_in`
   AND departing on the business date — a view of today, not a fact
   about the booking. Storing it would need a nightly job to keep true
   and would be wrong between midnight and that job.
   ══════════════════════════════════════════════════════════════════ */

export const stays = new Hono<{ Variables: { subject: string } }>();

/* ⚠ THE FIFTH COPY OF THE SOURCE LABEL WAS HERE, AND IT WAS THE WRONG
   ONE. It read:

       walk_in: "Walk-in", direct: "Fidato Hotels",
       ota: "Agoda", corporate: "Fidato Hotels",

   with `?? "Walk-in"` behind it — so EVERY OTA booking read "Agoda"
   whichever OTA it was, and anything the map did not recognise read
   "Walk-in". `groups.ts` writes the chosen source's name into that
   column and sets no company, so a booking taken through the booking
   screen for Tata Motors appeared on the stay list as a walk-in. The
   four SQL copies elsewhere fell back to `initcap(source)` and got it
   right; this one did not, and nothing compared them.

   The rule now lives in `app.booking_source_label` (082) and the query
   below asks for it. Defect 219. */

interface StayRow {
  id: string;
  reference: string;
  group_reference: string | null;
  guest: string;
  room_number: string | null;
  room_type: string;
  /** The room's own type, only when it is not the type booked (D27-328). */
  given_room_type: string | null;
  source: string | null;
  meal_plan: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  status: string;
  is_day_use: boolean;
  agreed_rate: string;
  /** NULL when the room type has no rate yet (032). */
  base_rate: string | null;
  is_complimentary: boolean;
  notes: string | null;
  phone: string | null;
  email: string | null;
  /** NOT NULL, default 'IN' — present on every guest. */
  nationality: string;
  group_id: string | null;
  group_name: string | null;
  group_rooms: string | null;
  is_vip: boolean;
  vip_level: string | null;
  guest_id: string;
  is_single_lady: boolean;
  business_source: string | null;
  market_segment: string | null;
  sales_person: string | null;
  void_reason: string | null;
  guest_company_name: string | null;
  guest_company_gstin: string | null;
  guest_company_address: string | null;
}

const SELECT = `
  /* THE RACK IS TODAY'S NORMAL PRICE (EP): a base where there is one
     (D27-188, 162), else the old rack rate - app.price_for, as the property
     page and the night-audit report read it; once per room type, not per stay.
     MATERIALIZED, or it is not (D27-387, the load test): left to the planner it
     was folded into the join and priced again for every booking, 8,672 times
     and 22 s at a hotel three years in, behind every list of bookings. */
  with rack as materialized (
    select rt.id, (select p.price from app.price_for(rt.id, 'EP', app.business_date($1)) p) as price
      from room_types rt where rt.hotel_id = $1)
  select r.id,
         r.reference,
         /* A group member's own reference is the group's plus its room.
            The guest was quoted the GROUP's, so that is what shows. */
         g.block_code                              as group_reference,
         gu.full_name                              as guest,
         rm.number                                 as room_number,
         rt.name                                   as room_type,
         rm.given_type                             as given_room_type,
         app.booking_source_label(bs.name, co.name, r.source) as source,
         r.meal_plan,
         r.check_in::text, r.check_out::text,
         r.adults, r.children, r.status, r.is_day_use,
         r.agreed_rate, rack.price::text as base_rate, r.is_complimentary,
         r.notes, r.group_id,
         /* THE GROUP'S NAME AND SIZE, so a stay panel can say "one of
            nine rooms in the Kulkarni wedding" instead of showing a
            booking that looks like every other booking. The join for
            this has been here since 056 and selected nothing from it - 
            the relationship was available and thrown away at the last
            step. */
         g.name as group_name,
         (select count(*) from reservations sib
           where sib.group_id = r.group_id
             and sib.status not in ('void', 'cancelled'))::text
           as group_rooms,
         /* The marks that change what a clerk DOES. VIP travels with the
            GUEST - somebody who is one this visit was one last visit - 
            and the single-lady flag sits on the RESERVATION, because the
            same person travelling with family is a different allocation. */
         gu.is_vip, (select vl.label from vip_levels vl where vl.id = gu.vip_level_id) as vip_level,
         gu.id::text as guest_id, r.is_single_lady,
         r.business_source, r.market_segment, r.sales_person,
         r.void_reason,
         /* The guest's own company (D27-371), for the tax invoice. */
         r.guest_company_name, r.guest_company_gstin, r.guest_company_address,
         /* How to reach the guest, for the stay panel's header. The
            booking form has captured these since it was written and no
            screen that shows a stay ever asked for them. */
         gu.phone, gu.email::text as email, gu.nationality
    from reservations r
    join guests gu     on gu.id = r.guest_id
    join room_types rt on rt.id = r.room_type_id
    left join rack           on rack.id = r.room_type_id
    left join companies co          on co.id = r.company_id
    left join booking_sources bs    on bs.id = r.booking_source_id
    left join reservation_groups g  on g.id  = r.group_id
    /* Which room this stay is IN, or was in.

       Filtering to released_at is null was wrong: a check-out releases
       the room, so 60 of the 83 stays came back with no room number at
       all -- and the Folios and Invoices screens print "room 202" for
       exactly those departed stays.

       This takes ONE assignment per reservation, preferring the one
       still held and then the most recent. That is also what a room
       MOVE needs: two assignments, and the current one wins.

       Except for a booking still to arrive (FD-17): one taken out of the
       room it was given ahead holds no room, and showed the released one -
       on the Rooms tile, on the Calendar, in its panel. Every other status
       keeps the room it had, as before.

       (No backticks in here. This whole string is a JS template
       literal, and one would end it.) */
    left join lateral (
      select rm2.number,
             /* An upgrade: the room's type, when it is not the booked one. */
             case when rm2.room_type_id <> r.room_type_id then rt2.name end as given_type
        from room_assignments ra2
        join rooms rm2 on rm2.id = ra2.room_id
        join room_types rt2 on rt2.id = rm2.room_type_id
       where ra2.reservation_id = r.id
         and (ra2.released_at is null or r.status <> 'confirmed')
       order by ra2.released_at desc nulls first, ra2.from_date desc
       limit 1
    ) rm on true
   where r.hotel_id = $1
`;

/** The shape every screen in this project already reads. */
function toStay(row: StayRow, hotelCode: string, businessDate: string) {
  /* `due-out` exists only in the interface, and only for today. */
  const status =
    row.status === "checked_in" && row.check_out === businessDate
      ? "due-out"
      : row.status === "checked_in"
        ? "in-house"
        : row.status === "confirmed"
          ? "due-in"
          : row.status.replace("_", "-");

  const nights = row.is_day_use
    ? 0
    : Math.round(
        (Date.parse(`${row.check_out}T00:00:00Z`) -
          Date.parse(`${row.check_in}T00:00:00Z`)) / 86_400_000,
      );

  return {
    id: row.id,
    hotelId: hotelCode,
    reference: row.group_reference ?? row.reference,
    guest: row.guest,
    /* An unassigned booking has no room yet — a reservation is for a
       room TYPE and a stay is in a specific ROOM. */
    roomNumber: row.room_number ?? "",
    roomType: row.room_type,
    /* The room's own type when it is not the type booked (D27-328): the
       panel said "302 · Superior" for a Deluxe room. */
    ...(row.given_room_type ? { givenRoomType: row.given_room_type } : {}),
    /* NULL when nothing on the booking says where it came from. The
       screen shows a dash; it does not guess a walk-in. */
    source: row.source,
    ratePlan: row.meal_plan === "RO" ? "Room Only" : row.meal_plan ?? "EP",
    arrival: row.check_in,
    departure: row.check_out,
    nights,
    adults: row.adults,
    children: row.children,
    status,
    isDayUse: row.is_day_use,
    /* Read from the column, not inferred from the price.
       Migration 020 (D1) added `is_complimentary` precisely so this
       would stop guessing — and this line kept guessing for a turn
       after the column existed, which is what an audit is for. A comp
       is a decision; a zero rate is a price. They coincided in the
       demo data and will not always. */
    isComplimentary: row.is_complimentary,
    /* ⚠ NULL IS "NO RATE SET", AND IT STAYS NULL. `Number(row.base_rate)`
       turned an unpriced room type into 0, and every stay panel printed
       "Rack rate ₹0" -- a price nobody set, on the screen a clerk quotes
       from. 032 made base_rate nullable so the hotel enters its own; the
       column's CHECK allows 0 too, so the screen cannot tell the two
       apart once this line has flattened them. Defect 246. */
    rackTariff: row.base_rate === null ? null : Number(row.base_rate),
    offeredTariff: Number(row.agreed_rate),
    ...(row.group_id
      ? {
          groupId: row.group_id,
          group: {
            id: row.group_id,
            name: row.group_name ?? "Group",
            /* Every room in the group, this one included. A panel that
               said "2 others" would be doing arithmetic the reader then
               has to undo to get the number on the group list. */
            rooms: Number(row.group_rooms ?? 1),
          },
        }
      : {}),
    ...(row.notes ? { notes: row.notes } : {}),

    /* Marks a clerk acts on. Always present rather than spread in only
       when true: a screen that has to distinguish "not a VIP" from
       "the field is missing" ends up doing both badly. */
    isVip: row.is_vip,
    /* The group's level for this guest (192, D27-260 Q7). */
    vipLevel: row.vip_level,
    /* VIP is set on the GUEST, so the screen needs to know which one. */
    guestId: row.guest_id,
    isSingleLady: row.is_single_lady,

    /* Where the booking came from. Nullable and left null — an unknown
       segment shows as a dash, never as "Direct" or "Other", because a
       guess here becomes a line in a source-mix report an owner makes
       decisions from. */
    businessSource: row.business_source,
    marketSegment: row.market_segment,
    salesPerson: row.sales_person,
    ...(row.void_reason ? { voidReason: row.void_reason } : {}),
    /* The guest's own company (D27-371): null when none was typed. */
    guestCompany: row.guest_company_name || row.guest_company_gstin || row.guest_company_address
      ? { name: row.guest_company_name, gstin: row.guest_company_gstin, address: row.guest_company_address }
      : null,

    /* Null when the guest gave nothing, which is most walk-ins. Never a
       placeholder -- a made-up number in a header gets dialled. */
    phone: row.phone,
    email: row.email,
    nationality: row.nationality,
  };
}

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/* THE DESK'S READ (D27-313). With `from` (and `to`, else the same day) only
   the bookings checked in now and those arriving from..to - what Arrivals,
   In house, Due out and the check-in's room list show. Every booking ever
   made was 793 rows and ~3.5 s on the demo, read on every check-in. Without
   `from` it is still every booking: All bookings, Find, the group and laundry
   screens read that.

   THE BOARD'S READ (D27-316 (1)): with `board=1` as well, every booking with
   a day in from..to (arriving by `to`, leaving on or after `from`), whoever is
   checked in now, and the bookings still to arrive that already hold a room
   (a tile's Arriving and Reserved, whatever the dates on screen). What Rooms,
   the Calendar's fortnight and the Dashboard draw - not every booking ever
   made, which they each read once or twice.

   TWO MORE BOUNDED READS (D27-387, the load test). `owing=1`: the stays whose
   bill carries a balance, what the Folios page lists. A guest who has left can
   still owe, so no date will do; the balance is the one GET /folios sums.
   `source=`: the bookings of one source, what Walk-ins lists.

   ALL BOOKINGS (the owner's D27-387): `since=` a day, the bookings leaving on
   or after it and everything ahead - what the screen opens on, the last 90
   days. `q=`, a search through every booking ever, by the words the screen
   searches: the guest, the reference or the group's, the room, three or more
   digits of the phone. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

stays.get("/:code/stays", async (c) => {
  const code = c.req.param("code");
  const asOn = c.req.query("asOn");
  const from = c.req.query("from");
  const to = c.req.query("to") ?? from;
  const board = c.req.query("board") === "1";
  const owing = c.req.query("owing") === "1";
  const source = c.req.query("source");
  const since = c.req.query("since");
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  if (since !== undefined && !DAY.test(since)) {
    return c.json({ error: "since is a day, YYYY-MM-DD." }, 400);
  }
  if (from !== undefined && !(DAY.test(from) && DAY.test(to!))) {
    return c.json({ error: "from and to are days, YYYY-MM-DD." }, 400);
  }

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, code);
    if (!hotelId) return null;
    const businessDate = asOn ?? (await businessDateFor(client, hotelId));

    const [only, params] =
      owing ? [`and r.id in (
                  select f.reservation_id
                    from folio_postings fp join folios f on f.id = fp.folio_id
                   where f.hotel_id = $1 and fp.reverses_id is null
                     and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
                   group by f.reservation_id
                  having sum(fp.amount + fp.tax_amount) <> 0)`, [hotelId]]
      /* Walk-ins opens on the last 90 days too (the owner, 2 November): `since=` narrows a source. */
      : source !== undefined ? since !== undefined
        ? [`and app.booking_source_label(bs.name, co.name, r.source) = $2 and r.check_out >= $3::date`, [hotelId, source, since]]
        : [`and app.booking_source_label(bs.name, co.name, r.source) = $2`, [hotelId, source]]
      : q ? [`and (gu.full_name ilike '%' || $2 || '%' or r.reference ilike '%' || $2 || '%'
                  or g.block_code ilike '%' || $2 || '%' or rm.number ilike '%' || $2 || '%'
                  or (length($3) >= 3
                      and regexp_replace(coalesce(gu.phone, ''), '\\D', '', 'g') like '%' || $3 || '%'))`,
             [hotelId, q, q.replace(/\D/g, "")]]
      : since !== undefined ? [`and r.check_out >= $2::date`, [hotelId, since]]
      : from === undefined ? ["", [hotelId]]
      /* Holding a room is asked of the booking's own assignments, not of the
         room join: a condition on the join is tried on every booking ever
         made, under row security, and took ~2.7 s instead of ~0.1 s. */
      : board ? [`and (r.status = 'checked_in'
                   or (r.check_in <= $3::date and r.check_out >= $2::date)
                   or (r.status = 'confirmed' and r.check_in >= $4::date
                       and exists (select 1 from room_assignments ra
                                    where ra.reservation_id = r.id and ra.released_at is null)))`,
                 [hotelId, from, to, businessDate]]
      : [`and (r.status = 'checked_in' or r.check_in between $2::date and $3::date)`,
         [hotelId, from, to]];
    /* `r.id` last: two bookings of one room on one day came back in whatever
       order the plan gave, so the Calendar stacked their bars differently
       from one read to the next (seen comparing the board's read with every
       booking, D27-316). */
    const { rows } = await client.query<StayRow>(
      `${SELECT} ${only} order by r.check_in, rm.number nulls last, r.id`, params);
    return rows.map((r) => toStay(r, code.toUpperCase(), businessDate));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

stays.get("/:code/stays/:id", async (c) => {
  const code = c.req.param("code");
  const asOn = c.req.query("asOn");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, code);
    if (!hotelId) return null;
    const businessDate = asOn ?? (await businessDateFor(client, hotelId));

    const { rows } = await client.query<StayRow>(
      `${SELECT} and r.id = $2`,
      [hotelId, c.req.param("id")],
    );
    const row = rows[0];
    return row ? toStay(row, code.toUpperCase(), businessDate) : null;
  });

  return body ? c.json(body) : c.json({ error: "Not found." }, 404);
});

/* ── The house now: In house and Empty, one rule (D21-36, D21-37) ──
   Every room with the one fact each screen counts, from app.house_now
   (migration 129): a checked-in guest in it now, whatever the departure
   date says; a block covering tonight; or neither, which is Empty. The
   Dashboard, Rooms, In house, the property page and the housekeeping
   board all read this, so none of them counts for itself.

   The counts are ROOMS. A room holding two checked-in bookings (a due-out
   guest not yet checked out, and the guest arriving into it) is one room
   in house; the In house list still shows both bookings. */
stays.get("/:code/house-now", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      number: string; in_house: boolean; out_of_order: boolean; empty: boolean;
    }>(
      "select number, in_house, out_of_order, empty from app.house_now($1)",
      [hotelId],
    );
    const rooms = rows.map((r) => ({
      number: r.number, inHouse: r.in_house, outOfOrder: r.out_of_order, empty: r.empty,
    }));
    return {
      rooms,
      inHouse: rooms.filter((r) => r.inHouse).length,
      empty: rooms.filter((r) => r.empty).length,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── The Calendar's price on each night (the owner's D27-271, item 3) ──
   Each room type on each night of the window: the figure the Rates
   screen's main row shows, app.price_for on EP - the night's own price
   (a base, or the master's plus a difference), else the type's standard
   (rack) price, else null, a dash. The one definition, read once for the
   whole window; nothing is worked out here. */
stays.get("/:code/calendar-prices", async (c) => {
  const from = c.req.query("from") ?? "";
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 14), 1), 62);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !Number.isInteger(days)) {
    return c.json({ ok: false, reason: "From which date, for how many nights?" }, 409);
  }

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ type: string; date: string; price: string | null }>(
      `select rt.name as type, d::date::text as date, p.price::text
         from room_types rt
         cross join generate_series($2::date, $2::date + ($3::int - 1), interval '1 day') d
         left join lateral app.price_for(rt.id, 'EP', d::date) p on true
        where rt.hotel_id = $1
        order by rt.sort_order, rt.name, d`,
      [hotelId, from, days],
    );
    /* null, not 0: zero would say the room is free. */
    return rows.map((r) => ({ type: r.type, date: r.date, price: r.price === null ? null : Number(r.price) }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Groups ──────────────────────────────────────────────────────── */

stays.get("/:code/groups", async (c) => {
  const code = c.req.param("code");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, code);
    if (!hotelId) return null;

    /* `scope` is what a desk is looking at on a Tuesday morning. The
       default is the groups that are here or coming; a wedding from
       March is history and sits behind a deliberate choice, because a
       list that grows forever stops being read. */
    const scope = c.req.query("scope") === "all" ? "all" : "current";

    const { rows } = await client.query<{
      id: string;
      name: string;
      block_code: string | null;
      company: string | null;
      rooms: string;
      nights: string;
      arrival: string;
      departure: string;
      in_house: string;
      due_in: string;
      departed: string;
      cancelled: string;
      routed: string;
      master_id: string | null;
      master_balance: string | null;
      guest_balance: string;
    }>(
      `select g.id, g.name, g.block_code, co.name as company,
              count(r.id)::text            as rooms,
              coalesce(sum(r.check_out - r.check_in), 0)::text as nights,
              min(r.check_in)::text        as arrival,
              max(r.check_out)::text       as departure,

              /* WHERE THE GROUP IS TODAY, which is the question somebody
                 opening this list is actually asking. Counted from the
                 rooms rather than stored, so a group whose bookings have
                 been amended cannot keep reporting the shape it had when
                 it was made. */
              count(*) filter (where r.status = 'checked_in')::text as in_house,
              count(*) filter (where r.status = 'confirmed')::text  as due_in,
              count(*) filter (where r.status = 'checked_out')::text as departed,
              count(*) filter (where r.status = 'cancelled')::text  as cancelled,

              /* How many rooms bill to the host. PER ROOM, not per
                 group - the couple's own room is usually settled by them
                 while the rest go to the host, and a list that said
                 "billed to the host" over a mixed group would be wrong
                 for whoever asked. */
              count(*) filter (where r.route_room_to_group)::text   as routed,

              m.id::text as master_id,
              (select sum(fp.amount + fp.tax_amount)::text
                 from folios f
                 join folio_postings fp on fp.folio_id = f.id
                where f.group_id = g.id) as master_balance,

              /* The rooms' OWN folios, kept apart from the host's for the
                 same reason the group panel keeps them apart: adding them
                 produces a number nobody is being asked to pay. */
              coalesce((
                select sum(fp2.amount + fp2.tax_amount)
                  from folios f2
                  join folio_postings fp2 on fp2.folio_id = f2.id
                 where f2.reservation_id in (
                   select r2.id from reservations r2
                    where r2.group_id = g.id and r2.status <> 'void')
              ), 0)::text as guest_balance

         from reservation_groups g
         join reservations r on r.group_id = g.id
         left join companies co on co.id = g.company_id
         left join folios m on m.group_id = g.id and m.reservation_id is null
        where r.hotel_id = $1
          /* A void booking never happened, so it is not one of the group's
             rooms and must not be counted as one. Same rule 042 wrote for
             every other count. */
          and r.status <> 'void'
          and ($2 = 'all' or exists (
                select 1 from reservations x
                 where x.group_id = g.id
                   and x.status not in ('void', 'cancelled')
                   /* app.business_date: the column stops at the first
                      night audit (FD-16). */
                   and x.check_out >= app.business_date($1)))
        group by g.id, g.name, g.block_code, co.name, m.id
        order by min(r.check_in), g.name`,
      [hotelId, scope],
    );

    return rows.map((g) => ({
      id: g.id,
      hotelId: code.toUpperCase(),
      name: g.name,
      reference: g.block_code ?? "",
      company: g.company,
      rooms: Number(g.rooms),
      nights: Number(g.nights),
      arrival: g.arrival,
      departure: g.departure,
      inHouse: Number(g.in_house),
      dueIn: Number(g.due_in),
      departed: Number(g.departed),
      cancelled: Number(g.cancelled),
      routedRooms: Number(g.routed),
      /* NULL, not zero. Zero says the host owes nothing; null says there
         is no host account, which is the case for most groups. */
      masterBalance: g.master_id === null || g.master_balance === null
        ? null : Number(g.master_balance),
      guestBalance: Number(g.guest_balance),
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
