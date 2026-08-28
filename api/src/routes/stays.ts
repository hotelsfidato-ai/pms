import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";
import { businessDateFor } from "../businessDate.ts";

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

/** The database's vocabulary, and the interface's, are not the same. */
const SOURCE_LABEL: Record<string, string> = {
  walk_in: "Walk-in",
  direct: "Fidato Hotels",
  ota: "Agoda",
  corporate: "Fidato Hotels",
};

interface StayRow {
  id: string;
  reference: string;
  group_reference: string | null;
  guest: string;
  room_number: string | null;
  room_type: string;
  source: string;
  company_name: string | null;
  meal_plan: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  status: string;
  is_day_use: boolean;
  agreed_rate: string;
  base_rate: string;
  is_complimentary: boolean;
  notes: string | null;
  group_id: string | null;
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
         r.source,
         co.name                                   as company_name,
         r.meal_plan,
         r.check_in::text, r.check_out::text,
         r.adults, r.children, r.status, r.is_day_use,
         r.agreed_rate, rt.base_rate, r.is_complimentary,
         r.notes, r.group_id
    from reservations r
    join guests gu     on gu.id = r.guest_id
    join room_types rt on rt.id = r.room_type_id
    left join companies co          on co.id = r.company_id
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
    source: row.company_name ?? SOURCE_LABEL[row.source] ?? "Walk-in",
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
    rackTariff: Number(row.base_rate),
    offeredTariff: Number(row.agreed_rate),
    ...(row.group_id ? { groupId: row.group_id } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
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

/* ── Groups ──────────────────────────────────────────────────────── */

stays.get("/:code/groups", async (c) => {
  const code = c.req.param("code");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, code);
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string;
      name: string;
      block_code: string | null;
      rooms: string;
      arrival: string;
      departure: string;
    }>(
      `select g.id, g.name, g.block_code,
              count(r.id)::text            as rooms,
              min(r.check_in)::text        as arrival,
              max(r.check_out)::text       as departure
         from reservation_groups g
         join reservations r on r.group_id = g.id
        where r.hotel_id = $1
        group by g.id, g.name, g.block_code
        order by min(r.check_in)`,
      [hotelId],
    );

    return rows.map((g) => ({
      id: g.id,
      hotelId: code.toUpperCase(),
      name: g.name,
      reference: g.block_code ?? "",
      rooms: Number(g.rooms),
      arrival: g.arrival,
      departure: g.departure,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
