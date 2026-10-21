import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { mayStock, STOCK_REFUSED } from "./stockGrants.ts";
import { barDrinks, barStore } from "./stores.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT EACH BAR DISH TAKES (the owner's D27-354, 21 October)

   Each bar dish - and each of its sizes - takes so many ml of a bottle
   (Imperial Blue 60 ml: 60 ml of "Imperial Blue 750 ml") or so many whole
   ones (a NIP: one "Imperial Blue 180 ml"; a beer: one bottle). Set once by
   whoever may edit the Store; read by migration 235's trigger, which takes
   it off the bar's store when the line is sent.

   GET /:code/bar/pours    every bar dish and size, what it takes now, and a
                           PROPOSAL from the names for those not set - shown,
                           never saved until somebody saves it
   PUT /:code/bar/pours    { pours: [{ itemId, variationId, stockItemId|null,
                           ml|null, units|null }] } - null clears one
   ══════════════════════════════════════════════════════════════════ */

export const barPours = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

type Drink = Awaited<ReturnType<typeof barDrinks>>[number];
type Pour = { stockItemId: string; ml: number | null; units: number | null };

/** What the names suggest, for a dish and size nobody has set. A drink named
    "<dish> <N> ml" is taken whole; a peg (under 200 ml) is that many ml of
    the dish's biggest bottle; a NIP is one "<dish> 180 ml"; a dish with no
    sizes, one bottle of the drink named as it is. Null when nothing fits. */
export function propose(dish: string, size: string | null, drinks: readonly Drink[]): Pour | null {
  const named = (name: string) => drinks.find((d) => d.name.trim().toLowerCase() === name.toLowerCase());
  const same = drinks.filter((d) => d.name.toLowerCase().startsWith(dish.toLowerCase()) && d.sizeMl);
  if (size === null) {
    const d = named(dish);
    return d ? { stockItemId: d.id, ml: null, units: 1 } : null;
  }
  if (/^nip$/i.test(size.trim())) {
    const d = named(`${dish} 180 ml`);
    return d ? { stockItemId: d.id, ml: null, units: 1 } : null;
  }
  const m = /^(\d{1,5})\s*ml$/i.exec(size.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const whole = named(`${dish} ${n} ml`);
  if (whole) return { stockItemId: whole.id, ml: null, units: 1 };
  if (n >= 200) return null;
  const bottle = [...same].sort((a, b) => (b.sizeMl ?? 0) - (a.sizeMl ?? 0))[0];
  return bottle && (bottle.sizeMl ?? 0) > n ? { stockItemId: bottle.id, ml: n, units: null } : null;
}

barPours.get("/:code/bar/pours", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "view"))) return { forbidden: STOCK_REFUSED.view };
    const store = await barStore(client, hotelId);
    const drinks = await barDrinks(client, hotelId, store?.id ?? null);
    const { rows } = await client.query<{
      item_id: string; item: string; category: string; variation_id: string | null; size: string | null;
      stock_item_id: string | null; ml: number | null; units: string | null;
    }>(
      `with sizes as (
         select i.id as item_id, i.name as item, c.name as category, c.sort_order as c_sort,
                i.sort_order as i_sort, v.id as variation_id, v.label as size, v.sort_order as v_sort
           from pos_menu_items i
           join pos_menu_categories c on c.id = i.category_id
           left join pos_item_variations v on v.item_id = i.id and v.is_active
          where i.hotel_id = $1 and i.is_active and c.tax_kind in ('bar', 'alcohol'))
       select s.item_id::text, s.item, s.category, s.variation_id::text, s.size,
              p.stock_item_id::text, p.ml, p.units::text
         from sizes s
         left join bar_pours p on p.item_id = s.item_id
                              and p.variation_id is not distinct from s.variation_id
        order by s.c_sort nulls last, s.category, s.i_sort nulls last, s.item, s.v_sort nulls last, s.size`,
      [hotelId]);
    return {
      store, drinks,
      dishes: rows.map((r) => {
        const pour: Pour | null = r.stock_item_id
          ? { stockItemId: r.stock_item_id, ml: r.ml, units: r.units === null ? null : Number(r.units) } : null;
        return {
          itemId: r.item_id, item: r.item, category: r.category, variationId: r.variation_id, size: r.size,
          pour, proposed: pour ? null : propose(r.item, r.size, drinks),
        };
      }),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

barPours.put("/:code/bar/pours", async (c) => {
  type In = { itemId?: string; variationId?: string | null; stockItemId?: string | null;
              ml?: number | null; units?: number | null };
  const input = await c.req.json<{ pours?: In[] }>().catch(() => ({}) as { pours?: In[] });
  const pours = Array.isArray(input.pours) ? input.pours : [];
  if (pours.length === 0) return c.json(refuse("Nothing to save."), 409);
  for (const p of pours) {
    if (!p.itemId) return c.json(refuse("Which dish?"), 409);
    if (!p.stockItemId) continue;
    const hasMl = p.ml !== null && p.ml !== undefined;
    const hasUnits = p.units !== null && p.units !== undefined;
    if (hasMl === hasUnits) return c.json(refuse("Say either how many ml it takes, or how many whole ones."), 409);
    if (hasMl && (!Number.isInteger(p.ml) || p.ml! < 1 || p.ml! > 20000)) {
      return c.json(refuse("ml are whole, from 1 to 20,000."), 409);
    }
    if (hasUnits && (!Number.isFinite(p.units) || p.units! <= 0 || p.units! > 1000)) {
      return c.json(refuse("How many whole ones: more than none."), 409);
    }
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "edit"))) return { forbidden: STOCK_REFUSED.edit };
    const drinks = new Map((await barDrinks(client, hotelId, null)).map((d) => [d.id, d]));
    const { rows: sizes } = await client.query<{ item_id: string; variation_id: string | null; item: string }>(
      `select i.id::text as item_id, v.id::text as variation_id, i.name as item
         from pos_menu_items i
         join pos_menu_categories c on c.id = i.category_id
         left join pos_item_variations v on v.item_id = i.id
        where i.hotel_id = $1 and c.tax_kind in ('bar', 'alcohol')`, [hotelId]);
    const known = new Set(sizes.map((s) => `${s.item_id}/${s.variation_id ?? ""}`));
    for (const p of pours) {
      if (!known.has(`${p.itemId}/${p.variationId ?? ""}`)) return refuse("That is not a bar dish or one of its sizes.");
      if (!p.stockItemId) continue;
      const d = drinks.get(p.stockItemId);
      if (!d) return refuse("That drink is not on the bar's list.");
      if (p.ml && !d.sizeMl) return refuse(`${d.name} has no bottle size, so it cannot be poured in ml. Take whole ones.`);
      if (p.ml && p.ml > d.sizeMl!) return refuse(`${d.name} holds ${d.sizeMl} ml: a dish cannot take more of one bottle.`);
    }
    for (const p of pours) {
      await client.query(
        `delete from bar_pours where hotel_id = $1 and item_id = $2 and variation_id is not distinct from $3::uuid`,
        [hotelId, p.itemId, p.variationId ?? null]);
      if (p.stockItemId) {
        await client.query(
          `insert into bar_pours (hotel_id, item_id, variation_id, stock_item_id, ml, units, set_by)
           values ($1, $2, $3::uuid, $4, $5, $6, $7)`,
          [hotelId, p.itemId, p.variationId ?? null, p.stockItemId, p.ml ?? null, p.units ?? null, session.staffId]);
      }
    }
    return { ok: true as const, saved: pours.length };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});
