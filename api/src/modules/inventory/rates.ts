import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { setsRates, RATE_SETTER_REFUSED } from "./rateSetters.ts";

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

/* ── The two grids ────────────────────────────────────────────────
   The screens a revenue manager lives in: what is left to sell, and
   what it costs. One request each, because a grid that fetches a cell
   at a time is a grid nobody scrolls twice. */

/** A window, clamped. A year of cells is a request nobody meant. */
function windowFor(c: { req: { query: (k: string) => string | undefined } },
                   fallback: string) {
  const from = c.req.query("from") ?? fallback;
  const asked = c.req.query("to");
  const to = asked ?? from;
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`))
    / 86_400_000;
  return {
    from,
    /* 90 days is four screens of scrolling and the longest a season is
       ever set in one go. Beyond that the answer is an export. */
    to: Number.isFinite(days) && days > 90
      ? new Date(Date.parse(`${from}T00:00:00Z`) + 90 * 86_400_000)
          .toISOString().slice(0, 10)
      : to,
  };
}

rates.get("/:code/inventory", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { from, to } = windowFor(c, await businessDateFor(client, hotelId));

    const { rows } = await client.query<{
      room_type_id: string; room_type: string; for_date: string;
      sellable: number; occupied: number; sold: number; available: number;
    }>(
      `select room_type_id::text, room_type, for_date::text,
              sellable, occupied, sold, available
         from app.inventory_grid($1, $2, $3)`,
      [hotelId, from, to],
    );

    /* Restrictions come back in the same request. Two round trips for
       one grid is how a cell renders open for a moment and then closes
       under somebody's cursor. */
    const { rows: rules } = await client.query<{
      room_type_id: string; for_date: string;
      stop_sell: boolean; closed_arrival: boolean; closed_departure: boolean;
      min_nights: number | null; max_nights: number | null;
    }>(
      `select room_type_id::text, for_date::text, stop_sell,
              closed_arrival, closed_departure, min_nights, max_nights
         from rate_restrictions
        where hotel_id = $1 and for_date between $2 and $3`,
      [hotelId, from, to],
    );

    return {
      from, to,
      cells: rows.map((r) => ({
        roomTypeId: r.room_type_id,
        roomType: r.room_type,
        date: r.for_date,
        sellable: r.sellable,
        /* Both, deliberately. `occupied` is what a revenue manager must
           subtract — a comped room cannot be sold to anybody else —
           and `sold` is the statistics definition that feeds occupancy
           and ADR. A grid showing one of them disagrees with the
           Manager Report while both are right. */
        occupied: r.occupied,
        sold: r.sold,
        available: r.available,
      })),
      restrictions: rules.map((r) => ({
        roomTypeId: r.room_type_id,
        date: r.for_date,
        stopSell: r.stop_sell,
        closedArrival: r.closed_arrival,
        closedDeparture: r.closed_departure,
        minNights: r.min_nights,
        maxNights: r.max_nights,
      })),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

rates.get("/:code/rate-grid", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { from, to } = windowFor(c, await businessDateFor(client, hotelId));

    /* ONE DEFINITION. This route used to expand the ranges itself, and its
       copy of the rule disagreed with the other three in two ways that both
       hid real prices: an open-ended rack rate (`valid_to` null) was filtered
       out entirely, and a season covered one day too many because the range
       is half-open everywhere else in the schema.

       app.rate_grid delegates to app.rate_for, which is the same function the
       exclusion constraint and the rate-plan list already agree with. */
    const { rows } = await client.query<{
      room_type_id: string; room_type: string; meal_plan: string;
      meal_plan_name: string; for_date: string;
      price: string | null; season: string | null; source: string | null;
    }>(
      `select room_type_id::text, room_type, meal_plan, meal_plan_name,
              for_date::text, price::text, season, source
         from app.rate_grid($1, $2, $3)`,
      [hotelId, from, to],
    );

    /* Every cell comes back, including the ones nobody has priced. That is
       the point of the screen: no price ever ships, so a new property is
       ENTIRELY empty, and a grid built only from rows that exist in `rates`
       would have nowhere to type the first one. */
    const plans = new Map<string, {
      roomTypeId: string; roomType: string;
      mealPlan: string; mealPlanName: string;
    }>();
    for (const r of rows) {
      const key = `${r.room_type_id}/${r.meal_plan}`;
      if (!plans.has(key)) {
        plans.set(key, {
          roomTypeId: r.room_type_id, roomType: r.room_type,
          mealPlan: r.meal_plan, mealPlanName: r.meal_plan_name,
        });
      }
    }

    return {
      from, to,
      plans: [...plans.values()],
      cells: rows.map((r) => ({
        roomTypeId: r.room_type_id, roomType: r.room_type,
        mealPlan: r.meal_plan, date: r.for_date,
        /* NULL travels as null, never as 0. An unpriced room is not a free
           one, and the screen renders a dash. */
        price: r.price === null ? null : Number(r.price),
        season: r.season,
        /* "rate" — priced for this date. "rack" — nobody has, and this is
           the room type's own rate. Two different facts that look identical
           if the screen renders them the same way. */
        source: r.source as "rate" | "rack" | null,
      })),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

/* Setting a price from the grid.

   The rearranging this needs — splitting the rack rate around a wedding
   weekend and putting its tail back afterwards — lives in app.set_rate, not
   here. The channel manager will write prices too when STAAH lands, and two
   callers doing the same range arithmetic is how the folio and the till drifted
   apart in 040. */
rates.put("/:code/rate-grid", async (c) => {
  type Body = {
    roomTypeId?: string; mealPlan?: string;
    from?: string; to?: string | null;
    price?: number | null; label?: string;
    /* An extra bed costs more in Diwali week than in June, so these travel
       with the season rather than living on a settings page. */
    extraAdult?: number | null; extraChild?: number | null;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.roomTypeId) return c.json(refuse("Which room type?"), 409);
  if (!input.mealPlan) return c.json(refuse("Which meal plan?"), 409);
  if (!input.from) return c.json(refuse("From which date?"), 409);

  /* null is a CLEARED cell and is allowed. undefined is a caller that forgot
     the field, and clearing a property's prices because a key was missing
     from a JSON body is not a thing this should do quietly. */
  const clearing = input.price === null;
  const price = clearing ? null : Number(input.price);
  if (!clearing && (!Number.isFinite(price) || (price as number) < 0)) {
    return c.json(refuse("A price is zero or more, or empty to clear it."), 409);
  }

  if (input.to && input.to <= input.from) {
    return c.json(refuse(
      "The end of a range has to be after its start. The last day is not "
      + "included, so a price through the 31st ends on the 1st of the next "
      + "month.",
    ), 409);
  }

  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;

      /* WHO, before anything else (INV-5, approved 16 September). Until
         then this checked no role at all — only RLS, which asks which
         hotel, not who — so a receptionist who typed the address could
         price a run of dates. First, because inside withSession a refusal
         after a write is a commit (MEMORY 243). */
      if (!(await setsRates(client, hotelId))) return "not-a-rate-setter" as const;

      /* The room type has to belong to THIS property. Without this the id is
         a hotel_id the caller supplies, and RLS would not save us — the
         insert names p_hotel separately. */
      const { rows: owned } = await client.query<{ name: string }>(
        `select name from room_types where id = $1 and hotel_id = $2`,
        [input.roomTypeId, hotelId],
      );
      if (!owned[0]) return refuse("No such room type here.");

      await client.query(
        `select app.set_rate($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10)`,
        [hotelId, input.roomTypeId, input.mealPlan, input.from,
         input.to ?? null, price, input.label ?? null, session.staffId,
         input.extraAdult ?? null, input.extraChild ?? null],
      );

      return {
        ok: true as const,
        roomType: owned[0].name,
        cleared: clearing,
      };
    });

    if (!result) return c.json({ error: "No such property." }, 404);
    /* 403, not 409: nothing about the request is wrong except who sent it. */
    if (result === "not-a-rate-setter") return c.json(refuse(RATE_SETTER_REFUSED), 403);
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error, { plan: input.mealPlan });
    if (reason) return c.json(refuse(reason), 409);
    /* app.set_rate raises its own refusals with a hint attached — a range that
       ends before it starts, a negative price. They are the caller's to fix,
       so they come back named rather than as a 500. */
    const message = error instanceof Error ? error.message : "";
    if (/rate range ends after it starts|a price is zero or more/.test(message)) {
      return c.json(refuse(message), 409);
    }
    throw error;
  }
});

/* ── What a party actually pays ────────────────────────────────────
   A booking screen has to be able to say "the third adult has no price"
   rather than quietly quoting for two. app.tariff_for returns a NULL total
   with `unpriced` naming what is missing, and this passes that through
   untouched — filling it in here with a zero is the mistake the whole
   function exists to prevent. */
rates.get("/:code/tariff", async (c) => {
  const q = c.req.query();
  if (!q["roomType"] || !q["from"] || !q["to"]) {
    return c.json(refuse("Which room type, and for which nights?"), 409);
  }

  const adults = Number(q["adults"] ?? 1);
  const children = Number(q["children"] ?? 0);
  if (!Number.isInteger(adults) || adults < 1) {
    return c.json(refuse("A stay has at least one adult."), 409);
  }
  if (!Number.isInteger(children) || children < 0) {
    return c.json(refuse("Children cannot be negative."), 409);
  }

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: owned } = await client.query<{ name: string; max: number }>(
      `select name, max_occupancy as max from room_types
        where id = $1 and hotel_id = $2`,
      [q["roomType"], hotelId]);
    if (!owned[0]) return refuse("No such room type here.");

    if (adults + children > owned[0].max) {
      return refuse(
        `${adults + children} people will not fit a ${owned[0].name} — it `
        + `sleeps ${owned[0].max}.`);
    }

    /* One row per night, because a season can change mid-stay and a single
       nightly figure would be wrong for half of it. */
    const { rows } = await client.query<{
      night: string; base: string | null;
      extra_adults: number; adult_rate: string | null;
      extra_children: number; child_rate: string | null;
      total: string | null; unpriced: string | null;
    }>(
      `select d::date::text as night, t.base::text, t.extra_adults,
              t.adult_rate::text, t.extra_children, t.child_rate::text,
              t.total::text, t.unpriced
         from generate_series($3::date, $4::date - 1, interval '1 day') d
         cross join lateral app.tariff_for($1, $2, d::date, $5, $6) t`,
      [q["roomType"], q["mealPlan"] ?? "EP", q["from"], q["to"],
       adults, children],
    );

    const nights = rows.map((r) => ({
      night: r.night,
      base: r.base === null ? null : Number(r.base),
      extraAdults: r.extra_adults,
      adultRate: r.adult_rate === null ? null : Number(r.adult_rate),
      extraChildren: r.extra_children,
      childRate: r.child_rate === null ? null : Number(r.child_rate),
      total: r.total === null ? null : Number(r.total),
      unpriced: r.unpriced,
    }));

    /* One unpriced night makes the STAY unpriced. Summing the rest would
       quote a number that is short by a night nobody notices. */
    const missing = [...new Set(nights.filter((n) => n.unpriced)
      .map((n) => n.unpriced!))];

    return {
      roomType: owned[0].name,
      nights,
      total: missing.length
        ? null
        : nights.reduce((sum, n) => sum + (n.total ?? 0), 0),
      unpriced: missing.length ? missing.join(", ") : null,
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok === false ? 409 : 200);
});

rates.post("/:code/restrictions", async (c) => {
  type Body = {
    roomTypeId?: string; from?: string; to?: string;
    stopSell?: boolean; closedArrival?: boolean; closedDeparture?: boolean;
    minNights?: number | null; maxNights?: number | null;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.roomTypeId || !input.from) {
    return c.json({ reason: "Which room type, and from when?" }, 409);
  }

  const min = input.minNights ?? null;
  const max = input.maxNights ?? null;
  if (min !== null && max !== null && min > max) {
    /* Named here as well as refused by the constraint. Two innocent
       numbers on a grid that between them accept nothing at all is not
       something a person spots by reading it back. */
    return c.json({
      reason: `A minimum of ${min} nights and a maximum of ${max} accepts ` +
        "no booking at all.",
    }, 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const to = input.to ?? input.from!;

    /* Applied across a range in one statement. A revenue manager closing
       a wedding weekend sets three days at once, and doing it a day at a
       time leaves the middle one open if the second call fails. */
    await client.query(
      `insert into rate_restrictions
         (hotel_id, room_type_id, for_date, stop_sell, closed_arrival,
          closed_departure, min_nights, max_nights, set_by)
       select $1, $2, d::date, $4, $5, $6, $7, $8, $9
         from generate_series($3::date, $10::date, interval '1 day') d
       on conflict (hotel_id, room_type_id, for_date) do update
          set stop_sell = excluded.stop_sell,
              closed_arrival = excluded.closed_arrival,
              closed_departure = excluded.closed_departure,
              min_nights = excluded.min_nights,
              max_nights = excluded.max_nights,
              set_by = excluded.set_by,
              set_at = now()`,
      [hotelId, input.roomTypeId, input.from,
       input.stopSell === true, input.closedArrival === true,
       input.closedDeparture === true, min, max, session.staffId, to],
    );

    /* A row saying nothing is removed by a trigger, so the count here is
       of dates that actually carry a rule. */
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from rate_restrictions
        where hotel_id = $1 and room_type_id = $2
          and for_date between $3 and $4`,
      [hotelId, input.roomTypeId, input.from, to],
    );

    return { ok: true as const, dates: Number(rows[0]!.n) };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});
