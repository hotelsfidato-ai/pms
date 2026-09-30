import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { priceProblem } from "../../validate.ts";

/* ══════════════════════════════════════════════════════════════════
   PRICING — one base, and everything else a difference from it

   The owner, 16 September 2026: a Deluxe, one person, no breakfast is
   the cheapest thing the hotel sells and IS the base; everything else
   is joined to it by a difference, "so that when a change happens it
   reflects all through the system". Migration 090 is the shape;
   docs/PRICING-PLAN.md is the plan; this is the one screen's API.

   WHAT THIS FILE DOES NOT DO — and the reason is the same each time:
   the arithmetic lives in the database, where the channel manager and
   any later caller will meet the same rules.

     · deciding a price        app.price_parts (typed → base + add-ons → rack → null)
     · splitting date ranges   app.set_rate, app.set_offset
     · the base covers one     app.set_base_price, the only writer of a base

   30 September (D27-188, D27-194, migration 181): a base per room type, or
   one base room type the others are derived from (+₹ or +%); add-ons set
   once per hotel - meals, double occupancy, extra adult and extra child.

   NULL IS NOT ZERO, anywhere below. An unpriced thing travels as null
   and the screen renders a dash. Nothing here invents a rupee.
   ══════════════════════════════════════════════════════════════════ */

export const pricing = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/** A database refusal, turned into something a person can act on. */
function reasonFor(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | undefined;
  if (!e?.code) return null;
  if (e.code === "23P01") {
    return "Another difference already covers part of those dates. A day "
      + "cannot have two, so change the one that is there or pick dates that "
      + "do not overlap it.";
  }
  if (e.code === "23514") return "That range or amount is not valid.";
  if (e.code === "23503") return "That room type or meal plan is not one this property has.";
  if (e.code === "23505") return "That is already set.";
  return null;
}

const num = (v: string | null) => (v === null ? null : Number(v));

/* ── Reading: the base, the differences, and what they add up to ──── */

/* One call for the whole screen. The calendar shows a month of base
   figures with the derived prices under each date, and asking for the
   basis, the differences and the grid separately would let the three
   disagree for a render. */
pricing.get("/:code/pricing", async (c) => {
  const fromParam = c.req.query("from");
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 31), 1), 62);

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const from = fromParam ?? (await businessDateFor(client, hotelId));

    const { rows: basisRows } = await client.query<{
      room_type_id: string; room_type: string; meal_plan: string;
      meal_plan_name: string; set_at: string;
    }>(
      /* ::text on every id and date, the convention in this service: the
          driver hands a `date` back as a JS Date, which JSON turns into a
          timestamp with a Z on the end — and a screen comparing it with
          "2028-01-01" then matches nothing. */
      `select b.room_type_id::text, rt.name as room_type, b.meal_plan,
              mp.name as meal_plan_name, b.set_at::text
         from pricing_basis b
         join room_types rt on rt.id = b.room_type_id
         join meal_plans  mp on mp.code = b.meal_plan
        where b.hotel_id = $1`,
      [hotelId],
    );

    const { rows: typeRows } = await client.query<{
      id: string; code: string; name: string; category: string | null;
      base_occupancy: number; max_occupancy: number; rack: string | null;
    }>(
      `select id::text, code, name, category, base_occupancy, max_occupancy,
              base_rate::text as rack
         from room_types
        where hotel_id = $1 and is_active
        order by sort_order, name`,
      [hotelId],
    );

    /* `meal_plans` has no sort order (011) — four rows, ordered by how much
       they include, which is the order a person reads them in. Written out
       rather than alphabetical, where AP would come before EP. */
    /* The owner's D27-164: the code with its words ("CP · Room + breakfast"),
       and RO is not offered - it is EP; old RO bookings read as before. */
    const { rows: planRows } = await client.query<{ code: string; name: string }>(
      `select code, code || ' · ' || includes as name from meal_plans
        where code <> 'RO'
        order by case code when 'EP' then 1 when 'CP' then 2
                           when 'MAP' then 3 when 'AP' then 4 when 'AI' then 5 else 6 end, code`,
    );

    const { rows: offsetRows } = await client.query<{
      id: string; kind: string; room_type_id: string | null;
      meal_plan: string | null; amount: string;
      valid_from: string; valid_to: string | null; label: string | null;
      unit: "rupees" | "percent";
    }>(
      `select id::text, kind, room_type_id::text, meal_plan, amount::text,
              valid_from::text, valid_to::text, label, unit
         from rate_offsets
        where hotel_id = $1
          and valid_from < ($2::date + $3::int)
          and (valid_to is null or valid_to > $2::date)
        order by kind, valid_from`,
      [hotelId, from, days],
    );

    /* PRICES TYPED BEFORE 181 (D27-194): kept exactly, listed so a person can
       see them and remove them. Everything in `rates` that is not a base -
       one guest, on the base plan - is one. */
    const { rows: olderRows } = await client.query<{
      id: string; room_type_id: string; meal_plan: string; price: string;
      valid_from: string; valid_to: string | null; label: string | null; covers: number;
    }>(
      `select r.id::text, r.room_type_id::text, r.meal_plan, r.price::text,
              r.valid_from::text, r.valid_to::text, r.label,
              coalesce(r.covers_persons, rt.base_occupancy) as covers
         from rates r
         join room_types rt on rt.id = r.room_type_id
        where r.hotel_id = $1
          and r.valid_from < ($2::date + $3::int)
          and (r.valid_to is null or r.valid_to > $2::date)
          and not (coalesce(r.covers_persons, 0) = 1 and r.meal_plan = coalesce(
                (select meal_plan from pricing_basis where hotel_id = $1), 'EP'))
        order by rt.sort_order, r.meal_plan, r.valid_from`,
      [hotelId, from, days],
    );

    /* The add-on or difference on the first day shown. Written once (181),
       so it is the same on every date; an older dated one reads as its first. */
    const onFrom = (o: (typeof offsetRows)[number]) =>
      o.valid_from <= from && (o.valid_to === null || o.valid_to > from);
    const addon = (kind: string, plan: string | null = null) => {
      const o = offsetRows.find((r) => r.kind === kind && r.meal_plan === plan && onFrom(r));
      return o ? Number(o.amount) : null;
    };

    /* The base figure per date, and every type × plan under it. Read
       through app.price_for so the screen shows exactly what a booking
       would be quoted — including which of the three layers answered. */
    const { rows: cellRows } = await client.query<{
      for_date: string; room_type_id: string; meal_plan: string;
      price: string | null; covers: number | null; source: string | null;
    }>(
      `with days as (
         select d::date as for_date
           from generate_series($2::date, $2::date + ($3::int - 1), interval '1 day') d
       ),
       types as (select id from room_types where hotel_id = $1 and is_active),
       plans as (select code from meal_plans)
       select d.for_date::text, t.id::text as room_type_id, p.code as meal_plan,
              f.price::text, f.covers, f.source
         from days d
         cross join types t
         cross join plans p
         cross join lateral app.price_for(t.id, p.code, d.for_date) f
        order by d.for_date, t.id, p.code`,
      [hotelId, from, days],
    );

    return {
      from,
      days,
      /* null until somebody chooses one. Until then nothing derives, and
         the screen says so rather than showing a grid of dashes with no
         explanation. */
      basis: basisRows[0]
        ? {
            roomTypeId: basisRows[0].room_type_id,
            roomType: basisRows[0].room_type,
            mealPlan: basisRows[0].meal_plan,
            mealPlanName: basisRows[0].meal_plan_name,
            setAt: basisRows[0].set_at,
          }
        : null,
      roomTypes: typeRows.map((t) => {
        const d = offsetRows.find((o) => o.kind === "room_type" && o.room_type_id === t.id && onFrom(o));
        return {
          id: t.id, code: t.code, name: t.name, category: t.category,
          baseOccupancy: t.base_occupancy, maxOccupancy: t.max_occupancy,
          /* The old rack rate: priced only where no base covers the date. */
          rack: num(t.rack),
          /* Its difference from the base room type, null never set (a dash). */
          difference: d ? { amount: Number(d.amount), unit: d.unit } : null,
        };
      }),
      mealPlans: planRows.map((p) => ({ code: p.code, name: p.name })),
      /* Set once per hotel (D27-188); null is a dash and not sold. */
      addons: {
        CP: addon("meal_plan", "CP"), MAP: addon("meal_plan", "MAP"),
        AP: addon("meal_plan", "AP"), AI: addon("meal_plan", "AI"),
        double: addon("double"), extraAdult: addon("extra_adult"),
        extraChild: addon("extra_child"),
      },
      older: olderRows.map((r) => ({
        id: r.id, roomTypeId: r.room_type_id, mealPlan: r.meal_plan,
        price: Number(r.price), from: r.valid_from, to: r.valid_to,
        label: r.label, covers: r.covers,
      })),
      offsets: offsetRows.map((o) => ({
        id: o.id,
        kind: o.kind as "room_type" | "meal_plan" | "double" | "extra_adult" | "extra_child",
        roomTypeId: o.room_type_id,
        mealPlan: o.meal_plan,
        amount: Number(o.amount),
        unit: o.unit,
        from: o.valid_from,
        to: o.valid_to,
        label: o.label,
      })),
      cells: cellRows.map((r) => ({
        date: r.for_date,
        roomTypeId: r.room_type_id,
        mealPlan: r.meal_plan,
        /* null travels as null. The screen renders a dash. */
        price: num(r.price),
        covers: r.covers,
        /* "typed" — somebody set this price outright. "derived" — base plus
           differences. "rack" — the room type's old fallback. null — nobody
           has priced it. Four different facts that look identical if the
           screen renders them the same way. */
        source: r.source as "typed" | "derived" | "rack" | null,
      })),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

/* ── Writing: which room is the base ──────────────────────────────── */

pricing.put("/:code/pricing/basis", async (c) => {
  type Body = { roomTypeId?: string | null; mealPlan?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  /* null (D27-188): no base room type - each type is priced from its own
     base. Absent is a caller that forgot, and is refused as before. */
  if (input.roomTypeId === undefined || input.roomTypeId === "") {
    return c.json(refuse("Which room type is the base?"), 409);
  }
  /* The base is one guest, room only (16 Sep, D27-188). */
  const mealPlan = input.mealPlan ?? "EP";

  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;

      if (input.roomTypeId === null) {
        await client.query("delete from pricing_basis where hotel_id = $1", [hotelId]);
        return { ok: true as const, roomType: null, mealPlan: null };
      }

      /* The room type has to belong to THIS property: the id comes from the
         caller, and RLS does not save us because the insert names hotel_id
         separately. rates.ts makes the same check for the same reason. */
      const { rows: owned } = await client.query<{ name: string }>(
        `select name from room_types where id = $1 and hotel_id = $2`,
        [input.roomTypeId, hotelId],
      );
      if (!owned[0]) return refuse("No such room type here.");

      await client.query(
        `insert into pricing_basis (hotel_id, room_type_id, meal_plan, set_by)
         values ($1, $2, $3, $4)
         on conflict (hotel_id) do update
            set room_type_id = excluded.room_type_id,
                meal_plan    = excluded.meal_plan,
                set_by       = excluded.set_by,
                set_at       = now()`,
        [hotelId, input.roomTypeId, mealPlan, session.staffId],
      );

      return { ok: true as const, roomType: owned[0].name, mealPlan };
    });

    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 409);
    throw error;
  }
});

/* ── Writing: the base figure ─────────────────────────────────────── */

/* Without a room type, the base room type's base (app.set_basis_price, which
   takes the type from `pricing_basis`). With one (D27-188), that type's own
   base - how a hotel with no base room type prices each type. */
pricing.put("/:code/pricing/base", async (c) => {
  type Body = {
    roomTypeId?: string; from?: string; to?: string | null;
    price?: number | null; label?: string; free?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.from) return c.json(refuse("From which date?"), 409);

  /* null is a CLEARED base and is allowed. undefined is a caller that forgot
     the field, and clearing a property's base because a key was missing is
     not a thing this should do quietly. */
  const clearing = input.price === null;
  const price = clearing ? null : Number(input.price);
  if (!clearing && (!Number.isFinite(price) || (price as number) < 0)) {
    return c.json(refuse("A base price is zero or more, or empty to clear it."), 409);
  }
  /* RT-2, X-1 (D27-120): a base of 0 put every room and plan that day at ₹0. */
  const zeroBase = priceProblem(price, input.free === true);
  if (zeroBase) return c.json(refuse(zeroBase), 409);
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

      if (input.roomTypeId) {
        const { rows: owned } = await client.query<{ name: string }>(
          `select name from room_types where id = $1 and hotel_id = $2`,
          [input.roomTypeId, hotelId],
        );
        if (!owned[0]) return refuse("No such room type here.");
        await client.query(
          `select app.set_base_price($1, $2, $3::date, $4::date, $5, $6, $7)`,
          [hotelId, input.roomTypeId, input.from, input.to ?? null, price,
           input.label ?? null, session.staffId],
        );
      } else {
        await client.query(
          `select app.set_basis_price($1, $2::date, $3::date, $4, $5, $6)`,
          [hotelId, input.from, input.to ?? null, price,
           input.label ?? null, session.staffId],
        );
      }

      return { ok: true as const, cleared: clearing };
    });

    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 409);
    /* app.set_basis_price refuses a property with no base yet, with the hint
       attached. That is the caller's to fix, so it comes back named. */
    const message = error instanceof Error ? error.message : "";
    if (/no base yet|ends after it starts|zero or more/.test(message)) {
      return c.json(refuse(
        /no base yet/.test(message)
          ? "Choose which room type and meal plan the base is before setting its price."
          : message,
      ), 409);
    }
    throw error;
  }
});

/* ── Writing: a difference ────────────────────────────────────────── */

pricing.put("/:code/pricing/offset", async (c) => {
  type Body = {
    kind?: "room_type" | "meal_plan";
    roomTypeId?: string | null; mealPlan?: string | null;
    from?: string; to?: string | null;
    amount?: number | null; label?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (input.kind !== "room_type" && input.kind !== "meal_plan") {
    return c.json(refuse("Is this difference about a room type or a meal plan?"), 409);
  }
  if (input.kind === "room_type" && !input.roomTypeId) {
    return c.json(refuse("Which room type?"), 409);
  }
  if (input.kind === "meal_plan" && !input.mealPlan) {
    return c.json(refuse("Which meal plan?"), 409);
  }
  if (!input.from) return c.json(refuse("From which date?"), 409);

  /* null CLEARS the range: nothing set means the base applies, which is the
     owner's own rule. A zero would be a claim that the difference is nothing,
     which reads the same on a screen and is not the same fact. */
  const clearing = input.amount === null;
  const amount = clearing ? null : Number(input.amount);
  if (!clearing && !Number.isFinite(amount)) {
    return c.json(refuse("A difference is an amount in rupees, or empty to clear it."), 409);
  }
  if (input.to && input.to <= input.from) {
    return c.json(refuse(
      "The end of a range has to be after its start. The last day is not "
      + "included, so a difference through the 31st ends on the 1st of the "
      + "next month.",
    ), 409);
  }

  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;

      if (input.kind === "room_type") {
        const { rows: owned } = await client.query<{ name: string }>(
          `select name from room_types where id = $1 and hotel_id = $2`,
          [input.roomTypeId, hotelId],
        );
        if (!owned[0]) return refuse("No such room type here.");

        /* The base has no difference from itself (090). Refused here in
           words rather than written and silently ignored by app.price_for,
           which is worse: a number on the screen that changes nothing. */
        const { rows: basis } = await client.query<{ room_type_id: string }>(
          `select room_type_id from pricing_basis where hotel_id = $1`, [hotelId],
        );
        if (basis[0]?.room_type_id === input.roomTypeId) {
          return refuse(
            `${owned[0].name} is the base room, so it has no difference from `
            + `itself. To change what it costs, set the base price - every `
            + `other price follows it.`,
          );
        }
      }

      await client.query(
        `select app.set_offset($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9)`,
        [hotelId, input.kind,
         input.kind === "room_type" ? input.roomTypeId : null,
         input.kind === "meal_plan" ? input.mealPlan : null,
         input.from, input.to ?? null, amount,
         input.label ?? null, session.staffId],
      );

      return { ok: true as const, cleared: clearing };
    });

    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 409);
    const message = error instanceof Error ? error.message : "";
    if (/ends after it starts|room type or a meal plan/.test(message)) {
      return c.json(refuse(message), 409);
    }
    throw error;
  }
});

/* ── Writing: an add-on, or a room type's difference (D27-188) ────────
   Set ONCE per hotel: one figure for every date, replacing whatever was on
   file for it (app.set_addon). null clears it - a dash, and nothing that
   needs it is sold. 0 only with Free ticked (D27-120). A room type's
   difference from the base type may be rupees or a percentage, rounded to
   the whole rupee (D27-194); the base type has none. */
const ADDON_KINDS = ["room_type", "meal_plan", "double", "extra_adult", "extra_child"] as const;
const MEAL_ADDONS = ["CP", "MAP", "AP", "AI"];

pricing.put("/:code/pricing/addon", async (c) => {
  type Body = {
    kind?: (typeof ADDON_KINDS)[number]; roomTypeId?: string; mealPlan?: string;
    amount?: number | null; unit?: "rupees" | "percent"; free?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.kind || !ADDON_KINDS.includes(input.kind)) {
    return c.json(refuse("Which add-on: a meal plan, double occupancy, an extra adult or child, or a room type's difference?"), 409);
  }
  if (input.kind === "meal_plan" && !MEAL_ADDONS.includes(input.mealPlan ?? "")) {
    return c.json(refuse("Which meal plan: CP, MAP, AP or AI? EP is the base itself."), 409);
  }
  if (input.kind === "room_type" && !input.roomTypeId) {
    return c.json(refuse("Which room type?"), 409);
  }
  if (input.amount === undefined) {
    return c.json(refuse("How much, or empty to clear it?"), 409);
  }
  const amount = input.amount === null ? null : Number(input.amount);
  const percent = input.kind === "room_type" && input.unit === "percent";
  if (input.unit === "percent" && input.kind !== "room_type") {
    return c.json(refuse("Only a room type's difference can be a percentage."), 409);
  }
  if (amount !== null) {
    if (!Number.isFinite(amount)) return c.json(refuse("That is not an amount."), 409);
    if (input.kind === "room_type") {
      /* A difference may be below the base (090), but never the whole of it. */
      if (percent && amount <= -100) {
        return c.json(refuse("A room type cannot cost 100% less than the base."), 409);
      }
    } else {
      const problem = priceProblem(amount, input.free === true);
      if (problem) return c.json(refuse(problem), 409);
    }
  }

  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;

      if (input.kind === "room_type") {
        const { rows: owned } = await client.query<{ name: string; base: boolean }>(
          `select name, exists (select 1 from pricing_basis b
                                 where b.hotel_id = $2 and b.room_type_id = $1) as base
             from room_types where id = $1 and hotel_id = $2`,
          [input.roomTypeId, hotelId],
        );
        if (!owned[0]) return refuse("No such room type here.");
        if (owned[0].base) {
          return refuse(`${owned[0].name} is the base room type, so it has no difference from itself.`);
        }
      }

      await client.query(
        `select app.set_addon($1, $2, $3, $4, $5, $6, $7)`,
        [hotelId, input.kind,
         input.kind === "room_type" ? input.roomTypeId : null,
         input.kind === "meal_plan" ? input.mealPlan : null,
         amount, percent ? "percent" : "rupees", session.staffId],
      );
      return { ok: true as const, cleared: amount === null };
    });

    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 409);
    throw error;
  }
});
