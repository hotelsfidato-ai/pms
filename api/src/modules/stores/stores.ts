import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import {
  mayStock, actionForKind, isInventoryManagerAt, STOCK_REFUSED, type StockAction,
} from "./stockGrants.ts";
import { priceProblem } from "../../validate.ts";
import { can, type Role } from "../../permissions.ts";
import { awaitingDelivery } from "../purchasing/index.ts";
import { outletSales } from "../pos/index.ts";
import { dailyFigures } from "../reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE STORE

   What the hotel keeps, and where it went. A ledger, built like the
   folio because it is the same shape.

   ON HAND IS NEVER READ FROM A COLUMN. `app.stock_on_hand()` sums the
   movements, every time. A `quantity_in_stock` column is a lie waiting
   to happen — two people receive at once, one update overwrites the
   other, and the number is wrong with nothing to compare it against.

   NOTHING IS EDITED. A receipt entered against the wrong item is
   reversed by a row that points at it, and both stay. Somebody has to
   be able to ask why the rice says forty kilos and get an answer that
   goes back to a delivery note.

   AN ITEM HAS NO PRICE. A DELIVERY has a price. The same rice costs
   differently in June and October, so the cost lives on the receipt
   that brought it in, and an item nobody has received is worth a dash
   rather than zero.
   ══════════════════════════════════════════════════════════════════ */

export const stores = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

/* WHO IS ASKING comes first in every route, before the first write — inside
   `withSession` a refusal returned after an insert keeps the insert (MEMORY
   243). The callback hands back this marker and the route answers 403: not
   409, because nothing about the request is wrong except who sent it. */
const forbid = (action: StockAction) => ({ forbidden: action });
const forbidden = (action: StockAction) => refuse(STOCK_REFUSED[action]);

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* What a person may RECORD through /movements. A move between stores is its own
   route, because it is two rows written as one act (106). */
const KINDS = ["receipt", "issue", "wastage", "adjustment", "return", "breakage"] as const;
type Kind = (typeof KINDS)[number];
/* Every kind the ledger holds, as it reads back. */
type StoredKind = Kind | "transfer";

/** Which way each kind moves stock. The database holds this too — this is
    so a screen gets a sentence rather than a constraint violation. */
const DIRECTION: Record<Kind, "in" | "out" | "either"> = {
  receipt: "in",
  issue: "out",
  wastage: "out",
  return: "out",
  adjustment: "either",
  /* Crockery and cutlery only (D27-242), with who. */
  breakage: "out",
};

/** How a refusal names the row somebody tried to undo. */
const UNDONE_NOUN: Record<StoredKind, string> = {
  receipt: "delivery",
  issue: "issue",
  wastage: "waste",
  return: "return",
  adjustment: "count correction",
  transfer: "move",
  breakage: "breakage",
};

/* A figure a person reads: no trailing zeros from numeric(12,3). */
const figure = (n: number) => String(Math.round(n * 1000) / 1000);

interface StoreRow { id: string; name: string; is_active: boolean; kind: string }

/** The places where crockery and cutlery is IN USE (D27-242): a restaurant, a
    bar or a kitchen the hotel added in Places and suppliers. */
const IN_USE_KINDS = ["restaurant", "bar", "kitchen"];

/** A store at this hotel, as a request names it — or null. Only a place of kind
    `store` holds stock (094); the database says so too (106). With `inUse`, a
    crockery item's restaurant, bar or kitchen place too (D27-242). */
async function storeAt(
  client: Client, hotelId: string, id: unknown, inUse = false,
): Promise<StoreRow | null> {
  if (typeof id !== "string" || id === "") return null;
  const { rows } = await client.query<StoreRow>(
    `select id::text, name, is_active, kind from locations
      where id::text = $1 and hotel_id = $2
        and (kind = 'store' or ($3 and kind = any($4::text[])))`,
    [id, hotelId, inUse, IN_USE_KINDS]);
  return rows[0] ?? null;
}

async function onHandIn(client: Client, itemId: string, storeId: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    "select app.stock_on_hand($1, $2)::text as n", [itemId, storeId]);
  return Number(rows[0]!.n);
}

/** THE statement that writes a movement — the one place the ledger is added
    to. The route below uses it, and so does `receiveIntoStore`, which is how
    a delivery against a purchase order gets in (116). Two writers for one
    ledger is the shape of half the defects in MEMORY.md. */
async function writeMovement(
  client: Client, hotelId: string, staffId: string,
  m: {
    itemId: string; storeId: string; kind: StoredKind; signed: number;
    unitCost?: number | null; supplier?: string | null;
    reference?: string | null; note?: string | null; outletId?: string | null;
    /** Empty cylinders, not full ones (D25-18). */
    empty?: boolean;
    /** A delivery's own facts (D27-238): its GST, all three or none, and its
        expiry. */
    gst?: Gst | null; expiresOn?: string | null;
    /** An issue's department, as typed (D27-242: free text). */
    department?: string | null;
    /** Who broke it; null is "Not known". */
    brokenBy?: string | null;
  },
): Promise<string> {
  const businessDate = await businessDateFor(client, hotelId);
  const { rows } = await client.query<{ id: string }>(
    `insert into stock_movements
       (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost,
        supplier, reference, note, to_outlet, moved_by, empty,
        gst_rate, gst_amount, gst_claimable, expires_on, department, broken_by)
     values ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::date,$18,$19)
     returning id::text`,
    [hotelId, m.itemId, m.storeId, businessDate, m.kind, m.signed,
     m.unitCost ?? null, m.supplier?.trim() || null,
     m.reference?.trim() || null, m.note?.trim() || null,
     m.outletId || null, staffId, m.empty === true,
     m.gst?.rate ?? null, m.gst?.amount ?? null, m.gst?.claimable ?? null,
     m.expiresOn || null, m.department?.trim() || null, m.brokenBy || null],
  );
  return rows[0]!.id;
}

/** A delivery's GST as the supplier's bill says it (D27-238, D27-242 Q6). */
export interface Gst { rate: number; amount: number; claimable: boolean }

/** The GST and expiry a delivery carries, checked: all three GST figures or
    none (none is "not recorded", a dash), and an expiry that is a date. The
    refusal in a sentence, or null. Purchasing's delivery asks the same, so the
    two cannot disagree. */
export function deliveryFactsProblem(
  input: { gstRate?: unknown; gstAmount?: unknown; gstClaimable?: unknown; expiresOn?: unknown },
): string | null {
  const given = [input.gstRate, input.gstAmount, input.gstClaimable]
    .filter((v) => v !== undefined && v !== null).length;
  if (given !== 0 && given !== 3) {
    return "GST is the rate, the amount and whether it can be claimed - all three, or none.";
  }
  if (given === 3) {
    const rate = Number(input.gstRate);
    const amount = Number(input.gstAmount);
    if (typeof input.gstRate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      return "A GST rate is between 0 and 100 per cent.";
    }
    if (typeof input.gstAmount !== "number" || !Number.isFinite(amount) || amount < 0) {
      return "A GST amount is zero or more.";
    }
    if (typeof input.gstClaimable !== "boolean") {
      return "Can this GST be claimed back? Yes or no.";
    }
  }
  if (input.expiresOn !== undefined && input.expiresOn !== null
      && (typeof input.expiresOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)
          || Number.isNaN(Date.parse(input.expiresOn)))) {
    return "An expiry is a date.";
  }
  return null;
}

/** The checked facts, as writeMovement takes them. */
export const gstOf = (input: { gstRate?: unknown; gstAmount?: unknown; gstClaimable?: unknown }): Gst | null =>
  input.gstRate === undefined || input.gstRate === null ? null
    : { rate: Number(input.gstRate), amount: Number(input.gstAmount), claimable: input.gstClaimable === true };

async function emptiesIn(client: Client, itemId: string, storeId: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    "select app.stock_empties($1, $2)::text as n", [itemId, storeId]);
  return Number(rows[0]!.n);
}

/** A level for one item in one store (D25-12, D25-13) - null clears it. No
    store named is the hotel's Main store: what "Add an item" and the import
    set. The caller has asked `edit` first. */
async function setLevel(
  client: Client, hotelId: string, itemId: string, storeId: string | null,
  level: number | null, staffId: string,
): Promise<void> {
  await client.query(
    `insert into stock_levels (hotel_id, item_id, location_id, reorder_level, set_by)
     values ($1, $2, coalesce($3::uuid, app.main_store($1)), $4, $5)
     on conflict (item_id, location_id) do update
       set reorder_level = excluded.reorder_level, set_by = excluded.set_by, set_at = now()`,
    [hotelId, itemId, storeId, level, staffId]);
}

/** Zero or more, or not a number at all. */
const isCount = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;

/* ── The Store's door for a delivery (116, the purchasing service) ──
   A purchase order that arrives is a RECEIPT in this ledger, and it is
   written here rather than by the service that ordered it: what may be
   received, into which store, and by whom are the Store's rules, and a
   second service writing `stock_movements` is a second set of them.

   ⚠ A REFUSAL IS A COMMIT INSIDE `withSession` (MEMORY 243). So a caller
   with several lines asks `mayDeliverInto` ONCE, before its first write,
   and only then calls `receiveIntoStore` line by line — everything that
   can be refused for the whole delivery is refused in the first call.
   ═══════════════════════════════════════════════════════════════════ */

/** Whether a delivery may be received into this store at all: the Store's
    own `create` grant, and a store that is switched on. The refusal, in the
    Store's words, or null when it may go ahead. */
export async function mayDeliverInto(
  client: Client, hotelId: string, storeId: unknown,
): Promise<string | null> {
  if (!(await mayStock(client, hotelId, "create"))) return STOCK_REFUSED["create"];
  const store = await storeAt(client, hotelId, storeId);
  if (!store) return "That is not a store at this property.";
  /* A SWITCHED-OFF STORE TAKES NOTHING IN — the same rule the movements
     route applies, for the same reason. */
  if (!store.is_active) {
    return `${store.name} is switched off. Receive into another store, or `
      + "switch it on in Places and suppliers.";
  }
  return null;
}

/** One line of a delivery, as a receipt in the Store's ledger. Returns what
    the store holds afterwards, or a refusal in a sentence. */
export async function receiveIntoStore(
  client: Client, hotelId: string, staffId: string,
  input: {
    itemId: string; storeId: string; quantity: number;
    unitCost?: number | null; supplier?: string | null;
    reference?: string | null; note?: string | null;
    /** The bill's GST, all three or none, and the expiry (D27-238). */
    gstRate?: number | null; gstAmount?: number | null; gstClaimable?: boolean | null;
    expiresOn?: string | null;
  },
): Promise<
  | { ok: true; id: string; item: string; unit: string; store: string; onHandHere: number }
  | { ok: false; reason: string }
> {
  const refusal = await mayDeliverInto(client, hotelId, input.storeId);
  if (refusal) return { ok: false, reason: refusal };

  const { rows: item } = await client.query<{ name: string; unit: string }>(
    "select name, unit from stock_items where id = $1 and hotel_id = $2",
    [input.itemId, hotelId]);
  if (!item[0]) return { ok: false, reason: "No such item in this store." };

  const store = (await storeAt(client, hotelId, input.storeId))!;
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: "How much came? A delivery of nothing is not a delivery." };
  }
  /* A COST IS ZERO OR MORE, OR NOBODY HAS SAID. Null is a real answer and
     the item's value is left as it was — it is never flattened to 0
     (MEMORY 246). */
  if (input.unitCost !== undefined && input.unitCost !== null
      && (!Number.isFinite(input.unitCost) || input.unitCost < 0)) {
    return { ok: false, reason: "A unit cost is zero or more." };
  }
  const facts = deliveryFactsProblem(input);
  if (facts) return { ok: false, reason: facts };

  const id = await writeMovement(client, hotelId, staffId, {
    itemId: input.itemId, storeId: store.id, kind: "receipt", signed: qty,
    unitCost: input.unitCost ?? null, supplier: input.supplier ?? null,
    reference: input.reference ?? null, note: input.note ?? null,
    gst: gstOf(input), expiresOn: input.expiresOn ?? null,
  });

  return {
    ok: true, id, item: item[0].name, unit: item[0].unit, store: store.name,
    onHandHere: await onHandIn(client, input.itemId, store.id),
  };
}

/* ── What is in the store ─────────────────────────────────────────── */

stores.get("/:code/stores", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "view"))) return forbid("view");

    const { rows } = await client.query<{
      id: string; name: string; unit: string; category: string | null;
      is_active: boolean; cylinder: boolean; empties: string;
      on_deposit: number | null; per_cylinder: string | null;
      on_hand: string; unit_cost: string | null;
      last_movement: string | null; movements: string;
      crockery: boolean; held_in: string[];
    }>(
      /* On hand and cost come from the FUNCTIONS, not from columns. That
         is the whole design: one definition, and it cannot disagree with
         the history below it. */
      `select i.id::text, i.name, i.unit, i.category, i.is_active,
              app.counted_in_cylinders(i.unit)               as cylinder,
              app.stock_empties(i.id)::text                  as empties,
              i.cylinders_on_deposit                         as on_deposit,
              i.deposit_per_cylinder::text                   as per_cylinder,
              app.stock_on_hand(i.id)::text                  as on_hand,
              app.stock_unit_cost(i.id)::text                as unit_cost,
              (select max(m.business_date)::text
                 from stock_movements m where m.item_id = i.id) as last_movement,
              (select count(*)::text
                 from stock_movements m where m.item_id = i.id) as movements,
              i.crockery,
              /* Every place it ever came into, and not undone: "Run out" is
                 a place that had some and holds none (D27-242 Q3). */
              array(select distinct m.location_id::text from stock_movements m
                     where m.item_id = i.id and m.quantity > 0 and not m.empty
                       and m.reverses_id is null
                       and not exists (select 1 from stock_movements r where r.reverses_id = m.id)) as held_in
         from stock_items i
        where i.hotel_id = $1
        order by i.category nulls last, i.name`,
      [hotelId],
    );

    /* THE STORES (106). Every store switched on, and any switched off that
       still holds something — in the order the owner named them (D17-3: Main,
       Kitchen, Bar; the layout they approved reads "Main 30 · Kitchen 8 ·
       Bar -"), then any added later by name. What each item holds in each
       comes from app.stock_on_hand(item, store): the one definition, per
       store, rather than a second copy of it in a GROUP BY here. */
    const { rows: places } = await client.query<{
      id: string; name: string; is_active: boolean; main: boolean;
    }>(
      `select l.id::text, l.name, l.is_active, l.id = app.main_store($1) as main
         from locations l
        where l.hotel_id = $1 and l.kind = 'store'
        order by l.id = app.main_store($1) desc,
                 array_position(array['Main store', 'Kitchen store', 'Bar store'], l.name) nulls last,
                 l.is_active desc, l.name`,
      [hotelId]);
    const { rows: held } = await client.query<{ item: string; store: string; n: string; e: string }>(
      `select i.id::text as item, l.id::text as store,
              app.stock_on_hand(i.id, l.id)::text as n,
              app.stock_empties(i.id, l.id)::text as e
         from stock_items i
         join locations l on l.hotel_id = i.hotel_id
                         and (l.kind = 'store' or (i.crockery and l.kind = any($2::text[])))
        where i.hotel_id = $1`,
      [hotelId, IN_USE_KINDS]);

    /* WHERE CROCKERY IS IN USE (D27-242): the hotel's restaurants, bars and
       kitchens in Places and suppliers - switched on, or still holding some. */
    const { rows: inUsePlaces } = await client.query<{ id: string; name: string; kind: string; is_active: boolean }>(
      `select id::text, name, kind, is_active from locations
        where hotel_id = $1 and kind = any($2::text[]) order by name`,
      [hotelId, IN_USE_KINDS]);

    /* THE TILES (D27-242 Q3), per item and per place: what moved today, the
       last count, and what is on order (Purchasing's door). */
    const businessDate = await businessDateFor(client, hotelId);
    const { rows: todays } = await client.query<{ item: string; store: string; kind: string }>(
      `select distinct m.item_id::text as item, m.location_id::text as store, m.kind
         from stock_movements m
        where m.hotel_id = $1 and m.business_date = $2::date and not m.empty
          and m.kind in ('receipt', 'issue', 'wastage', 'breakage')
          and m.reverses_id is null
          and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`,
      [hotelId, businessDate]);
    const { rows: counted } = await client.query<{ item: string; store: string; day: string }>(
      `select item_id::text as item, location_id::text as store, max(business_date)::text as day
         from stock_count_lines where hotel_id = $1 and not empty group by 1, 2`,
      [hotelId]);
    const onOrder = await awaitingDelivery(client, hotelId);
    const countedByItem = new Map<string, Record<string, string>>();
    for (const r of counted) countedByItem.set(r.item, { ...(countedByItem.get(r.item) ?? {}), [r.store]: r.day });
    const todayByItem = new Map<string, Record<string, string[]>>();
    for (const t of todays) {
      const mine = todayByItem.get(t.item) ?? {};
      mine[t.kind] = [...(mine[t.kind] ?? []), t.store];
      todayByItem.set(t.item, mine);
    }
    const orderedByItem = new Map<string, Record<string, number>>();
    for (const o of onOrder) {
      const mine = orderedByItem.get(o.itemId) ?? {};
      mine[o.storeId] = (mine[o.storeId] ?? 0) + o.quantity;
      orderedByItem.set(o.itemId, mine);
    }

    /* WHO BROKE IT (D27-242 Q10): the people rostered here, for those who
       record a breakage - a name, through app.colleague_name (096). */
    const { rows: people } = (await mayStock(client, hotelId, "create"))
      ? await client.query<{ id: string; name: string }>(
          `select sh.staff_id::text as id, app.colleague_name(sh.staff_id, $1) as name
             from staff_hotels sh join staff s on s.id = sh.staff_id
            where sh.hotel_id = $1 and s.is_active
            order by 2`, [hotelId])
      : { rows: [] };
    /* Per item, per store, what is not zero: full stock, and empty cylinders. */
    const byItem = new Map<string, Record<string, number>>();
    const emptiesByItem = new Map<string, Record<string, number>>();
    for (const h of held) {
      if (Number(h.n) !== 0) byItem.set(h.item, { ...(byItem.get(h.item) ?? {}), [h.store]: Number(h.n) });
      if (Number(h.e) !== 0) emptiesByItem.set(h.item, { ...(emptiesByItem.get(h.item) ?? {}), [h.store]: Number(h.e) });
    }
    const holding = new Set(held.filter((h) => Number(h.n) !== 0 || Number(h.e) !== 0).map((h) => h.store));

    /* THE LEVELS, per store (D25-12). A cleared one (null) is no level. */
    const { rows: levelRows } = await client.query<{ item: string; store: string; level: string }>(
      `select item_id::text as item, location_id::text as store, reorder_level::text as level
         from stock_levels where hotel_id = $1 and reorder_level is not null`,
      [hotelId]);
    const levelsByItem = new Map<string, Record<string, number>>();
    for (const l of levelRows) {
      levelsByItem.set(l.item, { ...(levelsByItem.get(l.item) ?? {}), [l.store]: Number(l.level) });
    }
    const open = new Set([...places, ...inUsePlaces].filter((p) => p.is_active).map((p) => p.id));

    /* WHERE AN ISSUE CAN GO (D22-20): the outlets the hotel already has — the
       till's own list, which 069's `to_outlet` has always pointed at. */
    const { rows: outlets } = await client.query<{ id: string; name: string }>(
      "select id::text, name from pos_outlets where hotel_id = $1 and is_active order by name",
      [hotelId]);

    return {
      outlets,
      businessDate,
      people: people.filter((p) => p.name),
      stores: places
        .filter((p) => p.is_active || holding.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, isActive: p.is_active, isMain: p.main })),
      /* Where crockery is in use (D27-242). Not stores: nothing is received
         into one, and only crockery is held there. */
      inUse: inUsePlaces
        .filter((p) => p.is_active || holding.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, kind: p.kind, isActive: p.is_active })),
      items: rows.map((r) => {
        const onHand = Number(r.on_hand);
        const byStore = byItem.get(r.id) ?? {};
        /* Only the levels somebody set, by store id. A store with none is
           absent: a dash, and never "below" (D25-12). */
        const levels = levelsByItem.get(r.id) ?? {};
        /* THE BELOW-LEVEL LIST (D25-14): the stores switched on where this
           item is at or below its level. Derived here rather than on the
           screen, so the list and any report asking get the same answer. */
        const lowIn = Object.entries(levels)
          .filter(([store, level]) => open.has(store) && (byStore[store] ?? 0) <= level)
          .map(([store]) => store);
        const empties = Number(r.empties);
        const perCylinder = r.per_cylinder === null ? null : Number(r.per_cylinder);
        return {
          id: r.id,
          name: r.name,
          unit: r.unit,
          category: r.category,
          onHand,
          levels,
          lowIn,
          low: lowIn.length > 0,
          /* CYLINDERS (D25-18, D25-19): counted in "cylinder", on hand is the
             FULL ones; the empties and the deposit sit beside it. The two
             deposit figures are typed, and a dash until they are. */
          cylinder: r.cylinder,
          empties,
          emptiesByStore: emptiesByItem.get(r.id) ?? {},
          cylindersOnDeposit: r.on_deposit,
          depositPerCylinder: perCylinder,
          depositHeld: r.on_deposit === null || perCylinder === null
            ? null : Math.round(r.on_deposit * perCylinder * 100) / 100,
          /* At the kitchen: on deposit, less full and empty in the stores. */
          inUse: r.on_deposit === null ? null : r.on_deposit - onHand - empties,
          /* NULL when nothing has ever been received — a dash, because
             an item nobody has bought has no value and zero would claim
             it is worthless. */
          unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
          value: r.unit_cost === null
            ? null
            : Math.round(onHand * Number(r.unit_cost) * 100) / 100,
          /* What is in each store, by store id. A store holding nothing of it
             is absent, and the screen shows a dash there, not a zero. */
          byStore,
          lastMovement: r.last_movement,
          movements: Number(r.movements),
          isActive: r.is_active,
          /* D27-242: crockery and cutlery; the places it ever came into; what
             moved today, by kind, as the places it moved in; the business date
             each place was last counted; what is on order, by store. */
          crockery: r.crockery,
          heldIn: r.held_in,
          today: todayByItem.get(r.id) ?? {},
          lastCounted: countedByItem.get(r.id) ?? {},
          onOrder: orderedByItem.get(r.id) ?? {},
        };
      }),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(forbidden(body.forbidden), 403);
  return c.json(body);
});

/* ── One item's history ───────────────────────────────────────────── */

stores.get("/:code/stores/items/:id/movements", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "view"))) return forbid("view");
    const namesEveryone = await isInventoryManagerAt(client, hotelId);

    const { rows } = await client.query<{
      id: string; business_date: string; kind: string; quantity: string;
      unit_cost: string | null; supplier: string | null;
      reference: string | null; note: string | null;
      outlet: string | null; who: string | null; store: string;
      reverses_id: string | null; reverses_kind: string | null;
      undone_quantity: string | null; partner_store: string | null; reversed: boolean; empty: boolean;
      gst_rate: string | null; gst_amount: string | null; gst_claimable: boolean | null;
      expires_on: string | null; department: string | null; broken_by: string | null;
    }>(
      /* WHO: through `staff` as before, and for the Inventory Manager through
         `app.colleague_name` too (STO-4) — a name, of somebody rostered here.
         REVERSES_KIND: what an undo undid, so the screen can say "Undo of a
         delivery" rather than "Adjusted" (STO-6).
         STORE and PARTNER_STORE (106): the store it happened in, and for a
         move, or the undo of one, the store at the other end of it. */
      `select m.id::text, m.business_date::text, m.kind, m.quantity::text,
              m.unit_cost::text, m.supplier, m.reference, m.note, m.empty,
              m.gst_rate::text, m.gst_amount::text, m.gst_claimable,
              m.expires_on::text, m.department,
              app.colleague_name(m.broken_by, $1) as broken_by,
              o.name as outlet,
              coalesce(s.full_name,
                       case when $3::boolean
                            then app.colleague_name(m.moved_by, $1) end) as who,
              here.name as store,
              m.reverses_id::text, undone.kind as reverses_kind,
              undone.quantity::text as undone_quantity,
              (select pl.name
                 from stock_movements p join locations pl on pl.id = p.location_id
                where p.transfer_id = coalesce(m.transfer_id, undone.transfer_id)
                  and p.id <> coalesce(undone.id, m.id)) as partner_store,
              exists (select 1 from stock_movements r
                       where r.reverses_id = m.id) as reversed
         from stock_movements m
         join locations here on here.id = m.location_id
         left join pos_outlets o on o.id = m.to_outlet
         left join staff s on s.id = m.moved_by
         left join stock_movements undone on undone.id = m.reverses_id
        where m.hotel_id = $1 and m.item_id = $2
        order by m.business_date desc, m.id desc
        limit 200`,
      [hotelId, c.req.param("id"), namesEveryone],
    );

    return {
      /* A MOVE READS AS ONE LINE. It is two rows — out of one store, into the
         other — and the history showed both, so eight kilos moved looked like
         eight kilos gone and eight arrived. Only the half INTO a store is sent,
         with both stores named; its id is what an undo is asked for, and the
         undo takes both halves back. The same for the undo of a move. */
      movements: rows
        .filter((m) => !(m.kind === "transfer" && Number(m.quantity) < 0))
        .filter((m) => !(m.reverses_kind === "transfer" && Number(m.undone_quantity) < 0))
        .map((m) => {
          const move = m.kind === "transfer" || m.reverses_kind === "transfer";
          return {
            id: m.id,
            date: m.business_date,
            kind: m.kind,
            quantity: Number(m.quantity),
            unitCost: m.unit_cost === null ? null : Number(m.unit_cost),
            supplier: m.supplier,
            reference: m.reference,
            note: m.note,
            outlet: m.outlet,
            who: m.who,
            store: m.store,
            fromStore: move ? m.partner_store : null,
            toStore: move ? m.store : null,
            /* Both flags, because they are different facts and the history is
               unreadable without both: one row UNDID something, another WAS
               undone, and neither should look like an ordinary movement. */
            isReversal: m.reverses_id !== null,
            reversesKind: m.reverses_kind,
            /* An empty cylinder, not a full one (D25-18). */
            empty: m.empty,
            /* D27-238: a delivery's GST (null = not recorded) and expiry; an
               issue's department; who broke it (null = not known). */
            gst: m.gst_rate === null ? null : {
              rate: Number(m.gst_rate), amount: Number(m.gst_amount), claimable: m.gst_claimable === true,
            },
            expiresOn: m.expires_on,
            department: m.department,
            brokenBy: m.broken_by,
            reversed: m.reversed,
          };
        }),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(forbidden(body.forbidden), 403);
  return c.json(body);
});

/* ── Fourteen days (D27-238, D27-242) ─────────────────────────────── */

/* THE DAYS VIEW: what moved, per item, place and day, over the fourteen
   business days ending `end` (today when not given). Grouped here, shaped on
   the screen: a cell is +in over -out; the footer adds received, issued and
   wasted rupees and the rooms occupied; by outlet, what was issued to each
   against what it sold.

   VALUES come from the running-average walk (app.stock_movement_costs): a
   delivery at what was paid, anything going out at the average of its moment.
   A group holding one unvalued row has no value - a dash, never a partial sum.
   A move between stores has none: nothing was bought or used.

   SALES are revenue, shown only to a role that may read reports (Q4); the
   food cost basis is the hotel's (Q5).
   ponytail: walks every item's whole history per read; keep a running value
   per movement if a hotel's Store ever reads slowly. */
stores.get("/:code/stores/days", async (c) => {
  const endParam = c.req.query("end");
  if (endParam !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(endParam)) {
    return c.json(refuse("Which day? A date, as 2026-10-02."), 409);
  }

  const body = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "view"))) return forbid("view");

    const today = await businessDateFor(client, hotelId);
    const end = endParam ?? today;
    const { rows: [span] } = await client.query<{ from: string; days: string[] }>(
      `select to_char($1::date - 13, 'YYYY-MM-DD') as from,
              array(select to_char(d, 'YYYY-MM-DD')
                      from generate_series($1::date - 13, $1::date, interval '1 day') d) as days`,
      [end]);
    const from = span!.from;

    const { rows } = await client.query<{
      item: string; place: string; date: string; kind: string; outlet: string | null;
      qty: string; value: string | null;
    }>(
      `with moved as (
         select m.item_id, m.location_id, m.business_date, m.kind, m.to_outlet, m.quantity,
                abs(m.quantity) * c.unit_value as value
           from stock_items i
           cross join lateral app.stock_movement_costs(i.id) c
           join stock_movements m on m.id = c.movement_id
          where i.hotel_id = $1 and m.business_date between $2::date and $3::date
         union all
         select m.item_id, m.location_id, m.business_date, m.kind, null, m.quantity, null
           from stock_movements m
          where m.hotel_id = $1 and m.kind = 'transfer'
            and m.business_date between $2::date and $3::date
            and not exists (select 1 from stock_movements r where r.reverses_id = m.id)
       )
       select item_id::text as item, location_id::text as place,
              to_char(business_date, 'YYYY-MM-DD') as date, kind, to_outlet::text as outlet,
              sum(quantity)::text as qty,
              case when bool_or(value is null) then null else round(sum(value), 2) end::text as value
         from moved
        group by 1, 2, 3, 4, 5`,
      [hotelId, from, end]);

    const occupied: Record<string, number> = {};
    for (const d of await dailyFigures(client, hotelId, from, end)) occupied[d.date] = d.sold;

    const role: Role | null = session.isGroupAdmin ? "owner"
      : ((await client.query<{ role: Role }>(
          "select role from staff_hotels where staff_id = $1 and hotel_id = $2",
          [session.staffId, hotelId])).rows[0]?.role ?? null);
    let sales: Record<string, Record<string, number>> | null = null;
    if (role !== null && can(role, "view", "report")) {
      sales = {};
      for (const s of await outletSales(client, hotelId, from, end)) {
        sales[s.outletId] = { ...(sales[s.outletId] ?? {}), [s.date]: s.net };
      }
    }
    const { rows: [hotel] } = await client.query<{ basis: string | null }>(
      "select food_cost_basis as basis from hotels where id = $1", [hotelId]);

    return {
      today,
      days: span!.days,
      rows: rows.map((r) => ({
        itemId: r.item, placeId: r.place, date: r.date, kind: r.kind, outletId: r.outlet,
        quantity: Number(r.qty), value: r.value === null ? null : Number(r.value),
      })),
      occupied,
      sales,
      foodCostBasis: hotel?.basis ?? null,
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(forbidden(body.forbidden), 403);
  return c.json(body);
});

/* ── Adding something to keep ─────────────────────────────────────── */

stores.post("/:code/stores/items", async (c) => {
  type Body = {
    name?: string; unit?: string; category?: string;
    reorderLevel?: number | null;
    /** Crockery and cutlery (D27-242). */
    crockery?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const name = input.name?.trim();
  const unit = input.unit?.trim();
  if (!name) return c.json(refuse("What is it called?"), 409);
  if (!unit) {
    return c.json(refuse(
      "What is it counted in? Kilos, litres, pieces, cylinders - without a "
      + "unit a number in this list means nothing."), 409);
  }
  if (input.reorderLevel !== undefined && input.reorderLevel !== null
      && (!Number.isFinite(input.reorderLevel) || input.reorderLevel < 0)) {
    return c.json(refuse("A reorder level is zero or more, or blank for none."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "create"))) return forbid("create");

    /* THE SAME NAME IS A CHANGE, NOT AN ADDITION. The insert below
       overwrites an existing item's unit and category, and the Main store's
       warning level — and changing an existing item needs `edit` (the owner,
       16 September). A level is `edit` on a new item too (D25-13). */
    const { rows: existing } = await client.query(
      "select 1 from stock_items where hotel_id = $1 and name = $2", [hotelId, name]);
    const settingLevel = input.reorderLevel !== undefined && input.reorderLevel !== null;
    if ((existing.length > 0 || settingLevel) && !(await mayStock(client, hotelId, "edit"))) {
      return forbid("edit");
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into stock_items (hotel_id, name, unit, category, crockery)
       values ($1,$2,$3,$4,$5)
       on conflict (hotel_id, name) do update
         set unit          = excluded.unit,
             category      = excluded.category,
             is_active     = true
       returning id::text`,
      [hotelId, name, unit, input.category?.trim() || null, input.crockery === true],
    );
    /* "Warn me below" is the MAIN store's level (D25-12). Re-adding an item
       sets it as the form says, blank clearing it, as before. */
    if (existing.length > 0 || settingLevel) {
      await setLevel(client, hotelId, rows[0]!.id, null, input.reorderLevel ?? null, session.staffId);
    }
    return { ok: true as const, id: rows[0]!.id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(forbidden(result.forbidden), 403);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Something came in, or went out ───────────────────────────────── */

stores.post("/:code/stores/movements", async (c) => {
  type Body = {
    itemId?: string;
    kind?: Kind;
    /** ALWAYS POSITIVE from the caller. The sign is this route's job —
        a screen that has to remember to send -5 for an issue will one
        day send 5 and quietly double the stock. */
    quantity?: number;
    unitCost?: number | null;
    /** X-1 (D27-120): a cost of 0 only when ticked Free. */
    unitCostFree?: boolean;
    supplier?: string;
    reference?: string;
    note?: string;
    outletId?: string | null;
    /** WHICH STORE it happened in (106). Required: the screen always says,
        and a request that does not is refused rather than guessed. */
    locationId?: string;
    /** CYLINDERS (D25-18), typed each time, 0 an answer: on an issue, the
        empties that came back from the kitchen; on a delivery, the empties
        the supplier took back. */
    emptiesBack?: number;
    emptiesTaken?: number;
    /** A delivery's GST, all three or none, and its expiry (D27-238). */
    gstRate?: number | null; gstAmount?: number | null; gstClaimable?: boolean | null;
    expiresOn?: string | null;
    /** An issue's department, free text (D27-242 Q8). */
    department?: string | null;
    /** A breakage's who: a person rostered here, or null for "Not known".
        Asked every time, so it is required on a breakage. */
    brokenBy?: string | null;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.itemId) return c.json(refuse("Which item?"), 409);
  const facts = [input.gstRate, input.gstAmount, input.gstClaimable, input.expiresOn]
    .some((v) => v !== undefined && v !== null);
  if (facts && input.kind !== "receipt") {
    return c.json(refuse("GST and an expiry are a delivery's."), 409);
  }
  const factsProblem = deliveryFactsProblem(input);
  if (factsProblem) return c.json(refuse(factsProblem), 409);
  const department = typeof input.department === "string" ? input.department.trim() : "";
  if (department && input.kind !== "issue") {
    return c.json(refuse("A department is an issue's."), 409);
  }
  if (department.length > 60) return c.json(refuse("A department is 60 letters at most."), 409);
  if (input.brokenBy !== undefined && input.kind !== "breakage") {
    return c.json(refuse("Who broke it is a breakage's."), 409);
  }
  if (input.kind === "breakage" && input.brokenBy === undefined) {
    return c.json(refuse("Who broke it? Choose Not known if nobody knows."), 409);
  }
  if (!input.kind || !KINDS.includes(input.kind)) {
    return c.json(refuse("That is not something that happens to stock."), 409);
  }
  if (!input.locationId) return c.json(refuse("Which store?"), 409);
  if (input.outletId && input.kind !== "issue") {
    return c.json(refuse("Only an issue goes to an outlet."), 409);
  }
  if ((input.emptiesBack !== undefined && input.kind !== "issue")
      || (input.emptiesTaken !== undefined && input.kind !== "receipt")) {
    return c.json(refuse(
      "Empties come back on an issue, and go to the supplier on a delivery."), 409);
  }
  for (const n of [input.emptiesBack, input.emptiesTaken]) {
    if (n !== undefined && !isCount(n)) {
      return c.json(refuse("How many empties? Zero or more."), 409);
    }
  }
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty === 0) {
    return c.json(refuse("How much? A movement of nothing is not a movement."), 409);
  }
  if (qty < 0 && input.kind !== "adjustment") {
    return c.json(refuse(
      "Send how much moved, not which way - the kind decides the direction. "
      + "Only an adjustment may go either way."), 409);
  }
  if (input.unitCost !== undefined && input.unitCost !== null) {
    if (input.kind !== "receipt") {
      return c.json(refuse(
        "Only a delivery carries a cost. Issuing to the kitchen does not "
        + "cost anything - the money left when it was bought."), 409);
    }
    if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
      return c.json(refuse("A unit cost is zero or more."), 409);
    }
    /* ST-1: 5 kg at 0 dragged the average down for every later receipt. */
    const zeroCost = priceProblem(input.unitCost, input.unitCostFree === true);
    if (zeroCost) return c.json(refuse(zeroCost), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const action = actionForKind(input.kind!);
    if (!(await mayStock(client, hotelId, action))) return forbid(action);

    const { rows: item } = await client.query<{
      name: string; unit: string; cylinder: boolean; crockery: boolean;
    }>(
      `select name, unit, app.counted_in_cylinders(unit) as cylinder, crockery
         from stock_items where id = $1 and hotel_id = $2`,
      [input.itemId, hotelId],
    );
    if (!item[0]) return refuse("No such item in this store.");
    if (input.kind === "breakage" && !item[0].crockery) {
      return refuse("Breakage is recorded for crockery and cutlery. Anything else is waste.");
    }
    if (input.brokenBy) {
      const { rows: here } = await client.query(
        "select 1 from staff_hotels where staff_id::text = $1 and hotel_id = $2", [input.brokenBy, hotelId]);
      if (!here[0]) return refuse("That person does not work here. Choose Not known if nobody knows.");
    }

    /* Crockery IN USE at a restaurant, bar or kitchen (D27-242) breaks there
       and is counted there; everything else happens in a store. */
    const inUse = item[0].crockery && (input.kind === "breakage" || input.kind === "adjustment");
    const store = await storeAt(client, hotelId, input.locationId, inUse);
    if (!store) return refuse("That is not a store at this property.");
    /* A SWITCHED-OFF STORE TAKES NOTHING IN. What is already in it may still
       go out, be wasted, returned or counted — or it could never be emptied. */
    if (input.kind === "receipt" && !store.is_active) {
      return refuse(
        `${store.name} is switched off. Receive into another store, or switch it `
        + "on in Places and suppliers.");
    }

    /* THE SWAP IS ASKED EVERY TIME (D25-18): a cylinder issued, or delivered,
       says how many empties went the other way - never assumed. */
    const empties = input.kind === "issue" ? input.emptiesBack : input.emptiesTaken;
    if (!item[0].cylinder && empties !== undefined) {
      return refuse("Only an item counted in cylinders has empties.");
    }
    if (item[0].cylinder && empties === undefined && (input.kind === "issue" || input.kind === "receipt")) {
      return refuse(input.kind === "issue"
        ? "How many empties came back from the kitchen? 0 is an answer."
        : "How many empties did the supplier take back? 0 is an answer.");
    }
    if (input.kind === "receipt" && empties) {
      const have = await emptiesIn(client, input.itemId!, store.id);
      if (empties > have) {
        return refuse(
          `There ${have === 1 ? "is" : "are"} ${figure(have)} empty ${item[0].unit} of `
          + `${item[0].name} in ${store.name}, and this says the supplier took `
          + `${figure(empties)}. Count the empties first if the store holds more.`);
      }
    }

    /* THIS HOTEL'S OUTLET (D22-20). 069's key is on the outlet's id alone, so
       the database would take another property's (MEMORY 161). */
    if (input.outletId) {
      const { rows: outlet } = await client.query(
        "select 1 from pos_outlets where id::text = $1 and hotel_id = $2",
        [input.outletId, hotelId]);
      if (!outlet[0]) return refuse("That is not an outlet at this property.");
    } else if (input.kind === "issue" && input.outletId === undefined) {
      /* SAID EVERY TIME (the owner, 24 September): where the hotel has an
         outlet, an issue names one, or sends null for "not an outlet". */
      const { rows: hasOutlet } = await client.query(
        "select 1 from pos_outlets where hotel_id = $1 and is_active limit 1", [hotelId]);
      if (hasOutlet[0]) {
        return refuse("Which outlet did it go to? Choose Not an outlet for "
          + "housekeeping or a floor.");
      }
    }

    /* WOULD THIS TAKE IT BELOW ZERO?
       Refused, and the refusal says what is actually there. A store that
       can go negative is a store whose count nobody trusts — and the
       usual cause is a receipt that was never entered, which is a thing
       somebody can go and fix. An adjustment is the way to say "the
       shelf disagrees with the book". Per store since 106: forty kilos in
       the Main store is not rice in the kitchen. */
    const direction = DIRECTION[input.kind!];
    if (direction === "out") {
      const onHand = await onHandIn(client, input.itemId!, store.id);
      if (qty > onHand) {
        return refuse(
          `There ${onHand === 1 ? "is" : "are"} ${figure(onHand)} ${item[0].unit} of `
          + `${item[0].name} in ${store.name}, and this would take out ${figure(qty)}. `
          + "If the shelf says otherwise, correct the count first - that is "
          + "what it is for.");
      }
    }

    const signed = direction === "either" ? qty : direction === "in" ? qty : -qty;

    const id = await writeMovement(client, hotelId, session.staffId, {
      itemId: input.itemId!, storeId: store.id, kind: input.kind!, signed,
      unitCost: input.unitCost ?? null, supplier: input.supplier ?? null,
      reference: input.reference ?? null, note: input.note ?? null,
      outletId: input.outletId ?? null,
      gst: gstOf(input), expiresOn: input.expiresOn ?? null,
      department: department || null, brokenBy: input.brokenBy ?? null,
    });
    /* The empties, as their own row in the same store: back in on an issue,
       out to the supplier on a delivery. Nothing is written for 0. */
    if (empties) {
      await writeMovement(client, hotelId, session.staffId, {
        itemId: input.itemId!, storeId: store.id, empty: true,
        kind: input.kind === "issue" ? "receipt" : "return",
        signed: input.kind === "issue" ? empties : -empties,
        supplier: input.kind === "receipt" ? input.supplier ?? null : null,
        reference: input.kind === "receipt" ? input.reference ?? null : null,
      });
    }

    const { rows: now } = await client.query<{ on_hand: string }>(
      "select app.stock_on_hand($1)::text as on_hand", [input.itemId]);

    return {
      ok: true as const,
      id,
      onHand: Number(now[0]!.on_hand),
      /* What that store holds now, named — what the person just changed. */
      onHandHere: await onHandIn(client, input.itemId!, store.id),
      emptiesHere: item[0].cylinder ? await emptiesIn(client, input.itemId!, store.id) : null,
      store: store.name,
      unit: item[0].unit,
      name: item[0].name,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(forbidden(result.forbidden), 403);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Undoing one ──────────────────────────────────────────────────── */

stores.post("/:code/stores/movements/:id/reverse", async (c) => {
  const input = await c.req.json<{ note?: string }>()
    .catch(() => ({}) as { note?: string });

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "edit"))) return forbid("edit");

    /* Scoped before it is touched. The function takes an id and RLS
       covers the read, but a route that hands a bare id to a
       SECURITY-less function is one policy change away from being
       wrong. */
    const { rows: legs } = await client.query<{
      kind: StoredKind; quantity: string; on_hand: string;
      store: string; name: string; unit: string; empty: boolean;
    }>(
      /* The row asked for — and, if it is half of a move, both halves: an
         undo takes both back (106), so both stores must bear it. An empty
         cylinder's row is borne by the empties (D25-18). */
      `select leg.kind, leg.quantity::text, leg.empty,
              (case when leg.empty then app.stock_empties(leg.item_id, leg.location_id)
                    else app.stock_on_hand(leg.item_id, leg.location_id) end)::text as on_hand,
              l.name as store, i.name, i.unit
         from stock_movements m
         join stock_movements leg
           on (m.transfer_id is not null and leg.transfer_id = m.transfer_id)
           or (m.transfer_id is null and leg.id = m.id)
         join locations l on l.id = leg.location_id
         join stock_items i on i.id = leg.item_id
        where m.id = $1 and m.hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    if (legs.length === 0) return refuse("No such movement in this store.");

    /* WOULD THIS UNDO LEAVE LESS THAN NOTHING? (STO-11, the owner's answer
       of 16 September: refuse, and say why.) Undoing a delivery after some
       of it went out took Basmati rice to −12 kg — the same shelf the Issue
       button refuses to overdraw. An undo takes back exactly what the row
       put in, so what is left IN THAT STORE is its on hand minus that. */
    for (const leg of legs) {
      const after = Number(leg.on_hand) - Number(leg.quantity);
      if (after < 0) {
        const gone = figure(-after);
        const unit = `${leg.empty ? "empty " : ""}${leg.unit}`;
        return refuse(
          `Undoing this ${leg.empty ? "record of empties" : UNDONE_NOUN[leg.kind]} `
          + `would leave −${gone} ${unit} of ${leg.name} in ${leg.store} - ${gone} `
          + `${unit} of it has already gone out. Correct the count instead.`);
      }
    }

    try {
      const { rows } = await client.query<{ id: string }>(
        "select app.reverse_stock_movement($1, $2, $3)::text as id",
        [c.req.param("id"), session.staffId, input.note?.trim() || null],
      );
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      /* The function raises in words somebody can act on — "that row is
         itself a reversal", "already reversed". Passed through rather
         than swallowed into a 500. */
      return refuse(
        error instanceof Error ? error.message : "That could not be undone.");
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(forbidden(result.forbidden), 403);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── An item's levels, and a cylinder's deposit ───────────────────── */

/* LEVELS PER STORE (D25-12, D25-13) and THE DEPOSIT (D25-19): settings on an
   item already in the store, so `edit` - the people who correct counts. A
   level of null clears it; a deposit figure of null is "not typed". Only what
   the body names is changed. */
stores.patch("/:code/stores/items/:id", async (c) => {
  type Body = {
    levels?: Record<string, number | null>;
    cylindersOnDeposit?: number | null;
    depositPerCylinder?: number | null;
    /** Crockery and cutlery (D27-242). */
    crockery?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const levels = Object.entries(input.levels ?? {});
  const deposit = "cylindersOnDeposit" in input || "depositPerCylinder" in input;
  const crockery = typeof input.crockery === "boolean" ? input.crockery : null;

  if (levels.length === 0 && !deposit && crockery === null) return c.json(refuse("Nothing to change."), 409);
  if (levels.some(([, n]) => n !== null && !isCount(n))) {
    return c.json(refuse("A level is zero or more, or blank for none."), 409);
  }
  const onDeposit = input.cylindersOnDeposit;
  if (onDeposit !== undefined && onDeposit !== null
      && (!isCount(onDeposit) || !Number.isInteger(onDeposit))) {
    return c.json(refuse("Cylinders on deposit is a whole number, or blank."), 409);
  }
  const each = input.depositPerCylinder;
  if (each !== undefined && each !== null && !isCount(each)) {
    return c.json(refuse("A deposit is zero or more, or blank."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "edit"))) return forbid("edit");

    const { rows: item } = await client.query<{ id: string; cylinder: boolean; crockery: boolean; in_use: boolean }>(
      `select i.id::text, app.counted_in_cylinders(i.unit) as cylinder, i.crockery,
              exists (select 1 from locations l
                       where l.hotel_id = i.hotel_id and l.kind = any($3::text[])
                         and app.stock_on_hand(i.id, l.id) <> 0) as in_use
         from stock_items i where i.id::text = $1 and i.hotel_id = $2`,
      [c.req.param("id"), hotelId, IN_USE_KINDS]);
    if (!item[0]) return refuse("No such item in this store.");
    if (deposit && !item[0].cylinder) {
      return refuse("Only an item counted in cylinders has a deposit.");
    }
    if (crockery === false && item[0].in_use) {
      return refuse("Some of it is in use at an outlet. Move it back to a store first.");
    }
    /* A par at a restaurant, bar or kitchen is crockery's (D27-242). */
    const isCrockery = crockery ?? item[0].crockery;
    for (const [storeId] of levels) {
      if (!(await storeAt(client, hotelId, storeId, isCrockery))) return refuse("That is not a store at this property.");
    }
    if (crockery !== null) {
      await client.query("update stock_items set crockery = $2 where id = $1", [item[0].id, crockery]);
    }

    for (const [storeId, level] of levels) {
      await setLevel(client, hotelId, item[0].id, storeId, level, session.staffId);
    }
    if (deposit) {
      await client.query(
        `update stock_items
            set cylinders_on_deposit = case when $2 then $3::int else cylinders_on_deposit end,
                deposit_per_cylinder = case when $4 then $5::numeric else deposit_per_cylinder end
          where id = $1`,
        [item[0].id, onDeposit !== undefined, onDeposit ?? null, each !== undefined, each ?? null]);
    }
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(forbidden(result.forbidden), 403);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── A store, counted ─────────────────────────────────────────────── */

/* THE COUNT SHEET (D25-15, D25-16, D25-17). The lines a person counted in one
   store; a line left blank is not sent, and never taken as zero. Each
   difference is ONE correction (`adjustment`), recorded against whoever saves
   the sheet, with the reason "Count of <store>" and any typed on the line.
   Nothing is edited, and a line that matches the book writes nothing.

   NO LOCK (D25-15). Each line carries the book figure the sheet showed; if
   the store's book has moved since, the whole save is refused and names what
   to count again - before anything is written (MEMORY 243).
   ponytail: the check and the writes are not locked against an issue in the
   same instant; lock the items if two people ever save into one store at once. */
stores.post("/:code/stores/counts", async (c) => {
  type Line = { itemId?: string; empty?: boolean; book?: number; counted?: number; reason?: string };
  const input = await c.req.json<{ locationId?: string; lines?: Line[] }>()
    .catch(() => ({}) as { locationId?: string; lines?: Line[] });
  const lines = input.lines ?? [];

  if (!input.locationId) return c.json(refuse("Which store was counted?"), 409);
  if (lines.length === 0) {
    return c.json(refuse("Nothing was counted - type a count on at least one line."), 409);
  }
  if (lines.some((l) => !l.itemId || typeof l.book !== "number" || !Number.isFinite(l.book))) {
    return c.json(refuse("Every line names its item and what the book said."), 409);
  }
  if (lines.some((l) => !isCount(l.counted))) {
    return c.json(refuse("A count is zero or more."), 409);
  }
  const keys = lines.map((l) => `${l.itemId}:${l.empty === true}`);
  if (new Set(keys).size !== keys.length) {
    return c.json(refuse("An item is on the sheet twice."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "edit"))) return forbid("edit");

    /* A restaurant, bar or kitchen is counted for its crockery (D27-242). */
    const store = await storeAt(client, hotelId, input.locationId, true);
    if (!store) return refuse("That is not a store at this property.");

    const { rows: items } = await client.query<{
      id: string; name: string; cylinder: boolean; crockery: boolean; full: string; empties: string;
    }>(
      `select id::text, name, app.counted_in_cylinders(unit) as cylinder, crockery,
              app.stock_on_hand(id, $3)::text as full,
              app.stock_empties(id, $3)::text as empties
         from stock_items where hotel_id = $1 and id::text = any($2)`,
      [hotelId, lines.map((l) => l.itemId), store.id]);
    const byId = new Map(items.map((i) => [i.id, i]));

    const moved: string[] = [];
    for (const l of lines) {
      const it = byId.get(l.itemId!);
      if (!it) return refuse("An item on the sheet is not in this store.");
      if (store.kind !== "store" && !it.crockery) {
        return refuse(`Only crockery and cutlery is counted at ${store.name}.`);
      }
      if (l.empty && !it.cylinder) return refuse("Only an item counted in cylinders has empties.");
      const now = Number(l.empty ? it.empties : it.full);
      if (now !== l.book) moved.push(l.empty ? `${it.name} (empty)` : it.name);
    }
    if (moved.length > 0) {
      return refuse(
        `${moved.join(", ")} moved in ${store.name} since the count was opened - `
        + `count ${moved.length === 1 ? "it" : "them"} again. Nothing was saved.`);
    }

    /* EVERY LINE IS KEPT (D27-238), matched or not: a count that matched
       wrote nothing, so nothing said the shelf had been counted at all.
       "Last counted" and the count-difference report read these. */
    const businessDate = await businessDateFor(client, hotelId);
    let recorded = 0;
    for (const l of lines) {
      const difference = Math.round((l.counted! - l.book!) * 1000) / 1000;
      const movementId = difference === 0 ? null : await writeMovement(client, hotelId, session.staffId, {
        itemId: l.itemId!, storeId: store.id, kind: "adjustment", signed: difference,
        empty: l.empty === true,
        note: `Count of ${store.name}` + (l.reason?.trim() ? ` - ${l.reason.trim()}` : ""),
      });
      await client.query(
        `insert into stock_count_lines
           (hotel_id, item_id, location_id, empty, book, counted, counted_by, business_date, movement_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9)`,
        [hotelId, l.itemId, store.id, l.empty === true, l.book, l.counted,
         session.staffId, businessDate, movementId]);
      if (movementId) recorded += 1;
    }
    return { ok: true as const, recorded, matched: lines.length - recorded, store: store.name };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(forbidden(result.forbidden), 403);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── From one store to another ────────────────────────────────────── */

/* ONE ACT, TWO ROWS (106, the owner's answer of 17 September). Rice leaving
   the Main store for the Kitchen store is not an issue — nothing was used — and
   not a delivery; it is `app.transfer_stock`, which writes both halves in one
   statement. `create`, like an issue: the kitchen manager may move stock too. */
stores.post("/:code/stores/transfers", async (c) => {
  type Body = {
    itemId?: string; fromId?: string; toId?: string; quantity?: number; note?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.itemId) return c.json(refuse("Which item?"), 409);
  if (!input.fromId) return c.json(refuse("Move it from which store?"), 409);
  if (!input.toId) return c.json(refuse("Move it to which store?"), 409);
  if (input.fromId === input.toId) return c.json(refuse("It is already there."), 409);
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return c.json(refuse("How much? A move of nothing is not a move."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "create"))) return forbid("create");

    const { rows: item } = await client.query<{ name: string; unit: string; crockery: boolean }>(
      "select name, unit, crockery from stock_items where id = $1 and hotel_id = $2",
      [input.itemId, hotelId]);
    if (!item[0]) return refuse("No such item in this store.");

    /* Crockery moves into use at a restaurant, bar or kitchen, and back
       (D27-242); everything else moves between stores. */
    const from = await storeAt(client, hotelId, input.fromId, item[0].crockery);
    const to = await storeAt(client, hotelId, input.toId, item[0].crockery);
    if (!from || !to) return refuse("That is not a store at this property.");
    if (!to.is_active) {
      return refuse(
        `${to.name} is switched off. Move it to another store, or switch it on `
        + "in Places and suppliers.");
    }

    const have = await onHandIn(client, input.itemId!, from.id);
    if (qty > have) {
      return refuse(
        `There ${have === 1 ? "is" : "are"} ${figure(have)} ${item[0].unit} of `
        + `${item[0].name} in ${from.name}, and this would move ${figure(qty)}.`);
    }

    const { rows } = await client.query<{ id: string }>(
      "select app.transfer_stock($1, $2, $3, $4, $5, $6)::text as id",
      [input.itemId, from.id, to.id, qty, session.staffId, input.note?.trim() || null]);

    return {
      ok: true as const,
      transferId: rows[0]!.id,
      name: item[0].name,
      unit: item[0].unit,
      from: { name: from.name, onHand: await onHandIn(client, input.itemId!, from.id) },
      to: { name: to.name, onHand: await onHandIn(client, input.itemId!, to.id) },
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(forbidden(result.forbidden), 403);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── A hundred items, from a file ─────────────────────────────────── */

/* A store is a hundred lines long and typing it into a dialog one at a
   time is not something anybody will do — the same argument the menu
   import is built on, and leaving it out here would be inconsistent.

   Same two passes: a dry run that changes nothing and reports what would
   happen, then the identical payload to apply. And the same refusal
   rule — a row with no unit does not land with a blank unit, because a
   quantity with no unit means nothing at all. */
stores.post("/:code/stores/import", async (c) => {
  interface Row {
    name?: string; unit?: string; category?: string; reorderLevel?: string;
  }
  const input = await c.req.json<{ rows?: Row[]; dryRun?: boolean }>()
    .catch(() => ({}) as { rows?: Row[]; dryRun?: boolean });

  const rows = input.rows ?? [];
  const dryRun = input.dryRun !== false;

  if (rows.length === 0) {
    return c.json(refuse("There are no rows in that file."), 409);
  }
  if (rows.length > 2000) {
    return c.json(refuse(
      `That file has ${rows.length} rows. Two thousand is the limit.`), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "create"))) return forbid("create");
    /* SPLIT BY ROW — the owner, 16 September. A new item needs `create`; a
       row that changes an item already in the store needs `edit`. Without
       it such a row is REJECTED like any other bad row: the dry run lists
       it with the reason, and the apply leaves that item untouched. */
    const mayEdit = await mayStock(client, hotelId, "edit");

    const { rows: existing } = await client.query<{ name: string }>(
      "select name from stock_items where hotel_id = $1", [hotelId]);
    const already = new Set(existing.map((r) => r.name.toLowerCase()));

    const verdicts: {
      line: number; name: string;
      action: "create" | "update" | "rejected"; detail: string;
    }[] = [];
    const seen = new Set<string>();
    const good: {
      name: string; unit: string; category: string | null;
      reorder: number | null; existed: boolean;
    }[] = [];

    rows.forEach((raw, i) => {
      const line = i + 2;
      const name = String(raw.name ?? "").trim();
      const unit = String(raw.unit ?? "").trim();
      const reject = (detail: string) => {
        verdicts.push({
          line, name: name || "(blank)", action: "rejected", detail,
        });
      };

      if (!name && !unit) return;
      if (!name) return reject("No item name.");
      /* A QUANTITY WITH NO UNIT MEANS NOTHING. Forty of what? */
      if (!unit) return reject("No unit - forty of what?");

      const rawLevel = String(raw.reorderLevel ?? "").trim();
      let reorder: number | null = null;
      if (rawLevel !== "") {
        reorder = Number(rawLevel);
        if (!Number.isFinite(reorder) || reorder < 0) {
          return reject(`"${raw.reorderLevel}" is not a quantity.`);
        }
      }

      const key = name.toLowerCase();
      if (seen.has(key)) {
        return reject(`"${name}" appears twice in this file.`);
      }
      seen.add(key);

      if (already.has(key) && !mayEdit) {
        return reject(
          "Already in the store. Changing an item is for the owner, an "
          + "administrator, the general manager, the hotel manager or the "
          + "Inventory Manager.");
      }
      /* A LEVEL IS `edit` (D25-13), on a new item too. */
      if (reorder !== null && !mayEdit) {
        return reject(
          "A warning level is set by the owner, an administrator, the general "
          + "manager, the hotel manager or the Inventory Manager. Leave it blank.");
      }

      verdicts.push({
        line, name,
        action: already.has(key) ? "update" : "create",
        detail: `counted in ${unit}`
          + (reorder === null ? "" : `, warn below ${reorder} in the Main store`),
      });
      good.push({
        name, unit,
        category: String(raw.category ?? "").trim() || null,
        reorder, existed: already.has(key),
      });
    });

    const tally = {
      creates: verdicts.filter((v) => v.action === "create").length,
      updates: verdicts.filter((v) => v.action === "update").length,
      rejected: verdicts.filter((v) => v.action === "rejected").length,
    };
    if (dryRun) return { ok: true as const, dryRun: true, verdicts, ...tally };

    for (const item of good) {
      const { rows: saved } = await client.query<{ id: string }>(
        `insert into stock_items (hotel_id, name, unit, category)
         values ($1,$2,$3,$4)
         on conflict (hotel_id, name) do update
           set unit          = excluded.unit,
               category      = coalesce(excluded.category, stock_items.category),
               is_active     = true
         returning id::text`,
        [hotelId, item.name, item.unit, item.category]);
      /* "Warn below" is the Main store's level (D25-12); on an item already
         there a blank clears it, as the column always did. */
      if (item.reorder !== null || item.existed) {
        await setLevel(client, hotelId, saved[0]!.id, null, item.reorder, session.staffId);
      }
    }

    /* NOTHING GETS A QUANTITY OR A VALUE FROM THIS. An import creates
       things the property keeps; receiving a delivery is what puts
       something on the shelf. A file that could set an opening balance
       would be a hundred stock movements with no delivery note behind
       any of them. */
    return { ok: true as const, dryRun: false, verdicts, ...tally };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(forbidden(result.forbidden), 403);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
