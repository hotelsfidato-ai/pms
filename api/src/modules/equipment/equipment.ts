import { Hono, type Context } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { roleAt, mayDo, refusedFor, type EquipmentAction } from "./grants.ts";

/* ══════════════════════════════════════════════════════════════════
   THE EQUIPMENT REGISTER

   Everything durable in the hotel, the restaurant and the rooms — an
   AC, a TV, a fridge, a kettle, a table. Phase 1B of
   docs/STOCK-AND-EQUIPMENT-PLAN.md; the owner's answers of 16 September
   are in src/modules/equipment/MODULE.md.

   WHO FIRST. Every route asks `grants.ts` before it reads or writes,
   because inside withSession a refusal after a write is a commit
   (root MEMORY 243) — and every other refusal also sits above the
   first write, for the same reason.

   THE HISTORY IS THE DATABASE'S. A move, a status, a retirement, a
   split and an edit are recorded by the triggers on equipment_items
   (the migration "the equipment register"). A route says WHY through
   the transaction-local `app.equipment_note`, and cannot forget WHAT.

   NOTHING INVENTED. A cost nobody typed goes in as NULL and comes back
   as null — the screen prints a dash. A warranty nobody entered is
   null, never "expired". Nothing here fills a blank with a default.
   ══════════════════════════════════════════════════════════════════ */

export const equipment = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
type Refusal = ReturnType<typeof refuse>;

/* A refusal of WHO, carried out of withSession so the route can answer
   403 rather than 409: nothing about the request is wrong except who
   sent it. */
const FORBIDDEN = Symbol("forbidden");
type Forbidden = { [FORBIDDEN]: EquipmentAction };
const forbidden = (action: EquipmentAction): Forbidden => ({ [FORBIDDEN]: action });
const isForbidden = (v: unknown): v is Forbidden =>
  typeof v === "object" && v !== null && FORBIDDEN in v;

const STATUSES = ["in_use", "under_repair", "retired"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_WORD: Record<Status, string> = {
  in_use: "in use",
  under_repair: "under repair",
  retired: "retired",
};

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/** Hotel, then role. Null for no such property (404); Forbidden for a
    role without the grant (403). */
async function open(
  client: Client, code: string, action: EquipmentAction,
): Promise<{ hotelId: string; role: string } | null | Forbidden> {
  const hotelId = await hotelFor(client, code);
  if (!hotelId) return null;
  const role = await roleAt(client, hotelId);
  if (!mayDo(role, action)) return forbidden(action);
  return { hotelId, role: role! };
}

/** Send what withSession returned, with the right status. */
function answer(c: Context, result: unknown): Response {
  if (result === null) return c.json({ error: "No such property." }, 404);
  if (isForbidden(result)) return c.json(refuse(refusedFor(result[FORBIDDEN])), 403);
  const r = result as { ok?: boolean };
  return c.json(r, r.ok === false ? 409 : 200);
}

/** Why, for the history. Transaction-local: gone at commit. */
const note = (client: Client, text: string | null | undefined) =>
  client.query("select set_config('app.equipment_note', $1, true)", [text?.trim() ?? ""]);

/* ── Reading a value somebody typed ───────────────────────────────── */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/* Day first, as a date is written in India — 14/03/2025, 14-03-2025,
   14.03.2025. A month-first file would read 03/14 as the 3rd of month
   14 and be refused, which is the right failure: said, not guessed. */
const DAY_FIRST = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** A real calendar date as YYYY-MM-DD, or null if it is not one. */
export function readDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = ISO.exec(s);
  const dmy = DAY_FIRST.exec(s);
  if (iso) { y = +iso[1]!; m = +iso[2]!; d = +iso[3]!; }
  else if (dmy) { d = +dmy[1]!; m = +dmy[2]!; y = +dmy[3]!; }
  else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  if (y < 1950 || y > 2100) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A cost in rupees: a number of zero or more, or null for "not typed".
    Returns undefined when what was typed is not a cost at all. */
export function readCost(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[₹,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n < 10_000_000_000 ? n : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/* ── The list, and one item ───────────────────────────────────────── */

interface ItemRow {
  id: string; name: string; category_id: string | null; category: string | null;
  held_as: "tagged" | "counted"; tag: string | null; quantity: number;
  room_id: string | null; room_number: string | null;
  location_id: string | null; location_name: string | null; location_kind: string | null;
  supplier_id: string | null; supplier: string | null;
  purchase_date: string | null; unit_cost: string | null;
  warranty_ends: string | null; amc_ends: string | null;
  status: Status;
  retire_reason: string | null;
  requested_by: string | null; retire_requested_at: string | null;
  retired_by: string | null; retired_at: string | null;
  split_from: string | null; created_at: string;
}

const ITEM_SELECT = `
  select i.id::text, i.name, i.category_id::text, c.name as category,
         i.held_as, i.tag, i.quantity,
         i.room_id::text, r.number as room_number,
         i.location_id::text, l.name as location_name, l.kind as location_kind,
         i.supplier_id::text, s.name as supplier,
         to_char(i.purchase_date, 'YYYY-MM-DD') as purchase_date,
         i.unit_cost::text,
         to_char(i.warranty_ends, 'YYYY-MM-DD') as warranty_ends,
         to_char(i.amc_ends, 'YYYY-MM-DD') as amc_ends,
         i.status, i.retire_reason,
         rq.full_name as requested_by, i.retire_requested_at::text,
         rt.full_name as retired_by, i.retired_at::text,
         i.split_from::text, i.created_at::text
    from equipment_items i
    left join equipment_categories c on c.id = i.category_id
    left join rooms r      on r.id = i.room_id
    left join locations l  on l.id = i.location_id
    left join suppliers s  on s.id = i.supplier_id
    left join staff rq     on rq.id = i.retire_requested_by
    left join staff rt     on rt.id = i.retired_by`;

function shape(r: ItemRow) {
  const unitCost = r.unit_cost === null ? null : Number(r.unit_cost);
  return {
    id: r.id,
    name: r.name,
    categoryId: r.category_id,
    category: r.category,
    heldAs: r.held_as,
    tag: r.tag,
    quantity: r.quantity,
    roomId: r.room_id,
    locationId: r.location_id,
    /* One label for where it is, so the list, the item page and the
       export all say it the same way. */
    place: r.room_id
      ? `Room ${r.room_number}`
      : (r.location_name ?? "—"),
    supplierId: r.supplier_id,
    supplier: r.supplier,
    purchaseDate: r.purchase_date,
    /* NULL, never 0. Nobody typed it. */
    unitCost,
    totalCost: unitCost === null ? null : Math.round(unitCost * r.quantity * 100) / 100,
    warrantyEnds: r.warranty_ends,
    amcEnds: r.amc_ends,
    status: r.status,
    retireRequest: r.retire_requested_at && r.status !== "retired"
      ? { by: r.requested_by, at: r.retire_requested_at, reason: r.retire_reason }
      : null,
    retired: r.retired_at
      ? { by: r.retired_by, at: r.retired_at, reason: r.retire_reason,
          requestedBy: r.requested_by }
      : null,
    splitFrom: r.split_from,
    createdAt: r.created_at,
  };
}

equipment.get("/:code/equipment", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const o = await open(client, c.req.param("code"), "view");
    if (o === null || isForbidden(o)) return o;

    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT}
        where i.hotel_id = $1
        order by (i.status = 'retired'), c.name nulls last, i.name,
                 r.number nulls last, l.name nulls last`,
      [o.hotelId],
    );
    return { ok: true as const, items: rows.map(shape) };
  });
  return answer(c, result);
});

/* What the add, move and filter controls offer. Places and suppliers are
   READ here and never created: the master builds one shared door for
   both (the owner's answer, 16 September). Until it lands, a property
   may have none, and the screen says so. */
equipment.get("/:code/equipment/options", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const o = await open(client, c.req.param("code"), "view");
    if (o === null || isForbidden(o)) return o;

    const [rooms, places, suppliers, categories, tag] = await Promise.all([
      client.query<{ id: string; number: string }>(
        `select id::text, number from rooms
          where hotel_id = $1 and is_active
          order by length(number), number`, [o.hotelId]),
      client.query<{ id: string; name: string; kind: string }>(
        `select id::text, name, kind from locations
          where hotel_id = $1 and is_active order by name`, [o.hotelId]),
      client.query<{ id: string; name: string }>(
        `select id::text, name from suppliers
          where hotel_id = $1 and is_active order by name`, [o.hotelId]),
      client.query<{ id: string; name: string }>(
        `select id::text, name from equipment_categories
          where hotel_id = $1 order by lower(name)`, [o.hotelId]),
      client.query<{ tag: string }>(
        "select app.next_equipment_tag($1) as tag", [o.hotelId]),
    ]);

    return {
      ok: true as const,
      rooms: rooms.rows,
      places: places.rows,
      suppliers: suppliers.rows,
      categories: categories.rows,
      nextTag: tag.rows[0]!.tag,
    };
  });
  return answer(c, result);
});

equipment.get("/:code/equipment/items/:id", async (c) => {
  const id = c.req.param("id");
  const result = await withSession(c.get("subject"), async (client) => {
    const o = await open(client, c.req.param("code"), "view");
    if (o === null || isForbidden(o)) return o;
    if (!isId(id)) return refuse("No such item here.");

    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT} where i.hotel_id = $1 and i.id = $2`, [o.hotelId, id]);
    if (!rows[0]) return refuse("No such item here.");

    const { rows: hist } = await client.query<{
      id: string; kind: string; quantity: number;
      from_place: string | null; to_place: string | null;
      from_status: Status | null; to_status: Status | null;
      related_id: string | null; related_name: string | null;
      related_place: string | null;
      changes: Record<string, { from: unknown; to: unknown }> | null;
      note: string | null; who: string | null; at: string;
    }>(
      `select h.id::text, h.kind, h.quantity,
              coalesce('Room ' || fr.number, fl.name) as from_place,
              coalesce('Room ' || tr.number, tl.name) as to_place,
              h.from_status, h.to_status,
              h.related_item_id::text as related_id,
              ri.name as related_name,
              coalesce('Room ' || rr.number, rl.name) as related_place,
              h.changes, h.note, s.full_name as who, h.done_at::text as at
         from equipment_history h
         left join rooms fr     on fr.id = h.from_room_id
         left join locations fl on fl.id = h.from_location_id
         left join rooms tr     on tr.id = h.to_room_id
         left join locations tl on tl.id = h.to_location_id
         left join equipment_items ri on ri.id = h.related_item_id
         left join rooms rr     on rr.id = ri.room_id
         left join locations rl on rl.id = ri.location_id
         left join staff s      on s.id = h.done_by
        where h.hotel_id = $1 and h.item_id = $2
        order by h.id desc`,
      [o.hotelId, id],
    );

    return {
      ok: true as const,
      item: shape(rows[0]),
      history: hist.map((h) => ({
        id: h.id,
        kind: h.kind,
        quantity: h.quantity,
        from: h.from_place,
        to: h.to_place,
        fromStatus: h.from_status,
        toStatus: h.to_status,
        related: h.related_id
          ? { id: h.related_id, name: h.related_name, place: h.related_place }
          : null,
        changes: h.changes,
        note: h.note,
        who: h.who,
        at: h.at,
      })),
    };
  });
  return answer(c, result);
});

/* ── Adding one ───────────────────────────────────────────────────── */

interface Details {
  name?: string;
  category?: string | null;
  heldAs?: string;
  tag?: string | null;
  quantity?: number | string | null;
  roomId?: string | null;
  locationId?: string | null;
  supplierId?: string | null;
  purchaseDate?: string | null;
  unitCost?: number | string | null;
  warrantyEnds?: string | null;
  amcEnds?: string | null;
  status?: string;
  note?: string;
}

/** A date field: undefined when absent, null when cleared, a string when
    valid, a Refusal when typed but not a date. */
function dateField(raw: string | null | undefined, what: string): string | null | undefined | Refusal {
  if (raw === undefined) return undefined;
  if (raw === null || String(raw).trim() === "") return null;
  return readDate(String(raw)) ?? refuse(`"${raw}" is not a date for ${what}. Write it as 14/03/2025.`);
}

const isRefusal = (v: unknown): v is Refusal =>
  typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false;

/** Checks that a room or place is at this property and in use. */
async function placeRefusal(
  client: Client, hotelId: string,
  roomId: string | null | undefined, locationId: string | null | undefined,
): Promise<Refusal | null> {
  const hasRoom = roomId !== null && roomId !== undefined && roomId !== "";
  const hasPlace = locationId !== null && locationId !== undefined && locationId !== "";
  if (hasRoom === hasPlace) {
    return refuse("Where is it? Choose a room or a place — one of the two.");
  }
  if (hasRoom) {
    if (!isId(roomId)) return refuse("No such room at this property.");
    const { rows } = await client.query<{ is_active: boolean }>(
      "select is_active from rooms where id = $1 and hotel_id = $2", [roomId, hotelId]);
    if (!rows[0]) return refuse("No such room at this property.");
    if (!rows[0].is_active) return refuse("That room is switched off.");
  } else {
    if (!isId(locationId)) return refuse("No such place at this property.");
    const { rows } = await client.query<{ is_active: boolean }>(
      "select is_active from locations where id = $1 and hotel_id = $2", [locationId, hotelId]);
    if (!rows[0]) return refuse("No such place at this property.");
    if (!rows[0].is_active) return refuse("That place is switched off.");
  }
  return null;
}

/** The category row for a typed name — found in any capitals, or made.
    Only called once every refusal has been passed (MEMORY 243). */
async function categoryFor(
  client: Client, hotelId: string, staffId: string, name: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id::text from equipment_categories
      where hotel_id = $1 and lower(btrim(name)) = lower(btrim($2))`, [hotelId, name]);
  if (rows[0]) return rows[0].id;
  /* DO NOTHING, never DO UPDATE: an upsert needs UPDATE on the table, and
     the application holds none on categories — so "do update set name =
     name" was refused with "permission denied" on every new category
     (EQ-1, found by this service's own tests). If somebody else made the
     same category a moment ago, nothing comes back and it is read again. */
  const made = await client.query<{ id: string }>(
    `insert into equipment_categories (hotel_id, name, created_by)
     values ($1, btrim($2), $3)
     on conflict (hotel_id, lower(btrim(name))) do nothing
     returning id::text`, [hotelId, name, staffId]);
  if (made.rows[0]) return made.rows[0].id;
  const again = await client.query<{ id: string }>(
    `select id::text from equipment_categories
      where hotel_id = $1 and lower(btrim(name)) = lower(btrim($2))`, [hotelId, name]);
  return again.rows[0]!.id;
}

async function tagTaken(
  client: Client, hotelId: string, tag: string, exceptId?: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from equipment_items
      where hotel_id = $1 and upper(btrim(tag)) = upper(btrim($2))
        and ($3::uuid is null or id <> $3::uuid)`,
    [hotelId, tag, exceptId ?? null]);
  return rows.length > 0;
}

const NAME_MAX = 200;

equipment.post("/:code/equipment", async (c) => {
  const input = await c.req.json<Details>().catch(() => ({}) as Details);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "create");
    if (o === null || isForbidden(o)) return o;

    /* ---- every refusal, before the first write ---- */
    const name = input.name?.trim() ?? "";
    if (!name) return refuse("What is it called?");
    if (name.length > NAME_MAX) return refuse("That name is too long — keep it under 200 letters.");

    if (input.heldAs !== "tagged" && input.heldAs !== "counted") {
      return refuse("Is it one thing with a tag, or a count of things in one place?");
    }
    const tagged = input.heldAs === "tagged";

    const tag = input.tag?.trim() ?? "";
    let quantity = 1;
    if (tagged) {
      if (!tag) return refuse("A tagged item needs its tag. The form offers the next free number.");
      if (tag.length > 40) return refuse("A tag is a short label — forty letters at most.");
      if (await tagTaken(client, o.hotelId, tag)) {
        const { rows } = await client.query<{ tag: string }>(
          "select app.next_equipment_tag($1) as tag", [o.hotelId]);
        return refuse(`${tag} is already on another item here. The next free number is ${rows[0]!.tag}.`);
      }
    } else {
      if (tag) return refuse("A count of things carries no tag — a tag names one thing.");
      const q = Number(input.quantity);
      if (!Number.isInteger(q) || q < 1) return refuse("How many? A whole number, one or more.");
      if (q > 100_000) return refuse("That is more than a hundred thousand of one thing in one place.");
      quantity = q;
    }

    const where = await placeRefusal(client, o.hotelId, input.roomId, input.locationId);
    if (where) return where;

    if (input.supplierId) {
      if (!isId(input.supplierId)) return refuse("No such supplier at this property.");
      const { rows } = await client.query(
        "select 1 from suppliers where id = $1 and hotel_id = $2", [input.supplierId, o.hotelId]);
      if (!rows[0]) return refuse("No such supplier at this property.");
    }

    const cost = readCost(input.unitCost);
    if (cost === undefined) {
      return refuse("A cost is rupees — a number, zero or more. Leave it blank if nobody knows it.");
    }

    const bought = dateField(input.purchaseDate, "when it was bought");
    const warranty = dateField(input.warrantyEnds, "when the warranty ends");
    const amc = dateField(input.amcEnds, "when the service contract ends");
    for (const d of [bought, warranty, amc]) if (isRefusal(d)) return d;
    const today = await businessDateFor(client, o.hotelId);
    if (typeof bought === "string" && bought > today) {
      return refuse("It cannot have been bought after today.");
    }
    if (typeof bought === "string" && typeof warranty === "string" && warranty < bought) {
      return refuse("The warranty cannot end before it was bought.");
    }
    if (typeof bought === "string" && typeof amc === "string" && amc < bought) {
      return refuse("The service contract cannot end before it was bought.");
    }

    const status = input.status ?? "in_use";
    if (status !== "in_use" && status !== "under_repair") {
      return refuse("A new item is in use or under repair. Retiring is something that happens to it later.");
    }

    /* ---- writes ---- */
    const categoryId = input.category?.trim()
      ? await categoryFor(client, o.hotelId, session.staffId, input.category)
      : null;

    await note(client, input.note);
    const { rows } = await client.query<{ id: string }>(
      `insert into equipment_items
         (hotel_id, name, category_id, held_as, tag, quantity, room_id, location_id,
          supplier_id, purchase_date, unit_cost, warranty_ends, amc_ends, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12::date,$13::date,$14,$15)
       returning id::text`,
      [o.hotelId, name, categoryId, input.heldAs, tagged ? tag : null, quantity,
       input.roomId || null, input.locationId || null, input.supplierId || null,
       bought ?? null, cost, warranty ?? null, amc ?? null, status, session.staffId],
    );
    return { ok: true as const, id: rows[0]!.id };
  });
  return answer(c, result);
});

/* ── Changing the details ─────────────────────────────────────────── */

async function loadItem(client: Client, hotelId: string, id: string) {
  if (!isId(id)) return null;
  const { rows } = await client.query<{
    id: string; name: string; held_as: "tagged" | "counted"; tag: string | null;
    quantity: number; status: Status; room_id: string | null; location_id: string | null;
    purchase_date: string | null; warranty_ends: string | null; amc_ends: string | null;
    retire_requested_at: string | null;
  }>(
    `select id::text, name, held_as, tag, quantity, status,
            room_id::text, location_id::text,
            to_char(purchase_date, 'YYYY-MM-DD') as purchase_date,
            to_char(warranty_ends, 'YYYY-MM-DD') as warranty_ends,
            to_char(amc_ends, 'YYYY-MM-DD') as amc_ends,
            retire_requested_at::text
       from equipment_items where hotel_id = $1 and id = $2
        for update`,
    [hotelId, id],
  );
  return rows[0] ?? null;
}

equipment.patch("/:code/equipment/items/:id", async (c) => {
  const input = await c.req.json<Details>().catch(() => ({}) as Details);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "edit");
    if (o === null || isForbidden(o)) return o;

    const item = await loadItem(client, o.hotelId, c.req.param("id"));
    if (!item) return refuse("No such item here.");
    if (item.status === "retired") {
      return refuse("A retired item is kept exactly as it was retired.");
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };

    if (input.name !== undefined) {
      const name = input.name?.trim() ?? "";
      if (!name) return refuse("What is it called?");
      if (name.length > NAME_MAX) return refuse("That name is too long — keep it under 200 letters.");
      set("name", name);
    }

    if (input.tag !== undefined) {
      const tag = input.tag?.trim() ?? "";
      if (item.held_as === "counted") {
        if (tag) return refuse("A count of things carries no tag — a tag names one thing.");
      } else {
        if (!tag) return refuse("A tagged item keeps a tag.");
        if (tag.length > 40) return refuse("A tag is a short label — forty letters at most.");
        if (await tagTaken(client, o.hotelId, tag, item.id)) {
          return refuse(`${tag} is already on another item here.`);
        }
        set("tag", tag);
      }
    }

    if (input.supplierId !== undefined) {
      if (input.supplierId) {
        if (!isId(input.supplierId)) return refuse("No such supplier at this property.");
        const { rows } = await client.query(
          "select 1 from suppliers where id = $1 and hotel_id = $2", [input.supplierId, o.hotelId]);
        if (!rows[0]) return refuse("No such supplier at this property.");
      }
      set("supplier_id", input.supplierId || null);
    }

    if (input.unitCost !== undefined) {
      const cost = readCost(input.unitCost);
      if (cost === undefined) {
        return refuse("A cost is rupees — a number, zero or more. Leave it blank if nobody knows it.");
      }
      set("unit_cost", cost);
    }

    const bought = dateField(input.purchaseDate, "when it was bought");
    const warranty = dateField(input.warrantyEnds, "when the warranty ends");
    const amc = dateField(input.amcEnds, "when the service contract ends");
    for (const d of [bought, warranty, amc]) if (isRefusal(d)) return d;
    const b = bought === undefined ? item.purchase_date : bought;
    const w = warranty === undefined ? item.warranty_ends : warranty;
    const a = amc === undefined ? item.amc_ends : amc;
    const today = await businessDateFor(client, o.hotelId);
    if (typeof b === "string" && b > today) return refuse("It cannot have been bought after today.");
    if (typeof b === "string" && typeof w === "string" && w < b) {
      return refuse("The warranty cannot end before it was bought.");
    }
    if (typeof b === "string" && typeof a === "string" && a < b) {
      return refuse("The service contract cannot end before it was bought.");
    }
    if (bought !== undefined) set("purchase_date", bought, "::date");
    if (warranty !== undefined) set("warranty_ends", warranty, "::date");
    if (amc !== undefined) set("amc_ends", amc, "::date");

    /* Last, because it may write a new category. */
    if (input.category !== undefined) {
      set("category_id", input.category?.trim()
        ? await categoryFor(client, o.hotelId, session.staffId, input.category)
        : null);
    }

    if (sets.length === 0) return { ok: true as const, id: item.id, changed: false };

    await note(client, input.note);
    params.push(item.id, o.hotelId);
    await client.query(
      `update equipment_items set ${sets.join(", ")}
        where id = $${params.length - 1} and hotel_id = $${params.length}`,
      params,
    );
    return { ok: true as const, id: item.id, changed: true };
  });
  return answer(c, result);
});

/* ── Part of a count ──────────────────────────────────────────────── */

/**
 * Which line an action applies to. A tagged item, or all of a counted
 * line, is the line itself. PART of a counted line is first split off
 * into its own line — the database records the split on both — and the
 * action then applies to the new line, as its own recorded step.
 */
async function lineFor(
  client: Client, hotelId: string, staffId: string,
  item: NonNullable<Awaited<ReturnType<typeof loadItem>>>,
  count: unknown,
): Promise<{ id: string; quantity: number } | Refusal> {
  if (count === undefined || count === null || count === "") {
    return { id: item.id, quantity: item.quantity };
  }
  const n = Number(count);
  if (item.held_as === "tagged") {
    return n === 1 ? { id: item.id, quantity: 1 }
      : refuse("A tagged item is one thing.");
  }
  if (!Number.isInteger(n) || n < 1) return refuse("How many? A whole number, one or more.");
  if (n > item.quantity) {
    return refuse(`There ${item.quantity === 1 ? "is" : "are"} ${item.quantity} on this line.`);
  }
  if (n === item.quantity) return { id: item.id, quantity: n };

  const { rows } = await client.query<{ id: string }>(
    `insert into equipment_items
       (hotel_id, name, category_id, held_as, quantity, room_id, location_id,
        supplier_id, purchase_date, unit_cost, warranty_ends, amc_ends, status,
        split_from, created_by)
     select hotel_id, name, category_id, held_as, $3, room_id, location_id,
            supplier_id, purchase_date, unit_cost, warranty_ends, amc_ends, status,
            id, $4
       from equipment_items where id = $1 and hotel_id = $2
     returning id::text`,
    [item.id, hotelId, n, staffId],
  );
  return { id: rows[0]!.id, quantity: n };
}

/* ── Moving it ────────────────────────────────────────────────────── */

equipment.post("/:code/equipment/items/:id/move", async (c) => {
  type Body = { roomId?: string | null; locationId?: string | null; count?: number | string; note?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "edit");
    if (o === null || isForbidden(o)) return o;

    const item = await loadItem(client, o.hotelId, c.req.param("id"));
    if (!item) return refuse("No such item here.");
    if (item.status === "retired") return refuse("A retired item does not move.");
    if (item.retire_requested_at) {
      return refuse("A retirement is waiting for approval. Approve or decline it first.");
    }

    const where = await placeRefusal(client, o.hotelId, input.roomId, input.locationId);
    if (where) return where;
    if ((input.roomId || null) === item.room_id && (input.locationId || null) === item.location_id) {
      return refuse("It is already there.");
    }

    /* Checked before the split writes anything. */
    if (input.count !== undefined && input.count !== null && input.count !== "") {
      const n = Number(input.count);
      if (item.held_as === "counted" && (!Number.isInteger(n) || n < 1 || n > item.quantity)) {
        return refuse(`How many of the ${item.quantity}? A whole number, one to ${item.quantity}.`);
      }
    }

    await note(client, input.note);
    const line = await lineFor(client, o.hotelId, session.staffId, item, input.count);
    if (isRefusal(line)) return line;

    await client.query(
      `update equipment_items set room_id = $1, location_id = $2
        where id = $3 and hotel_id = $4`,
      [input.roomId || null, input.locationId || null, line.id, o.hotelId],
    );
    return { ok: true as const, id: line.id, quantity: line.quantity, split: line.id !== item.id };
  });
  return answer(c, result);
});

/* ── In use, or under repair ──────────────────────────────────────── */

/* By hand until phase 2B, when a work order against the item sets it
   (housekeeping, `work_orders`). */
equipment.post("/:code/equipment/items/:id/status", async (c) => {
  type Body = { status?: string; count?: number | string; note?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "edit");
    if (o === null || isForbidden(o)) return o;

    if (input.status !== "in_use" && input.status !== "under_repair") {
      return refuse(input.status === "retired"
        ? "Retiring has its own step, with a reason."
        : "In use, or under repair?");
    }
    const item = await loadItem(client, o.hotelId, c.req.param("id"));
    if (!item) return refuse("No such item here.");
    if (item.status === "retired") return refuse("A retired item is kept exactly as it was retired.");
    if (item.retire_requested_at) {
      return refuse("A retirement is waiting for approval. Approve or decline it first.");
    }
    if (item.status === input.status) {
      return refuse(`It is already ${STATUS_WORD[item.status]}.`);
    }
    if (input.count !== undefined && input.count !== null && input.count !== "") {
      const n = Number(input.count);
      if (item.held_as === "counted" && (!Number.isInteger(n) || n < 1 || n > item.quantity)) {
        return refuse(`How many of the ${item.quantity}? A whole number, one to ${item.quantity}.`);
      }
    }

    await note(client, input.note);
    const line = await lineFor(client, o.hotelId, session.staffId, item, input.count);
    if (isRefusal(line)) return line;

    await client.query(
      "update equipment_items set status = $1 where id = $2 and hotel_id = $3",
      [input.status, line.id, o.hotelId],
    );
    return { ok: true as const, id: line.id, quantity: line.quantity, split: line.id !== item.id };
  });
  return answer(c, result);
});

/* ── Retiring it ──────────────────────────────────────────────────── */

/* The owner's answer, 16 September: a TAGGED item retired by somebody
   without `approve` — the Hotel Manager — waits for the GM, owner or
   admin, because retiring is how a missing TV would be hidden. A
   counted line, and anything an approver retires, goes straight
   through. Who, when and why are recorded either way. */
equipment.post("/:code/equipment/items/:id/retire", async (c) => {
  type Body = { reason?: string; count?: number | string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "edit");
    if (o === null || isForbidden(o)) return o;

    const reason = input.reason?.trim() ?? "";
    if (!reason) return refuse("Why is it being retired? Broken beyond repair, lost, sold, given away.");
    if (reason.length > 500) return refuse("Keep the reason under 500 letters.");

    const item = await loadItem(client, o.hotelId, c.req.param("id"));
    if (!item) return refuse("No such item here.");
    if (item.status === "retired") return refuse("It is already retired.");

    const approver = mayDo(o.role, "approve");

    if (item.held_as === "tagged" && !approver) {
      if (item.retire_requested_at) {
        return refuse("A retirement is already waiting for the general manager.");
      }
      await client.query(
        `update equipment_items
            set retire_requested_at = now(), retire_requested_by = $1, retire_reason = $2
          where id = $3 and hotel_id = $4`,
        [session.staffId, reason, item.id, o.hotelId],
      );
      return { ok: true as const, id: item.id, requested: true };
    }

    if (input.count !== undefined && input.count !== null && input.count !== "") {
      const n = Number(input.count);
      if (item.held_as === "counted" && (!Number.isInteger(n) || n < 1 || n > item.quantity)) {
        return refuse(`How many of the ${item.quantity}? A whole number, one to ${item.quantity}.`);
      }
    }

    await note(client, reason);
    const line = await lineFor(client, o.hotelId, session.staffId, item, input.count);
    if (isRefusal(line)) return line;

    /* An approver retiring a tagged item that was waiting keeps the
       request on the row: the record then says who asked AND who agreed. */
    await client.query(
      `update equipment_items
          set status = 'retired', retired_at = now(), retired_by = $1,
              retire_reason = $2
        where id = $3 and hotel_id = $4`,
      [session.staffId, reason, line.id, o.hotelId],
    );
    return { ok: true as const, id: line.id, quantity: line.quantity, requested: false,
             split: line.id !== item.id };
  });
  return answer(c, result);
});

equipment.post("/:code/equipment/items/:id/retire/approve", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "approve");
    if (o === null || isForbidden(o)) return o;

    const item = await loadItem(client, o.hotelId, c.req.param("id"));
    if (!item) return refuse("No such item here.");
    if (item.status === "retired") return refuse("It is already retired.");
    if (!item.retire_requested_at) return refuse("Nobody has asked to retire it.");

    await client.query(
      `update equipment_items
          set status = 'retired', retired_at = now(), retired_by = $1
        where id = $2 and hotel_id = $3`,
      [session.staffId, item.id, o.hotelId],
    );
    return { ok: true as const, id: item.id };
  });
  return answer(c, result);
});

equipment.post("/:code/equipment/items/:id/retire/decline", async (c) => {
  const input = await c.req.json<{ note?: string }>().catch(() => ({}) as { note?: string });

  const result = await withSession(c.get("subject"), async (client) => {
    const o = await open(client, c.req.param("code"), "approve");
    if (o === null || isForbidden(o)) return o;

    const item = await loadItem(client, o.hotelId, c.req.param("id"));
    if (!item) return refuse("No such item here.");
    if (item.status === "retired") return refuse("It is already retired.");
    if (!item.retire_requested_at) return refuse("Nobody has asked to retire it.");

    await note(client, input.note);
    await client.query(
      `update equipment_items
          set retire_requested_at = null, retire_requested_by = null, retire_reason = null
        where id = $1 and hotel_id = $2`,
      [item.id, o.hotelId],
    );
    return { ok: true as const, id: item.id };
  });
  return answer(c, result);
});

/* ── The opening register, from a file ────────────────────────────── */

/* Same two passes as the Store's and the menu's import: a dry run that
   changes nothing and says what would happen to every row, then the
   identical payload to apply. A row that cannot be read is REJECTED
   with its line number — never repaired, and a blank cost never lands
   as zero. */
interface ImportRow {
  name?: string; category?: string; heldAs?: string; tag?: string;
  quantity?: string; room?: string; place?: string; supplier?: string;
  purchaseDate?: string; unitCost?: string; warrantyEnds?: string;
  amcEnds?: string; status?: string;
}

equipment.post("/:code/equipment/import", async (c) => {
  const input = await c.req.json<{ rows?: ImportRow[]; dryRun?: boolean }>()
    .catch(() => ({}) as { rows?: ImportRow[]; dryRun?: boolean });
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const dryRun = input.dryRun !== false;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "create");
    if (o === null || isForbidden(o)) return o;

    if (rows.length === 0) return refuse("There are no rows in that file.");
    if (rows.length > 2000) {
      return refuse(`That file has ${rows.length} rows. Two thousand is the limit.`);
    }

    const [roomQ, placeQ, supQ, tagQ, nextQ] = await Promise.all([
      client.query<{ id: string; number: string; is_active: boolean }>(
        "select id::text, number, is_active from rooms where hotel_id = $1", [o.hotelId]),
      client.query<{ id: string; name: string; is_active: boolean }>(
        "select id::text, name, is_active from locations where hotel_id = $1", [o.hotelId]),
      client.query<{ id: string; name: string }>(
        "select id::text, name from suppliers where hotel_id = $1", [o.hotelId]),
      client.query<{ tag: string }>(
        "select upper(btrim(tag)) as tag from equipment_items where hotel_id = $1 and tag is not null",
        [o.hotelId]),
      client.query<{ tag: string }>("select app.next_equipment_tag($1) as tag", [o.hotelId]),
    ]);
    const roomBy = new Map(roomQ.rows.map((r) => [r.number.trim().toUpperCase(), r]));
    const placeBy = new Map(placeQ.rows.map((p) => [p.name.trim().toLowerCase(), p]));
    const supplierBy = new Map(supQ.rows.map((s) => [s.name.trim().toLowerCase(), s]));
    const tagsUsed = new Set(tagQ.rows.map((t) => t.tag));
    const today = await businessDateFor(client, o.hotelId);

    /* The next free EQ-number, skipping any the file itself uses. */
    let nextNumber = Number(/^EQ-(\d+)$/.exec(nextQ.rows[0]!.tag)?.[1] ?? "1");
    const takeTag = () => {
      for (;;) {
        const s = String(nextNumber++);
        const t = `EQ-${s.length < 4 ? s.padStart(4, "0") : s}`;
        if (!tagsUsed.has(t)) { tagsUsed.add(t); return t; }
      }
    };

    type Good = {
      name: string; category: string | null; heldAs: "tagged" | "counted";
      tag: string | null; quantity: number; roomId: string | null; locationId: string | null;
      supplierId: string | null; purchaseDate: string | null; unitCost: number | null;
      warrantyEnds: string | null; amcEnds: string | null; status: "in_use" | "under_repair";
      blankTag: boolean;
    };
    const verdicts: { line: number; name: string; action: "create" | "update" | "rejected"; detail: string }[] = [];
    const good: Good[] = [];
    const fileTags = new Set<string>();

    /* Typed tags first, so a blank-tag row is never given a number that a
       later row in the same file types by hand. */
    for (const raw of rows) {
      const t = String(raw.tag ?? "").trim().toUpperCase();
      if (t) fileTags.add(t);
    }

    rows.forEach((raw, i) => {
      const line = i + 2;
      const text = (v: unknown) => String(v ?? "").trim();
      const name = text(raw.name);
      const reject = (detail: string) =>
        verdicts.push({ line, name: name || "(blank)", action: "rejected", detail });

      if (Object.values(raw).every((v) => text(v) === "")) return;
      if (!name) return reject("No item name.");
      if (name.length > NAME_MAX) return reject("The name is longer than 200 letters.");

      const held = text(raw.heldAs).toLowerCase();
      const heldAs = held === "tag" || held === "tagged" ? "tagged"
        : held === "count" || held === "counted" ? "counted" : null;
      if (!heldAs) return reject(`"Held as" must be tag or count, not "${text(raw.heldAs)}".`);

      let tag = text(raw.tag);
      let quantity = 1;
      let blankTag = false;
      if (heldAs === "tagged") {
        const q = text(raw.quantity);
        if (q !== "" && q !== "1") return reject("A tagged item is one thing — leave How many blank or 1.");
        if (tag) {
          if (tag.length > 40) return reject("The tag is longer than forty letters.");
          const key = tag.toUpperCase();
          if (tagsUsed.has(key)) return reject(`${tag} is already in the register, or earlier in this file.`);
          tagsUsed.add(key);
        } else {
          blankTag = true;
        }
      } else {
        if (tag) return reject("A count of things carries no tag — leave Tag blank.");
        const q = Number(text(raw.quantity));
        if (!Number.isInteger(q) || q < 1) return reject("How many? A whole number, one or more.");
        if (q > 100_000) return reject("More than a hundred thousand in one place.");
        quantity = q;
        tag = "";
      }

      const roomText = text(raw.room);
      const placeText = text(raw.place);
      if ((roomText === "") === (placeText === "")) {
        return reject("Give a Room or a Place — exactly one of the two.");
      }
      let roomId: string | null = null;
      let locationId: string | null = null;
      if (roomText) {
        const r = roomBy.get(roomText.toUpperCase());
        if (!r) return reject(`There is no room ${roomText} at this property.`);
        if (!r.is_active) return reject(`Room ${roomText} is switched off.`);
        roomId = r.id;
      } else {
        const p = placeBy.get(placeText.toLowerCase());
        if (!p) return reject(`There is no place called "${placeText}" here yet.`);
        if (!p.is_active) return reject(`"${placeText}" is switched off.`);
        locationId = p.id;
      }

      let supplierId: string | null = null;
      const supplierText = text(raw.supplier);
      if (supplierText) {
        const s = supplierBy.get(supplierText.toLowerCase());
        if (!s) return reject(`There is no supplier called "${supplierText}" here yet. Leave it blank, or add the supplier first.`);
        supplierId = s.id;
      }

      const dates: Record<string, string | null> = {};
      for (const [key, label] of [
        ["purchaseDate", "Bought on"], ["warrantyEnds", "Warranty ends"],
        ["amcEnds", "Service contract ends"],
      ] as const) {
        const v = text(raw[key]);
        if (v === "") { dates[key] = null; continue; }
        const d = readDate(v);
        if (!d) return reject(`${label}: "${v}" is not a date. Write it as 14/03/2025.`);
        dates[key] = d;
      }
      const bought = dates["purchaseDate"] ?? null;
      if (bought && bought > today) return reject("Bought on is after today.");
      if (bought && dates["warrantyEnds"] && dates["warrantyEnds"] < bought) {
        return reject("The warranty ends before it was bought.");
      }
      if (bought && dates["amcEnds"] && dates["amcEnds"] < bought) {
        return reject("The service contract ends before it was bought.");
      }

      const cost = readCost(text(raw.unitCost));
      if (cost === undefined) return reject(`Cost: "${text(raw.unitCost)}" is not rupees.`);

      const st = text(raw.status).toLowerCase().replace(/[_-]/g, " ");
      const status = st === "" || st === "in use" ? "in_use"
        : st === "under repair" ? "under_repair" : null;
      if (!status) {
        return reject(st === "retired"
          ? "A retired thing is left out of the opening register."
          : `Status must be blank, in use, or under repair — not "${text(raw.status)}".`);
      }

      good.push({
        name, category: text(raw.category) || null, heldAs, tag: tag || null, quantity,
        roomId, locationId, supplierId, purchaseDate: bought,
        unitCost: cost, warrantyEnds: dates["warrantyEnds"] ?? null,
        amcEnds: dates["amcEnds"] ?? null, status, blankTag,
      });
      verdicts.push({ line, name, action: "create", detail: "" });
    });

    /* Numbers for the blank tags, in file order, skipping every tag the
       file types by hand. */
    for (const t of fileTags) tagsUsed.add(t);
    let gi = 0;
    for (const v of verdicts) {
      if (v.action !== "create") continue;
      const g = good[gi++]!;
      if (g.blankTag) g.tag = takeTag();
      const where = g.roomId
        ? `Room ${roomQ.rows.find((r) => r.id === g.roomId)!.number}`
        : placeQ.rows.find((p) => p.id === g.locationId)!.name;
      v.detail = (g.heldAs === "tagged"
          ? `tag ${g.tag}${g.blankTag ? " (given)" : ""}`
          : `${g.quantity} counted`)
        + ` · ${where}`
        + (g.unitCost === null ? " · cost not known" : "")
        + (g.status === "under_repair" ? " · under repair" : "");
    }

    const tally = {
      creates: verdicts.filter((v) => v.action === "create").length,
      updates: 0,
      rejected: verdicts.filter((v) => v.action === "rejected").length,
    };
    verdicts.sort((a, b) => a.line - b.line);
    if (dryRun) return { ok: true as const, dryRun: true, verdicts, ...tally };

    await note(client, "Imported from a file");
    for (const g of good) {
      const categoryId = g.category
        ? await categoryFor(client, o.hotelId, session.staffId, g.category)
        : null;
      await client.query(
        `insert into equipment_items
           (hotel_id, name, category_id, held_as, tag, quantity, room_id, location_id,
            supplier_id, purchase_date, unit_cost, warranty_ends, amc_ends, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12::date,$13::date,$14,$15)`,
        [o.hotelId, g.name, categoryId, g.heldAs, g.tag, g.quantity, g.roomId, g.locationId,
         g.supplierId, g.purchaseDate, g.unitCost, g.warrantyEnds, g.amcEnds, g.status,
         session.staffId],
      );
    }
    return { ok: true as const, dryRun: false, verdicts, ...tally };
  });
  return answer(c, result);
});

/* ── The register, out ────────────────────────────────────────────── */

/* The export is a separate route, not the list read twice, because the
   grant is separate: the Viewer may SEE the register and may not take
   it away (the owner's table: Accountant see and export). The screen
   turns these rows into the CSV. */
equipment.get("/:code/equipment/export", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const o = await open(client, c.req.param("code"), "export");
    if (o === null || isForbidden(o)) return o;

    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT}
        where i.hotel_id = $1
        order by (i.status = 'retired'), c.name nulls last, i.name`,
      [o.hotelId],
    );
    return { ok: true as const, items: rows.map(shape) };
  });
  return answer(c, result);
});
