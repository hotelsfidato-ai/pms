import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import {
  mayStock, actionForKind, isInventoryManagerAt, STOCK_REFUSED, type StockAction,
} from "./stockGrants.ts";

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
    a delivery against a purchase order gets in (115). Two writers for one
    ledger is the shape of half the defects in MEMORY.md. */
async function writeMovement(
  client: Client, hotelId: string, staffId: string,
  m: {
    itemId: string; storeId: string; kind: StoredKind; signed: number;
    unitCost?: number | null; supplier?: string | null;
    reference?: string | null; note?: string | null; outletId?: string | null;
  },
): Promise<string> {
  const businessDate = await businessDateFor(client, hotelId);
  const { rows } = await client.query<{ id: string }>(
    `insert into stock_movements
       (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost,
        supplier, reference, note, to_outlet, moved_by)
     values ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id::text`,
    [hotelId, m.itemId, m.storeId, businessDate, m.kind, m.signed,
     m.unitCost ?? null, m.supplier?.trim() || null,
     m.reference?.trim() || null, m.note?.trim() || null,
     m.outletId || null, staffId],
  );
  return rows[0]!.id;
}

/* ── The Store's door for a delivery (115, the purchasing service) ──
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
      reorder_level: string | null; is_active: boolean;
      on_hand: string; unit_cost: string | null;
      last_movement: string | null; movements: string;
    }>(
      /* On hand and cost come from the FUNCTIONS, not from columns. That
         is the whole design: one definition, and it cannot disagree with
         the history below it. */
      `select i.id::text, i.name, i.unit, i.category,
              i.reorder_level::text, i.is_active,
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
    const { rows: held } = await client.query<{ item: string; store: string; n: string }>(
      `select i.id::text as item, l.id::text as store,
              app.stock_on_hand(i.id, l.id)::text as n
         from stock_items i
         join locations l on l.hotel_id = i.hotel_id and l.kind = 'store'
        where i.hotel_id = $1`,
      [hotelId]);
    const byItem = new Map<string, Record<string, number>>();
    for (const h of held) {
      const n = Number(h.n);
      if (n === 0) continue;
      byItem.set(h.item, { ...(byItem.get(h.item) ?? {}), [h.store]: n });
    }
    const holding = new Set(held.filter((h) => Number(h.n) !== 0).map((h) => h.store));

    return {
      stores: places
        .filter((p) => p.is_active || holding.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, isActive: p.is_active, isMain: p.main })),
      items: rows.map((r) => {
        const onHand = Number(r.on_hand);
        const reorder = r.reorder_level === null ? null : Number(r.reorder_level);
        return {
          id: r.id,
          name: r.name,
          unit: r.unit,
          category: r.category,
          onHand,
          /* NULL, never 0. Nobody has asked to be warned about this one,
             which is not the same as "warn me when it hits zero". */
          reorderLevel: reorder,
          /* Derived here rather than on the screen, so the list and any
             report asking the same question get the same answer. */
          low: reorder !== null && onHand <= reorder,
          /* NULL when nothing has ever been received — a dash, because
             an item nobody has bought has no value and zero would claim
             it is worthless. */
          unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
          value: r.unit_cost === null
            ? null
            : Math.round(onHand * Number(r.unit_cost) * 100) / 100,
          /* What is in each store, by store id. A store holding nothing of it
             is absent, and the screen shows a dash there, not a zero. */
          byStore: byItem.get(r.id) ?? {},
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
      undone_quantity: string | null; partner_store: string | null; reversed: boolean;
    }>(
      /* WHO: through `staff` as before, and for the Inventory Manager through
         `app.colleague_name` too (STO-4) — a name, of somebody rostered here.
         REVERSES_KIND: what an undo undid, so the screen can say "Undo of a
         delivery" rather than "Adjusted" (STO-6).
         STORE and PARTNER_STORE (106): the store it happened in, and for a
         move, or the undo of one, the store at the other end of it. */
      `select m.id::text, m.business_date::text, m.kind, m.quantity::text,
              m.unit_cost::text, m.supplier, m.reference, m.note,
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

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayStock(client, hotelId, "create"))) return forbid("create");

    /* THE SAME NAME IS A CHANGE, NOT AN ADDITION. The insert below
       overwrites an existing item's unit, category and warning level —
       and changing an existing item needs `edit` (the owner, 16 September). */
    const { rows: existing } = await client.query(
      "select 1 from stock_items where hotel_id = $1 and name = $2", [hotelId, name]);
    if (existing.length > 0 && !(await mayStock(client, hotelId, "edit"))) {
      return forbid("edit");
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into stock_items (hotel_id, name, unit, category, reorder_level)
       values ($1,$2,$3,$4,$5)
       on conflict (hotel_id, name) do update
         set unit          = excluded.unit,
             category      = excluded.category,
             reorder_level = excluded.reorder_level,
             is_active     = true
       returning id::text`,
      [hotelId, name, unit, input.category?.trim() || null,
       input.reorderLevel ?? null],
    );
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
    supplier?: string;
    reference?: string;
    note?: string;
    outletId?: string | null;
    /** WHICH STORE it happened in (106). Required: the screen always says,
        and a request that does not is refused rather than guessed. */
    locationId?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.itemId) return c.json(refuse("Which item?"), 409);
  if (!input.kind || !KINDS.includes(input.kind)) {
    return c.json(refuse("That is not something that happens to stock."), 409);
  }
  if (!input.locationId) return c.json(refuse("Which store?"), 409);
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
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const action = actionForKind(input.kind!);
    if (!(await mayStock(client, hotelId, action))) return forbid(action);

    const { rows: item } = await client.query<{ name: string; unit: string }>(
      "select name, unit from stock_items where id = $1 and hotel_id = $2",
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

    const { rows: now } = await client.query<{ on_hand: string }>(
      "select app.stock_on_hand($1)::text as on_hand", [input.itemId]);

    return {
      ok: true as const,
      id,
      onHand: Number(now[0]!.on_hand),
      /* What that store holds now, named — what the person just changed. */
      onHandHere: await onHandIn(client, input.itemId!, store.id),
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
      store: string; name: string; unit: string;
    }>(
      /* The row asked for — and, if it is half of a move, both halves: an
         undo takes both back (106), so both stores must bear it. */
      `select leg.kind, leg.quantity::text,
              app.stock_on_hand(leg.item_id, leg.location_id)::text as on_hand,
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
        return refuse(
          `Undoing this ${UNDONE_NOUN[leg.kind]} would leave −${gone} ${leg.unit} `
          + `of ${leg.name} in ${leg.store} - ${gone} ${leg.unit} of it has `
          + "already gone out. Correct the count instead.");
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

  const result = await withSession(c.get("subject"), async (client) => {
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
      reorder: number | null;
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

      verdicts.push({
        line, name,
        action: already.has(key) ? "update" : "create",
        detail: `counted in ${unit}`
          + (reorder === null ? "" : `, warn below ${reorder}`),
      });
      good.push({
        name, unit,
        category: String(raw.category ?? "").trim() || null,
        reorder,
      });
    });

    const tally = {
      creates: verdicts.filter((v) => v.action === "create").length,
      updates: verdicts.filter((v) => v.action === "update").length,
      rejected: verdicts.filter((v) => v.action === "rejected").length,
    };
    if (dryRun) return { ok: true as const, dryRun: true, verdicts, ...tally };

    for (const item of good) {
      await client.query(
        `insert into stock_items (hotel_id, name, unit, category, reorder_level)
         values ($1,$2,$3,$4,$5)
         on conflict (hotel_id, name) do update
           set unit          = excluded.unit,
               category      = coalesce(excluded.category, stock_items.category),
               reorder_level = excluded.reorder_level,
               is_active     = true`,
        [hotelId, item.name, item.unit, item.category, item.reorder]);
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
