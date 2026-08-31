import { Hono } from "hono";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   RATES — what a room costs

   Stage 9. Until 033 a property had one number per room type and no way
   to say that breakfast costs more, or that December is not August.

   The group's instruction shapes this file: prices are not fixed, the
   team updates them, and nothing is standard across properties. So
   everything here WRITES what the hotel tells it and nothing here has
   an opinion about what a room should cost.

   NOT /rates — THAT PATH IS TAKEN

   billing.ts already answers `/:code/rates`: the rate CALENDAR, which
   is availability and achieved ADR by date. This is what a room COSTS,
   which the navigation has always called rate-plans. Two different
   questions that were about to collide on one path, with the older
   route winning silently because it is mounted first.

   THE REFUSAL THAT MATTERS

   Two prices covering one day for one room type on one plan means
   nobody can say what the room costs. `rates_no_overlap` refuses it in
   the database; this turns that into a sentence naming the season it
   collides with, because "23P01" is not something a front-office
   manager can act on.
   ══════════════════════════════════════════════════════════════════ */

export const rates = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/** A database refusal, turned into something a person can act on. */
function reasonFor(error: unknown, ctx: { plan?: string }): string | null {
  const e = error as { code?: string; message?: string } | undefined;
  if (!e?.code) return null;
  if (e.code === "23P01") {
    return `Another ${ctx.plan ?? ""} rate already covers part of those dates. `
      + `A day cannot have two prices — change the existing one, or pick dates `
      + `that do not overlap it.`;
  }
  if (e.code === "23514") return "That range or price is not valid.";
  if (e.code === "23503") return "That meal plan is not one the system knows.";
  return null;
}

/* ── Reading ──────────────────────────────────────────────────────── */

rates.get("/:code/rate-plans", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);

    const { rows: types } = await client.query<{
      id: string; code: string; name: string; base_rate: string | null;
      max_occupancy: number; rooms: string;
    }>(
      `select rt.id::text, rt.code, rt.name, rt.base_rate::text,
              rt.max_occupancy,
              (select count(*) from rooms rm
                where rm.room_type_id = rt.id and rm.is_active)::text as rooms
         from room_types rt
        where rt.hotel_id = $1
        order by rt.sort_order, rt.name`,
      [hotelId],
    );

    const { rows: plans } = await client.query<{
      code: string; name: string; includes: string;
    }>("select code, name, includes from meal_plans order by code");

    const { rows: rows } = await client.query<{
      id: string; room_type_id: string; room_type: string;
      meal_plan: string; price: string;
      valid_from: string; valid_to: string | null;
      label: string | null; created_by_name: string | null;
      is_current: boolean;
    }>(
      `select r.id::text, r.room_type_id::text, rt.name as room_type,
              r.meal_plan, r.price::text,
              to_char(r.valid_from,'YYYY-MM-DD') as valid_from,
              to_char(r.valid_to,  'YYYY-MM-DD') as valid_to,
              r.label, s.full_name as created_by_name,
              ($2::date >= r.valid_from
                and (r.valid_to is null or $2::date < r.valid_to)) as is_current
         from rates r
         join room_types rt on rt.id = r.room_type_id
         left join staff s on s.id = r.created_by
        where r.hotel_id = $1
        order by rt.sort_order, r.meal_plan, r.valid_from`,
      [hotelId, businessDate],
    );

    return {
      businessDate,
      roomTypes: types.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        /* null, never 0. An unpriced type is a real state — 032 stopped
           the templates shipping numbers nobody chose. */
        rackRate: t.base_rate === null ? null : Number(t.base_rate),
        maxOccupancy: t.max_occupancy,
        rooms: Number(t.rooms),
      })),
      mealPlans: plans,
      rates: rows.map((r) => ({
        id: r.id,
        roomTypeId: r.room_type_id,
        roomType: r.room_type,
        mealPlan: r.meal_plan,
        price: Number(r.price),
        from: r.valid_from,
        to: r.valid_to,
        label: r.label,
        /* Who set it. A price with nobody's name on it is the row you
           cannot ask about six months later. */
        setBy: r.created_by_name,
        isCurrent: r.is_current,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── The rack rate ────────────────────────────────────────────────── */

rates.put("/:code/room-types/:id/rate", async (c) => {
  type Body = { rate?: number | null };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  /* null CLEARS it, which is a legitimate thing to want: a type nobody
     has priced yet reads as a dash rather than a figure somebody has to
     wonder about. Distinguished from "absent" on purpose. */
  const clearing = input.rate === null;
  const rate = clearing ? null : Number(input.rate);

  if (!clearing && (!Number.isFinite(rate) || (rate as number) < 0)) {
    return c.json(refuse("A rate must be zero or more, or blank to clear it."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ name: string }>(
      `update room_types set base_rate = $1
        where id = $2 and hotel_id = $3
        returning name`,
      [rate, c.req.param("id"), hotelId],
    );
    if (!rows[0]) return refuse("No such room type here.");

    return { ok: true as const, roomType: rows[0].name, rate };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Rates ────────────────────────────────────────────────────────── */

rates.post("/:code/rate-plans", async (c) => {
  type Body = {
    roomTypeId?: string; mealPlan?: string; price?: number;
    from?: string; to?: string | null; label?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.roomTypeId) return c.json(refuse("Which room type?"), 409);
  if (!input.mealPlan) return c.json(refuse("Which meal plan?"), 409);
  if (!input.from) return c.json(refuse("From which date?"), 409);

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    return c.json(refuse("A price must be zero or more."), 409);
  }
  if (input.to && input.to <= input.from) {
    return c.json(refuse(
      "The end of a season has to be after its start. The last day is not "
      + "included, so a season through 31 December ends on the 1st of January.",
    ), 409);
  }

  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;

      const { rows } = await client.query<{ id: string; room_type: string }>(
        `insert into rates (hotel_id, room_type_id, meal_plan, price,
                            valid_from, valid_to, label, created_by)
         select $1, rt.id, $3, $4, $5::date, $6::date, $7, $8
           from room_types rt
          where rt.id = $2 and rt.hotel_id = $1
         returning id::text,
                   (select name from room_types where id = $2) as room_type`,
        [hotelId, input.roomTypeId, input.mealPlan, price,
         input.from, input.to ?? null, input.label?.trim() || null,
         session.staffId],
      );
      if (!rows[0]) return refuse("No such room type here.");

      return { ok: true as const, id: rows[0].id, roomType: rows[0].room_type };
    });

    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error, { plan: input.mealPlan });
    if (reason) return c.json(refuse(reason), 409);
    throw error;
  }
});

rates.delete("/:code/rate-plans/:id", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Removed, not flagged. A rate is a SETTING — what it priced is
       already recorded on the reservations it priced, in agreed_rate,
       which this does not touch. That is the row that matters. */
    const { rowCount } = await client.query(
      "delete from rates where id = $1 and hotel_id = $2",
      [c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("That rate is not here.");

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ══════════════════════════════════════════════════════════════════
   CANCELLATION TERMS

   Stage 5's night audit charged nothing on a no-show because nothing
   modelled what one costs. 036 models it; this is how a property
   writes its own terms down.

   The same instruction that shapes the prices above shapes these:
   nothing here ships with a figure. A property with no policy has no
   terms and the audit charges nothing, which is exactly what it did
   before any of this existed.
   ══════════════════════════════════════════════════════════════════ */

const BASES = ["nothing", "first_night", "full_stay", "percent", "flat"];

rates.get("/:code/cancellation-policies", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query(
      `select id::text, name, free_until_hours, applies_to_new_bookings,
              cancel_basis, cancel_percent::text, cancel_amount::text,
              no_show_basis, no_show_percent::text, no_show_amount::text,
              (select count(*) from reservations r
                where r.cancellation_policy_id = p.id)::int as bookings
         from cancellation_policies p
        where hotel_id = $1 and is_active
        order by name`,
      [hotelId],
    );

    return rows.map((r) => ({
      id: r["id"] as string,
      name: r["name"] as string,
      freeUntilHours: r["free_until_hours"] as number | null,
      cancelBasis: r["cancel_basis"] as string,
      /* null, never 0 — an unset figure is not a figure of nothing. */
      cancelPercent: r["cancel_percent"] === null ? null : Number(r["cancel_percent"]),
      cancelAmount: r["cancel_amount"] === null ? null : Number(r["cancel_amount"]),
      noShowBasis: r["no_show_basis"] as string,
      noShowPercent: r["no_show_percent"] === null ? null : Number(r["no_show_percent"]),
      noShowAmount: r["no_show_amount"] === null ? null : Number(r["no_show_amount"]),
      bookings: r["bookings"] as number,
      appliesToNewBookings: r["applies_to_new_bookings"] as boolean,
    }));
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

rates.post("/:code/cancellation-policies", async (c) => {
  type Body = {
    name?: string; freeUntilHours?: number | null;
    cancelBasis?: string; cancelPercent?: number | null; cancelAmount?: number | null;
    noShowBasis?: string; noShowPercent?: number | null; noShowAmount?: number | null;
  };
  const b = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!b.name?.trim()) return c.json(refuse("Give the policy a name."), 409);
  if (!b.cancelBasis || !BASES.includes(b.cancelBasis)) {
    return c.json(refuse("What does a cancellation cost?"), 409);
  }
  if (!b.noShowBasis || !BASES.includes(b.noShowBasis)) {
    return c.json(refuse("What does a no-show cost?"), 409);
  }
  /* The figure the basis needs. Refused here so the message names the
     missing number rather than letting a CHECK constraint say 23514. */
  if (b.cancelBasis === "percent" && b.cancelPercent == null) {
    return c.json(refuse("What percentage is retained on a cancellation?"), 409);
  }
  if (b.cancelBasis === "flat" && b.cancelAmount == null) {
    return c.json(refuse("What amount is retained on a cancellation?"), 409);
  }
  if (b.noShowBasis === "percent" && b.noShowPercent == null) {
    return c.json(refuse("What percentage is retained on a no-show?"), 409);
  }
  if (b.noShowBasis === "flat" && b.noShowAmount == null) {
    return c.json(refuse("What amount is retained on a no-show?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into cancellation_policies
           (hotel_id, name, free_until_hours,
            cancel_basis, cancel_percent, cancel_amount,
            no_show_basis, no_show_percent, no_show_amount, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning id::text`,
        [hotelId, b.name!.trim(), b.freeUntilHours ?? null,
         b.cancelBasis, b.cancelPercent ?? null, b.cancelAmount ?? null,
         b.noShowBasis, b.noShowPercent ?? null, b.noShowAmount ?? null,
         session.staffId],
      );
      return { ok: true as const, id: rows[0]!.id };
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "23505") {
        return refuse(`There is already a policy called "${b.name!.trim()}".`);
      }
      throw e;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

rates.delete("/:code/cancellation-policies/:id", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Retired, not deleted. Bookings froze their own copy of the terms
       (036), so removing the row would not change any bill — but the
       row is what a policy's provenance points at, and deleting it
       would orphan every booking that named it. */
    const { rowCount } = await client.query(
      `update cancellation_policies set is_active = false
        where id = $1 and hotel_id = $2 and is_active`,
      [c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("That policy is not here.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Which policy applies to new bookings ─────────────────────────────
   A property-CHOSEN default, which is the opposite of a shipped one:
   the hotel stating its own terms rather than the system inventing
   them. Until one is marked, every new booking carries no terms and
   the audit charges nothing.
   ═══════════════════════════════════════════════════════════════════ */
rates.put("/:code/cancellation-policies/:id/default", async (c) => {
  type Flag = { on?: boolean };
  const body = await c.req.json<Flag>().catch(() => ({}) as Flag);
  const on = body.on !== false;

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Cleared first. The partial unique index refuses a second policy
       claiming new bookings, so setting one without clearing the other
       would fail with 23505 rather than doing what was asked. */
    await client.query(
      `update cancellation_policies set applies_to_new_bookings = false
        where hotel_id = $1 and applies_to_new_bookings`,
      [hotelId],
    );

    if (!on) return { ok: true as const, name: null };

    const { rows } = await client.query<{ name: string }>(
      `update cancellation_policies set applies_to_new_bookings = true
        where id = $1 and hotel_id = $2 and is_active
      returning name`,
      [c.req.param("id"), hotelId],
    );
    if (!rows[0]) return refuse("That policy is not here.");
    return { ok: true as const, name: rows[0].name };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
