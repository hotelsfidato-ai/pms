import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   GROUPS — twelve rooms and one host

   A wedding block. The host settles the accommodation; every guest
   pays their own bar tab. That was never a choice between one folio
   and twelve — 006 built `folios` many-per-reservation from the start
   and made `reservation_id` nullable precisely so a master could
   exist. 056 added the other end of the link and the routing switch.

   TWO BALANCES, NEVER ONE. What the host owes and what the guests owe
   are different debts settled by different people, and adding them
   into a single figure hides which half anybody is being asked for.
   ══════════════════════════════════════════════════════════════════ */

export const groups = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── The list lives in stays.ts ────────────────────────────────────
   `GET /:code/groups` was already answered there, and `stays` is mounted
   BEFORE this file — so a second copy here would never have run, and the
   older one would have kept answering while this one looked correct in
   the source. rates.ts carries the same warning about `/:code/rates`, and
   I walked into it anyway: the first probe of this file returned a shape
   nothing in it produces.

   The existing route gained the master balance rather than being
   duplicated. What is here is what it did not answer: one group in
   detail, the master folio, and who pays for which room. */

/* ── One group ─────────────────────────────────────────────────── */

groups.get("/:code/groups/:id", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const groupId = c.req.param("id");

    const { rows: g } = await client.query<{
      name: string; block_code: string | null; company: string | null;
      notes: string | null;
    }>(
      `select g.name, g.block_code, co.name as company, g.notes
         from reservation_groups g
         left join companies co on co.id = g.company_id
        where g.id = $1`,
      [groupId],
    );
    if (!g[0]) return refuse("No such group.");

    const { rows: rooms } = await client.query<{
      reservation_id: string; reference: string; guest: string;
      room: string | null; room_type: string;
      check_in: string; check_out: string; nights: number;
      status: string; agreed_rate: string; routed: boolean; balance: string;
    }>(
      `select reservation_id::text, reference, guest, room, room_type,
              check_in::text, check_out::text, nights, status,
              agreed_rate::text, routed, balance::text
         from app.group_rooms($1, $2)`,
      [hotelId, groupId],
    );

    const { rows: master } = await client.query<{
      id: string; status: string; balance: string;
    }>(
      `select f.id::text, f.status,
              coalesce((select sum(fp.amount + fp.tax_amount)
                          from folio_postings fp where fp.folio_id = f.id), 0)::text
                as balance
         from folios f
        where f.group_id = $1 and f.hotel_id = $2 and f.status = 'open'`,
      [groupId, hotelId],
    );

    const { rows: lines } = master[0]
      ? await client.query<{
          date: string; description: string; category: string;
          amount: string; room: string | null;
        }>(
          `select fp.business_date::text as date, fp.description, fp.category,
                  (fp.amount + fp.tax_amount)::text as amount,
                  (select rm.number from room_assignments ra
                     join rooms rm on rm.id = ra.room_id
                    where ra.reservation_id = fp.reservation_id
                      and ra.released_at is null
                    order by ra.from_date limit 1) as room
             from folio_postings fp
            where fp.folio_id = $1
            order by fp.business_date, fp.id`,
          [master[0].id])
      : { rows: [] };

    const guestSide = rooms.reduce((sum, r) => sum + Number(r.balance), 0);

    return {
      id: groupId,
      name: g[0].name,
      blockCode: g[0].block_code,
      company: g[0].company,
      notes: g[0].notes,
      rooms: rooms.map((r) => ({
        reservationId: r.reservation_id, reference: r.reference,
        guest: r.guest, room: r.room, roomType: r.room_type,
        checkIn: r.check_in, checkOut: r.check_out, nights: r.nights,
        status: r.status, agreedRate: Number(r.agreed_rate),
        routed: r.routed, balance: Number(r.balance),
      })),
      /* TWO figures, deliberately. The host's account and what the guests
         owe on their own folios are different debts settled by different
         people; one combined number tells nobody what to collect. */
      master: master[0]
        ? { id: master[0].id, balance: Number(master[0].balance),
            lines: lines.map((l) => ({
              date: l.date, description: l.description,
              category: l.category, amount: Number(l.amount), room: l.room,
            })) }
        : null,
      guestBalance: guestSide,
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok === false ? 409 : 200);
});

/* ── Opening the master ────────────────────────────────────────── */

groups.post("/:code/groups/:id/master", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const groupId = c.req.param("id");

    const { rows: existing } = await client.query<{ id: string }>(
      `select id::text from folios
        where group_id = $1 and hotel_id = $2 and status = 'open'`,
      [groupId, hotelId]);
    if (existing[0]) {
      /* Not an error worth a red toast — it is already what was wanted.
         A unique index enforces one, so this is the friendly half. */
      return { ok: true as const, id: existing[0].id, created: false };
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into folios (hotel_id, group_id) values ($1,$2)
       returning id::text`,
      [hotelId, groupId]);

    return { ok: true as const, id: rows[0]!.id, created: true };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

/* ── Who pays for a room ───────────────────────────────────────── */

groups.post("/:code/stays/:id/routing", async (c) => {
  const input = await c.req.json<{ toGroup?: boolean }>()
    .catch(() => ({}) as { toGroup?: boolean });
  const toGroup = input.toGroup === true;

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");

    const { rows: stay } = await client.query<{
      guest: string; group_id: string | null;
    }>(
      `select g.full_name as guest, r.group_id::text
         from reservations r join guests g on g.id = r.guest_id
        where r.id = $1 and r.hotel_id = $2`,
      [stayId, hotelId]);
    if (!stay[0]) return refuse("No such reservation.");

    if (toGroup && !stay[0].group_id) {
      return refuse(
        `${stay[0].guest} is not in a group, so there is no master folio to `
        + "charge. Add the booking to a group first.");
    }

    if (toGroup) {
      const { rows: master } = await client.query<{ id: string }>(
        `select id::text from folios
          where group_id = $1 and hotel_id = $2 and status = 'open'`,
        [stay[0].group_id, hotelId]);
      if (!master[0]) {
        /* Named rather than silently falling back. app.folio_for_room_charge
           WOULD fall back to the stay's own folio — deliberately, because a
           charge that lands nowhere is worse than one on the wrong account —
           but a clerk who ticked "host pays" and got no master would never
           know the tick did nothing. */
        return refuse(
          "This group has no open master folio yet. Open one, and the room "
          + "charges will go to it.");
      }
    }

    await client.query(
      `update reservations set route_room_to_group = $1 where id = $2`,
      [toGroup, stayId]);

    return { ok: true as const, guest: stay[0].guest, routed: toGroup };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── Booking several rooms at once ─────────────────────────────────
   A wedding party wants four Deluxes and two Superiors for the same three
   nights. Six bookings typed one at a time is six chances to mistype a date,
   and nothing afterwards says they belong together.

   A GROUP IS CREATED ONLY FOR MORE THAN ONE ROOM. A single booking that
   happens to go through this path is just a booking — inventing a group of
   one puts a row in every group list that nobody means.

   THE RATE IS NOT GUESSED. app.tariff_for answers NULL when any part of the
   party is unpriced, and this refuses by name rather than quietly charging
   for two people in a room of three. The caller may override with a rate
   somebody agreed, which is what a negotiated block is.

   AVAILABILITY IS REPORTED, NOT ENFORCED. A reservation is for a room TYPE;
   deliberate overbooking is something every hotel does, and 005 separated
   type from room precisely so it stays possible. The summary says how many
   are left; the clerk decides. */
groups.post("/:code/bookings", async (c) => {
  type Line = {
    roomTypeId?: string; mealPlan?: string;
    adults?: number; children?: number;
    rooms?: number; agreedRate?: number;
  };
  type Body = {
    guestName?: string; phone?: string; email?: string;
    checkIn?: string; checkOut?: string;
    groupName?: string; blockCode?: string;
    source?: string; businessSource?: string; marketSegment?: string;
    lines?: Line[];
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const guestName = input.guestName?.trim();
  if (!guestName) return c.json(refuse("Whose booking is it?"), 409);
  if (!input.checkIn || !input.checkOut) {
    return c.json(refuse("Which nights?"), 409);
  }
  if (input.checkOut <= input.checkIn) {
    return c.json(refuse(
      "A stay ends after it starts. The night of departure is not charged, "
      + "so a guest leaving on the 5th has their last night on the 4th."), 409);
  }

  const lines = (input.lines ?? []).filter((l) => l.roomTypeId);
  if (lines.length === 0) return c.json(refuse("Which rooms?"), 409);

  const total = lines.reduce((n, l) => n + Math.max(1, l.rooms ?? 1), 0);
  if (total > 40) {
    /* Not a policy — a guard against a typo in the quantity box turning into
       four hundred reservations nobody can undo one at a time. */
    return c.json(refuse(
      `${total} rooms in one booking looks like a mistake. Split it, or say `
      + "so and it can be raised."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* One guest for the whole booking. A block belongs to whoever made it;
       individual names are filled in as the rooming list arrives, which is
       usually days later and often never for a wedding. */
    const { rows: guest } = await client.query<{ id: string }>(
      `insert into guests (full_name, phone, email)
       values ($1, nullif($2,''), nullif($3,''))
       returning id::text`,
      [guestName, input.phone?.trim() ?? "", input.email?.trim() ?? ""]);
    const guestId = guest[0]!.id;

    let groupId: string | null = null;
    if (total > 1) {
      const { rows: g } = await client.query<{ id: string }>(
        `insert into reservation_groups (name, block_code, lead_hotel_id)
         values ($1, nullif($2,''), $3) returning id::text`,
        [input.groupName?.trim() || `${guestName} — ${total} rooms`,
         input.blockCode?.trim() ?? "", hotelId]);
      groupId = g[0]!.id;
    }

    const made: { reference: string; roomType: string; rate: number }[] = [];

    for (const line of lines) {
      const { rows: rt } = await client.query<{
        name: string; max: number;
      }>(`select name, max_occupancy as max from room_types
           where id = $1 and hotel_id = $2`, [line.roomTypeId, hotelId]);
      if (!rt[0]) return refuse("One of those room types is not here.");

      const adults = line.adults ?? 1;
      const children = line.children ?? 0;
      if (adults + children > rt[0].max) {
        return refuse(
          `${adults + children} people will not fit a ${rt[0].name} — it `
          + `sleeps ${rt[0].max}.`);
      }

      /* The FIRST night's tariff, and the clerk sees the whole breakdown
         before submitting. agreed_rate is one number the audit posts every
         night — that is what "snapshotted at booking" means — so a stay
         crossing a season is charged what was agreed, not what the calendar
         says on night four. */
      let rate = line.agreedRate ?? null;
      if (rate === null) {
        const { rows: t } = await client.query<{
          total: string | null; unpriced: string | null;
        }>(
          `select total::text, unpriced
             from app.tariff_for($1,$2,$3::date,$4,$5)`,
          [line.roomTypeId, line.mealPlan ?? "EP", input.checkIn,
           adults, children]);
        if (t[0]?.total === null || t[0]?.total === undefined) {
          return refuse(
            `${rt[0].name} has no price for ${t[0]?.unpriced ?? "this party"}. `
            + "Set it on the rate calendar, or enter a rate for this booking.");
        }
        rate = Number(t[0].total);
      }

      for (let i = 0; i < Math.max(1, line.rooms ?? 1); i += 1) {
        const { rows: ref } = await client.query<{ reference: string }>(
          `select 'FH-' || to_char(now(),'DDMM') || '-' ||
                  lpad((coalesce(max(substring(reference from '[0-9]+$')::int),
                        5000) + 1)::text, 4, '0') as reference
             from reservations where hotel_id = $1`, [hotelId]);

        await client.query(
          `insert into reservations
             (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
              adults, children, occupancy, agreed_rate, status, source,
              meal_plan, group_id, business_source, market_segment)
           values ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,'confirmed',$11,
                   $12,$13,$14,$15)`,
          [hotelId, ref[0]!.reference, guestId, line.roomTypeId,
           input.checkIn, input.checkOut, adults, children, adults + children,
           rate, input.source ?? "direct", line.mealPlan ?? "EP", groupId,
           /* Blank stays NULL, never "" — an empty segment would sort as its
              own category in the source-mix report and read as an answer. */
           input.businessSource?.trim() || null,
           input.marketSegment?.trim() || null],
        );
        made.push({ reference: ref[0]!.reference, roomType: rt[0].name,
                    rate: Number(rate) });
      }
    }

    return {
      ok: true as const,
      groupId,
      rooms: made.length,
      guest: guestName,
      bookings: made,
      nightly: made.reduce((sum, m) => sum + m.rate, 0),
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
