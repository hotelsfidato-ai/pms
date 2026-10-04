import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { PoolClient as Client } from "pg";
import { inr } from "../../reportRender.ts";

/* Split out of api/src/routes/inventorySetup.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: finance.
   Every endpoint is unchanged, byte for byte, and the router keeps the
   name it had there. `refuse` and `hotelFor` are copies of the ones in
   modules/inventory/inventorySetup.ts — each route file keeps its own. */

const inventorySetup = new Hono<{ Variables: { subject: string } }>();
export { inventorySetup as tax };

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/* ══════════════════════════════════════════════════════════════════
   GST, IN ONE PLACE, FOR THE WHOLE PROPERTY

   The front desk and the till used to hold separate answers: the desk
   read `hotels.cgst_rate + sgst_rate` and the till read
   `pos_menu_items.tax_rate default 5.00`. Two places, and a menu that
   silently taxed itself.

   One screen now sets both. A KIND is what is being sold — the room, the
   restaurant, the bar — and a kind may have SLABS, because the rate on a
   room turns on what the room costs. Everything the desk posts follows
   'room'; every menu category names the kind it sells under.

   A kind with no rule cannot be billed. That is deliberate and it is the
   same rule as everywhere else here: a missing number is a dash, and a
   dash is not a zero.
   ══════════════════════════════════════════════════════════════════ */

/* ⚠ "spa" WAS MISSING UNTIL 21 SEPTEMBER. Migration 119 let tax_rules hold a
   spa rule and closing a treatment demands one (D18-21), but this list is the
   only way a person sets a rule — so no hotel could ever bill a treatment.
   Its own test inserted the rule straight into the database and passed
   (root MEMORY 313). */
/* ⚠ "alcohol" IS VAT, NOT GST (D21-91, 22 September), and only where the
   property is switched on for it (D21-90). Its rule is the VAT rate: one
   rate, never slabs, never halved into CGST and SGST, and never seeded - the
   accountant confirms it here, and until somebody does, nothing sold under it
   can be billed. */
/* "laundry" is its own heading since D27-194 (it went under "room" before). */
const TAX_KINDS = ["room", "restaurant", "bar", "banquet", "spa", "alcohol", "laundry", "other"] as const;
type TaxKind = (typeof TAX_KINDS)[number];

/** Whether the property is switched on for alcohol (D21-90) - the same
    question the till asks before it rings a drink up. Off unless an owner or
    administrator turned it on: app.module_enabled reads no row as off. */
async function servesAlcohol(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ on: boolean }>(
    "select app.module_enabled($1, 'alcohol') as on", [hotelId]);
  return rows[0]?.on === true;
}

const NOT_SERVING_ALCOHOL =
  "This property is not switched on for alcohol. The owner or an "
  + "administrator turns it on in Settings, under Modules.";

inventorySetup.get("/:code/tax", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; kind: string; over_amount: string; rate: string;
      note: string | null; set_by: string | null;
    }>(
      `select t.id::text, t.kind, t.over_amount::text, t.rate::text, t.note,
              s.full_name as set_by
         from tax_rules t
         left join staff s on s.id = t.set_by
        where t.hotel_id = $1
        order by t.kind, t.over_amount`,
      [hotelId]);

    /* Which menu categories sell under which kind, so the screen can say
       "nothing is set for the bar, and these four categories need it". */
    const { rows: cats } = await client.query<{
      name: string; kind: string | null; items: number;
    }>(
      `select c.name, c.tax_kind as kind, count(i.id)::int as items
         from pos_menu_categories c
         left join pos_menu_items i on i.category_id = c.id and i.is_active
        where c.hotel_id = $1 and c.is_active
        group by c.name, c.tax_kind
        order by c.name`,
      [hotelId]);

    const byKind = new Map<string, typeof rows>();
    for (const r of rows) {
      byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
    }

    /* Alcohol is listed only where the property serves it (D21-90). A rate
       set before the switch went off stays in the table, unused, and comes
       back with the switch. */
    const alcohol = await servesAlcohol(client, hotelId);

    /* The SAC printed on a line of each kind (D27-258 Q6). Null: not said -
       rooms keep the invoice's 996311, the others show a dash. */
    const { rows: sacs } = await client.query<{ kind: string; sac_code: string }>(
      "select kind, sac_code from tax_sac where hotel_id = $1", [hotelId]);
    const sacOf = new Map(sacs.map((r) => [r.kind, r.sac_code]));

    return {
      servesAlcohol: alcohol,
      kinds: TAX_KINDS.filter((kind) => kind !== "alcohol" || alcohol).map((kind) => ({
        kind,
        sac: sacOf.get(kind) ?? null,
        slabs: (byKind.get(kind) ?? []).map((r) => ({
          id: r.id,
          overAmount: Number(r.over_amount),
          rate: Number(r.rate),
          note: r.note,
          setBy: r.set_by,
        })),
      })),
      categories: cats.map((x) => ({
        name: x.name, kind: x.kind, items: x.items,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/** Replace every slab for ONE kind, in one call.

    Whole-kind rather than row-by-row on purpose: the slabs of a kind only
    make sense together. Editing them one at a time passes through states
    like "18% above 7,500 and nothing below it", where a ₹4,000 room
    cannot be billed at all — briefly, silently, and in the middle of a
    day the hotel is trading. */
inventorySetup.put("/:code/tax/:kind", async (c) => {
  const kind = c.req.param("kind") as TaxKind;
  if (!TAX_KINDS.includes(kind)) {
    return c.json(refuse(`${kind} is not something this system taxes.`), 409);
  }

  type Slab = { overAmount?: number; rate?: number; note?: string | null };
  const input = await c.req.json<{ slabs?: Slab[] }>()
    .catch(() => ({}) as { slabs?: Slab[] });
  const slabs = input.slabs ?? [];

  for (const s of slabs) {
    if (!Number.isFinite(s.rate) || s.rate! < 0 || s.rate! > 100) {
      return c.json(refuse(
        `A ${kind === "alcohol" ? "VAT" : "GST"} rate is a percentage between 0 and 100.`), 409);
    }
    if (s.overAmount !== undefined
        && (!Number.isFinite(s.overAmount) || s.overAmount < 0)) {
      return c.json(refuse("A slab starts at zero or more."), 409);
    }
  }

  /* A kind with slabs but no base row has a hole under the lowest one,
     and anything falling in it cannot be billed. Caught here, with the
     reason, rather than discovered by a clerk at the desk. */
  if (slabs.length > 0 && !slabs.some((s) => (s.overAmount ?? 0) === 0)) {
    return c.json(refuse(
      "The first slab has to start at zero, or there is no rate for the "
      + "cheapest rooms. Add a row for everything up to the threshold."), 409);
  }

  /* VAT on alcohol is one rate on everything (D21-91): "one VAT 10% line on
     the bill". A band would print two. */
  if (kind === "alcohol" && (slabs.length > 1 || (slabs[0]?.overAmount ?? 0) !== 0)) {
    return c.json(refuse("VAT on alcohol is one rate, on everything."), 409);
  }

  const seen = new Set<number>();
  for (const s of slabs) {
    const over = s.overAmount ?? 0;
    if (seen.has(over)) {
      return c.json(refuse(
        `Two slabs both start above ₹${over}. One boundary, one rate.`), 409);
    }
    seen.add(over);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Asked BEFORE the delete below: a refusal returned after a write
       inside withSession keeps the write (MEMORY 243). */
    if (kind === "alcohol" && !(await servesAlcohol(client, hotelId))) {
      return refuse(NOT_SERVING_ALCOHOL);
    }

    /* Deleting a kind's rules is allowed and MEANS SOMETHING: it puts
       that kind back to unset, so it refuses to bill rather than billing
       at nought. Emptying the bar is how you take the bar down. */
    await client.query(
      "delete from tax_rules where hotel_id = $1 and kind = $2",
      [hotelId, kind]);

    for (const s of slabs) {
      await client.query(
        `insert into tax_rules (hotel_id, kind, over_amount, rate, note, set_by)
         values ($1,$2,$3,$4,$5, app.current_user_id())`,
        [hotelId, kind, s.overAmount ?? 0, s.rate, s.note?.trim() || null]);
    }

    return { ok: true as const, slabs: slabs.length };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/** A tax kind's SAC code (D27-258 Q6): six digits, or null to clear it.
    The codes are the CA's - nothing here suggests one. */
inventorySetup.put("/:code/tax/:kind/sac", async (c) => {
  const kind = c.req.param("kind") as TaxKind;
  if (!TAX_KINDS.includes(kind)) {
    return c.json(refuse(`${kind} is not something this system taxes.`), 409);
  }
  const input = await c.req.json<{ sacCode?: unknown }>().catch(() => ({}) as { sacCode?: unknown });
  const sac = input.sacCode === null ? null : typeof input.sacCode === "string" ? input.sacCode.trim() : undefined;
  if (sac === undefined || (sac !== null && !/^\d{6}$/.test(sac))) {
    return c.json(refuse("A SAC code is six digits, like 996311."), 409);
  }
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (sac === null) {
      await client.query("delete from tax_sac where hotel_id = $1 and kind = $2", [hotelId, kind]);
    } else {
      await client.query(
        `insert into tax_sac (hotel_id, kind, sac_code) values ($1, $2, $3)
         on conflict (hotel_id, kind) do update set sac_code = excluded.sac_code`, [hotelId, kind, sac]);
    }
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

/** Which tax kind a menu category sells under — the till's half of the
    same screen. A category with no kind cannot be sold, and says so. */
inventorySetup.patch("/:code/menu-categories/:name/tax-kind", async (c) => {
  const input = await c.req.json<{ kind?: string | null }>()
    .catch(() => ({}) as { kind?: string | null });
  const kind = input.kind ?? null;

  if (kind !== null && !TAX_KINDS.includes(kind as TaxKind)) {
    return c.json(refuse(`${kind} is not something this system taxes.`), 409);
  }
  if (kind === "room") {
    return c.json(refuse(
      "A menu category cannot be taxed as a room. Rooms are the front "
      + "desk's; a category sells under the restaurant, the bar or "
      + "banqueting."), 409);
  }
  /* The database refuses it too (067's check on pos_menu_categories); this
     says so in a sentence instead of an error. */
  if (kind === "spa" || kind === "laundry") {
    return c.json(refuse(
      `A menu category cannot be taxed as the ${kind}. That heading is the `
      + `${kind}'s own; a category sells under the restaurant, the bar or `
      + "banqueting."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (kind === "alcohol" && !(await servesAlcohol(client, hotelId))) {
      return refuse(NOT_SERVING_ALCOHOL);
    }

    const { rowCount } = await client.query(
      `update pos_menu_categories set tax_kind = $3
        where hotel_id = $1 and name = $2`,
      [hotelId, c.req.param("name"), kind]);

    if (!rowCount) return refuse("No such menu category.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/** The rate one charge of this kind and value would carry, or null where no
    rule covers it - `app.gst_rate_or_null`, the one place the slab is worked
    out - so the Add charge dialog shows what the posting will really carry
    rather than a second copy of the arithmetic (or a fixed 2.5% + 2.5%). */
inventorySetup.get("/:code/tax/:kind/rate", async (c) => {
  const kind = c.req.param("kind") as TaxKind;
  if (!TAX_KINDS.includes(kind)) {
    return c.json(refuse(`${kind} is not something this system taxes.`), 409);
  }
  const amount = Number(c.req.query("amount"));
  if (!Number.isFinite(amount) || amount < 0) {
    return c.json(refuse("An amount is a number of rupees, zero or more."), 409);
  }

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ rate: string | null }>(
      "select app.gst_rate_or_null($1, $2, $3::numeric)::text as rate",
      [hotelId, kind, amount]);
    const rate = rows[0]?.rate ?? null;
    return {
      kind,
      amount,
      /* Null is "nobody has set it": the dialog prints a dash, never 0%. */
      rate: rate === null ? null : Number(rate),
      scheme: kind === "alcohol" ? ("vat" as const) : ("gst" as const),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ══════════════════════════════════════════════════════════════════
   A ROOM RATE THAT INCLUDES GST (D27-187, D27-195)

   The typed figure a night is split into the rate before GST and the GST
   by the slab, WORKED ON THE PRE-TAX VALUE (app.gst_rate_or_null, the one
   place the slab is decided), rounded a night as the audit rounds it:
   pre + round(pre x rate / 100, 2). A slab counts only when the figure's
   own pre-tax value falls in it; then, of the paisa splits near it, the
   nearest total NOT above the typed figure (the owner: a figure no split
   reaches exactly, like 502, is billed 501.99). No slab holds it: the gap
   between two slabs, refused in the owner's words with the card's own
   figures; no room rule at all: refused, never a zero.
   ══════════════════════════════════════════════════════════════════ */
export async function roomRateBeforeGst(
  client: Client, hotelId: string, gross: number,
): Promise<{ ok: true; pre: number; rate: number; total: number } | { ok: false; reason: string }> {
  if (!Number.isFinite(gross) || !(gross > 0)) {
    return refuse("A rate that includes GST is an amount above zero.");
  }
  const g = Math.round(gross * 100) / 100;
  const { rows } = await client.query<{ pre: string; rate: string; total: string }>(
    `with slab as (
       select distinct t.rate from tax_rules t
        where t.hotel_id = $1 and t.kind = 'room'
          and app.gst_rate_or_null($1, 'room', $2::numeric / (1 + t.rate / 100)) = t.rate),
     near as (
       select s.rate, round($2::numeric / (1 + s.rate / 100), 2) + d * 0.01 as pre
         from slab s, generate_series(-3, 3) d)
     select pre::text, rate::text, (pre + round(pre * rate / 100, 2))::text as total
       from near
      where pre > 0 and app.gst_rate_or_null($1, 'room', pre) = rate
        and pre + round(pre * rate / 100, 2) <= $2::numeric
      order by pre + round(pre * rate / 100, 2) desc, pre desc
      limit 1`,
    [hotelId, g]);
  const best = rows[0];
  if (best) {
    return { ok: true, pre: Number(best.pre), rate: Number(best.rate), total: Number(best.total) };
  }

  const { rows: gap } = await client.query<{ lo: string; hi: string }>(
    `select (b.over_amount * (1 + below.rate / 100))::text as lo,
            (b.over_amount * (1 + b.rate / 100))::text as hi
       from tax_rules b
       join lateral (
         select l.rate from tax_rules l
          where l.hotel_id = b.hotel_id and l.kind = 'room' and l.over_amount < b.over_amount
          order by l.over_amount desc limit 1) below on true
      where b.hotel_id = $1 and b.kind = 'room'
        and $2::numeric > b.over_amount * (1 + below.rate / 100)
        and $2::numeric <= b.over_amount * (1 + b.rate / 100)
      limit 1`,
    [hotelId, g]);
  if (gap[0]) {
    const rupees = (n: string) => `₹${inr(Number(n)).replace(/\.00$/, "")}`;
    const [lo, hi] = [rupees(gap[0].lo), rupees(gap[0].hi)];
    return refuse(`An inclusive rate between ${lo} and ${hi} can't be split under the GST slab: `
      + `type ${lo} or less, or more than ${hi}.`);
  }
  return refuse("This property has no GST rule for rooms, so a rate that includes GST cannot be "
    + "split. Set it in the GST card first. A missing rate is not zero.");
}

/** The split, for the one page to show before saving (D27-195). */
inventorySetup.get("/:code/tax/room/before-gst", async (c) => {
  const gross = Number(c.req.query("gross"));
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    return hotelId ? roomRateBeforeGst(client, hotelId, gross) : null;
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
