import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import {
  mayRead, ADMIN_READ_REFUSED, maySeeGroupActivity, GROUP_ACTIVITY_REFUSED,
} from "./grants.ts";

/* ══════════════════════════════════════════════════════════════════
   THE FULL ACTIVITY LOG (D27-243 5.1, D27-245)

   GET /api/hotels/:code/activity?scope=hotel|group&who=&kind=&from=&to=&limit=&offset=

   Every change `app.write_audit` records (011, 016 and on): who, when,
   which record, and what changed - newest first, paged, filtered by
   person, kind and day. The Audit log screen stays the money's.

   WHO: the owner, an Admin and the GM read their hotel's changes, and
   changes to the hotel's own record (`mayRead` "audit_log"). Changes that
   belong to no hotel - a guest's record, a person, a company - are the
   owner's and an Admin's only, as `scope=group` (Q-A).

   A GUEST'S DETAILS ARE NEVER SENT. On a guest's own records every field
   is "changed", with no value before or after; elsewhere a guest's name,
   phone, email, address or ID is the same. `before` and `after` never
   leave this file whole.
   ══════════════════════════════════════════════════════════════════ */

export const activity = new Hono<{ Variables: { subject: string } }>();

/* What a table is, in words. One not named here reads as its name. */
const KINDS: Record<string, string> = {
  reservations: "Booking", room_assignments: "Room given", folios: "Bill",
  rooms: "Room", room_types: "Room type", staff: "Person", staff_hotels: "Access",
  guests: "Guest", guest_documents: "Guest's ID", form_iii_stays: "Form III",
  companies: "Company", invoices: "Invoice", invoice_series: "Invoice numbers",
  payments: "Payment", night_audit_runs: "Night audit", hotels: "Hotel settings",
  hotel_modules: "Module switch", reservation_groups: "Group booking",
  work_orders: "Work order", channel_bookings: "Booking-site booking",
  crs_bookings: "CRS booking", table_bookings: "Table booking",
};
const kindOf = (table: string) =>
  KINDS[table] ?? table.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/* A guest's own records: every field "changed". */
const GUEST_RECORDS = new Set([
  "guests", "guest_documents", "form_iii_stays", "offer_opt_ins", "offer_opt_outs",
]);
/* Elsewhere: a guest's (or anybody's) name on a booking, phone, email,
   address or ID - and a booking site's whole message, and the CRS's copy (seen). */
const PERSONAL = /(^|_)(phone|email|address|passport|visa|dob|date_of_birth|id_number|id_type)(_|$)|^guest_name$|^payload$|^seen$/;
const NOISE = new Set(["updated_at", "created_at"]);

type Json = Record<string, unknown> | null;
export interface Change { field: string; from?: string | null; to?: string | null; masked?: true }

const shown = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
};

/** What changed, with a guest's details as "changed" only. Exported for its test. */
export function changesOf(table: string, before: Json, after: Json): Change[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Change[] = [];
  for (const field of keys) {
    if (NOISE.has(field) || field === "id") continue;
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (before && after && JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!before && b === null) continue;
    if (GUEST_RECORDS.has(table) || PERSONAL.test(field)) {
      out.push({ field: field.replace(/_/g, " "), masked: true });
    } else {
      out.push({ field: field.replace(/_/g, " "), from: shown(a), to: shown(b) });
    }
  }
  return out;
}

/* Which record, in a word, where one is cheap - never a guest's. */
const LABEL_FIELDS = ["reference", "number", "invoice_number", "name", "full_name", "code", "title"];
function recordOf(table: string, row: Json): string | null {
  if (!row || GUEST_RECORDS.has(table)) return null;
  for (const f of LABEL_FIELDS) {
    const v = row[f];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/* A column that holds a person ("late checkout by", "staff id"): their name,
   as the Who column has it, never the raw id; "-" where it is not theirs to see. */
const STAFF_FIELD = /(^| )(by|staff id)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIONS: Record<string, string> = { INSERT: "Added", UPDATE: "Changed", DELETE: "Removed" };

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

activity.get("/:code/activity", async (c) => {
  const group = c.req.query("scope") === "group";
  const who = c.req.query("who") || null;
  const kind = c.req.query("kind") || null;
  const from = c.req.query("from") || null;
  const to = c.req.query("to") || null;
  if ([from, to].some((d) => d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    return c.json({ ok: false, reason: "A date is written YYYY-MM-DD." }, 400);
  }
  if (who !== null && !/^[0-9a-f-]{36}$/i.test(who)) {
    return c.json({ ok: false, reason: "Pick a person from the list." }, 400);
  }
  const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query("limit"))) || 50));
  const offset = Math.max(0, Math.floor(Number(c.req.query("offset"))) || 0);

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayRead(client, hotelId, "audit_log"))) {
      return { refused: ADMIN_READ_REFUSED.audit_log };
    }
    if (group && !(await maySeeGroupActivity(client, hotelId))) {
      return { refused: GROUP_ACTIVITY_REFUSED };
    }

    /* This hotel's rows and its own record; or the rows of no hotel. */
    const scope = group
      ? "(a.hotel_id is null and a.table_name <> 'hotels' and $1::uuid is not null)"
      : "(a.hotel_id = $1::uuid or (a.table_name = 'hotels' and a.row_id = $1::text))";
    const day = "(a.at at time zone coalesce(h.timezone, 'Asia/Kolkata'))::date";

    const { rows } = await client.query<{
      id: string; at: string; table_name: string; action: string;
      before: Json; after: Json; actor: string | null; actor_name: string | null;
    }>(
      `select a.id::text, a.at::text, a.table_name, a.action, a.before, a.after,
              a.actor::text, app.colleague_name(a.actor, $1::uuid) as actor_name
         from audit_log a, hotels h
        where h.id = $1::uuid and ${scope}
          and ($2::uuid is null or a.actor = $2::uuid)
          and ($3::text is null or a.table_name = $3)
          and ($4::date is null or ${day} >= $4::date)
          and ($5::date is null or ${day} <= $5::date)
        order by a.at desc, a.id desc
        limit $6 offset $7`,
      [hotelId, who, kind, from, to, limit, offset]);

    /* The filters' choices, from what this scope holds. */
    const { rows: kinds } = await client.query<{ t: string }>(
      `select distinct a.table_name as t from audit_log a where ${scope} order by 1`, [hotelId]);
    const { rows: people } = await client.query<{ id: string; name: string | null }>(
      `select p.actor::text as id, app.colleague_name(p.actor, $1::uuid) as name
         from (select distinct a.actor from audit_log a
                where ${scope} and a.actor is not null) p
        order by 2 nulls last`, [hotelId]);

    const entries = rows.map((r) => ({
        id: r.id,
        at: r.at,
        actor: r.actor_name,
        kind: kindOf(r.table_name),
        table: r.table_name,
        record: recordOf(r.table_name, r.after ?? r.before),
        action: ACTIONS[r.action] ?? r.action,
        changes: r.action === "UPDATE" ? changesOf(r.table_name, r.before, r.after) : [],
      }));
    const staffIds = [...new Set(entries.flatMap((e) => e.changes
      .filter((ch) => STAFF_FIELD.test(ch.field)).flatMap((ch) => [ch.from, ch.to])
      .filter((v): v is string => !!v && UUID.test(v))))];
    if (staffIds.length) {
      const { rows: names } = await client.query<{ id: string; name: string | null }>(
        "select x::text as id, app.colleague_name(x, $1::uuid) as name from unnest($2::uuid[]) x",
        [hotelId, staffIds]);
      const nameOf = new Map(names.map((n) => [n.id, n.name ?? "-"]));
      for (const ch of entries.flatMap((e) => e.changes)) {
        if (!STAFF_FIELD.test(ch.field)) continue;
        if (ch.from && nameOf.has(ch.from)) ch.from = nameOf.get(ch.from)!;
        if (ch.to && nameOf.has(ch.to)) ch.to = nameOf.get(ch.to)!;
      }
    }

    return {
      entries,
      kinds: kinds.map((k) => ({ key: k.t, label: kindOf(k.t) })),
      people: people.filter((p) => p.name).map((p) => ({ id: p.id, name: p.name! })),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("refused" in body) return c.json({ ok: false, reason: body.refused }, 403);
  return c.json(body);
});
