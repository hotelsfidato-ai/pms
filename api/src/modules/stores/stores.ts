import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import {
  mayStock, actionForKind, isInventoryManagerAt, STOCK_REFUSED, type StockAction,
} from "./stockGrants.ts";
import { priceProblem } from "../../validate.ts";

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
const KINDS = ["receipt", "issue", "wastage", "adjustment", "return"] as const;
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
};

/** How a refusal names the row somebody tried to undo. */
const UNDONE_NOUN: Record<StoredKind, string> = {
  receipt: "delivery",
  issue: "issue",
  wastage: "waste",
  return: "return",
  adjustment: "count correction",
  transfer: "move",
};

/* A figure a person reads: no trailing zeros from numeric(12,3). */
const figure = (n: number) => String(Math.round(n * 1000) / 1000);

interface StoreRow { id: string; name: string; is_active: boolean }

/** A store at this hotel, as a request names it — or null. Only a place of kind
    `store` holds stock (094); the database says so too (106). */
async function storeAt(client: Client, hotelId: string, id: unknown): Promise<StoreRow | null> {
  if (typeof id !== "string" || id === "") return null;
  const { rows } = await client.query<StoreRow>(
    `select id::text, name, is_active from locations
      where id::text = $1 and hotel_id = $2 and kind = 'store'`,
    [id, hotelId]);
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
  },
): Promise<string> {
  const businessDate = await businessDateFor(client, hotelId);
  const { rows } = await client.query<{ id: string }>(
    `insert into stock_movements
       (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost,
        supplier, reference, note, to_outlet, moved_by, empty)
     values ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id::text`,
    [hotelId, m.itemId, m.storeId, businessDate, m.kind, m.signed,
     m.unitCost ?? null, m.supplier?.trim() || null,
     m.reference?.trim() || null, m.note?.trim() || null,
     m.outletId || null, staffId, m.empty === true],
  );
  return rows[0]!.id;
}

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

  const id = await writeMovement(client, hotelId, staffId, {
    itemId: input.itemId, storeId: store.id, kind: "receipt", signed: qty,
    unitCost: input.unitCost ?? null, supplier: input.supplier ?? null,
    reference: input.reference ?? null, note: input.note ?? null,
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
                 from stock_movements m where m.item_id = i.id) as movements
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
         join locations l on l.hotel_id = i.hotel_id and l.kind = 'store'
        where i.hotel_id = $1`,
      [hotelId]);
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
    const open = new Set(places.filter((p) => p.is_active).map((p) => p.id));

    /* WHERE AN ISSUE CAN GO (D22-20): the outlets the hotel already has — the
       till's own list, which 069's `to_outlet` has always pointed at. */
    const { rows: outlets } = await client.query<{ id: string; name: string }>(
      "select id::text, name from pos_outlets where hotel_id = $1 and is_active order by name",
      [hotelId]);

    return {
      outlets,
      stores: places
        .filter((p) => p.is_active || holding.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, isActive: p.is_active, isMain: p.main })),
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
    }>(
      /* WHO: through `staff` as before, and for the Inventory Manager through
         `app.colleague_name` too (STO-4) — a name, of somebody rostered here.
         REVERSES_KIND: what an undo undid, so the screen can say "Undo of a
         delivery" rather than "Adjusted" (STO-6).
         STORE and PARTNER_STORE (106): the store it happened in, and for a
         move, or the undo of one, the store at the other end of it. */
      `select m.id::text, m.business_date::text, m.kind, m.quantity::text,
              m.unit_cost::text, m.supplier, m.reference, m.note, m.empty,
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
            reversed: m.reversed,
          };
        }),
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
      `insert into stock_items (hotel_id, name, unit, category)
       values ($1,$2,$3,$4)
       on conflict (hotel_id, name) do update
         set unit          = excluded.unit,
             category      = excluded.category,
             is_active     = true
       returning id::text`,
      [hotelId, name, unit, input.category?.trim() || null],
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
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.itemId) return c.json(refuse("Which item?"), 409);
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

    const { rows: item } = await client.query<{ name: string; unit: string; cylinder: boolean }>(
      `select name, unit, app.counted_in_cylinders(unit) as cylinder
         from stock_items where id = $1 and hotel_id = $2`,
      [input.itemId, hotelId],
    );
    if (!item[0]) return refuse("No such item in this store.");

    const store = await storeAt(client, hotelId, input.locationId);
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
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const levels = Object.entries(input.levels ?? {});
  const deposit = "cylindersOnDeposit" in input || "depositPerCylinder" in input;

  if (levels.length === 0 && !deposit) return c.json(refuse("Nothing to change."), 409);
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

    const { rows: item } = await client.query<{ id: string; cylinder: boolean }>(
      `select id::text, app.counted_in_cylinders(unit) as cylinder
         from stock_items where id::text = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    if (!item[0]) return refuse("No such item in this store.");
    if (deposit && !item[0].cylinder) {
      return refuse("Only an item counted in cylinders has a deposit.");
    }
    for (const [storeId] of levels) {
      if (!(await storeAt(client, hotelId, storeId))) return refuse("That is not a store at this property.");
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

    const store = await storeAt(client, hotelId, input.locationId);
    if (!store) return refuse("That is not a store at this property.");

    const { rows: items } = await client.query<{
      id: string; name: string; cylinder: boolean; full: string; empties: string;
    }>(
      `select id::text, name, app.counted_in_cylinders(unit) as cylinder,
              app.stock_on_hand(id, $3)::text as full,
              app.stock_empties(id, $3)::text as empties
         from stock_items where hotel_id = $1 and id::text = any($2)`,
      [hotelId, lines.map((l) => l.itemId), store.id]);
    const byId = new Map(items.map((i) => [i.id, i]));

    const moved: string[] = [];
    for (const l of lines) {
      const it = byId.get(l.itemId!);
      if (!it) return refuse("An item on the sheet is not in this store.");
      if (l.empty && !it.cylinder) return refuse("Only an item counted in cylinders has empties.");
      const now = Number(l.empty ? it.empties : it.full);
      if (now !== l.book) moved.push(l.empty ? `${it.name} (empty)` : it.name);
    }
    if (moved.length > 0) {
      return refuse(
        `${moved.join(", ")} moved in ${store.name} since the count was opened - `
        + `count ${moved.length === 1 ? "it" : "them"} again. Nothing was saved.`);
    }

    let recorded = 0;
    for (const l of lines) {
      const difference = Math.round((l.counted! - l.book!) * 1000) / 1000;
      if (difference === 0) continue;
      await writeMovement(client, hotelId, session.staffId, {
        itemId: l.itemId!, storeId: store.id, kind: "adjustment", signed: difference,
        empty: l.empty === true,
        note: `Count of ${store.name}` + (l.reason?.trim() ? ` - ${l.reason.trim()}` : ""),
      });
      recorded += 1;
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

    const { rows: item } = await client.query<{ name: string; unit: string }>(
      "select name, unit from stock_items where id = $1 and hotel_id = $2",
      [input.itemId, hotelId]);
    if (!item[0]) return refuse("No such item in this store.");

    const from = await storeAt(client, hotelId, input.fromId);
    const to = await storeAt(client, hotelId, input.toId);
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
