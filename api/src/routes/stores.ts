import { Hono } from "hono";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import type { Client } from "../db.ts";

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

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

const KINDS = ["receipt", "issue", "wastage", "adjustment", "return"] as const;
type Kind = (typeof KINDS)[number];

/** Which way each kind moves stock. The database holds this too — this is
    so a screen gets a sentence rather than a constraint violation. */
const DIRECTION: Record<Kind, "in" | "out" | "either"> = {
  receipt: "in",
  issue: "out",
  wastage: "out",
  return: "out",
  adjustment: "either",
};

/* ── What is in the store ─────────────────────────────────────────── */

stores.get("/:code/stores", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

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

    return {
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
          lastMovement: r.last_movement,
          movements: Number(r.movements),
          isActive: r.is_active,
        };
      }),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── One item's history ───────────────────────────────────────────── */

stores.get("/:code/stores/items/:id/movements", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; business_date: string; kind: string; quantity: string;
      unit_cost: string | null; supplier: string | null;
      reference: string | null; note: string | null;
      outlet: string | null; who: string | null;
      reverses_id: string | null; reversed: boolean;
    }>(
      `select m.id::text, m.business_date::text, m.kind, m.quantity::text,
              m.unit_cost::text, m.supplier, m.reference, m.note,
              o.name as outlet, s.full_name as who,
              m.reverses_id::text,
              exists (select 1 from stock_movements r
                       where r.reverses_id = m.id) as reversed
         from stock_movements m
         left join pos_outlets o on o.id = m.to_outlet
         left join staff s on s.id = m.moved_by
        where m.hotel_id = $1 and m.item_id = $2
        order by m.business_date desc, m.id desc
        limit 200`,
      [hotelId, c.req.param("id")],
    );

    return {
      movements: rows.map((m) => ({
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
        /* Both flags, because they are different facts and the history is
           unreadable without both: one row UNDID something, another WAS
           undone, and neither should look like an ordinary movement. */
        isReversal: m.reverses_id !== null,
        reversed: m.reversed,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
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
      "What is it counted in? Kilos, litres, pieces, cylinders — without a "
      + "unit a number in this list means nothing."), 409);
  }
  if (input.reorderLevel !== undefined && input.reorderLevel !== null
      && (!Number.isFinite(input.reorderLevel) || input.reorderLevel < 0)) {
    return c.json(refuse("A reorder level is zero or more, or blank for none."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

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
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (!input.itemId) return c.json(refuse("Which item?"), 409);
  if (!input.kind || !KINDS.includes(input.kind)) {
    return c.json(refuse("That is not something that happens to stock."), 409);
  }
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty === 0) {
    return c.json(refuse("How much? A movement of nothing is not a movement."), 409);
  }
  if (qty < 0 && input.kind !== "adjustment") {
    return c.json(refuse(
      "Send how much moved, not which way — the kind decides the direction. "
      + "Only an adjustment may go either way."), 409);
  }
  if (input.unitCost !== undefined && input.unitCost !== null) {
    if (input.kind !== "receipt") {
      return c.json(refuse(
        "Only a delivery carries a cost. Issuing to the kitchen does not "
        + "cost anything — the money left when it was bought."), 409);
    }
    if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
      return c.json(refuse("A unit cost is zero or more."), 409);
    }
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: item } = await client.query<{ name: string; unit: string }>(
      "select name, unit from stock_items where id = $1 and hotel_id = $2",
      [input.itemId, hotelId],
    );
    if (!item[0]) return refuse("No such item in this store.");

    /* WOULD THIS TAKE IT BELOW ZERO?
       Refused, and the refusal says what is actually there. A store that
       can go negative is a store whose count nobody trusts — and the
       usual cause is a receipt that was never entered, which is a thing
       somebody can go and fix. An adjustment is the way to say "the
       shelf disagrees with the book". */
    const direction = DIRECTION[input.kind!];
    if (direction === "out") {
      const { rows: have } = await client.query<{ on_hand: string }>(
        "select app.stock_on_hand($1)::text as on_hand", [input.itemId]);
      const onHand = Number(have[0]!.on_hand);
      if (qty > onHand) {
        return refuse(
          `There ${onHand === 1 ? "is" : "are"} ${onHand} ${item[0].unit} of `
          + `${item[0].name} in the store, and this would take out ${qty}. `
          + "If the shelf says otherwise, record an adjustment — that is "
          + "what it is for.");
      }
    }

    const businessDate = await businessDateFor(client, hotelId);
    const signed = direction === "either" ? qty : direction === "in" ? qty : -qty;

    const { rows } = await client.query<{ id: string }>(
      `insert into stock_movements
         (hotel_id, item_id, business_date, kind, quantity, unit_cost,
          supplier, reference, note, to_outlet, moved_by)
       values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)
       returning id::text`,
      [hotelId, input.itemId, businessDate, input.kind, signed,
       input.unitCost ?? null, input.supplier?.trim() || null,
       input.reference?.trim() || null, input.note?.trim() || null,
       input.outletId || null, session.staffId],
    );

    const { rows: now } = await client.query<{ on_hand: string }>(
      "select app.stock_on_hand($1)::text as on_hand", [input.itemId]);

    return {
      ok: true as const,
      id: rows[0]!.id,
      onHand: Number(now[0]!.on_hand),
      unit: item[0].unit,
      name: item[0].name,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Undoing one ──────────────────────────────────────────────────── */

stores.post("/:code/stores/movements/:id/reverse", async (c) => {
  const input = await c.req.json<{ note?: string }>()
    .catch(() => ({}) as { note?: string });

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Scoped before it is touched. The function takes an id and RLS
       covers the read, but a route that hands a bare id to a
       SECURITY-less function is one policy change away from being
       wrong. */
    const { rows: own } = await client.query<{ id: string }>(
      "select id::text from stock_movements where id = $1 and hotel_id = $2",
      [c.req.param("id"), hotelId],
    );
    if (!own[0]) return refuse("No such movement in this store.");

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
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
