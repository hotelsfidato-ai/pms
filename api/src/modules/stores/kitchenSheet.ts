import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { holdsRoleAt, KITCHEN_KEEPERS, STOCK_REFUSED, STOCK_ROLES } from "./stockGrants.ts";
import { countLinesProblem, saveCount } from "./stores.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN'S STOCK (the owner's D27-373 and D27-374): Inventory's
   Restaurant tab, the bar's sheet (barSheet.ts) for the kitchen store.

   THE SHEET: per Store item, the day's Opening, Received (deliveries),
   Moved in and Moved out (moves between stores, hand issues, returns),
   Used by KOTs (the issues migration 253's trigger made), Wastage (the
   Store's and every dish struck after its KOT, with the reason), Corrected
   (the counts) and Closing - which is all of them added up - and the day's
   closing count. Below zero is shown red; a delivery or a count puts it right.

   RECIPES: what one of a dish takes, in each Store item's own unit; a size,
   a side and a numbered add-on have lines of their own, on top of the dish's.
   A dish with none takes nothing, and the tab lists it.

   GET  /:code/kitchen-stock/sheet?date=     whoever sees the Store
   POST /:code/kitchen-stock/count           { lines }               } KITCHEN_KEEPERS:
   PUT  /:code/kitchen-stock/store           { locationId }          } the owner, an
   GET  /:code/kitchen-stock/recipes         whoever sees the Store  } Admin, the GM,
   PUT  /:code/kitchen-stock/recipes         { owner, lines }        } the Inventory Manager
   ══════════════════════════════════════════════════════════════════ */

export const kitchenSheet = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const KEEP_REFUSED = "Recipes, the kitchen's count and which store is the kitchen's are for the owner, "
  + "an administrator, the general manager and the Inventory Manager.";
const NO_STORE = "No store is marked as the kitchen's yet. Pick it on Inventory, Restaurant.";

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

async function kitchenStore(
  client: Client, hotelId: string,
): Promise<{ id: string; name: string; isActive: boolean } | null> {
  const { rows } = await client.query<{ id: string; name: string; is_active: boolean }>(
    "select id::text, name, is_active from locations where hotel_id = $1 and is_kitchen_store", [hotelId]);
  return rows[0] ? { id: rows[0].id, name: rows[0].name, isActive: rows[0].is_active } : null;
}

/** The stores that may be the kitchen's: any store switched on, never the bar's. */
async function storesToMark(client: Client, hotelId: string) {
  const { rows } = await client.query<{ id: string; name: string }>(
    `select id::text, name from locations
      where hotel_id = $1 and kind = 'store' and is_active and not is_bar_store and not is_bar_counter
      order by name`, [hotelId]);
  return rows;
}

const LIVE = `m.reverses_id is null
  and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`;

kitchenSheet.get("/:code/kitchen-stock/sheet", async (c) => {
  const asked = c.req.query("date");
  if (asked !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asked)) return c.json(refuse("Pick a date."), 409);
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, STOCK_ROLES.view))) return { forbidden: STOCK_REFUSED.view };
    const mayKeep = await holdsRoleAt(client, hotelId, KITCHEN_KEEPERS);
    const businessDate = await businessDateFor(client, hotelId);
    const date = asked ?? businessDate;
    const store = await kitchenStore(client, hotelId);
    const head = { businessDate, date, store, mayKeep, stores: mayKeep ? await storesToMark(client, hotelId) : [] };
    if (!store) return { ...head, mayCount: false, items: [], wasted: [] };

    const { rows } = await client.query<{
      id: string; name: string; unit: string; opening: string; received: string; moved_in: string;
      moved_out: string; used: string; wasted: string; corrected: string; closing: string; on_hand: string;
      counted: string | null; count_book: string | null;
    }>(
      `with mv as (
         select m.item_id, m.business_date, m.kind, m.quantity, m.pos_line_id
           from stock_movements m
          where m.hotel_id = $1 and m.location_id = $2 and not m.empty and m.business_date <= $3::date and ${LIVE})
       select i.id::text, i.name, i.unit,
              coalesce(sum(mv.quantity) filter (where mv.business_date < $3::date), 0)::text as opening,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind = 'receipt'), 0)::text as received,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date
                and mv.kind = 'transfer' and mv.quantity > 0), 0)::text as moved_in,
              coalesce(-sum(mv.quantity) filter (where mv.business_date = $3::date
                and (mv.kind in ('return', 'breakage') or (mv.kind = 'transfer' and mv.quantity < 0)
                     or (mv.kind = 'issue' and mv.pos_line_id is null))), 0)::text as moved_out,
              coalesce(-sum(mv.quantity) filter (where mv.business_date = $3::date
                and mv.kind = 'issue' and mv.pos_line_id is not null), 0)::text as used,
              coalesce(-sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind = 'wastage'), 0)::text as wasted,
              coalesce(sum(mv.quantity) filter (where mv.business_date = $3::date and mv.kind = 'adjustment'), 0)::text as corrected,
              coalesce(sum(mv.quantity), 0)::text as closing,
              app.stock_on_hand(i.id, $2)::text as on_hand,
              cl.counted::text, cl.book::text as count_book
         from stock_items i
         left join mv on mv.item_id = i.id
         left join lateral (
           select counted, book from stock_count_lines
            where item_id = i.id and location_id = $2 and business_date = $3::date and not empty and moment = 'closing'
            order by counted_at desc limit 1) cl on true
        where i.hotel_id = $1
        group by i.id, i.name, i.unit, cl.counted, cl.book
       having exists (select 1 from recipe_lines r where r.stock_item_id = i.id)
           or coalesce(sum(mv.quantity), 0) <> 0
           or count(*) filter (where mv.business_date = $3::date) > 0
        order by i.name`,
      [hotelId, store.id, date]);

    /* The day's wastage, each with its reason: the Store's own, and every dish
       struck after its KOT (253). */
    const { rows: wasted } = await client.query<{
      item: string; unit: string; quantity: string; note: string | null; reference: string | null;
    }>(
      `select i.name as item, i.unit, (-m.quantity)::text as quantity, m.note, m.reference
         from stock_movements m join stock_items i on i.id = m.item_id
        where m.hotel_id = $1 and m.location_id = $2 and m.business_date = $3::date and m.kind = 'wastage'
          and not m.empty and ${LIVE}
        order by m.moved_at, m.id`,
      [hotelId, store.id, date]);

    const num = (v: string | null) => (v === null ? null : Number(v));
    return {
      ...head,
      mayCount: mayKeep && date === businessDate && store.isActive,
      items: rows.map((r) => ({
        id: r.id, name: r.name, unit: r.unit,
        opening: Number(r.opening), received: Number(r.received), movedIn: Number(r.moved_in),
        movedOut: Number(r.moved_out), used: Number(r.used), wasted: Number(r.wasted),
        corrected: Number(r.corrected), closing: Number(r.closing), onHand: Number(r.on_hand),
        counted: num(r.counted), countBook: num(r.count_book),
      })),
      wasted: wasted.map((w) => ({ ...w, quantity: Number(w.quantity) })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden as string), 403);
  return c.json(body);
});

kitchenSheet.post("/:code/kitchen-stock/count", async (c) => {
  type Line = { itemId?: string; book?: number; counted?: number; reason?: string };
  const input = await c.req.json<{ lines?: Line[] }>().catch(() => ({}) as { lines?: Line[] });
  const lines = input.lines ?? [];
  const problem = countLinesProblem(lines);
  if (problem) return c.json(refuse(problem), 409);
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, KITCHEN_KEEPERS))) return { forbidden: KEEP_REFUSED };
    const store = await kitchenStore(client, hotelId);
    if (!store) return refuse(NO_STORE);
    return saveCount(client, hotelId, session.staffId, store.id, lines);
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

kitchenSheet.put("/:code/kitchen-stock/store", async (c) => {
  const input = await c.req.json<{ locationId?: string }>().catch(() => ({}) as { locationId?: string });
  if (typeof input.locationId !== "string" || !input.locationId) return c.json(refuse("Which store is the kitchen's?"), 409);
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, KITCHEN_KEEPERS))) return { forbidden: KEEP_REFUSED };
    const store = (await storesToMark(client, hotelId)).find((s) => s.id === input.locationId);
    if (!store) return refuse("That is not a store switched on at this property, or it is the bar's.");
    /* One per hotel (253's index): the old mark goes first. */
    await client.query(
      "update locations set is_kitchen_store = false where hotel_id = $1 and is_kitchen_store and id <> $2",
      [hotelId, store.id]);
    await client.query("update locations set is_kitchen_store = true where id = $1", [store.id]);
    return { ok: true as const, store: store.name };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Recipes ──────────────────────────────────────────────────────── */

/** Whose recipe: a dish, one of its sizes, a side or a numbered add-on. */
interface Owner {
  itemId: string | null; variationId: string | null; addonId: string | null; numberedAddonId: string | null;
}
const keyOf = (o: Owner) => `${o.itemId ?? ""}/${o.variationId ?? ""}/${o.addonId ?? ""}/${o.numberedAddonId ?? ""}`;

kitchenSheet.get("/:code/kitchen-stock/recipes", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, STOCK_ROLES.view))) return { forbidden: STOCK_REFUSED.view };
    const mayKeep = await holdsRoleAt(client, hotelId, KITCHEN_KEEPERS);
    const store = await kitchenStore(client, hotelId);
    /* What a recipe may take: the Store's items, never the bar's drinks or the crockery. */
    const { rows: ingredients } = await client.query<{ id: string; name: string; unit: string }>(
      `select id::text, name, unit from stock_items
        where hotel_id = $1 and is_active and not crockery and category is distinct from 'Bar'
        order by name`, [hotelId]);
    /* The food on the menu (not a section taxed as bar or alcohol), each size,
       the sides and the numbered add-ons, in the menu's order. */
    const { rows: owners } = await client.query<{
      kind: "dish" | "size" | "side" | "addon"; item_id: string | null; variation_id: string | null;
      addon_id: string | null; numbered_addon_id: string | null; name: string; section: string;
    }>(
      `select * from (
         select 'dish' as kind, i.id::text as item_id, null::text as variation_id, null::text as addon_id,
                null::text as numbered_addon_id, i.name, c.name as section,
                1 as part, c.sort_order as s1, i.sort_order as s2, 0 as s3
           from pos_menu_items i join pos_menu_categories c on c.id = i.category_id
          where i.hotel_id = $1 and i.is_active and coalesce(c.tax_kind, '') not in ('bar', 'alcohol')
         union all
         select 'size', i.id::text, v.id::text, null, null, i.name || ' (' || v.label || ')', c.name,
                1, c.sort_order, i.sort_order, 1 + v.sort_order
           from pos_item_variations v join pos_menu_items i on i.id = v.item_id
           join pos_menu_categories c on c.id = i.category_id
          where i.hotel_id = $1 and i.is_active and v.is_active and coalesce(c.tax_kind, '') not in ('bar', 'alcohol')
         union all
         select 'side', null, null, a.id::text, null, a.label, g.label, 2, g.sort_order, a.sort_order, 0
           from pos_addons a join pos_addon_groups g on g.id = a.group_id
          where a.hotel_id = $1 and a.is_active
         union all
         select 'addon', null, null, null, n.id::text, n.number || '. ' || n.name, 'Add-ons', 3, 0, n.number, 0
           from pos_numbered_addons n
          where n.hotel_id = $1 and n.is_active) o
       order by part, s1 nulls last, section, s2 nulls last, name, s3`, [hotelId]);
    const { rows: lines } = await client.query<{
      item_id: string | null; variation_id: string | null; addon_id: string | null; numbered_addon_id: string | null;
      stock_item_id: string; name: string; unit: string; quantity: string;
    }>(
      `select r.item_id::text, r.variation_id::text, r.addon_id::text, r.numbered_addon_id::text,
              r.stock_item_id::text, i.name, i.unit, r.quantity::text
         from recipe_lines r join stock_items i on i.id = r.stock_item_id
        where r.hotel_id = $1 order by i.name`, [hotelId]);
    const byOwner = new Map<string, { stockItemId: string; name: string; unit: string; quantity: number }[]>();
    for (const l of lines) {
      const k = keyOf({ itemId: l.item_id, variationId: l.variation_id, addonId: l.addon_id, numberedAddonId: l.numbered_addon_id });
      byOwner.set(k, [...(byOwner.get(k) ?? []), { stockItemId: l.stock_item_id, name: l.name, unit: l.unit, quantity: Number(l.quantity) }]);
    }
    const list = owners.map((o) => {
      const owner = { itemId: o.item_id, variationId: o.variation_id, addonId: o.addon_id, numberedAddonId: o.numbered_addon_id };
      return { kind: o.kind, ...owner, name: o.name, section: o.section, lines: byOwner.get(keyOf(owner)) ?? [] };
    });
    /* A dish has a recipe when it, or any of its sizes, takes something (D27-374). */
    const withRecipe = new Set(list.filter((o) => o.itemId && o.lines.length > 0).map((o) => o.itemId));
    return {
      store, mayKeep, ingredients, owners: list,
      withoutRecipe: list.filter((o) => o.kind === "dish" && !withRecipe.has(o.itemId))
        .map((o) => ({ itemId: o.itemId!, name: o.name, section: o.section })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden as string), 403);
  return c.json(body);
});

kitchenSheet.put("/:code/kitchen-stock/recipes", async (c) => {
  type In = Partial<Owner> & { lines?: { stockItemId?: unknown; quantity?: unknown }[] };
  const input = await c.req.json<In>().catch(() => ({}) as In);
  const id = (v: unknown) => (typeof v === "string" && v ? v : null);
  const owner: Owner = { itemId: id(input.itemId), variationId: id(input.variationId),
                         addonId: id(input.addonId), numberedAddonId: id(input.numberedAddonId) };
  if ([owner.itemId, owner.addonId, owner.numberedAddonId].filter(Boolean).length !== 1
      || (owner.variationId && !owner.itemId)) {
    return c.json(refuse("Whose recipe: a dish, one of its sizes, a side or an add-on?"), 409);
  }
  const lines = Array.isArray(input.lines) ? input.lines : null;
  if (!lines) return c.json(refuse("Which ingredients? None clears the recipe."), 409);
  for (const l of lines) {
    if (!id(l.stockItemId)) return c.json(refuse("Each line: an item from the Store."), 409);
    const q = l.quantity;
    /* Kept to the thousandth (numeric(12,3)): 0.0004 would be stored as none. */
    if (typeof q !== "number" || !Number.isFinite(q) || Math.round(q * 1000) < 1 || q > 100000) {
      return c.json(refuse("Each line: how much of the item one takes, more than none."), 409);
    }
  }
  if (new Set(lines.map((l) => l.stockItemId)).size !== lines.length) {
    return c.json(refuse("An item is in the recipe twice - put it on one line."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, KITCHEN_KEEPERS))) return { forbidden: KEEP_REFUSED };
    /* Every refusal before the first write (MEMORY 243). */
    const { rows: [found] } = await client.query<{ ok: boolean }>(
      owner.itemId
        ? `select exists (select 1 from pos_menu_items i where i.id::text = $2 and i.hotel_id = $1
                            and ($3::text is null or exists (select 1 from pos_item_variations v
                                  where v.id::text = $3 and v.item_id = i.id))) as ok`
        : owner.addonId
          ? "select exists (select 1 from pos_addons where id::text = $2 and hotel_id = $1) as ok"
          : "select exists (select 1 from pos_numbered_addons where id::text = $2 and hotel_id = $1) as ok",
      owner.itemId ? [hotelId, owner.itemId, owner.variationId] : [hotelId, owner.addonId ?? owner.numberedAddonId]);
    if (!found?.ok) return refuse("That dish, size, side or add-on is not on this property's menu.");
    const { rows: known } = await client.query<{ id: string }>(
      `select id::text from stock_items
        where hotel_id = $1 and id::text = any($2::text[]) and not crockery and category is distinct from 'Bar'`,
      [hotelId, lines.map((l) => l.stockItemId)]);
    if (known.length !== lines.length) return refuse("An ingredient is not one of the Store's items here.");

    await client.query(
      `delete from recipe_lines
        where hotel_id = $1 and item_id is not distinct from $2::uuid and variation_id is not distinct from $3::uuid
          and addon_id is not distinct from $4::uuid and numbered_addon_id is not distinct from $5::uuid`,
      [hotelId, owner.itemId, owner.variationId, owner.addonId, owner.numberedAddonId]);
    for (const l of lines) {
      await client.query(
        `insert into recipe_lines (hotel_id, item_id, variation_id, addon_id, numbered_addon_id, stock_item_id, quantity, set_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [hotelId, owner.itemId, owner.variationId, owner.addonId, owner.numberedAddonId, l.stockItemId, l.quantity, session.staffId]);
    }
    return { ok: true as const, saved: lines.length };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});
