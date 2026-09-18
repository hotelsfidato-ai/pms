import { Hono, type Context } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { roleAt, mayDo, refusedFor, whoMayText, type EquipmentAction } from "./grants.ts";

/* ══════════════════════════════════════════════════════════════════
   THE EQUIPMENT REGISTER

   Everything durable in the hotel, the restaurant and the rooms — an
   AC, a TV, a fridge, a kettle, a table. Phase 1B of
   docs/STOCK-AND-EQUIPMENT-PLAN.md; the owner's answers are in
   src/modules/equipment/MODULE.md.

   WHO FIRST. Every route asks `grants.ts` before it reads or writes,
   because inside withSession a refusal after a write is a commit
   (root MEMORY 243) — and every other refusal also sits above the
   first write, for the same reason.

   APPROVALS ARE THE CORE'S. Taking a thing out of a store (S12–S15) and
   a Hotel Manager retiring a tagged item (S16) are RAISED here with
   `app.request_approval` and DECIDED in the one shared inbox
   (`api/src/routes/approvals.ts`), which records a decision and performs
   nothing. So nothing here applies a decision: where a thing is, and
   whether it is retired, are worked out by the database every time
   (`app.equipment_place`, `app.equipment_is_retired`) — a refusal leaves
   it where it was, and nothing has to be undone.

   THE HISTORY IS THE DATABASE'S. Added, split, status, retired and
   edited are recorded by triggers; moves are their own table. A route
   says WHY through the transaction-local `app.equipment_note`.

   NAMES. Whoever may approve sees who did each thing; everybody else
   sees what the staff table already shows them — for most, a dash (the
   owner's answer, 16 September; root MEMORY 283).

   NOTHING INVENTED. A cost nobody typed is null — the screen prints a
   dash. A warranty nobody entered is null, never "expired".
   ══════════════════════════════════════════════════════════════════ */

export const equipment = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
type Refusal = ReturnType<typeof refuse>;

/* A refusal of WHO, carried out of withSession so the route answers 403
   rather than 409: nothing about the request is wrong except who sent it. */
const FORBIDDEN = Symbol("forbidden");
type Forbidden = { [FORBIDDEN]: string };
const forbidden = (action: EquipmentAction): Forbidden => ({ [FORBIDDEN]: refusedFor(action) });
const forbiddenBecause = (reason: string): Forbidden => ({ [FORBIDDEN]: reason });
const isForbidden = (v: unknown): v is Forbidden =>
  typeof v === "object" && v !== null && FORBIDDEN in v;

type Status = "in_use" | "under_repair" | "retired";
type Decision = "pending" | "approved" | "rejected" | "clarify";

const STATUS_WORD: Record<Status, string> = {
  in_use: "in use",
  under_repair: "under repair",
  retired: "retired",
};

const WAITING =
  "A request for this item is waiting in the approvals inbox. It is decided there first.";

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
  if (isForbidden(result)) return c.json(refuse(result[FORBIDDEN]), 403);
  const r = result as { ok?: boolean };
  return c.json(r, r.ok === false ? 409 : 200);
}

/** Why, for the history. Transaction-local: gone at commit. */
const note = (client: Client, text: string | null | undefined) =>
  client.query("select set_config('app.equipment_note', $1, true)", [text?.trim() ?? ""]);

/**
 * A person's name as SQL, for a staff id column. `$2` is whether the caller
 * may approve: they see every name at the property (`app.colleague_name`,
 * 096); anybody else sees what the staff table shows them, which for most
 * roles is their own name only. Never an inner join (root MEMORY 283).
 */
const nameOf = (col: string, hotel = "$1") =>
  `case when $2::boolean
        then coalesce((select st.full_name from staff st where st.id = ${col}),
                      app.colleague_name(${col}, ${hotel}))
        else (select st.full_name from staff st where st.id = ${col}) end`;

/** A moment as fixed-width UTC text. The history is merged from three
    tables and sorted by it; `timestamptz::text` trims trailing zeros from
    the fraction, and two events a millisecond apart then sort wrongly. */
const iso = (col: string) =>
  `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/* ── Reading a value somebody typed ───────────────────────────────── */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/* Day first, as a date is written in India — 14/03/2025, 14-03-2025,
   14.03.2025. A month-first date is refused, not guessed. */
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
  status: Status; retire_reason: string | null; retired_at: string | null; retired_by: string | null;
  split_from: string | null; created_at: string;
  ask_move_id: string | null; ask_approval_id: string | null; ask_status: Decision | null;
  ask_note: string | null; ask_decision_note: string | null; ask_at: string | null;
  ask_by: string | null; ask_decided_at: string | null; ask_to: string | null;
  ask_after_place: boolean | null;
  ret_approval_id: string | null; ret_status: Decision | null; ret_reason: string | null;
  ret_decision_note: string | null; ret_at: string | null; ret_decided_at: string | null;
  ret_by: string | null; ret_decided_by: string | null;
}

/* $1 the property, $2 whether the caller may see names. */
const ITEM_SELECT = `
  select i.id::text, i.name, i.category_id::text, c.name as category,
         i.held_as, i.tag, i.quantity,
         pl.room_id::text, r.number as room_number,
         pl.location_id::text, l.name as location_name, l.kind as location_kind,
         i.supplier_id::text, s.name as supplier,
         to_char(i.purchase_date, 'YYYY-MM-DD') as purchase_date,
         i.unit_cost::text,
         to_char(i.warranty_ends, 'YYYY-MM-DD') as warranty_ends,
         to_char(i.amc_ends, 'YYYY-MM-DD') as amc_ends,
         i.status, i.retire_reason, i.retired_at::text,
         ${nameOf("i.retired_by", "i.hotel_id")} as retired_by,
         i.split_from::text, i.created_at::text,

         lm.id::text as ask_move_id, lm.approval_id::text as ask_approval_id,
         lm.status as ask_status, lm.note as ask_note,
         lm.decision_note as ask_decision_note, lm.requested_at::text as ask_at,
         ${nameOf("lm.requested_by", "i.hotel_id")} as ask_by,
         lm.decided_at::text as ask_decided_at,
         coalesce('Room ' || lr.number, ll.name) as ask_to,
         (lm.seq > pl.seq) as ask_after_place,

         ra.id::text as ret_approval_id, ra.status as ret_status, ra.reason as ret_reason,
         ra.decision_note as ret_decision_note, ra.requested_at::text as ret_at,
         ra.decided_at::text as ret_decided_at,
         ${nameOf("ra.requested_by", "i.hotel_id")} as ret_by,
         ${nameOf("ra.decided_by", "i.hotel_id")} as ret_decided_by
    from equipment_items i
    left join equipment_categories c on c.id = i.category_id
    left join suppliers s on s.id = i.supplier_id
    left join lateral app.equipment_place(i.id) pl on true
    left join rooms r on r.id = pl.room_id
    left join locations l on l.id = pl.location_id
    /* The latest move somebody ASKED for. */
    left join lateral (
      select m.id, m.seq, m.note, m.to_room_id, m.to_location_id,
             a.id as approval_id, a.status, a.decision_note, a.requested_at,
             a.requested_by, a.decided_at
        from equipment_moves m
        join approvals a on a.id = m.approval_id
       where m.item_id = i.id
       order by m.seq desc
       limit 1) lm on true
    left join rooms lr on lr.id = lm.to_room_id
    left join locations ll on ll.id = lm.to_location_id
    /* The latest retirement somebody ASKED for. */
    left join lateral (
      select a.id, a.status, a.reason, a.decision_note, a.requested_at, a.requested_by,
             a.decided_at, a.decided_by
        from approvals a
       where a.hotel_id = i.hotel_id and a.kind = 'equipment_retire'
         and a.subject_table = 'equipment_items' and a.subject_id = i.id
       order by a.requested_at desc
       limit 1) ra on true`;

function shape(r: ItemRow) {
  const unitCost = r.unit_cost === null ? null : Number(r.unit_cost);
  const retiredInInbox = r.ret_status === "approved";
  const retired = r.status === "retired" || retiredInInbox;
  const refused = (s: Decision | null) => s === "rejected" || s === "clarify";
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
    /* One wording for where it is, so the list, the item and the export agree. */
    place: r.room_id ? `Room ${r.room_number}` : (r.location_name ?? "-"),
    /* "room", or the place's kind. A store is where leaving needs approval. */
    placeKind: r.room_id ? "room" : (r.location_kind ?? null),
    supplierId: r.supplier_id,
    supplier: r.supplier,
    purchaseDate: r.purchase_date,
    /* NULL, never 0. Nobody typed it. */
    unitCost,
    totalCost: unitCost === null ? null : Math.round(unitCost * r.quantity * 100) / 100,
    warrantyEnds: r.warranty_ends,
    amcEnds: r.amc_ends,
    status: (retired ? "retired" : r.status) as Status,

    /* Waiting to leave the store — decided in the approvals inbox. */
    leaving: r.ask_status === "pending"
      ? { moveId: r.ask_move_id!, approvalId: r.ask_approval_id!, to: r.ask_to,
          reason: r.ask_note, by: r.ask_by, at: r.ask_at! }
      : null,
    /* Refused, or sent back, and nothing has moved it since: the reason
       shows beside it (the brief, S12). */
    leavingRefused: refused(r.ask_status) && r.ask_after_place
      ? { to: r.ask_to, note: r.ask_decision_note, at: r.ask_decided_at, sentBack: r.ask_status === "clarify" }
      : null,

    retireRequest: r.ret_status === "pending" && !retired
      ? { approvalId: r.ret_approval_id!, by: r.ret_by, at: r.ret_at!, reason: r.ret_reason }
      : null,
    retireRefused: refused(r.ret_status) && !retired
      ? { note: r.ret_decision_note, at: r.ret_decided_at, sentBack: r.ret_status === "clarify" }
      : null,
    retired: r.status === "retired"
      ? { by: r.retired_by, at: r.retired_at!, reason: r.retire_reason, requestedBy: null }
      : retiredInInbox
        ? { by: r.ret_decided_by, at: r.ret_decided_at!, reason: r.ret_reason, requestedBy: r.ret_by }
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
      [o.hotelId, mayDo(o.role, "approve")],
    );
    const items = rows.map(shape);
    /* A retirement approved in the inbox sorts with the retired too. */
    items.sort((a, b) => Number(a.status === "retired") - Number(b.status === "retired"));
    return { ok: true as const, items };
  });
  return answer(c, result);
});

/* What the add, move and filter controls offer. Places and suppliers are
   READ here and never created: the master builds one shared door for both
   (the owner's answer, 16 September). */
equipment.get("/:code/equipment/options", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const o = await open(client, c.req.param("code"), "view");
    if (o === null || isForbidden(o)) return o;

    const rooms = await client.query<{ id: string; number: string }>(
      `select id::text, number from rooms
        where hotel_id = $1 and is_active order by length(number), number`, [o.hotelId]);
    const places = await client.query<{ id: string; name: string; kind: string }>(
      `select id::text, name, kind from locations
        where hotel_id = $1 and is_active order by name`, [o.hotelId]);
    const suppliers = await client.query<{ id: string; name: string }>(
      `select id::text, name from suppliers
        where hotel_id = $1 and is_active order by name`, [o.hotelId]);
    const categories = await client.query<{ id: string; name: string }>(
      `select id::text, name from equipment_categories
        where hotel_id = $1 order by lower(name)`, [o.hotelId]);
    const tag = await client.query<{ tag: string }>(
      "select app.next_equipment_tag($1) as tag", [o.hotelId]);

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
    const named = mayDo(o.role, "approve");

    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT} where i.hotel_id = $1 and i.id = $3`, [o.hotelId, named, id]);
    if (!rows[0]) return refuse("No such item here.");

    type Entry = {
      id: string; kind: string; quantity: number;
      from: string | null; to: string | null; place: string | null;
      fromStatus: Status | null; toStatus: Status | null;
      related: { id: string; name: string | null; place: string | null } | null;
      changes: Record<string, { from: unknown; to: unknown }> | null;
      note: string | null; who: string | null; at: string;
      decision: { status: Decision; by: string | null; at: string | null; note: string | null } | null;
    };

    /* What happened to it: added, split, status, retired directly, edited. */
    const events = await client.query<{
      id: string; kind: string; quantity: number; place: string | null;
      from_status: Status | null; to_status: Status | null;
      related_id: string | null; related_name: string | null; related_place: string | null;
      changes: Entry["changes"]; note: string | null; who: string | null; at: string;
    }>(
      `select 'h' || h.id::text as id, h.kind, h.quantity,
              coalesce('Room ' || hr.number, hl.name) as place,
              h.from_status, h.to_status,
              h.related_item_id::text as related_id, ri.name as related_name,
              (select coalesce('Room ' || rr.number, rl.name)
                 from app.equipment_place(h.related_item_id) rp
                 left join rooms rr on rr.id = rp.room_id
                 left join locations rl on rl.id = rp.location_id) as related_place,
              h.changes, h.note, ${nameOf("h.done_by", "h.hotel_id")} as who,
              ${iso("h.done_at")} as at
         from equipment_history h
         left join rooms hr on hr.id = h.room_id
         left join locations hl on hl.id = h.location_id
         left join equipment_items ri on ri.id = h.related_item_id
        where h.hotel_id = $1 and h.item_id = $3`,
      [o.hotelId, named, id],
    );

    /* Where it went, and where it was asked to go. */
    const moves = await client.query<{
      id: string; from_place: string | null; to_place: string | null; note: string | null;
      who: string | null; at: string; status: Decision | null;
      decided_by: string | null; decided_at: string | null; decision_note: string | null;
    }>(
      `select 'm' || m.id::text as id,
              coalesce('Room ' || fr.number, fl.name) as from_place,
              coalesce('Room ' || tr.number, tl.name) as to_place,
              m.note, ${nameOf("m.moved_by", "m.hotel_id")} as who, ${iso("m.moved_at")} as at,
              a.status, ${nameOf("a.decided_by", "m.hotel_id")} as decided_by,
              ${iso("a.decided_at")} as decided_at, a.decision_note
         from equipment_moves m
         left join rooms fr on fr.id = m.from_room_id
         left join locations fl on fl.id = m.from_location_id
         left join rooms tr on tr.id = m.to_room_id
         left join locations tl on tl.id = m.to_location_id
         left join approvals a on a.id = m.approval_id
        where m.hotel_id = $1 and m.item_id = $3 and m.kind = 'move'`,
      [o.hotelId, named, id],
    );

    /* Retirements asked for in the inbox (S16). */
    const asked = await client.query<{
      id: string; reason: string; who: string | null; at: string; status: Decision;
      decided_by: string | null; decided_at: string | null; decision_note: string | null;
    }>(
      `select 'r' || a.id::text as id, a.reason,
              ${nameOf("a.requested_by", "a.hotel_id")} as who, ${iso("a.requested_at")} as at,
              a.status, ${nameOf("a.decided_by", "a.hotel_id")} as decided_by,
              ${iso("a.decided_at")} as decided_at, a.decision_note
         from approvals a
        where a.hotel_id = $1 and a.kind = 'equipment_retire'
          and a.subject_table = 'equipment_items' and a.subject_id = $3`,
      [o.hotelId, named, id],
    );

    const quantity = rows[0].quantity;
    const history: Entry[] = [
      ...events.rows.map((h) => ({
        id: h.id, kind: h.kind, quantity: h.quantity, from: null, to: null, place: h.place,
        fromStatus: h.from_status, toStatus: h.to_status,
        related: h.related_id ? { id: h.related_id, name: h.related_name, place: h.related_place } : null,
        changes: h.changes, note: h.note, who: h.who, at: h.at, decision: null,
      })),
      ...moves.rows.map((m) => ({
        id: m.id, kind: m.status === null ? "moved" : "move_asked", quantity,
        from: m.from_place, to: m.to_place, place: null, fromStatus: null, toStatus: null,
        related: null, changes: null, note: m.note, who: m.who, at: m.at,
        decision: m.status === null ? null
          : { status: m.status, by: m.decided_by, at: m.decided_at, note: m.decision_note },
      })),
      ...asked.rows.map((a) => ({
        id: a.id, kind: "retire_asked", quantity, from: null, to: null, place: null,
        fromStatus: null, toStatus: null, related: null, changes: null,
        note: a.reason, who: a.who, at: a.at,
        decision: { status: a.status, by: a.decided_by, at: a.decided_at, note: a.decision_note },
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id.localeCompare(a.id)));

    return { ok: true as const, item: shape(rows[0]), history };
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
    return refuse("Where is it? Choose a room or a place - one of the two.");
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
     the application holds none on categories (EQ-1). */
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

/** Where a new thing is put. Adding is not leaving the store: no approval. */
const placeIt = (
  client: Client, hotelId: string, itemId: string,
  roomId: string | null | undefined, locationId: string | null | undefined, staffId: string,
) =>
  client.query(
    `insert into equipment_moves (hotel_id, item_id, kind, to_room_id, to_location_id, moved_by)
     values ($1, $2, 'placed', $3, $4, $5)`,
    [hotelId, itemId, roomId || null, locationId || null, staffId]);

const NAME_MAX = 200;

equipment.post("/:code/equipment", async (c) => {
  const input = await c.req.json<Details>().catch(() => ({}) as Details);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "create");
    if (o === null || isForbidden(o)) return o;

    /* ---- every refusal, before the first write ---- */
    const name = input.name?.trim() ?? "";
    if (!name) return refuse("What is it called?");
    if (name.length > NAME_MAX) return refuse("That name is too long - keep it under 200 letters.");

    if (input.heldAs !== "tagged" && input.heldAs !== "counted") {
      return refuse("Is it one thing with a tag, or a count of things in one place?");
    }
    const tagged = input.heldAs === "tagged";

    const tag = input.tag?.trim() ?? "";
    let quantity = 1;
    if (tagged) {
      if (!tag) return refuse("A tagged item needs its tag. The form offers the next free number.");
      if (tag.length > 40) return refuse("A tag is a short label - forty letters at most.");
      if (await tagTaken(client, o.hotelId, tag)) {
        const { rows } = await client.query<{ tag: string }>(
          "select app.next_equipment_tag($1) as tag", [o.hotelId]);
        return refuse(`${tag} is already on another item here. The next free number is ${rows[0]!.tag}.`);
      }
    } else {
      if (tag) return refuse("A count of things carries no tag - a tag names one thing.");
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
      return refuse("A cost is rupees - a number, zero or more. Leave it blank if nobody knows it.");
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
         (hotel_id, name, category_id, held_as, tag, quantity,
          supplier_id, purchase_date, unit_cost, warranty_ends, amc_ends, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10::date,$11::date,$12,$13)
       returning id::text`,
      [o.hotelId, name, categoryId, input.heldAs, tagged ? tag : null, quantity,
       input.supplierId || null, bought ?? null, cost, warranty ?? null, amc ?? null,
       status, session.staffId],
    );
    await placeIt(client, o.hotelId, rows[0]!.id, input.roomId, input.locationId, session.staffId);
    return { ok: true as const, id: rows[0]!.id };
  });
  return answer(c, result);
});

/* ── One item, as the routes that change it need it ───────────────── */

interface Loaded {
  id: string; name: string; held_as: "tagged" | "counted"; tag: string | null;
  quantity: number; status: Status;
  purchase_date: string | null; warranty_ends: string | null; amc_ends: string | null;
  retired: boolean; move_waiting: boolean; retire_waiting: boolean;
  room_id: string | null; location_id: string | null;
}

async function loadItem(client: Client, hotelId: string, id: string): Promise<Loaded | null> {
  if (!isId(id)) return null;
  const { rows } = await client.query<Loaded>(
    `select i.id::text, i.name, i.held_as, i.tag, i.quantity, i.status,
            to_char(i.purchase_date, 'YYYY-MM-DD') as purchase_date,
            to_char(i.warranty_ends, 'YYYY-MM-DD') as warranty_ends,
            to_char(i.amc_ends, 'YYYY-MM-DD') as amc_ends,
            app.equipment_is_retired(i.id) as retired,
            app.equipment_move_waiting(i.id) as move_waiting,
            app.equipment_retire_waiting(i.id) as retire_waiting,
            pl.room_id::text, pl.location_id::text
       from equipment_items i
       left join lateral app.equipment_place(i.id) pl on true
      where i.hotel_id = $1 and i.id = $2
        for update of i`,
    [hotelId, id],
  );
  return rows[0] ?? null;
}

/* ── Changing the details ─────────────────────────────────────────── */

equipment.patch("/:code/equipment/items/:id", async (c) => {
  const input = await c.req.json<Details>().catch(() => ({}) as Details);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "edit");
    if (o === null || isForbidden(o)) return o;

    const item = await loadItem(client, o.hotelId, c.req.param("id"));
    if (!item) return refuse("No such item here.");
    if (item.retired) return refuse("A retired item is kept exactly as it was retired.");

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };

    if (input.name !== undefined) {
      const name = input.name?.trim() ?? "";
      if (!name) return refuse("What is it called?");
      if (name.length > NAME_MAX) return refuse("That name is too long - keep it under 200 letters.");
      set("name", name);
    }

    if (input.tag !== undefined) {
      const tag = input.tag?.trim() ?? "";
      if (item.held_as === "counted") {
        if (tag) return refuse("A count of things carries no tag - a tag names one thing.");
      } else {
        if (!tag) return refuse("A tagged item keeps a tag.");
        if (tag.length > 40) return refuse("A tag is a short label - forty letters at most.");
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
        return refuse("A cost is rupees - a number, zero or more. Leave it blank if nobody knows it.");
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

/** How many, when a counted line is to be split. A Refusal when it is not
    a count this line can give; null for the whole line. */
function countRefusal(item: Loaded, count: unknown): Refusal | null {
  if (count === undefined || count === null || count === "") return null;
  const n = Number(count);
  if (item.held_as === "tagged") return n === 1 ? null : refuse("A tagged item is one thing.");
  if (!Number.isInteger(n) || n < 1 || n > item.quantity) {
    return refuse(`How many of the ${item.quantity}? A whole number, one to ${item.quantity}.`);
  }
  return null;
}

/**
 * The line an action applies to. A tagged item, or all of a counted line,
 * is the line itself. PART of a counted line is first split off as its own
 * line — the database records the split on both and places the new line
 * where its line is — and the action then applies to the new line.
 * `countRefusal` has already been asked.
 */
async function lineFor(
  client: Client, hotelId: string, staffId: string, item: Loaded, count: unknown,
): Promise<{ id: string; quantity: number }> {
  const n = count === undefined || count === null || count === "" ? item.quantity : Number(count);
  if (item.held_as === "tagged" || n === item.quantity) return { id: item.id, quantity: item.quantity };

  const { rows } = await client.query<{ id: string }>(
    `insert into equipment_items
       (hotel_id, name, category_id, held_as, quantity, supplier_id, purchase_date,
        unit_cost, warranty_ends, amc_ends, status, split_from, created_by)
     select hotel_id, name, category_id, held_as, $3, supplier_id, purchase_date,
            unit_cost, warranty_ends, amc_ends, status, id, $4
       from equipment_items where id = $1 and hotel_id = $2
     returning id::text`,
    [item.id, hotelId, n, staffId],
  );
  return { id: rows[0]!.id, quantity: n };
}

/* ── Moving it ────────────────────────────────────────────────────── */

/* S12–S15 and the owner's answers of 16 September:
     OUT OF A STORE to anywhere but a store — ASKED FOR, by anybody who can
       see equipment, with a reason; it happens when the Inventory Manager
       (or the owner, an administrator or the GM) approves it in the inbox.
       Part of a count becomes its own line when asked.
     BETWEEN ROOMS, OR INTO A STORE — recorded at once, by anybody who may
       edit.
   The database holds the first rule as well: a move out of a store with no
   request attached is refused while the property has the rule. */
equipment.post("/:code/equipment/items/:id/move", async (c) => {
  type Body = { roomId?: string | null; locationId?: string | null; count?: number | string; note?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const o = await open(client, c.req.param("code"), "view");
    if (o === null || isForbidden(o)) return o;

    const item = await loadItem(client, o.hotelId, c.req.param("id"));
    if (!item) return refuse("No such item here.");

    const where = await placeRefusal(client, o.hotelId, input.roomId, input.locationId);
    if (where) return where;

    const { rows: l } = await client.query<{ leaves: boolean }>(
      "select app.equipment_leaves_store($1::uuid, $2::uuid) as leaves",
      [item.location_id, input.locationId || null]);
    const leaves = l[0]!.leaves;

    /* WHO, before any other refusal that would tell them something. */
    if (!leaves && !mayDo(o.role, "edit")) {
      return forbiddenBecause(
        `Moving equipment between rooms, or into a store, is for ${whoMayText("edit")}. `
        + "Anybody who can see equipment may ask for something to leave the store.");
    }

    if (item.retired) return refuse("A retired item does not move.");
    if (item.move_waiting || item.retire_waiting) return refuse(WAITING);
    if ((input.roomId || null) === item.room_id && (input.locationId || null) === item.location_id) {
      return refuse("It is already there.");
    }
    const reason = input.note?.trim() ?? "";
    if (leaves && !reason) {
      return refuse("Why is it leaving the store? The Inventory Manager decides on it.");
    }
    if (reason.length > 500) return refuse("Keep the reason under 500 letters.");
    const bad = countRefusal(item, input.count);
    if (bad) return bad;

    /* ---- writes ---- */
    await note(client, reason);
    const line = await lineFor(client, o.hotelId, session.staffId, item, input.count);

    const { rows: id } = await client.query<{ id: string }>("select gen_random_uuid()::text as id");
    const moveId = id[0]!.id;

    let approvalId: string | null = null;
    if (leaves) {
      /* The core function, never a queue of our own. It returns null when
         the property has no rule — which means proceed, and the database
         agrees (app.equipment_issue_rule_applies). */
      const { rows: ap } = await client.query<{ id: string | null }>(
        `select app.request_approval($1::uuid, 'equipment_issue', 'equipment_moves',
                $2::uuid, $3, null, $4::uuid)::text as id`,
        [o.hotelId, moveId, reason, session.staffId]);
      approvalId = ap[0]!.id;
    }

    await client.query(
      `insert into equipment_moves
         (id, hotel_id, item_id, kind, to_room_id, to_location_id, note, approval_id, moved_by)
       values ($1, $2, $3, 'move', $4, $5, $6, $7, $8)`,
      [moveId, o.hotelId, line.id, input.roomId || null, input.locationId || null,
       reason || null, approvalId, session.staffId],
    );
    return {
      ok: true as const, id: line.id, quantity: line.quantity,
      split: line.id !== item.id, requested: approvalId !== null, approvalId,
    };
  });
  return answer(c, result);
});

/* ── In use, or under repair ──────────────────────────────────────── */

/* By hand until phase 2B, when a work order against the item sets it. */
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
    if (item.retired) return refuse("A retired item is kept exactly as it was retired.");
    if (item.move_waiting || item.retire_waiting) return refuse(WAITING);
    if (item.status === input.status) return refuse(`It is already ${STATUS_WORD[item.status]}.`);
    const bad = countRefusal(item, input.count);
    if (bad) return bad;

    await note(client, input.note);
    const line = await lineFor(client, o.hotelId, session.staffId, item, input.count);
    await client.query(
      "update equipment_items set status = $1 where id = $2 and hotel_id = $3",
      [input.status, line.id, o.hotelId],
    );
    return { ok: true as const, id: line.id, quantity: line.quantity, split: line.id !== item.id };
  });
  return answer(c, result);
});

/* ── Retiring it ──────────────────────────────────────────────────── */

/* The owner, 16 September, and S16: a TAGGED item retired by somebody
   who may not approve — the Hotel Manager — waits in the shared approvals
   inbox for the Inventory Manager (the owner, an administrator or the GM
   instead). A counted line, and anything an approver retires, goes
   straight through. Who, when and why are recorded either way. */
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
    if (item.retired) return refuse("It is already retired.");
    if (item.move_waiting || item.retire_waiting) return refuse(WAITING);
    const bad = countRefusal(item, input.count);
    if (bad) return bad;

    if (item.held_as === "tagged" && !mayDo(o.role, "approve")) {
      const { rows } = await client.query<{ id: string | null }>(
        `select app.request_approval($1::uuid, 'equipment_retire', 'equipment_items',
                $2::uuid, $3, null, $4::uuid)::text as id`,
        [o.hotelId, item.id, reason, session.staffId]);
      if (rows[0]!.id !== null) {
        return { ok: true as const, id: item.id, requested: true, approvalId: rows[0]!.id };
      }
      /* No rule at this property: nothing to wait for (076). */
    }

    await note(client, reason);
    const line = await lineFor(client, o.hotelId, session.staffId, item, input.count);
    await client.query(
      `update equipment_items
          set status = 'retired', retired_at = now(), retired_by = $1, retire_reason = $2
        where id = $3 and hotel_id = $4`,
      [session.staffId, reason, line.id, o.hotelId],
    );
    return { ok: true as const, id: line.id, quantity: line.quantity, requested: false,
             approvalId: null, split: line.id !== item.id };
  });
  return answer(c, result);
});

/* ── The opening register, from a file ────────────────────────────── */

/* Same two passes as the Store's and the menu's import: a dry run that
   changes nothing and says what would happen to every row, then the
   identical payload to apply. A row that cannot be read is REJECTED with
   its line number — never repaired, and a blank cost never lands as zero.
   Putting a thing somewhere by import is adding it, not taking it out of
   the store: no approval. */
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

    const roomQ = await client.query<{ id: string; number: string; is_active: boolean }>(
      "select id::text, number, is_active from rooms where hotel_id = $1", [o.hotelId]);
    const placeQ = await client.query<{ id: string; name: string; is_active: boolean }>(
      "select id::text, name, is_active from locations where hotel_id = $1", [o.hotelId]);
    const supQ = await client.query<{ id: string; name: string }>(
      "select id::text, name from suppliers where hotel_id = $1", [o.hotelId]);
    const tagQ = await client.query<{ tag: string }>(
      "select upper(btrim(tag)) as tag from equipment_items where hotel_id = $1 and tag is not null",
      [o.hotelId]);
    const nextQ = await client.query<{ tag: string }>(
      "select app.next_equipment_tag($1) as tag", [o.hotelId]);

    const roomBy = new Map(roomQ.rows.map((r) => [r.number.trim().toUpperCase(), r]));
    const placeBy = new Map(placeQ.rows.map((p) => [p.name.trim().toLowerCase(), p]));
    const supplierBy = new Map(supQ.rows.map((s) => [s.name.trim().toLowerCase(), s]));
    const tagsUsed = new Set(tagQ.rows.map((t) => t.tag));
    const today = await businessDateFor(client, o.hotelId);

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
        if (q !== "" && q !== "1") return reject("A tagged item is one thing - leave How many blank or 1.");
        if (tag) {
          if (tag.length > 40) return reject("The tag is longer than forty letters.");
          const key = tag.toUpperCase();
          if (tagsUsed.has(key)) return reject(`${tag} is already in the register, or earlier in this file.`);
          tagsUsed.add(key);
        } else {
          blankTag = true;
        }
      } else {
        if (tag) return reject("A count of things carries no tag - leave Tag blank.");
        const q = Number(text(raw.quantity));
        if (!Number.isInteger(q) || q < 1) return reject("How many? A whole number, one or more.");
        if (q > 100_000) return reject("More than a hundred thousand in one place.");
        quantity = q;
        tag = "";
      }

      const roomText = text(raw.room);
      const placeText = text(raw.place);
      if ((roomText === "") === (placeText === "")) {
        return reject("Give a Room or a Place - exactly one of the two.");
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
          : `Status must be blank, in use, or under repair - not "${text(raw.status)}".`);
      }

      good.push({
        name, category: text(raw.category) || null, heldAs, tag: tag || null, quantity,
        roomId, locationId, supplierId, purchaseDate: bought,
        unitCost: cost, warrantyEnds: dates["warrantyEnds"] ?? null,
        amcEnds: dates["amcEnds"] ?? null, status, blankTag,
      });
      verdicts.push({ line, name, action: "create", detail: "" });
    });

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
      const { rows: made } = await client.query<{ id: string }>(
        `insert into equipment_items
           (hotel_id, name, category_id, held_as, tag, quantity,
            supplier_id, purchase_date, unit_cost, warranty_ends, amc_ends, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10::date,$11::date,$12,$13)
         returning id::text`,
        [o.hotelId, g.name, categoryId, g.heldAs, g.tag, g.quantity, g.supplierId,
         g.purchaseDate, g.unitCost, g.warrantyEnds, g.amcEnds, g.status, session.staffId],
      );
      await placeIt(client, o.hotelId, made[0]!.id, g.roomId, g.locationId, session.staffId);
    }
    return { ok: true as const, dryRun: false, verdicts, ...tally };
  });
  return answer(c, result);
});

/* ── The register, out ────────────────────────────────────────────── */

/* A separate door, because the grant is separate: the Viewer may SEE the
   register and may not take it away (Accountant see and export). */
equipment.get("/:code/equipment/export", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const o = await open(client, c.req.param("code"), "export");
    if (o === null || isForbidden(o)) return o;

    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT}
        where i.hotel_id = $1
        order by (i.status = 'retired'), c.name nulls last, i.name`,
      [o.hotelId, mayDo(o.role, "approve")],
    );
    return { ok: true as const, items: rows.map(shape) };
  });
  return answer(c, result);
});
