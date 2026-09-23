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
  guest_id: string;
  is_single_lady: boolean;
  business_source: string | null;
  market_segment: string | null;
  sales_person: string | null;
  void_reason: string | null;
}

const SELECT = `
  select r.id,
         r.reference,
         /* A group member's own reference is the group's plus its room.
            The guest was quoted the GROUP's, so that is what shows. */
         g.block_code                              as group_reference,
         gu.full_name                              as guest,
         rm.number                                 as room_number,
         rt.name                                   as room_type,
         app.booking_source_label(bs.name, co.name, r.source) as source,
         r.meal_plan,
         r.check_in::text, r.check_out::text,
         r.adults, r.children, r.status, r.is_day_use,
         r.agreed_rate, rt.base_rate, r.is_complimentary,
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
         gu.is_vip, gu.id::text as guest_id, r.is_single_lady,
         r.business_source, r.market_segment, r.sales_person,
         r.void_reason,
         /* How to reach the guest, for the stay panel's header. The
            booking form has captured these since it was written and no
            screen that shows a stay ever asked for them. */
         gu.phone, gu.email::text as email, gu.nationality
    from reservations r
    join guests gu     on gu.id = r.guest_id
    join room_types rt on rt.id = r.room_type_id
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

       (No backticks in here. This whole string is a JS template
       literal, and one would end it.) */
    left join lateral (
      select rm2.number
        from room_assignments ra2
        join rooms rm2 on rm2.id = ra2.room_id
       where ra2.reservation_id = r.id
       order by ra2.released_at nulls first, ra2.from_date desc
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

stays.get("/:code/stays", async (c) => {
  const code = c.req.param("code");
  const asOn = c.req.query("asOn");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, code);
    if (!hotelId) return null;
    const businessDate = asOn ?? (await businessDateFor(client, hotelId));

    const { rows } = await client.query<StayRow>(
      `${SELECT} order by r.check_in, rm.number nulls last`,
      [hotelId],
    );
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
                   and x.check_out >= (select business_date from hotels
                                        where id = $1)))
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
