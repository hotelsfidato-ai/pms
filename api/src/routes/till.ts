import { Hono } from "hono";
import type { Context, Next } from "hono";
import { randomUUID } from "node:crypto";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   THE TILL — the POS built into the PMS

   pos.ts is the BRIDGE: an outside till presents a key and posts a
   finished bill. This is the PMS's own till, and every route here is
   PERSON-facing — a waiter with a session, not a machine with a key.

   THE RULE THAT SHAPES THIS FILE

   Settling to a room does NOT write a folio posting of its own. It
   goes through the same door an outside POS uses: a pos_tickets row
   carrying the posting. The in-house till gets no privileged path to
   the ledger, which means the idempotency, the one-room-two-guests
   refusal and the append-only posting were all built and tested
   before this file existed.

   A CASH sale never touches a folio and so never creates a ticket.
   pos_tickets stays what its comment says — bills that reached a
   guest folio. pos_orders is the complete sales record.
   ══════════════════════════════════════════════════════════════════ */

export const till = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

/** The hotel this route is about, or null if the code is unknown. */
async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── The module gate ──────────────────────────────────────────────
   Not every property has a restaurant. HIDING THE SCREEN IS NOT
   DISABLING IT — a hidden nav entry is still a URL anybody can type,
   and the endpoint behind it would answer happily.

   So the API refuses independently of the interface, which is the
   shape Rule 6 asks for everywhere: the screen shows the reason, and
   the server does not rely on the screen having shown it.

   Absent means ENABLED. A property that never had a row keeps its
   till, because turning something off is an act somebody performs and
   never a side effect of a deploy. */
till.use("/:code/till/*", moduleGate);
till.use("/:code/kitchen", moduleGate);
till.use("/:code/kitchen/*", moduleGate);

async function moduleGate(
  c: Context<{ Variables: { subject: string } }>,
  next: Next,
) {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "No such property." }, 404);

  const allowed = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return null;
    const { rows } = await client.query<{ enabled: boolean }>(
      `select app.module_enabled($1, 'pos') as enabled`, [hotelId]);
    return rows[0]!.enabled;
  });

  if (allowed === null) return c.json({ error: "No such property." }, 404);
  if (!allowed) {
    return c.json(refuse(
      "This property has no point of sale. Turn it on in the property's " +
      "settings if that is wrong."), 403);
  }
  await next();
}

/* ── The menu ─────────────────────────────────────────────────────── */

till.get("/:code/till/menu", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      category_id: string; category: string; id: string | null;
      name: string | null; price: string | null; tax_rate: string | null;
      is_active: boolean | null; sort_order: number;
      short_code: string | null; is_veg: boolean | null;
      is_favourite: boolean | null; off_until: string | null;
      off_reason: string | null;
    }>(
      /* Left join, so a category with nothing in it still appears.
         A kitchen that has created "Desserts" and not filled it needs
         to see the empty shelf, not wonder where it went. */
      `select c.id::text as category_id, c.name as category,
              i.id::text, i.name, i.price::text, i.tax_rate::text,
              i.is_active, coalesce(i.sort_order, 0) as sort_order,
              i.short_code, i.is_veg, i.is_favourite,
              i.off_until::text, i.off_reason
         from pos_menu_categories c
         left join pos_menu_items i on i.category_id = c.id
        where c.hotel_id = $1 and c.is_active
        order by c.sort_order, c.name, i.sort_order, i.name`,
      [hotelId],
    );

    const byCategory = new Map<string, {
      id: string; name: string;
      items: {
        id: string; name: string; price: number; taxRate: number;
        isActive: boolean; shortCode: string | null;
        isVeg: boolean | null; isFavourite: boolean;
        offUntil: string | null; offReason: string | null;
        variations: { id: string; label: string; price: number }[];
        addonGroups: {
          id: string; label: string; minSelect: number; maxSelect: number | null;
          addons: { id: string; label: string; price: number; offUntil: string | null }[];
        }[];
      }[];
    }>();

    for (const r of rows) {
      let cat = byCategory.get(r.category_id);
      if (!cat) {
        cat = { id: r.category_id, name: r.category, items: [] };
        byCategory.set(r.category_id, cat);
      }
      if (r.id && r.name) {
        cat.items.push({
          id: r.id,
          name: r.name,
          price: Number(r.price),
          taxRate: Number(r.tax_rate),
          isActive: r.is_active ?? false,
          shortCode: r.short_code,
          /* NULL is a real answer: nobody has said whether this is veg,
             and the third state must not render as the green mark. */
          isVeg: r.is_veg,
          isFavourite: r.is_favourite ?? false,
          offUntil: r.off_until,
          offReason: r.off_reason,
          variations: [],
          addonGroups: [],
        });
      }
    }

    /* Variations and add-ons in two more queries rather than a join that
       multiplies rows. A dish with two variations and four sides would
       come back eight times, and the reassembly is then the thing that
       has a bug in it. */
    const { rows: variations } = await client.query<{
      item_id: string; id: string; label: string; price: string;
    }>(
      `select v.item_id::text, v.id::text, v.label, v.price::text
         from pos_item_variations v
         join pos_menu_items i on i.id = v.item_id
        where i.hotel_id = $1 and v.is_active
        order by v.sort_order, v.price`,
      [hotelId],
    );

    const { rows: addons } = await client.query<{
      item_id: string; group_id: string; group_label: string;
      min_select: number; max_select: number | null;
      id: string; label: string; price: string; off_until: string | null;
    }>(
      `select ig.item_id::text, g.id::text as group_id, g.label as group_label,
              g.min_select, g.max_select,
              a.id::text, a.label, a.price::text, a.off_until::text
         from pos_item_addon_groups ig
         join pos_addon_groups g on g.id = ig.group_id
         join pos_addons a on a.group_id = g.id
        where g.hotel_id = $1 and a.is_active
        order by ig.sort_order, g.label, a.sort_order, a.label`,
      [hotelId],
    );

    const items = new Map(
      [...byCategory.values()].flatMap((c2) => c2.items.map((i) => [i.id, i] as const)),
    );

    for (const v of variations) {
      items.get(v.item_id)?.variations.push({
        id: v.id, label: v.label, price: Number(v.price),
      });
    }

    for (const a of addons) {
      const item = items.get(a.item_id);
      if (!item) continue;
      let group = item.addonGroups.find((g) => g.id === a.group_id);
      if (!group) {
        group = {
          id: a.group_id, label: a.group_label,
          minSelect: a.min_select, maxSelect: a.max_select, addons: [],
        };
        item.addonGroups.push(group);
      }
      group.addons.push({
        id: a.id, label: a.label, price: Number(a.price),
        offUntil: a.off_until,
      });
    }

    return { categories: [...byCategory.values()] };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

till.post("/:code/till/menu/categories", async (c) => {
  type CategoryBody = { name?: string; sortOrder?: number };
  const input = await c.req.json<CategoryBody>()
    .catch(() => ({}) as CategoryBody);
  const name = input.name?.trim();
  if (!name) return c.json(refuse("A category needs a name."), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_menu_categories (hotel_id, name, sort_order)
       values ($1,$2,$3)
       on conflict (hotel_id, name) do update set is_active = true
       returning id::text`,
      [hotelId, name, input.sortOrder ?? 0],
    );
    return { ok: true as const, id: rows[0]!.id, name };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

till.post("/:code/till/menu/items", async (c) => {
  type ItemBody = {
    categoryId?: string; name?: string; price?: number; taxRate?: number;
  };
  const input = await c.req.json<ItemBody>().catch(() => ({}) as ItemBody);

  const name = input.name?.trim();
  if (!name) return c.json(refuse("An item needs a name."), 409);
  if (!input.categoryId) {
    return c.json(refuse("Which part of the menu does this belong to?"), 409);
  }

  /* A price of zero is legitimate — a complimentary welcome drink still
     goes on the bill at nil. A NEGATIVE one is not, and neither is a
     blank pretending to be one. */
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    return c.json(refuse("A price must be zero or more."), 409);
  }

  const taxRate = Number(input.taxRate ?? 5);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    return c.json(refuse("A tax rate must be between 0 and 100."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
       values ($1,$2,$3,$4,$5)
       on conflict (hotel_id, category_id, name)
         do update set price = excluded.price,
                       tax_rate = excluded.tax_rate,
                       is_active = true
       returning id::text`,
      [hotelId, input.categoryId, name, price, taxRate],
    );
    return { ok: true as const, id: rows[0]!.id, name, price, taxRate };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

till.post("/:code/till/menu/items/:id/toggle", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Off, not gone. A dish that is unavailable today has a history of
       being sold, and the lines that sold it point at this row. */
    const { rows } = await client.query<{ is_active: boolean; name: string }>(
      `update pos_menu_items set is_active = not is_active
        where id = $1 and hotel_id = $2
        returning is_active, name`,
      [c.req.param("id"), hotelId],
    );
    if (!rows[0]) return { ok: false as const, reason: "No such item." };
    return { ok: true as const, isActive: rows[0].is_active, name: rows[0].name };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Rooms a bill can be charged to ───────────────────────────────── */

till.get("/:code/till/rooms", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The same function the bridge uses. A room is chargeable when
       somebody is checked into it AND their folio is open — not merely
       when the room is occupied. Two different questions with two
       different answers on a checkout morning. */
    const { rows } = await client.query<{
      room_number: string; guest_name: string; folio_id: string;
    }>(
      `select room_number, guest_name, folio_id::text
         from app.pos_chargeable_rooms($1)
        order by room_number`,
      [hotelId],
    );

    return {
      rooms: rows.map((r) => ({
        room: r.room_number, guest: r.guest_name, folioId: r.folio_id,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Orders ───────────────────────────────────────────────────────── */

/** One order with its lines and what it comes to. */
async function readOrder(client: Client, orderId: string) {
  const { rows: head } = await client.query<{
    id: string; order_no: string; outlet: string; outlet_name: string;
    hotel_name: string; hotel_city: string | null; hotel_gstin: string | null;
    table_ref: string | null; status: string; business_date: string;
    payment_method: string | null; opened_by_name: string;
    discount_type: string | null; discount_value: string | null;
    discount_reason: string | null;
    covers: number | null; waiter_name: string | null; order_type: string;
    customer_name: string | null; customer_phone: string | null;
    customer_address: string | null; customer_locality: string | null;
    held_at: string | null;
    settled_by_name: string | null; settled_at: string | null;
    abandoned_reason: string | null; ticket_id: string | null;
  }>(
    /* The hotel's details travel WITH the order, the way the invoice
       carries its own. A bill printed today should still read the same
       next year, and a browser assembling it from a live property list
       would quietly reprint it with June's address. */
    `select o.id::text, o.order_no, ou.code as outlet, ou.name as outlet_name,
            h.name as hotel_name, h.city as hotel_city, h.gstin as hotel_gstin,
            o.table_ref, o.status,
            to_char(o.business_date,'YYYY-MM-DD') as business_date,
            o.payment_method,
            o.discount_type, o.discount_value::text, o.discount_reason,
            o.covers, s3.full_name as waiter_name, o.order_type,
            o.customer_name, o.customer_phone, o.customer_address,
            o.customer_locality, o.held_at::text,
            s1.full_name as opened_by_name,
            s2.full_name as settled_by_name,
            to_char(o.settled_at,'DD Mon, HH24:MI') as settled_at,
            o.abandoned_reason, o.ticket_id::text
       from pos_orders o
       join pos_outlets ou on ou.id = o.outlet_id
       join hotels h on h.id = o.hotel_id
       join staff s1 on s1.id = o.opened_by
       left join staff s2 on s2.id = o.settled_by
       left join staff s3 on s3.id = o.waiter_id
      where o.id = $1`,
    [orderId],
  );
  if (!head[0]) return null;

  const { rows: lines } = await client.query<{
    id: string; name: string; qty: string; unit_price: string;
    tax_rate: string; note: string | null; voided: boolean;
    kot_status: string;
    added_by_name: string;
    parent_line_id: string | null;
    variation_id: string | null; addon_id: string | null;
  }>(
    `select l.id::text, l.name, l.qty::text, l.unit_price::text,
            l.tax_rate::text, l.note, l.voided, l.kot_status,
            s.full_name as added_by_name,
            l.parent_line_id::text, l.variation_id::text, l.addon_id::text
       from pos_order_lines l
       join staff s on s.id = l.added_by
      where l.order_id = $1
      order by l.id`,
    [orderId],
  );

  /* The total comes from the DATABASE, not from adding the lines up
     here. One definition, used by the till, the bill and the
     settlement, so the three cannot disagree about what a guest owes. */
  const { rows: total } = await client.query<{
    net: string; discount: string; taxable: string; tax: string;
    gross: string; round_off: string; payable: string;
  }>(`select net::text, discount::text, taxable::text, tax::text,
             gross::text, round_off::text, payable::text
        from app.pos_order_total($1)`,
    [orderId]);

  /* What was actually taken, and how. One row for an ordinary bill,
     several when the guest paid part cash and part card. Empty while the
     order is open — nothing has been taken yet. */
  const { rows: tenders } = await client.query<{
    id: string; method: string; amount: string;
    tendered: string | null; reference: string | null; taken_by_name: string;
  }>(
    `select t.id::text, t.method, t.amount::text, t.tendered::text,
            t.reference, s.full_name as taken_by_name
       from pos_order_tenders t
       join staff s on s.id = t.taken_by
      where t.order_id = $1
      order by t.id`,
    [orderId],
  );

  const h = head[0];
  return {
    id: h.id,
    orderNo: h.order_no,
    outlet: h.outlet,
    outletName: h.outlet_name,
    hotelName: h.hotel_name,
    hotelCity: h.hotel_city,
    hotelGstin: h.hotel_gstin,
    table: h.table_ref,
    status: h.status,
    businessDate: h.business_date,
    paymentMethod: h.payment_method,
    openedBy: h.opened_by_name,
    settledBy: h.settled_by_name,
    settledAt: h.settled_at,
    abandonedReason: h.abandoned_reason,
    ticketId: h.ticket_id,

    /* The header. `covers` is people eating, not seats — average per
       cover is the metric a restaurant runs on, and a table for two
       that seats six says nothing. */
    covers: h.covers,
    waiter: h.waiter_name,
    orderType: h.order_type,
    customerName: h.customer_name,
    customerPhone: h.customer_phone,
    customerAddress: h.customer_address,
    customerLocality: h.customer_locality,
    heldAt: h.held_at,
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      qty: Number(l.qty),
      unitPrice: Number(l.unit_price),
      taxRate: Number(l.tax_rate),
      note: l.note,
      voided: l.voided,
      /* pending until a waiter sends it. The till shows which dishes the
         kitchen has, so a second KOT does not re-fire the starters. */
      kotStatus: l.kot_status,
      addedBy: l.added_by_name,
      /* An add-on names the dish it belongs to. The bill and the kitchen
         docket both indent on this: "Sides: Onions" under "Bhaaji Pau
         (Butter)", exactly as the printed ticket does. */
      parentLineId: l.parent_line_id,
      isAddon: l.addon_id !== null,
      variationId: l.variation_id,
    })),
    net: Number(total[0]!.net),
    /* The discount as APPLIED, which is what the arithmetic used. type and
       value are what the biller entered, and are what the bill prints —
       "10% off" rather than a number whose origin nobody can reconstruct. */
    discount: Number(total[0]!.discount),
    discountType: h.discount_type,
    discountValue: h.discount_value === null ? null : Number(h.discount_value),
    discountReason: h.discount_reason,
    taxable: Number(total[0]!.taxable),
    tax: Number(total[0]!.tax),
    gross: Number(total[0]!.gross),
    roundOff: Number(total[0]!.round_off),
    payable: Number(total[0]!.payable),
    tenders: tenders.map((t) => ({
      id: t.id,
      method: t.method,
      amount: Number(t.amount),
      tendered: t.tendered === null ? null : Number(t.tendered),
      /* Change is derived, never stored. A stored figure is one more thing
         that can disagree with the arithmetic. */
      change: t.tendered === null ? null : Number(t.tendered) - Number(t.amount),
      reference: t.reference,
      takenBy: t.taken_by_name,
    })),
  };
}

till.get("/:code/till/orders", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);

    /* Open orders regardless of date, plus everything settled today.

       Open ones ignore the date deliberately: an order left open when
       the night audit ran is a mistake somebody has to find, and
       filtering it out by date is how it stays lost. */
    const { rows } = await client.query<{
      id: string; order_no: string; outlet: string; table_ref: string | null;
      status: string; business_date: string; gross: string;
      payment_method: string | null; opened_at: string; lines: string;
    }>(
      `select o.id::text, o.order_no, ou.code as outlet, o.table_ref,
              o.status, to_char(o.business_date,'YYYY-MM-DD') as business_date,
              (select gross from app.pos_order_total(o.id))::text as gross,
              o.payment_method,
              to_char(o.opened_at,'HH24:MI') as opened_at,
              (select count(*) from pos_order_lines l
                where l.order_id = o.id and not l.voided)::text as lines
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
        where o.hotel_id = $1
          and (o.status = 'open' or o.business_date = $2::date)
        order by o.status = 'open' desc, o.opened_at desc
        limit 200`,
      [hotelId, businessDate],
    );

    return {
      businessDate,
      orders: rows.map((r) => ({
        id: r.id,
        orderNo: r.order_no,
        outlet: r.outlet,
        table: r.table_ref,
        status: r.status,
        businessDate: r.business_date,
        gross: Number(r.gross),
        paymentMethod: r.payment_method,
        openedAt: r.opened_at,
        lines: Number(r.lines),
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

till.post("/:code/till/orders", async (c) => {
  type OpenBody = { outlet?: string; table?: string; tableId?: string };
  const input = await c.req.json<OpenBody>().catch(() => ({}) as OpenBody);
  if (!input.outlet) return c.json(refuse("Which outlet is this order for?"), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: outlet } = await client.query<{
      id: string; name: string;
      closed_until: string | null; closed_reason: string | null;
    }>(
      `select id::text, name, closed_until::text, closed_reason
         from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, input.outlet!.toUpperCase()],
    );
    if (!outlet[0]) {
      return refuse(`No active outlet with code ${input.outlet}.`);
    }

    /* THE STORE IS SHUT. Not the same as the module being off — that is
       a configuration change made in settings, and this is a Tuesday
       when the kitchen stopped serving early.

       Says WHEN it reopens, because a waiter refused with no time has
       to go and find somebody to ask. */
    if (outlet[0].closed_until
        && Date.parse(outlet[0].closed_until) > Date.now()) {
      const back = new Date(outlet[0].closed_until)
        .toLocaleString("en-IN", {
          weekday: "short", hour: "2-digit", minute: "2-digit",
        });
      return refuse(
        `${outlet[0].name} is closed` +
        `${outlet[0].closed_reason ? ` — ${outlet[0].closed_reason}` : ""}. ` +
        `Open again ${back}.`);
    }

    /* The hotel's operating day, resolved here. A waiter opening an
       order at 00:40 is serving the evening that has not closed yet. */
    const businessDate = await businessDateFor(client, hotelId);

    const { rows: no } = await client.query<{ order_no: string }>(
      `select app.pos_next_order_no($1, $2::date) as order_no`,
      [hotelId, businessDate],
    );

    /* A TABLE FROM THE FLOOR, or free text. Both are real: a floor plan
       does not have to cover everywhere food is served, and "Poolside"
       is still an answer. When a table IS named, its label is copied
       into table_ref so a bill reprinted next year reads the same even
       if the floor has been rearranged since. */
    let tableId: string | null = null;
    let tableRef: string | null = input.table?.trim() || null;

    if (input.tableId) {
      const { rows: t } = await client.query<{ id: string; label: string }>(
        `select t.id::text, t.label from pos_tables t
           join pos_sections s on s.id = t.section_id
          where t.id = $1 and s.outlet_id = $2 and t.is_active`,
        [input.tableId, outlet[0].id],
      );
      if (!t[0]) return refuse("That table is not in this outlet.");
      tableId = t[0].id;
      tableRef = t[0].label;

      /* Named before the unique index gets to it. Two open orders on one
         table is two bills nobody can tell apart, and the floor would
         show whichever came back first. */
      const { rows: busy } = await client.query<{ order_no: string }>(
        `select order_no from pos_orders
          where table_id = $1 and cleared_at is null and status = 'open'`,
        [tableId],
      );
      if (busy[0]) {
        return refuse(
          `${t[0].label} already has ${busy[0].order_no} running on it.`);
      }
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_orders
         (hotel_id, outlet_id, order_no, table_ref, business_date, opened_by,
          table_id)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id::text`,
      [hotelId, outlet[0].id, no[0]!.order_no, tableRef,
       businessDate, session.staffId, tableId],
    );

    return { ok: true as const, ...(await readOrder(client, rows[0]!.id))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.get("/:code/till/orders/:id", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    return await readOrder(client, c.req.param("id"));
  });

  return body ? c.json(body) : c.json({ error: "No such order." }, 404);
});

till.post("/:code/till/orders/:id/lines", async (c) => {
  type LineBody = {
    itemId?: string; qty?: number; note?: string;
    /* Chosen in the dish dialog, both optional. A dish with variations
       REQUIRES one and the database refuses without it; a dish with
       none must not be sent one. */
    variationId?: string;
    addonIds?: string[];
  };
  const input = await c.req.json<LineBody>().catch(() => ({}) as LineBody);

  const qty = Number(input.qty ?? 1);
  if (!Number.isFinite(qty) || qty <= 0) {
    return c.json(refuse("A quantity must be more than nothing."), 409);
  }
  if (!input.itemId) return c.json(refuse("Which item?"), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const orderId = c.req.param("id");

    /* Refuse in the API as well as the database. The trigger is the
       guarantee — it holds against every role — but a waiter who taps
       an item on a bill somebody just settled deserves the reason,
       not a constraint violation. Rule 6. */
    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(
        `This order is ${order[0].status}. A bill that has been paid cannot ` +
          `take another item — correct it with a credit, not by editing it.`,
      );
    }

    const { rows: item } = await client.query<{
      name: string; price: string; tax_rate: string; is_active: boolean;
      off_until: string | null; off_reason: string | null;
      variation_count: string;
    }>(
      `select i.name, i.price::text, i.tax_rate::text, i.is_active,
              i.off_until::text, i.off_reason,
              (select count(*)::text from pos_item_variations v
                where v.item_id = i.id and v.is_active) as variation_count
         from pos_menu_items i where i.id = $1 and i.hotel_id = $2`,
      [input.itemId, hotelId],
    );
    if (!item[0]) return refuse("No such item on the menu.");
    if (!item[0].is_active) {
      return refuse(`${item[0].name} is off the menu today.`);
    }
    /* "We are out of paneer", until a time. Says WHEN it comes back, so
       the waiter can tell the table rather than just be refused. */
    if (item[0].off_until && Date.parse(item[0].off_until) > Date.now()) {
      const back = new Date(item[0].off_until)
        .toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      return refuse(
        `${item[0].name} is off${item[0].off_reason ? ` — ${item[0].off_reason}` : ""}. ` +
        `Back after ${back}.`);
    }

    /* THE PRICE COMES FROM THE VARIATION, NOT THE ITEM.

       A dish that gains an Oil and a Butter has a `price` column nobody
       has looked at since. Charging it would put a number on the bill
       that is on no menu — so the database refuses, and this names the
       reason before the constraint does. */
    let name = item[0].name;
    let unitPrice = item[0].price;

    if (Number(item[0].variation_count) > 0) {
      if (!input.variationId) {
        return refuse(`${item[0].name} is sold by variation. Choose one.`);
      }
      const { rows: v } = await client.query<{ label: string; price: string }>(
        `select label, price::text from pos_item_variations
          where id = $1 and item_id = $2 and is_active`,
        [input.variationId, input.itemId],
      );
      if (!v[0]) return refuse("That variation is not on this dish.");
      name = `${item[0].name} (${v[0].label})`;
      unitPrice = v[0].price;
    } else if (input.variationId) {
      return refuse(`${item[0].name} has no variations.`);
    }

    /* Price and tax are COPIED onto the line. A menu price that rises
       next month must not silently re-price a bill printed today. */
      /* Increment first. Only if nothing matched does a row get added. */
      /* Add-ons make two lines DIFFERENT even when the dish and note
         match — a Bhaaji Pau with onions is not the same thing to a
         kitchen as one without. Sent with add-ons, it always starts a
         new line rather than joining one whose sides nobody checked. */
      const wantsAddons = (input.addonIds?.length ?? 0) > 0;
      const { rowCount: bumped } = wantsAddons ? { rowCount: 0 } : await client.query(
        `update pos_order_lines
            set qty = qty + $1
          where order_id = $2
            and item_id = $3
            and variation_id is not distinct from $5
            and parent_line_id is null
            and not exists (select 1 from pos_order_lines a
                             where a.parent_line_id = pos_order_lines.id
                               and not a.voided)
            and not voided
            and note is not distinct from $4`,
        [qty, orderId, input.itemId, input.note?.trim() || null,
         input.variationId ?? null],
      );

      const added = !bumped ? await client.query<{ id: string }>(
      /* TAPPING THE SAME DISH TWICE MEANS TWO OF IT, NOT TWO LINES.

         This inserted unconditionally, so a table ordering six butter
         rotis produced six rows reading "1x Butter Roti" — six taps, six
         lines on the kitchen copy, six lines on the guest's bill. Every
         till in the trade increments instead, and a waiter expects it to.

         The match is on the item AND the note: "Paneer Tikka" and
         "Paneer Tikka, no chilli" are different things to a kitchen and
         must stay different rows. A struck line is not matched either —
         re-adding something that was cancelled starts fresh. */
      `insert into pos_order_lines
         (order_id, hotel_id, item_id, variation_id, name, qty, unit_price,
          tax_rate, note, added_by)
       values ($1,$2,$3,$10,$4,$5,$6,$7,$8,$9)
       returning id`,
      [orderId, hotelId, input.itemId, name, qty,
       unitPrice, item[0].tax_rate, input.note?.trim() || null, session.staffId,
       input.variationId ?? null],
    ) : null;

    /* ── The sides, as child lines ────────────────────────────────
       An add-on is a LINE. It carries its own name, price, quantity and
       tax rate, so the totals, the discount apportionment and the
       per-rate folio posting all handle it without being taught
       anything new — and striking the dish strikes them, by trigger.

       Its own tax rate comes from the DISH, not the add-on: onions
       served on a plate of Bhaaji Pau are taxed as what they are part
       of, and a side sold at a different rate to the thing it garnishes
       would split one dish across two folio postings. */
    const parentId = added?.rows[0]?.id;
    if (parentId && input.addonIds?.length) {
      const { rows: chosen } = await client.query<{
        id: string; label: string; price: string; group_label: string;
        off_until: string | null;
      }>(
        `select a.id::text, a.label, a.price::text, g.label as group_label,
                a.off_until::text
           from pos_addons a
           join pos_addon_groups g on g.id = a.group_id
          where a.id = any($1::uuid[]) and a.hotel_id = $2 and a.is_active
            and exists (select 1 from pos_item_addon_groups ig
                         where ig.group_id = a.group_id and ig.item_id = $3)`,
        [input.addonIds, hotelId, input.itemId],
      );

      /* Named, not silently dropped. An add-on the guest asked for that
         does not reach the kitchen is a complaint at the table. */
      if (chosen.length !== input.addonIds.length) {
        return refuse(
          "One of those sides is not offered with this dish, or is off today.");
      }

      for (const a of chosen) {
        if (a.off_until && Date.parse(a.off_until) > Date.now()) {
          return refuse(`${a.label} is off today.`);
        }
        await client.query(
          `insert into pos_order_lines
             (order_id, hotel_id, addon_id, parent_line_id, name, qty,
              unit_price, tax_rate, added_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [orderId, hotelId, a.id, parentId,
           `${a.group_label}: ${a.label}`, qty, a.price,
           item[0].tax_rate, session.staffId],
        );
      }
    }

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/orders/:id/lines/:lineId/void", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    /* Struck, not removed. A waiter adding and cancelling the same
       dish four times is exactly what a manager investigating a
       dispute wants to be able to see. */
    const { rowCount } = await client.query(
      `update pos_order_lines
          set voided = true, voided_by = $1, voided_at = now()
        where id = $2 and order_id = $3 and not voided`,
      [session.staffId, c.req.param("lineId"), orderId],
    );
    if (!rowCount) return refuse("That line is already struck, or is not here.");

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── The discount ─────────────────────────────────────────────────
   A discount is allowed and it must say WHY. A till with nowhere to
   record one does not stop discounts happening — it moves them
   somewhere invisible, and the biller voids a line instead. */

till.post("/:code/till/orders/:id/discount", async (c) => {
  type DiscountBody = { type?: string; value?: number; reason?: string };
  const input = await c.req.json<DiscountBody>().catch(() => ({}) as DiscountBody);

  const type = input.type;
  if (type !== "percent" && type !== "fixed") {
    return c.json(refuse("A discount is a percentage or a fixed amount."), 409);
  }

  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) {
    return c.json(refuse("How much is the discount?"), 409);
  }
  if (type === "percent" && value > 100) {
    return c.json(
      refuse("More than 100% is a refund, not a discount."), 409);
  }

  /* The reason is the whole point. An amount with nobody's explanation
     attached is an unauditable hole in revenue, which is worse than
     not offering the feature at all. */
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(
      refuse("Why is this discounted? A staff meal, a complaint, a manager's call."),
      409,
    );
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    const { rows: t } = await client.query<{ net: string }>(
      `select net::text from app.pos_order_total($1)`, [orderId]);
    if (Number(t[0]!.net) <= 0) {
      return refuse("There is nothing on this order to discount.");
    }

    /* A percentage is resolved to money ONCE, here, and stored. Never
       recomputed on read: a bill printed at 10% off would silently
       change the moment somebody added a line to the order. */
    const amount = type === "percent"
      ? (await client.query<{ amount: string }>(
          `select app.pos_discount_for($1, $2)::text as amount`,
          [orderId, value])).rows[0]!.amount
      : value;

    await client.query(
      `update pos_orders
          set discount_type = $1, discount_value = $2,
              discount_amount = $3, discount_reason = $4, updated_at = now()
        where id = $5`,
      [type, value, amount, reason, orderId],
    );

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/orders/:id/discount/clear", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rowCount } = await client.query(
      `update pos_orders
          set discount_type = null, discount_value = null,
              discount_amount = 0, discount_reason = null, updated_at = now()
        where id = $1 and hotel_id = $2 and status = 'open'`,
      [orderId, hotelId],
    );
    if (!rowCount) return refuse("No open order here, or it is already settled.");

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Round off ────────────────────────────────────────────────────
   To the nearest rupee, so the biller takes a note rather than
   counting coins. Its own column because it is its own line on the
   bill and its own row in the day book — and the database caps it
   under a rupee so it cannot become a discount avoiding the reason. */

till.post("/:code/till/orders/:id/round-off", async (c) => {
  type RoundBody = { apply?: boolean };
  const input = await c.req.json<RoundBody>().catch(() => ({}) as RoundBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    if (input.apply === false) {
      await client.query(
        `update pos_orders set round_off = 0, updated_at = now() where id = $1`,
        [orderId]);
      return { ok: true as const, ...(await readOrder(client, orderId))! };
    }

    /* Computed from the gross, with round_off already zeroed, so
       applying it twice does not compound. */
    await client.query(
      `update pos_orders set round_off = 0 where id = $1`, [orderId]);

    const { rows: t } = await client.query<{ gross: string }>(
      `select gross::text from app.pos_order_total($1)`, [orderId]);
    const gross = Number(t[0]!.gross);
    const adjustment = Math.round(gross) - gross;

    await client.query(
      `update pos_orders set round_off = $1, updated_at = now() where id = $2`,
      [adjustment.toFixed(2), orderId],
    );

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── Off, and back on ─────────────────────────────────────────────
   The most-used menu action in a live kitchen, and the one that has to
   take three seconds: paneer runs out mid-service and a waiter is
   already at a table asking for it.

   A DURATION, not a switch. "Off" with no end is a dish that stays off
   for a week because the person who took it off went home. The choices
   are the ones a kitchen actually thinks in — a couple of hours, the
   rest of the shift, the rest of the day. */

/** Turns what the screen offers into the moment it comes back. */
function offUntilFor(
  choice: string | undefined, custom: string | undefined,
  businessDate: string,
): Date | null | "bad" {
  switch (choice) {
    case "2h":  return new Date(Date.now() + 2 * 3600_000);
    case "4h":  return new Date(Date.now() + 4 * 3600_000);
    case "8h":  return new Date(Date.now() + 8 * 3600_000);
    case "24h": return new Date(Date.now() + 24 * 3600_000);
    case "next_business_day":
      /* Midnight ending the hotel's operating day, plus a whole day.
         Deliberately the BUSINESS date and not the clock: a kitchen
         closing out at 00:40 is still working yesterday's service, and
         "back tomorrow" must not mean "back in twenty minutes". */
      return new Date(
        Date.parse(`${businessDate}T00:00:00Z`) + 2 * 86_400_000);
    case "custom": {
      if (!custom) return "bad";
      const at = Date.parse(custom);
      if (!Number.isFinite(at) || at <= Date.now()) return "bad";
      return new Date(at);
    }
    default: return "bad";
  }
}

till.post("/:code/till/menu/items/:id/off", async (c) => {
  type OffBody = { until?: string; customUntil?: string; reason?: string };
  const input = await c.req.json<OffBody>().catch(() => ({}) as OffBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);
    const until = offUntilFor(input.until, input.customUntil, businessDate);
    if (until === "bad") {
      return refuse("For how long — two hours, four, eight, the rest of the day?");
    }

    const { rowCount } = await client.query(
      `update pos_menu_items
          set off_until = $1, off_reason = $2, updated_at = now()
        where id = $3 and hotel_id = $4`,
      [until, input.reason?.trim() || null, c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such item on the menu.");

    return { ok: true as const, offUntil: until?.toISOString() ?? null };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/menu/items/:id/on", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Cleared, not set to now(). A past timestamp reads as "it was off
       until then", which is a fact nobody needs and which makes the
       five states on the screen ambiguous. */
    const { rowCount } = await client.query(
      `update pos_menu_items
          set off_until = null, off_reason = null, updated_at = now()
        where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such item on the menu.");

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/addons/:id/off", async (c) => {
  type OffBody = { until?: string; customUntil?: string };
  const input = await c.req.json<OffBody>().catch(() => ({}) as OffBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);
    const until = offUntilFor(input.until, input.customUntil, businessDate);
    if (until === "bad") return refuse("For how long?");

    const { rowCount } = await client.query(
      `update pos_addons set off_until = $1 where id = $2 and hotel_id = $3`,
      [until, c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such add-on.");
    return { ok: true as const, offUntil: until?.toISOString() ?? null };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/addons/:id/on", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      `update pos_addons set off_until = null where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such add-on.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── The store itself ─────────────────────────────────────────────
   A kitchen that has stopped serving, without turning the whole module
   off in settings — that is a configuration change, and this is a
   Tuesday. */

till.post("/:code/till/outlet/:outlet/closed", async (c) => {
  type ClosedBody = {
    closed?: boolean; until?: string; customUntil?: string; reason?: string;
  };
  const input = await c.req.json<ClosedBody>().catch(() => ({}) as ClosedBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (input.closed === false) {
      const { rowCount } = await client.query(
        `update pos_outlets set closed_until = null, closed_reason = null
          where code = upper($1) and hotel_id = $2`,
        [c.req.param("outlet"), hotelId]);
      if (!rowCount) return refuse("No such outlet.");
      return { ok: true as const, closedUntil: null };
    }

    const businessDate = await businessDateFor(client, hotelId);
    const until = offUntilFor(input.until, input.customUntil, businessDate);
    if (until === "bad") return refuse("Closed until when?");

    const { rowCount } = await client.query(
      `update pos_outlets set closed_until = $1, closed_reason = $2
        where code = upper($3) and hotel_id = $4`,
      [until, input.reason?.trim() || null, c.req.param("outlet"), hotelId]);
    if (!rowCount) return refuse("No such outlet.");

    return { ok: true as const, closedUntil: until?.toISOString() ?? null };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── The floor ────────────────────────────────────────────────────
   Every table with whatever is sitting on it, in ONE request. A grid
   that fetches a tile at a time flickers as it fills, and a waiter
   reads the whole room at once or not at all. */

till.get("/:code/till/floor", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const code = (c.req.query("outlet") ?? "REST").toUpperCase();
    const { rows: outlet } = await client.query<{
      id: string; name: string; closed_until: string | null;
    }>(
      `select id::text, name, closed_until::text from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, code],
    );
    if (!outlet[0]) return { sections: [], outlet: null };

    const { rows } = await client.query<{
      section_id: string; section: string; table_id: string; label: string;
      seats: number | null; row_no: number; col_no: number;
      order_id: string | null; order_no: string | null; state: string;
      minutes: number | null; payable: string | null;
    }>(
      `select section_id::text, section, table_id::text, label, seats,
              row_no, col_no, order_id::text, order_no, state, minutes,
              payable::text
         from app.pos_floor($1)`,
      [outlet[0].id],
    );

    /* Grouped here rather than in the browser: the SQL already returns
       them in section then row then column order, and re-sorting on the
       client is a second opinion about the same thing. */
    const sections: {
      id: string; name: string;
      tables: {
        id: string; label: string; seats: number | null;
        row: number; col: number;
        orderId: string | null; orderNo: string | null;
        state: string; minutes: number | null; payable: number | null;
      }[];
    }[] = [];

    for (const r of rows) {
      let section = sections.find((s) => s.id === r.section_id);
      if (!section) {
        section = { id: r.section_id, name: r.section, tables: [] };
        sections.push(section);
      }
      section.tables.push({
        id: r.table_id, label: r.label, seats: r.seats,
        row: r.row_no, col: r.col_no,
        orderId: r.order_id, orderNo: r.order_no,
        /* blank · running · kot · printed · paid. Derived, so the tile
           cannot disagree with the bill behind it. */
        state: r.state,
        minutes: r.minutes,
        payable: r.payable === null ? null : Number(r.payable),
      });
    }

    return {
      outlet: { code, name: outlet[0].name, closedUntil: outlet[0].closed_until },
      sections,
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

/* ── Printed, and cleared ─────────────────────────────────────────
   The two moments that make "printed" and "paid" different colours.
   Neither is a state somebody sets by hand on the tile: printing marks
   the order, and clearing the table is what a waiter does when the
   guests have gone. */

till.post("/:code/till/orders/:id/printed", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The FIRST print is what the colour means — the guest has the bill
       in front of them. Reprinting because the paper jammed does not
       restart that, so the timestamp is only set once. */
    const { rowCount } = await client.query(
      `update pos_orders set printed_at = coalesce(printed_at, now())
        where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such order.");
    return { ok: true as const, ...(await readOrder(client, c.req.param("id")))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/orders/:id/clear", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows } = await client.query<{
      status: string; order_no: string; cleared_at: string | null;
    }>(
      `select status, order_no, cleared_at::text from pos_orders
        where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!rows[0]) return refuse("No such order.");
    if (rows[0].cleared_at) return refuse("That table is already clear.");

    /* AN OPEN BILL IS NOT A FREE TABLE. Clearing one would take a live
       order off the floor with money on it — the guests are still
       sitting there and nobody can see what they have had. */
    if (rows[0].status === "open") {
      return refuse(
        `${rows[0].order_no} has not been settled. Take payment, or close it ` +
        "unpaid with a reason.");
    }

    await client.query(
      `update pos_orders set cleared_at = now() where id = $1`, [orderId]);

    return { ok: true as const, orderNo: rows[0].order_no };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── The order header ─────────────────────────────────────────────
   Covers, waiter, customer and channel — the five icons above the bill.

   ONE endpoint, because they are one panel. Four endpoints would mean a
   waiter who fills the panel in and taps away produces four writes,
   three of which can fail on their own and leave the header half
   entered with nothing saying which half.

   Every field is OPTIONAL and only what is SENT is written. Sending
   `covers` must not blank the waiter somebody set a minute ago. */

till.patch("/:code/till/orders/:id", async (c) => {
  type HeaderBody = {
    covers?: number | null;
    waiterId?: string | null;
    orderType?: string;
    customerName?: string | null;
    customerPhone?: string | null;
    customerAddress?: string | null;
    customerLocality?: string | null;
    held?: boolean;
  };
  const input = await c.req.json<HeaderBody>().catch(() => ({}) as HeaderBody);

  const TYPES = ["dine_in", "takeaway", "room_service", "delivery"];
  if (input.orderType !== undefined && !TYPES.includes(input.orderType)) {
    return c.json(refuse("Dine in, takeaway, room service or delivery."), 409);
  }
  if (input.covers !== undefined && input.covers !== null
      && (!Number.isInteger(input.covers) || input.covers < 1)) {
    /* Zero covers is a table nobody is sitting at. Named here so the
       waiter is not shown a constraint violation for a typo. */
    return c.json(refuse("How many people are eating?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    /* Only what was sent. A patch that wrote every column would blank
       the waiter each time somebody changed the covers. */
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, value: unknown) => {
      args.push(value);
      sets.push(`${col} = $${args.length}`);
    };

    if (input.covers !== undefined) set("covers", input.covers);
    if (input.waiterId !== undefined) set("waiter_id", input.waiterId);
    if (input.orderType !== undefined) set("order_type", input.orderType);
    if (input.customerName !== undefined) {
      set("customer_name", input.customerName?.trim() || null);
    }
    if (input.customerPhone !== undefined) {
      set("customer_phone", input.customerPhone?.trim() || null);
    }
    if (input.customerAddress !== undefined) {
      set("customer_address", input.customerAddress?.trim() || null);
    }
    if (input.customerLocality !== undefined) {
      set("customer_locality", input.customerLocality?.trim() || null);
    }
    /* Parked. A table that has ordered drinks and is not ready for food
       should not be a bill a waiter has to remember. */
    if (input.held !== undefined) {
      sets.push(input.held ? "held_at = now()" : "held_at = null");
    }

    if (!sets.length) return refuse("Nothing to change.");

    args.push(orderId, hotelId);
    try {
      await client.query(
        `update pos_orders set ${sets.join(", ")}, updated_at = now()
          where id = $${args.length - 1} and hotel_id = $${args.length}`,
        args,
      );
    } catch (error) {
      /* The waiter-scope trigger raises a sentence. Passing it through
         beats "internal error" for something the person can fix by
         picking a different name. */
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("does not work at this property")) {
        return refuse("That person does not work at this property.");
      }
      throw error;
    }

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* Who can be named as the waiter. Everyone with access to this property
   — the same answer housekeeping gives, and for the same reason: nobody
   holds a `waiter` role, and inventing one would leave the list empty on
   the first evening. */
till.get("/:code/till/waiters", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ id: string; name: string }>(
      `select s.id::text, s.full_name as name
         from staff s
         join staff_hotels sh on sh.staff_id = s.id
        where sh.hotel_id = $1 and s.is_active
        order by s.full_name`,
      [hotelId],
    );
    return { waiters: rows };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Settling ─────────────────────────────────────────────────────── */

till.post("/:code/till/orders/:id/settle", async (c) => {
  type Tender = {
    method?: string; amount?: number; tendered?: number; reference?: string;
  };
  type SettleBody = {
    method?: string; room?: string; folioId?: string; tenders?: Tender[];
  };
  const input = await c.req.json<SettleBody>().catch(() => ({}) as SettleBody);

  const METHODS = ["room", "cash", "card", "upi"];

  /* Two shapes reach here. `method` alone is the ordinary bill: one way,
     the whole amount. `tenders` is the Part button — several payments that
     must add up. Both end as rows in pos_order_tenders, so the drawer
     reconciles the same way regardless of which was used. */
  const raw = Array.isArray(input.tenders) ? input.tenders : null;
  let tenders: {
    method: string; amount: number;
    tendered: number | null; reference: string | null;
  }[] | null = null;

  if (raw) {
    if (raw.length === 0) {
      return c.json(refuse("Add at least one payment."), 409);
    }
    for (const t of raw) {
      if (!t.method || !METHODS.includes(t.method)) {
        return c.json(refuse("Each payment is room, cash, card or upi."), 409);
      }
      if (!Number.isFinite(Number(t.amount)) || Number(t.amount) <= 0) {
        return c.json(refuse("Every payment needs an amount above zero."), 409);
      }
      if (t.tendered !== undefined && t.method !== "cash") {
        return c.json(
          refuse("Only cash is tendered — a card pays its own amount."), 409);
      }
      if (t.tendered !== undefined && Number(t.tendered) < Number(t.amount)) {
        return c.json(
          refuse("The cash handed over is less than the amount being taken."),
          409);
      }
    }
    tenders = raw.map((t) => ({
      method: t.method!,
      amount: Number(t.amount),
      tendered: t.tendered === undefined ? null : Number(t.tendered),
      reference: t.reference?.trim() || null,
    }));

    /* A room charge reaches the folio as one posting per tax rate. Paying
       PART of a bill to a room would mean apportioning that part across
       rates again, and there is no defensible way to choose which rate a
       partial payment settles. Refused with a reason rather than guessed. */
    if (tenders.some((t) => t.method === "room") && tenders.length > 1) {
      return c.json(refuse(
        "A bill going to a room has to go there in full. Split it between " +
        "cash, card and UPI, or charge the whole bill to the room."), 409);
    }
  }

  const method = tenders
    ? (tenders.length === 1 ? tenders[0]!.method : "split")
    : input.method;

  if (!method || !(METHODS.includes(method) || method === "split")) {
    return c.json(refuse("How was this paid — room, cash, card or upi?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{
      status: string; order_no: string; outlet_id: string;
      business_date: string; outlet_name: string; category: string;
      order_type: string; customer_phone: string | null;
    }>(
      `select o.status, o.order_no, o.outlet_id::text,
              to_char(o.business_date,'YYYY-MM-DD') as business_date,
              ou.name as outlet_name, ou.category,
              o.order_type, o.customer_phone
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
        where o.id = $1 and o.hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is already ${order[0].status}.`);
    }

    /* YOU CANNOT DELIVER TO NOBODY, and the database says so at
       settlement. Reached here first so the biller gets a sentence they
       can act on instead of a 500 — the constraint is the guarantee, and
       this is the reason.

       Caught by its own test, which expected a refusal and got an
       internal error. */
    if (order[0].order_type === "delivery" && !order[0].customer_phone) {
      return refuse(
        "This is a delivery with no phone number. It will be cooked and " +
        "then it cannot leave the building — take a number first.");
    }

    const { rows: t } = await client.query<{
      net: string; discount: string; tax: string;
      gross: string; payable: string;
    }>(`select net::text, discount::text, tax::text, gross::text,
               payable::text from app.pos_order_total($1)`,
      [orderId]);

    const net = Number(t[0]!.net);
    const payable = Number(t[0]!.payable);

    /* An empty bill is not a sale. Settling one would put a zero-value
       ticket on a folio and a zero row in the shift count, which is
       noise somebody has to explain later. */
    if (net <= 0) {
      return refuse(
        "There is nothing on this order. Add an item, or abandon it.",
      );
    }

    /* The tenders must equal the bill exactly. Short is a drawer that will
       not reconcile at day end; over is change that was never given. */
    if (tenders) {
      const taken = tenders.reduce((a, t) => a + t.amount, 0);
      if (Math.abs(taken - payable) > 0.005) {
        return refuse(
          `The payments come to ₹${taken.toFixed(2)} and the bill is ` +
          `₹${payable.toFixed(2)}.`,
        );
      }
    }

    /* Everything comped. There is no payment to record, and a tender row
       must carry a positive amount, so the bill settles with none. */
    const rows = payable <= 0
      ? []
      : tenders ?? [{
          method: method === "split" ? "cash" : method,
          amount: payable, tendered: null, reference: null,
        }];

    const writeTenders = async () => {
      for (const t of rows) {
        await client.query(
          `insert into pos_order_tenders
             (order_id, hotel_id, method, amount, tendered, reference, taken_by)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [orderId, hotelId, t.method, t.amount.toFixed(2),
           t.tendered === null ? null : t.tendered.toFixed(2),
           t.reference, session.staffId],
        );
      }
    };

    /* ── Cash, card, upi: nothing touches a folio ────────────────── */
    if (method !== "room") {
      await client.query(
        `update pos_orders
            set status='settled', settled_by=$1, settled_at=now(),
                payment_method=$2
          where id = $3`,
        [session.staffId, method, orderId],
      );
      await writeTenders();
      return { ok: true as const, ...(await readOrder(client, orderId))! };
    }

    /* ── To a room: through the bridge, not around it ────────────── */
    const room = input.room?.trim();
    if (!room) return refuse("Which room is this bill for?");

    const { rows: chargeable } = await client.query<{
      folio_id: string; guest_name: string;
    }>(
      `select folio_id::text, guest_name from app.pos_chargeable_rooms($1)
        where room_number = $2`,
      [hotelId, room],
    );

    /* ONE ROOM, TWO GUESTS. A same-day changeover leaves both folios
       open. The bridge refuses and names both rather than charging
       whoever the database returned first; the till must do the same,
       and here it can actually ask the person standing at it. */
    const candidates = input.folioId
      ? chargeable.filter((r) => r.folio_id === input.folioId)
      : chargeable;

    if (candidates.length > 1) {
      return {
        ok: false as const,
        reason:
          `Room ${room} has ${candidates.length} open folios — a changeover ` +
          `day. Choose the guest who ate.`,
        choices: candidates.map((r) => ({
          folioId: r.folio_id, guest: r.guest_name,
        })),
      };
    }

    const target = candidates[0];
    if (!target) {
      return refuse(
        `Room ${room} cannot be charged: nobody is checked in there, or the ` +
          `folio is closed. Take payment another way.`,
      );
    }

    const businessDate = await businessDateFor(client, hotelId);

    /* ── ONE POSTING PER TAX RATE ─────────────────────────────────
       The ledger refuses anything else. `fp_tax_consistent` (015)
       requires tax_amount = round(amount * tax_rate / 100, 2) within
       a paisa, and a folio posting carries ONE rate — so a bill of
       5% food and 18% water cannot be a single row. A blended rate
       does not rescue it: 680 at an effective 5.76% computes to
       39.17 against an actual 39.20, which is three paise outside
       the tolerance.

       That constraint is right and GST agrees with it. Two rates are
       two taxable supplies, and the Sales Register reports them
       separately. The first version of this posted one row with
       tax_rate 0 and the tax in tax_amount; the database rejected it
       immediately, which is the constraint doing its job. */
    /* app.pos_order_by_rate, NOT a second copy of the arithmetic here.
       This query used to compute the split itself from the lines, which was
       correct until discounts existed and silently wrong afterwards: the
       guest holds a discounted bill and the folio receives the full amount.
       Nobody notices at the till, because the till's own total is right.

       `taxable` is the discounted net — what the folio must actually be
       charged. */
    const { rows: byRate } = await client.query<{
      tax_rate: string; net: string; tax: string;
    }>(
      `select tax_rate::text, taxable::text as net, tax::text
         from app.pos_order_by_rate($1)
        where taxable > 0
        order by tax_rate`,
      [orderId],
    );

    const split = byRate.length > 1;
    const tickets: string[] = [];

    for (const group of byRate) {
      const rate = Number(group.tax_rate);
      const groupNet = Number(group.net);
      const groupTax = Number(group.tax);

      /* The ticket id is generated before either insert so the posting
         can name the ticket in one pass. The obvious shape — post,
         then update the posting with its source — is refused by the
         ledger, which grants pms_app no UPDATE on folio_postings. */
      const ticketId = randomUUID();

      /* A guest reading their folio should be able to tell why one
         restaurant bill became two lines. */
      const description = split
        ? `${order[0].outlet_name} — ${order[0].order_no} (${rate}%)`
        : `${order[0].outlet_name} — ${order[0].order_no}`;

      const { rows: posted } = await client.query<{ id: string }>(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, source_type, source_id, posted_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'pos',$9,$10)
         returning id::text`,
        [hotelId, target.folio_id, businessDate, order[0].category,
         description, groupNet, rate, groupTax, ticketId, session.staffId],
      );

      /* The order number is the idempotency key, exactly as an outside
         POS's bill number is. A split bill suffixes the rate so both
         halves can live under `unique (outlet_id, ticket_ref)`. */
      const ticketRef = split
        ? `${order[0].order_no}/${rate}`
        : order[0].order_no;

      await client.query(
        `insert into pos_tickets (id, hotel_id, outlet_id, ticket_ref, folio_id,
                                  posting_id, business_date, amount, tax_rate,
                                  tax_amount, status)
         values ($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9,$10,'posted')`,
        [ticketId, hotelId, order[0].outlet_id, ticketRef, target.folio_id,
         posted[0]!.id, businessDate, groupNet, rate, groupTax],
      );

      tickets.push(ticketId);
    }

    await client.query(
      `update pos_orders
          set status='settled', settled_by=$1, settled_at=now(),
              payment_method='room', ticket_id=$2
        where id = $3`,
      /* The first ticket, when a bill split across rates. The order is
         the record of the whole sale; pos_tickets is the record of what
         reached the folio, and a split bill reached it twice. */
      [session.staffId, tickets[0], orderId],
    );

    /* After the ticket exists. The room-tender trigger is deferred so the
       order would not matter, but writing it in the order a person would
       read is worth more than relying on that. */
    await writeTenders();

    return {
      ok: true as const,
      guest: target.guest_name,
      room,
      ...(await readOrder(client, orderId))!,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/orders/:id/abandon", async (c) => {
  type AbandonBody = { reason?: string };
  const input = await c.req.json<AbandonBody>().catch(() => ({}) as AbandonBody);
  const reason = input.reason?.trim();

  /* A refusal says why, and so does an abandonment. An order closed
     with no explanation is the row nobody can account for at the end
     of a shift. */
  if (!reason) {
    return c.json(refuse("Why is this order being closed unpaid?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rowCount } = await client.query(
      `update pos_orders
          set status='abandoned', abandoned_reason=$1
        where id = $2 and hotel_id = $3 and status = 'open'`,
      [reason, orderId, hotelId],
    );
    if (!rowCount) return refuse("That order is not open.");

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Changing a quantity ──────────────────────────────────────────────
   Every till in the trade puts +/- on a line. Without it, "make that two
   rather than three" means striking the line and re-adding — which leaves
   a cancelled row on the kitchen copy for something the guest is still
   getting, and reads as a mistake nobody made.
   ═══════════════════════════════════════════════════════════════════ */
till.post("/:code/till/orders/:id/lines/:lineId/qty", async (c) => {
  type Body = { qty?: number };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty < 0) {
    return c.json(refuse("A quantity cannot be negative."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    if (qty === 0) {
      /* Down to nothing is a strike, not a delete. A waiter counting to
         zero means the same thing as pressing the cross, and the line
         stays visible either way — 028 keeps struck lines because a
         manager settling a dispute wants to see them. */
      const { rowCount } = await client.query(
        `update pos_order_lines
            set voided = true, voided_by = $1, voided_at = now()
          where id = $2 and order_id = $3 and not voided`,
        [session.staffId, c.req.param("lineId"), orderId],
      );
      if (!rowCount) return refuse("That line is already struck.");
    } else {
      const { rowCount } = await client.query(
        `update pos_order_lines set qty = $1
          where id = $2 and order_id = $3 and not voided`,
        [qty, c.req.param("lineId"), orderId],
      );
      if (!rowCount) return refuse("That line is struck, or is not here.");
    }

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Sending to the kitchen ───────────────────────────────────────────
   KOT and BILL are two different acts. A table orders starters, the
   kitchen starts on them, the table orders mains twenty minutes later,
   and the bill happens once at the end. Collapsing them — which this
   till did — means the kitchen hears about the food when the guest asks
   to pay.

   Only PENDING lines are sent. Firing the whole order again would put
   the starters back on the pass while they are being eaten.
   ═══════════════════════════════════════════════════════════════════ */
till.post("/:code/till/orders/:id/kot", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{
      status: string; outlet_id: string; business_date: string;
    }>(
      `select status, outlet_id::text,
              to_char(business_date,'YYYY-MM-DD') as business_date
         from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status}. Nothing to send.`);
    }

    /* THE DOCKET NUMBER GOES WITH THE BATCH, not the order. Starters,
       then mains, then the dessert somebody changed their mind about:
       three dockets, three numbers, one bill. A kitchen holding three
       pieces of paper that all say KOT-5 cannot tell the chef which is
       which.

       Taken inside the same statement that sends the lines, so two
       waiters sending at once cannot both read the same number and
       print it twice. */
    const { rows: next } = await client.query<{ no: number }>(
      `select app.pos_next_kot_no($1, $2::date) as no`,
      [order[0].outlet_id, order[0].business_date],
    );
    const kotNo = next[0]!.no;

    const { rowCount: sent } = await client.query(
      `update pos_order_lines
          set kot_status = 'sent', kot_sent_at = now(), kot_no = $2
        where order_id = $1 and not voided and kot_status = 'pending'`,
      [orderId, kotNo],
    );

    if (!sent) {
      return refuse(
        "Everything on this order is already with the kitchen. Add "
        + "something first.",
      );
    }

    return {
      ok: true as const,
      sent,
      /* Handed back so the till can print THIS docket without asking
         again — and so a waiter who wants the paper knows which number
         to expect out of the machine. */
      kotNo,
      ...(await readOrder(client, orderId))!,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── One docket, for printing ─────────────────────────────────────
   What the kitchen printer gets: the batch that went out under this
   number, dishes with their add-ons nested underneath. The pass screen
   stays and is better than paper — oldest first, colour by wait, a
   struck dish shown loudly — but most kitchens run on the docket. */

till.get("/:code/till/orders/:id/kot/:no", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");
    const kotNo = Number(c.req.param("no"));
    if (!Number.isInteger(kotNo)) return null;

    const { rows: head } = await client.query<{
      order_no: string; table_ref: string | null; order_type: string;
      outlet_name: string; hotel_name: string; sent_at: string | null;
    }>(
      `select o.order_no, o.table_ref, o.order_type,
              ou.name as outlet_name, h.name as hotel_name,
              to_char(min(l.kot_sent_at), 'DD/MM/YY HH24:MI') as sent_at
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
         join hotels h on h.id = o.hotel_id
         join pos_order_lines l on l.order_id = o.id and l.kot_no = $3
        where o.id = $1 and o.hotel_id = $2
        group by o.order_no, o.table_ref, o.order_type, ou.name, h.name`,
      [orderId, hotelId, kotNo],
    );
    if (!head[0]) return null;

    const { rows } = await client.query<{
      line_id: string; parent_id: string | null; name: string;
      qty: string; note: string | null; is_addon: boolean;
    }>(
      `select line_id::text, parent_id::text, name, qty::text, note, is_addon
         from app.pos_kot($1, $2)`,
      [orderId, kotNo],
    );

    return {
      kotNo,
      orderNo: head[0].order_no,
      table: head[0].table_ref,
      orderType: head[0].order_type,
      outlet: head[0].outlet_name,
      hotel: head[0].hotel_name,
      sentAt: head[0].sent_at,
      lines: rows.map((r) => ({
        id: r.line_id,
        parentId: r.parent_id,
        name: r.name,
        qty: Number(r.qty),
        note: r.note,
        isAddon: r.is_addon,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such docket." }, 404);
});

/* ── The pass ─────────────────────────────────────────────────────────
   Every line the kitchen holds, oldest first. Sorted by when it was
   SENT and not when it was rung up: a dish added to an old order still
   goes to the back of the queue, because that is when the kitchen
   learned about it.
   ═══════════════════════════════════════════════════════════════════ */
till.get("/:code/kitchen", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; order_no: string; table_ref: string | null;
      order_type: string; outlet: string; name: string; qty: string;
      note: string | null; kot_status: string; waited: string;
      voided: boolean; was_sent_when_voided: boolean;
    }>(
      `select l.id::text, o.order_no, o.table_ref, o.order_type,
              ou.code as outlet, l.name, l.qty::text, l.note,
              l.kot_status,
              extract(epoch from (now() - l.kot_sent_at))::int::text as waited,
              l.voided, l.was_sent_when_voided
         from pos_order_lines l
         join pos_orders o  on o.id = l.order_id
         join pos_outlets ou on ou.id = o.outlet_id
        where l.hotel_id = $1
          and l.kot_status in ('sent', 'preparing', 'ready')
          and o.status = 'open'
        order by l.kot_sent_at`,
      [hotelId],
    );

    return {
      lines: rows.map((r) => ({
        id: r.id,
        orderNo: r.order_no,
        table: r.table_ref,
        orderType: r.order_type,
        outlet: r.outlet,
        name: r.name,
        qty: Number(r.qty),
        note: r.note,
        status: r.kot_status,
        /* Seconds since it reached the kitchen. The pass sorts and
           colours by this — a dish waiting eleven minutes is the only
           thing on that screen that matters. */
        waitedSeconds: Number(r.waited),
        /* A struck line the kitchen already had. Shown so the pass can
           stop cooking it, rather than having the ticket vanish. */
        cancelled: r.voided && r.was_sent_when_voided,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

till.post("/:code/kitchen/lines/:lineId/:to", async (c) => {
  const to = c.req.param("to");
  if (!["preparing", "ready", "served"].includes(to)) {
    return c.json(refuse("A dish moves to preparing, ready or served."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rowCount } = await client.query(
      `update pos_order_lines set kot_status = $1
        where id = $2 and hotel_id = $3 and not voided
          and kot_status <> 'pending'`,
      [to, c.req.param("lineId"), hotelId],
    );
    if (!rowCount) {
      return refuse("That dish is not with the kitchen, or was cancelled.");
    }
    return { ok: true as const, status: to };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
