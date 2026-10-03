import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   THE FRONT DESK'S SETTINGS AND THE LISTS (phase 5 of the settings plan,
   the owner's D27-260; migration 193)

   - /:code/lists/:kind    market segments and the four ready-reason lists
   - /:code/holidays       name, day, colour - shading only
   - /:code/vip-levels     ONE list for the group (a guest is one record)
   - /:code/desk-settings  the hotel's guarantee, bill-to, required fields,
                           housekeeping switches, ID types, status colours,
                           the restaurant's round-off and how figures count
   Read by every screen that offers them; changed from the Settings console.
   Every refusal is a sentence (MEMORY 243: before anything is written).
   ══════════════════════════════════════════════════════════════════ */

export const lists = new Hono<{ Variables: { subject: string } }>();

const KINDS = ["market_segment", "reason_block", "reason_cancel", "reason_void", "reason_correction"] as const;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const no = (reason: string) => ({ ok: false as const, reason });

async function hotelOf(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

const labelProblem = (label: unknown, max = 80) =>
  typeof label !== "string" || !label.trim() || label.trim().length > max
    ? `A name is 1 to ${max} letters.` : null;
const colourProblem = (colour: unknown) =>
  colour != null && (typeof colour !== "string" || !COLOUR.test(colour))
    ? "A colour is like #DF6128." : null;

/* ── The lists ──────────────────────────────────────────────────────── */

lists.get("/:code/lists/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!(KINDS as readonly string[]).includes(kind)) return c.json(no("No such list."), 404);
  const rows = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelOf(client, c.req.param("code"));
    if (!hotelId) return null;
    return (await client.query(
      `select id, label, colour, sort, active from hotel_lists
        where hotel_id = $1 and kind = $2 order by sort, label`, [hotelId, kind])).rows;
  });
  return rows ? c.json(rows) : c.json({ error: "No such property." }, 404);
});

lists.post("/:code/lists/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!(KINDS as readonly string[]).includes(kind)) return c.json(no("No such list."), 404);
  const b = await c.req.json<{ label?: string; colour?: string | null }>().catch(() => ({}) as never);
  const wrong = labelProblem(b.label) ?? colourProblem(b.colour);
  if (wrong) return c.json(no(wrong), 409);
  const out = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelOf(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ id: string }>(
      `insert into hotel_lists (hotel_id, kind, label, colour, sort)
       values ($1, $2, trim($3), $4,
               coalesce((select max(sort) + 10 from hotel_lists where hotel_id = $1 and kind = $2), 10))
       on conflict do nothing returning id::text`,
      [hotelId, kind, b.label, b.colour ?? null]);
    return rows[0] ? { ok: true as const, id: rows[0].id } : no("That one is on the list already.");
  });
  if (!out) return c.json({ error: "No such property." }, 404);
  return c.json(out, out.ok ? 200 : 409);
});

lists.patch("/:code/lists/:kind/:id", async (c) => {
  const b = await c.req.json<{ label?: string; colour?: string | null; sort?: number; active?: boolean }>()
    .catch(() => ({}) as never);
  const wrong = (b.label !== undefined ? labelProblem(b.label) : null) ?? colourProblem(b.colour)
    ?? (b.sort !== undefined && !Number.isInteger(b.sort) ? "The order is a whole number." : null)
    ?? (b.active !== undefined && typeof b.active !== "boolean" ? "On or Off is a yes or a no." : null);
  if (wrong) return c.json(no(wrong), 409);
  const out = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelOf(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      `update hotel_lists set
         label  = coalesce(trim($4), label),
         colour = case when $5::boolean then $6 else colour end,
         sort   = coalesce($7, sort),
         active = coalesce($8, active)
       where hotel_id = $1 and kind = $2 and id = $3::uuid`,
      [hotelId, c.req.param("kind"), c.req.param("id"), b.label ?? null,
       Object.hasOwn(b, "colour"), b.colour ?? null, b.sort ?? null, b.active ?? null]);
    return rowCount ? { ok: true as const } : no("That is not on the list.");
  }).catch(() => no("That one is on the list already."));
  if (!out) return c.json({ error: "No such property." }, 404);
  return c.json(out, out.ok ? 200 : 409);
});

/* Deleted only when nothing uses it: a segment a booking carries is
   switched Off instead, so the booking keeps its word. */
lists.delete("/:code/lists/:kind/:id", async (c) => {
  const out = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelOf(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ used: number }>(
      `select count(r.id)::int as used
         from hotel_lists l
         left join reservations r on l.kind = 'market_segment' and r.hotel_id = l.hotel_id
                                 and r.market_segment = l.label
        where l.hotel_id = $1 and l.kind = $2 and l.id = $3::uuid`,
      [hotelId, c.req.param("kind"), c.req.param("id")]);
    if (!rows[0]) return no("That is not on the list.");
    if (rows[0].used > 0) {
      return no(`${rows[0].used} ${rows[0].used === 1 ? "booking uses" : "bookings use"} it: switch it Off instead.`);
    }
    await client.query("delete from hotel_lists where hotel_id = $1 and id = $2::uuid",
      [hotelId, c.req.param("id")]);
    return { ok: true as const };
  });
  if (!out) return c.json({ error: "No such property." }, 404);
  return c.json(out, out.ok ? 200 : 409);
});

/* ── Holidays ───────────────────────────────────────────────────────── */

lists.get("/:code/holidays", async (c) => {
  const rows = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelOf(client, c.req.param("code"));
    if (!hotelId) return null;
    return (await client.query(
      `select id, to_char(day, 'YYYY-MM-DD') as day, name, colour from hotel_holidays
        where hotel_id = $1 order by day`, [hotelId])).rows;
  });
  return rows ? c.json(rows) : c.json({ error: "No such property." }, 404);
});

lists.post("/:code/holidays", async (c) => {
  const b = await c.req.json<{ day?: string; name?: string; colour?: string | null }>().catch(() => ({}) as never);
  const wrong = (typeof b.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.day) ? "Choose the day." : null)
    ?? labelProblem(b.name) ?? colourProblem(b.colour);
  if (wrong) return c.json(no(wrong), 409);
  const out = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelOf(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ id: string }>(
      `insert into hotel_holidays (hotel_id, day, name, colour) values ($1, $2::date, trim($3), $4)
       on conflict do nothing returning id::text`, [hotelId, b.day, b.name, b.colour ?? null]);
    return rows[0] ? { ok: true as const, id: rows[0].id } : no("That day is a holiday already.");
  });
  if (!out) return c.json({ error: "No such property." }, 404);
  return c.json(out, out.ok ? 200 : 409);
});

lists.delete("/:code/holidays/:id", async (c) => {
  const out = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelOf(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      "delete from hotel_holidays where hotel_id = $1 and id = $2::uuid", [hotelId, c.req.param("id")]);
    return rowCount ? { ok: true as const } : no("That is not a holiday here.");
  });
  if (!out) return c.json({ error: "No such property." }, 404);
  return c.json(out, out.ok ? 200 : 409);
});

/* ── VIP levels, one list for the group ─────────────────────────────── */

lists.get("/:code/vip-levels", async (c) => {
  const rows = await withSession(c.get("subject"), async (client) =>
    (await client.query("select id, label, colour, sort, active from vip_levels order by sort, label")).rows);
  return c.json(rows);
});

lists.post("/:code/vip-levels", async (c) => {
  const b = await c.req.json<{ label?: string; colour?: string | null }>().catch(() => ({}) as never);
  const wrong = labelProblem(b.label, 40) ?? colourProblem(b.colour);
  if (wrong) return c.json(no(wrong), 409);
  const out = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into vip_levels (label, colour, sort)
       values (trim($1), $2, coalesce((select max(sort) + 10 from vip_levels), 10))
       on conflict do nothing returning id::text`, [b.label, b.colour ?? null]);
    return rows[0] ? { ok: true as const, id: rows[0].id } : no("That level is on the list already.");
  }).catch(() => no("The group's VIP levels are set by the owner or an administrator."));
  return c.json(out, out.ok ? 200 : 409);
});

lists.patch("/:code/vip-levels/:id", async (c) => {
  const b = await c.req.json<{ label?: string; colour?: string | null; sort?: number; active?: boolean }>()
    .catch(() => ({}) as never);
  const wrong = (b.label !== undefined ? labelProblem(b.label, 40) : null) ?? colourProblem(b.colour);
  if (wrong) return c.json(no(wrong), 409);
  const out = await withSession(c.get("subject"), async (client) => {
    const { rowCount } = await client.query(
      `update vip_levels set
         label = coalesce(trim($2), label),
         colour = case when $3::boolean then $4 else colour end,
         sort = coalesce($5, sort), active = coalesce($6, active)
       where id = $1::uuid`,
      [c.req.param("id"), b.label ?? null, Object.hasOwn(b, "colour"), b.colour ?? null,
       b.sort ?? null, b.active ?? null]);
    return rowCount ? { ok: true as const } : no("The group's VIP levels are set by the owner or an administrator.");
  }).catch(() => no("That level is on the list already."));
  return c.json(out, out.ok ? 200 : 409);
});

lists.delete("/:code/vip-levels/:id", async (c) => {
  const out = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{ used: number }>(
      "select count(*)::int as used from guests where vip_level_id = $1::uuid", [c.req.param("id")]);
    if (rows[0]!.used > 0) {
      return no(`${rows[0]!.used} ${rows[0]!.used === 1 ? "guest has" : "guests have"} it: switch it Off instead.`);
    }
    const { rowCount } = await client.query("delete from vip_levels where id = $1::uuid", [c.req.param("id")]);
    return rowCount ? { ok: true as const } : no("The group's VIP levels are set by the owner or an administrator.");
  });
  return c.json(out, out.ok ? 200 : 409);
});

/* ── The front desk's settings ──────────────────────────────────────── */

const REQUIRED = ["phone", "email", "nationality", "address", "expectedArrival",
  "marketSegment", "businessSource", "salesPerson"];
const ID_TYPES = ["aadhaar", "passport", "driving_licence", "voter", "other"];
const STATES = ["confirmed", "waiting", "in-house", "due-out", "departed", "no-show"];

export type DeskSettings = {
  defaultGuarantee?: string; defaultBillTo?: string; requiredBookingFields?: string[];
  hkDirtyAfterMove?: boolean; hkDirtyAfterUnblock?: boolean; hkStayoverDirtyAtAudit?: boolean;
  idTypesOff?: string[]; statusColours?: Record<string, string> | null;
  posRoundOff?: string; kpiDayUseHalf?: boolean; kpiCompAsSold?: boolean;
};

function settingsProblem(b: DeskSettings): string | null {
  const one = (v: unknown, of: string[]) => v === undefined || of.includes(v as string);
  const bool = (v: unknown) => v === undefined || typeof v === "boolean";
  const some = (v: unknown, of: string[]) =>
    v === undefined || (Array.isArray(v) && v.every((x) => of.includes(x)));
  if (!one(b.defaultGuarantee, ["confirmed", "tentative"])) return "A booking starts Confirmed or Tentative.";
  if (!one(b.defaultBillTo, ["guest", "company"])) return "A booking is billed to the guest or a company.";
  if (!some(b.requiredBookingFields, REQUIRED)) return "That is not a field New booking can ask for.";
  if (!bool(b.hkDirtyAfterMove) || !bool(b.hkDirtyAfterUnblock) || !bool(b.hkStayoverDirtyAtAudit)
      || !bool(b.kpiDayUseHalf) || !bool(b.kpiCompAsSold)) return "A switch is on or off.";
  if (!some(b.idTypesOff, ID_TYPES)) return "That is not an ID type.";
  if (b.statusColours != null && (typeof b.statusColours !== "object"
      || Object.entries(b.statusColours).some(([k, v]) => !STATES.includes(k) || !COLOUR.test(String(v))))) {
    return "A colour is like #DF6128, for a booking state.";
  }
  if (!one(b.posRoundOff, ["off", "manual", "automatic"])) return "The restaurant's round-off is Off, Manual or Automatic.";
  return null;
}

lists.patch("/:code/desk-settings", async (c) => {
  const b = await c.req.json<DeskSettings>().catch(() => ({}) as DeskSettings);
  const wrong = settingsProblem(b);
  if (wrong) return c.json(no(wrong), 409);
  const out = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelOf(client, c.req.param("code"));
    if (!hotelId) return null;
    await client.query(
      `update hotels set
         default_guarantee          = coalesce($2, default_guarantee),
         default_bill_to            = coalesce($3, default_bill_to),
         required_booking_fields    = coalesce($4::text[], required_booking_fields),
         hk_dirty_after_move        = coalesce($5, hk_dirty_after_move),
         hk_dirty_after_unblock     = coalesce($6, hk_dirty_after_unblock),
         hk_stayover_dirty_at_audit = coalesce($7, hk_stayover_dirty_at_audit),
         id_types_off               = coalesce($8::text[], id_types_off),
         status_colours = case when $9::boolean then $10::jsonb else status_colours end,
         pos_round_off              = coalesce($11, pos_round_off),
         kpi_day_use_half           = coalesce($12, kpi_day_use_half),
         kpi_comp_as_sold           = coalesce($13, kpi_comp_as_sold)
       where id = $1`,
      [hotelId, b.defaultGuarantee ?? null, b.defaultBillTo ?? null, b.requiredBookingFields ?? null,
       b.hkDirtyAfterMove ?? null, b.hkDirtyAfterUnblock ?? null, b.hkStayoverDirtyAtAudit ?? null,
       b.idTypesOff ?? null, Object.hasOwn(b, "statusColours"),
       b.statusColours ? JSON.stringify(b.statusColours) : null,
       b.posRoundOff ?? null, b.kpiDayUseHalf ?? null, b.kpiCompAsSold ?? null]);
    return { ok: true as const };
  });
  if (!out) return c.json({ error: "No such property." }, 404);
  return c.json(out);
});
