import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { PoolClient as Client } from "pg";

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

const TAX_KINDS = ["room", "restaurant", "bar", "banquet", "other"] as const;
type TaxKind = (typeof TAX_KINDS)[number];

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

    return {
      kinds: TAX_KINDS.map((kind) => ({
        kind,
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
      return c.json(refuse("A GST rate is a percentage between 0 and 100."), 409);
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

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

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
