import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import { can, type Role } from "../../permissions.ts";
import { roleAt } from "./repairRoles.ts";

/* ══════════════════════════════════════════════════════════════════
   HOUSEKEEPING CHECKLISTS (D27-383 item 10, built under D27-396) -
   migration 271

   Per hotel, a list of items per job (checkout clean, stay-over, deep
   clean, inspection), for one room type or for every room type without its
   own. Kept by the owner, an administrator or the GM (the gate's
   room_config edit, as every hotel setting); so is the switch.

   THE SWITCH, `hotels.checklists_required`, OFF by default: today's board
   is unchanged until a hotel turns it on. On, a room whose type has a
   checklist for the job is marked clean or inspected ONLY by ticking it
   (`roomStatus.ts` refuses the plain tap); a room with none is marked as
   before.

   A RUN is one ticking, written once: a cleaning job needs every item
   ticked and marks the room clean; an inspection may fail items, each with
   a note - passed marks it inspected, failed sends it back to Needs
   cleaning. Who may tick is who may mark a room (the gate's ROOM_STATE).
   The run's address is under /housekeeping/, so with the line down it is
   held on the phone like the board's own taps (src/lib/offline.ts); the
   lists' addresses are not, so a setting is refused offline.
   ══════════════════════════════════════════════════════════════════ */

export const checklists = new Hono<{ Variables: { subject: string } }>();

export const JOBS = ["checkout", "stayover", "deep", "inspection"] as const;
const JOB_WORDS: Record<string, string> = {
  checkout: "checkout clean", stayover: "stay-over", deep: "deep clean", inspection: "inspection",
};
const refuse = (reason: string) => ({ ok: false as const, reason });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/** The items as typed: trimmed, none blank, 1 to 60, each under 120 letters. */
function itemsOf(raw: unknown): string[] | string {
  if (!Array.isArray(raw)) return "Give the checklist its items, one per line.";
  const items = raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (items.length === 0) return "A checklist has at least one item.";
  if (items.length > 60) return "A checklist has at most 60 items.";
  if (items.some((i) => i.length > 120)) return "Keep each item under 120 letters.";
  if (new Set(items.map((i) => i.toLowerCase())).size !== items.length) return "Each item once.";
  return items;
}

/* ── The lists, the switch, the room types ────────────────────────── */
checklists.get("/:code/checklists", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const role = (await roleAt(client, hotelId)) as Role | null;
    const { rows: h } = await client.query<{ required: boolean }>(
      "select checklists_required as required from hotels where id = $1", [hotelId]);
    const { rows: lists } = await client.query(
      `select c.id::text, c.job, c.room_type_id::text as "roomTypeId", rt.name as "roomType", c.items
         from hk_checklists c left join room_types rt on rt.id = c.room_type_id
        where c.hotel_id = $1
        order by array_position(array['checkout','stayover','deep','inspection'], c.job),
                 rt.name nulls first`, [hotelId]);
    const { rows: roomTypes } = await client.query(
      "select id::text, name from room_types where hotel_id = $1 order by name", [hotelId]);
    return {
      required: h[0]?.required ?? false, checklists: lists, roomTypes,
      mayKeep: role !== null && can(role, "edit", "room_config"),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

checklists.put("/:code/checklists/required", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as { required?: boolean };
  if (typeof input.required !== "boolean") return c.json(refuse("On or off?"), 409);
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      "update hotels set checklists_required = $2 where id = $1", [hotelId, input.required]);
    /* Row security (app.manages_hotel) is the last word on a hotel's settings. */
    return rowCount ? { ok: true as const } : refuse("Only the owner, an administrator or the general manager changes this.");
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

checklists.post("/:code/checklists", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as { job?: string; roomTypeId?: string | null; items?: unknown };
  if (!JOBS.includes(input.job as never)) return c.json(refuse("Which job is it for?"), 409);
  if (input.roomTypeId && !UUID.test(input.roomTypeId)) return c.json(refuse("That is not a room type here."), 409);
  const items = itemsOf(input.items);
  if (typeof items === "string") return c.json(refuse(items), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    let typeName = "every room type";
    if (input.roomTypeId) {
      const { rows } = await client.query<{ name: string }>(
        "select name from room_types where id = $1 and hotel_id = $2", [input.roomTypeId, hotelId]);
      if (!rows[0]) return refuse("That is not a room type here.");
      typeName = rows[0].name;
    }
    const { rows: had } = await client.query(
      `select 1 from hk_checklists where hotel_id = $1 and job = $2
          and room_type_id is not distinct from $3::uuid`, [hotelId, input.job, input.roomTypeId || null]);
    if (had[0]) return refuse(`There is already a ${JOB_WORDS[input.job!]} list for ${typeName}. Change that one.`);
    const { rows } = await client.query<{ id: string }>(
      `insert into hk_checklists (hotel_id, job, room_type_id, items, updated_by)
       values ($1, $2, $3, $4, $5) returning id::text`,
      [hotelId, input.job, input.roomTypeId || null, items, session.staffId]);
    return { ok: true as const, data: { id: rows[0]!.id } };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

checklists.put("/:code/checklists/:id", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as { items?: unknown };
  const items = itemsOf(input.items);
  if (typeof items === "string") return c.json(refuse(items), 409);
  if (!UUID.test(c.req.param("id"))) return c.json(refuse("No such checklist."), 409);
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      `update hk_checklists set items = $3, updated_by = $4, updated_at = now()
        where id = $2 and hotel_id = $1`, [hotelId, c.req.param("id"), items, session.staffId]);
    return rowCount ? { ok: true as const } : refuse("No such checklist.");
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

checklists.delete("/:code/checklists/:id", async (c) => {
  if (!UUID.test(c.req.param("id"))) return c.json(refuse("No such checklist."), 409);
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      "delete from hk_checklists where id = $2 and hotel_id = $1", [hotelId, c.req.param("id")]);
    return rowCount ? { ok: true as const } : refuse("No such checklist.");
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Ticking one in a room ────────────────────────────────────────── */
checklists.post("/:code/housekeeping/checklist-runs", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as {
    room?: string; job?: string; results?: { item?: string; ok?: boolean; note?: string }[];
  };
  const room = String(input.room ?? "").trim().toUpperCase();
  if (!room) return c.json(refuse("Which room?"), 409);
  if (!JOBS.includes(input.job as never)) return c.json(refuse("Which job is it?"), 409);
  const results = (Array.isArray(input.results) ? input.results : []).map((r) => ({
    item: String(r?.item ?? ""), ok: r?.ok === true, note: String(r?.note ?? "").trim(),
  }));

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows: rm } = await client.query<{ id: string; number: string; status: string; type: string }>(
      `select id::text, number, housekeeping_status as status, room_type_id::text as type
         from rooms where hotel_id = $1 and upper(number) = $2 and is_active`, [hotelId, room]);
    const r = rm[0];
    if (!r) return refuse(`There is no room ${room} here.`);
    const { rows: list } = await client.query<{ items: string[] }>(
      `select items from hk_checklists
        where hotel_id = $1 and job = $2 and (room_type_id = $3 or room_type_id is null)
        order by room_type_id nulls last limit 1`, [hotelId, input.job, r.type]);
    const items = list[0]?.items;
    if (!items) return refuse(`There is no ${JOB_WORDS[input.job!]} checklist for room ${r.number}.`);
    if (results.length !== items.length || results.some((x, i) => x.item !== items[i])) {
      return refuse("The checklist was changed while it was open. Open it again.");
    }
    if (r.status === "out_of_service") {
      return refuse("This room is held out of service. Release it before cleaning it.");
    }
    const failed = results.filter((x) => !x.ok);
    if (input.job === "inspection") {
      if (r.status === "dirty") return refuse("A dirty room is cleaned before it is inspected.");
      const silent = failed.find((x) => !x.note);
      if (silent) return refuse(`Say what is wrong with: ${silent.item}.`);
    } else if (failed.length) {
      return refuse(`Tick every item before room ${r.number} is clean: ${failed.map((x) => x.item).join(", ")}.`);
    }

    const passed = failed.length === 0;
    await client.query(
      `insert into hk_checklist_runs (hotel_id, room_id, job, business_date, results, passed, done_by)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [hotelId, r.id, input.job, await businessDateFor(client, hotelId),
       JSON.stringify(results.map((x) => (x.note ? x : { item: x.item, ok: x.ok }))), passed, session.staffId]);
    /* Clean, inspected - or a failed inspection back to Needs cleaning. */
    const state = input.job !== "inspection" ? "clean" : passed ? "inspected" : "dirty";
    await client.query("update rooms set housekeeping_status = $2 where id = $1", [r.id, state]);
    return { ok: true as const, data: { passed, state } };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── A room's history: who, when, which items failed ──────────────── */
checklists.get("/:code/housekeeping/checklist-runs", async (c) => {
  const room = c.req.query("room")?.trim().toUpperCase() || null;
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query(
      `select k.id::text, rm.number as room, k.job, k.done_at as "doneAt",
              app.colleague_name(k.done_by, k.hotel_id) as "doneBy", k.passed,
              coalesce((select jsonb_agg(jsonb_build_object('item', x ->> 'item', 'note', x ->> 'note'))
                          from jsonb_array_elements(k.results) x where (x ->> 'ok')::boolean = false),
                       '[]'::jsonb) as failed
         from hk_checklist_runs k join rooms rm on rm.id = k.room_id
        where k.hotel_id = $1 and ($2::text is null or upper(rm.number) = $2)
        order by k.done_at desc limit 100`, [hotelId, room]);
    return { runs: rows };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/** With the switch on, is this room marked `state` only through its checklist?
    roomStatus.ts asks it before the plain tap writes. */
export async function needsChecklist(
  client: Client, hotelId: string, number: string, state: string,
): Promise<boolean> {
  if (state !== "clean" && state !== "inspected") return false;
  const { rows } = await client.query<{ needs: boolean }>(
    `select h.checklists_required and exists (
              select 1 from hk_checklists c join rooms r on r.hotel_id = c.hotel_id
               where c.hotel_id = h.id and r.number = $2
                 and (c.room_type_id = r.room_type_id or c.room_type_id is null)
                 and (c.job = 'inspection') = ($3 = 'inspected')) as needs
       from hotels h where h.id = $1`, [hotelId, number, state]);
  return rows[0]?.needs ?? false;
}
