import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   EXCHANGING TWO ROOMS, AND WHAT A RATE INCLUDES

   Both are things the desk does daily and this system could not.

   An EXCHANGE is not two moves. `ra_no_double_booking` is checked per
   statement, so writing A into B's room while B still holds it
   collides every time — the suite asserts that, so nobody later
   "simplifies" this into a loop. `app.exchange_rooms` releases both
   and re-assigns both in one transaction.

   An INCLUSION is a promise attached to a rate. "3,400 with breakfast
   for two and the airport pickup" is one price and three promises, and
   until now only the price was written down.
   ══════════════════════════════════════════════════════════════════ */

export const stayExtras = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/* ── Who can this guest swap with? ───────────────────────────────── */

stayExtras.get("/:code/stays/:id/exchangeable", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Everybody else who is IN A ROOM. Not "has a booking covering
       tonight" — an exchange swaps two occupied rooms, and offering a
       guest who has not arrived would produce a refusal the desk could
       not have predicted. Status, not dates; the third time that
       distinction has mattered here. */
    const { rows } = await client.query<{
      id: string; guest: string; room: string; reference: string;
      departs: string;
    }>(
      `select r.id::text, g.full_name as guest, rm.number as room,
              r.reference, r.check_out::text as departs
         from reservations r
         join guests g on g.id = r.guest_id
         join room_assignments ra
           on ra.reservation_id = r.id and ra.released_at is null
         join rooms rm on rm.id = ra.room_id
        where r.hotel_id = $1
          and r.status = 'checked_in'
          and r.id <> $2
        order by rm.number`,
      [hotelId, c.req.param("id")]);

    return { rooms: rows };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

stayExtras.post("/:code/stays/:id/exchange", async (c) => {
  type Body = { withStayId?: string; from?: string; reason?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.withStayId) return c.json(refuse("Swap with whom?"), 409);
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse(
      "Why are they swapping? Two guests changed rooms and somebody will "
      + "ask about it."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const from = input.from
      ?? (await client.query<{ bd: string }>(
            `select business_date::text as bd from hotels where id = $1`,
            [hotelId])).rows[0]!.bd;

    try {
      const { rows } = await client.query<{
        room_a: string; room_b: string; nights: number;
      }>(
        `select * from app.exchange_rooms($1,$2,$3,$4::date,$5,$6)`,
        [hotelId, c.req.param("id"), input.withStayId, from, reason,
         session.staffId]);
      const r = rows[0]!;
      return {
        ok: true as const,
        /* The rooms they came FROM, so the message can say what
           happened rather than what was asked for. */
        from: r.room_a, to: r.room_b, nights: r.nights,
      };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      /* The function raises sentences, deliberately. Passing the
         message through beats translating it into a worse one. */
      if (e?.code === "P0001" && e.message) return refuse(e.message);
      if (e?.code === "23P01") {
        return refuse(
          "One of those rooms is taken for part of the remaining nights.");
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── What a rate includes ────────────────────────────────────────── */

stayExtras.get("/:code/inclusions", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      id: string; name: string; description: string | null;
      rate: string | null; category: string;
    }>(
      `select id::text, name, description, default_rate::text as rate, category
         from inclusions
        where hotel_id = $1 and is_active
        order by sort_order, name`, [hotelId]);
    return {
      inclusions: rows.map((r) => ({
        id: r.id, name: r.name, description: r.description,
        /* NULL means included at no extra charge, which is what an
           inclusion usually is. Not zero. */
        rate: r.rate === null ? null : Number(r.rate),
        category: r.category,
      })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

stayExtras.post("/:code/inclusions", async (c) => {
  type Body = {
    name?: string; description?: string;
    defaultRate?: number | null; category?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const name = input.name?.trim();
  if (!name) return c.json(refuse("What is it called?"), 409);
  if (input.defaultRate != null
      && (!Number.isFinite(input.defaultRate) || input.defaultRate < 0)) {
    return c.json(refuse("A charge is zero or more, or blank for none."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into inclusions (hotel_id, name, description, default_rate,
                                 category)
         values ($1,$2,nullif($3,''),$4,$5) returning id::text`,
        [hotelId, name, input.description?.trim() ?? "",
         input.defaultRate ?? null, input.category ?? "misc"]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      const e = error as { code?: string } | undefined;
      if (e?.code === "23505") {
        return refuse(`This property already offers "${name}".`);
      }
      throw error;
    }
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── What THIS booking was promised ──────────────────────────────── */

stayExtras.get("/:code/stays/:id/inclusions", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      id: string; name: string; quantity: number; rate: string | null;
      notes: string | null; added_by: string; at: string;
    }>(
      `select ri.id::text, ri.name, ri.quantity, ri.rate::text as rate,
              ri.notes, s.full_name as added_by,
              to_char(ri.created_at,'DD Mon, HH24:MI') as at
         from reservation_inclusions ri
         join staff s on s.id = ri.added_by
        where ri.hotel_id = $1 and ri.reservation_id = $2
        order by ri.created_at`,
      [hotelId, c.req.param("id")]);
    return {
      inclusions: rows.map((r) => ({
        id: r.id, name: r.name, quantity: r.quantity,
        rate: r.rate === null ? null : Number(r.rate),
        notes: r.notes, addedBy: r.added_by, at: r.at,
      })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

stayExtras.post("/:code/stays/:id/inclusions", async (c) => {
  type Body = {
    inclusionId?: string; name?: string; quantity?: number;
    rate?: number | null; notes?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Named from the catalogue when one was picked, so the row still
       reads correctly if somebody renames the inclusion next year. The
       rate is snapshotted for the same reason every agreed number here
       is: repricing the pickup in March must not reprice a booking
       made in January. */
    let name = input.name?.trim() ?? "";
    let rate = input.rate ?? null;
    if (input.inclusionId) {
      const { rows } = await client.query<{ name: string; rate: string | null }>(
        `select name, default_rate::text as rate from inclusions
          where id = $1 and hotel_id = $2`, [input.inclusionId, hotelId]);
      if (!rows[0]) return refuse("That is not on this property's list.");
      name = name || rows[0].name;
      if (input.rate === undefined) {
        rate = rows[0].rate === null ? null : Number(rows[0].rate);
      }
    }
    if (!name) return refuse("What is included?");

    const quantity = Number(input.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return refuse("How many?");
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into reservation_inclusions
         (hotel_id, reservation_id, inclusion_id, name, quantity, rate,
          notes, added_by)
       values ($1,$2,$3,$4,$5,$6,nullif($7,''),$8) returning id::text`,
      [hotelId, c.req.param("id"), input.inclusionId ?? null, name,
       quantity, rate, input.notes?.trim() ?? "", session.staffId]);
    return { ok: true as const, id: rows[0]!.id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

stayExtras.delete("/:code/stays/:id/inclusions/:lineId", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* A promise removed before it was billed is a correction, not a
       ledger event — nothing has been posted, so there is nothing to
       reverse. The moment one IS charged it becomes a folio line and
       the ledger's own rules take over. */
    await client.query(
      `delete from reservation_inclusions
        where id = $1 and hotel_id = $2 and reservation_id = $3`,
      [c.req.param("lineId"), hotelId, c.req.param("id")]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, 200);
});
