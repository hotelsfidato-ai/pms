import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { folioFor } from "../../folio.ts";
import { COMP_ROLES, holdsRoleAt } from "./book.ts";

/* ══════════════════════════════════════════════════════════════════
   THE NEW BOOKING SCREEN'S TWO LISTS, AND CONFIRMING A WAITING BOOKING
   (Phase 1, D27-33)

     sales people      one list for the group (D27-37); a booking keeps the
                       NAME, so "Other" can still be typed
     room promotions   per hotel; a discount over 10% is only one of these
                       (D27-36)
     confirm           Waiting for the hotel -> confirmed; then the voucher
                       may go (the owner, 27 September)

   Each list is saved WHOLE, as the tax card's slabs are: the dialog shows
   the list and sends it back. A name left out is switched off, never
   deleted - a booking that used it still points at it. Kept by the owner,
   an administrator or the GM (the owner, 27 September), asked here; the
   gate lets every role through to this answer (roleGate: own).
   ══════════════════════════════════════════════════════════════════ */

export const desk = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const KEEPERS_ONLY =
  "This list is kept by the owner, an administrator or the general manager.";

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/** Trimmed, non-empty, at most 80 characters, each once (case aside). */
function cleanNames(names: unknown): string[] | null {
  if (!Array.isArray(names) || names.length > 200) return null;
  const seen = new Map<string, string>();
  for (const n of names) {
    if (typeof n !== "string" || !n.trim() || n.trim().length > 80) return null;
    seen.set(n.trim().toLowerCase(), n.trim());
  }
  return [...seen.values()];
}

/* ── Sales people ─────────────────────────────────────────────────── */

desk.get("/:code/sales-people", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    if (!(await hotelFor(client, c.req.param("code")))) return null;
    const { rows } = await client.query<{ id: string; name: string }>(
      "select id::text, name from sales_people where is_active order by lower(name)");
    return rows;
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

desk.put("/:code/sales-people", async (c) => {
  const input = await c.req.json<{ names?: unknown }>().catch(() => ({}) as { names?: unknown });
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, COMP_ROLES))) return { forbidden: KEEPERS_ONLY };
    const names = cleanNames(input.names);
    if (!names) return refuse("Each name is written out, at most 80 characters.");

    await client.query(
      `update sales_people set is_active = false
        where is_active and lower(btrim(name)) <> all($1::text[])`,
      [names.map((n) => n.toLowerCase())]);
    await client.query(
      `insert into sales_people (name) select unnest($1::text[])
       on conflict ((lower(btrim(name)))) do update
         set is_active = true, name = excluded.name`,
      [names]);
    return { ok: true as const, count: names.length };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Room promotions ──────────────────────────────────────────────── */

desk.get("/:code/room-promotions", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ id: string; name: string; percent: string }>(
      `select id::text, name, percent::text from room_promotions
        where hotel_id = $1 and is_active order by lower(name)`, [hotelId]);
    return rows.map((r) => ({ id: r.id, name: r.name, percent: Number(r.percent) }));
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

desk.put("/:code/room-promotions", async (c) => {
  const input = await c.req.json<{ promotions?: unknown }>()
    .catch(() => ({}) as { promotions?: unknown });
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, COMP_ROLES))) return { forbidden: KEEPERS_ONLY };

    const list = Array.isArray(input.promotions) ? input.promotions as unknown[] : null;
    const names = cleanNames(list?.map((p) => (p as { name?: unknown })?.name));
    const percents = (list ?? []).map((p) => Number((p as { percent?: unknown })?.percent));
    if (!list || !names || names.length !== list.length
        || percents.some((p) => !Number.isFinite(p) || p <= 0 || p > 100)) {
      return refuse("Each promotion has its own name and a percentage above 0, at most 100.");
    }

    await client.query(
      `update room_promotions set is_active = false
        where hotel_id = $1 and is_active and lower(btrim(name)) <> all($2::text[])`,
      [hotelId, names.map((n) => n.toLowerCase())]);
    await client.query(
      `insert into room_promotions (hotel_id, name, percent)
       select $1, n, p from unnest($2::text[], $3::numeric[]) as t(n, p)
       on conflict (hotel_id, (lower(btrim(name)))) do update
         set is_active = true, name = excluded.name, percent = excluded.percent`,
      [hotelId, names, percents]);
    return { ok: true as const, count: names.length };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Confirming a booking that was waiting for the hotel ──────────────
   The whole booking: every room of its group that is still waiting, as it
   was made together. Anybody who may make a booking may confirm one (the
   owner, 27 September; the gate asks). Nothing is sent here - the voucher
   is its own act. */
desk.post("/:code/stays/:id/confirm", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ reference: string; status: string }>(
      "select reference, status from reservations where id = $1 and hotel_id = $2",
      [c.req.param("id"), hotelId]);
    const stay = rows[0];
    if (!stay) return refuse("No such booking.");
    if (stay.status !== "tentative") {
      return refuse(`${stay.reference} is not waiting for the hotel, so there is nothing to confirm.`);
    }
    const { rowCount } = await client.query(
      `update reservations set status = 'confirmed'
        where hotel_id = $2 and status = 'tentative'
          and (id = $1 or group_id = (select group_id from reservations where id = $1))`,
      [c.req.param("id"), hotelId]);
    return { ok: true as const, rooms: rowCount ?? 0, reference: stay.reference };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Cancelling a booking that was waiting for the hotel (D27-64) ─────
   The owner, 27 September: "cancel it directly". It was never confirmed,
   so NO CHARGE (the terms are not applied) and nothing is sent; the room
   it held on the grid is free the moment the status changes (044 counts
   no cancelled booking), and any room given to it is released by 073's
   trigger. The whole booking, as Confirm does, with a short reason kept
   on it. For the people who may cancel a booking (the gate: reservation
   cancel). A CONFIRMED booking goes to cancelConfirmed, below (BK-1). */
desk.post("/:code/stays/:id/cancel", async (c) => {
  const input = await c.req.json<{ reason?: unknown; waive?: unknown; dryRun?: unknown }>()
    .catch(() => ({}) as { reason?: unknown; waive?: unknown; dryRun?: unknown });
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  /* dryRun: what the terms would charge, written nowhere - the dialog shows
     it before the clerk confirms (BK-1). */
  const dryRun = input.dryRun === true;
  if (!reason && !dryRun) {
    return c.json(refuse("Why is it cancelled? It stays on the booking, e.g. “Hotel full that week”."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      reference: string; status: string; terms: string | null; basis: string | null;
      retention: string | null; free: boolean | null; nightly: string;
    }>(
      /* THE TERMS FROZEN ON THE BOOKING (036, 037), and whether now is still
         inside their free window: free until N hours before the hotel's
         check-in time on the arrival day, on the hotel's clock. No window
         (N null) means the charge applies from the moment of booking. */
      `select r.reference, r.status, r.cancel_terms as terms, r.cancel_basis as basis,
              app.retention_for(r.id, 'cancel')::text as retention,
              now() < app.hotel_moment(r.hotel_id,
                        r.check_in::text || 'T' || to_char(h.check_in_time, 'HH24:MI'))
                      - make_interval(hours => r.cancel_free_until_hours) as free,
              r.agreed_rate::text as nightly
         from reservations r join hotels h on h.id = r.hotel_id
        where r.id = $1 and r.hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    const stay = rows[0];
    if (!stay) return refuse("No such booking.");
    if (stay.status === "confirmed") {
      return cancelConfirmed(client, hotelId, c.req.param("id"), stay,
        { reason, dryRun, waive: input.waive === true, staffId: session.staffId });
    }
    if (stay.status !== "tentative") {
      const why: Record<string, string> = {
        checked_in: "has arrived. Check them out instead.", checked_out: "has checked out.",
        cancelled: "is already cancelled.", void: "was voided.", no_show: "was marked a no-show.",
      };
      return refuse(`${stay.reference} ${why[stay.status] ?? "cannot be cancelled."}`);
    }
    if (dryRun) return { ok: true as const, preview: { terms: null, charge: 0 } };
    const { rowCount } = await client.query(
      `update reservations
          set status = 'cancelled', cancelled_at = now(), cancelled_by = $3,
              cancel_reason = $4
        where hotel_id = $2 and status = 'tentative'
          and (id = $1 or group_id = (select group_id from reservations where id = $1))`,
      [c.req.param("id"), hotelId, session.staffId, reason]);
    return { ok: true as const, rooms: rowCount ?? 0, reference: stay.reference };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Cancelling a CONFIRMED booking (BK-1; the owner, 28 September) ────
   Until now a confirmed booking could only be voided, and the Void dialog
   itself says "use Cancel if the guest cancelled": a guest's cancellation
   and its fee could not be recorded. The owner's answers:

     · the terms frozen on the booking decide (036, 037): inside the free
       window nothing; outside it, what the terms retain - posted on the
       guest's bill as the night audit posts a no-show's, category misc at
       the ROOM's slab (circular 178/10/2022, as nightAudit.ts says)
     · no terms on the booking: no charge, and the dialog says so
     · the owner, an administrator or the GM may waive it, with the reason
     · THIS ROOM ONLY - a family of nine rooms losing one keeps eight
     · an advance already paid stays on the bill; more than the fee shows
       as owed back, on the refunds due, and nothing is refunded here

   Every refusal above the first write (MEMORY 243). */
async function cancelConfirmed(
  client: Client, hotelId: string, stayId: string,
  stay: { reference: string; terms: string | null; basis: string | null;
          retention: string | null; free: boolean | null; nightly: string },
  ask: { reason: string; dryRun: boolean; waive: boolean; staffId: string },
) {
  const charge = stay.basis === null ? null            // no terms recorded
    : stay.free === true ? 0                           // inside the free window
    : Number(stay.retention ?? 0);
  const preview = { terms: stay.terms, charge };
  if (ask.dryRun) return { ok: true as const, preview };

  const owed = charge !== null && charge > 0;
  const waive = owed && ask.waive;
  if (waive && !(await holdsRoleAt(client, hotelId, COMP_ROLES))) {
    return refuse("A cancellation charge is waived by the owner, an administrator or the general manager.");
  }
  if (owed && !waive) {
    /* app.gst_rate RAISES on a property with no rule; asked politely first
       (finance's postCharge does the same). */
    const { rows: rate } = await client.query<{ rate: string | null }>(
      "select app.gst_rate_or_null($1, 'room', $2::numeric)::text as rate", [hotelId, stay.nightly]);
    if (rate[0]?.rate === null || rate[0]?.rate === undefined) {
      return refuse("This property has no GST rule for rooms, so the cancellation charge cannot be billed. "
        + "Set it in the GST card under System → Administration → Configuration.");
    }
  }

  if (owed && !waive) {
    const folioId = await folioFor(client, hotelId, stayId);
    if (!folioId) return refuse("Could not open a bill for this booking.");
    await client.query(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount, source_type, posted_by)
       select $1::uuid, $2::uuid, app.business_date($1), 'misc', $3::text, $4::numeric,
              t.rate, round($4::numeric * t.rate / 100.0, 2), 'front_desk', $5::uuid
         from (select app.gst_rate($1, 'room', $6::numeric) as rate) t`,
      [hotelId, folioId, `Retention - cancellation${stay.terms ? ` (${stay.terms})` : ""}`,
       charge, ask.staffId, stay.nightly]);
  }

  await client.query(
    `update reservations
        set status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4
      where hotel_id = $2 and id = $1 and status = 'confirmed'`,
    [stayId, hotelId, ask.staffId,
     waive ? `${ask.reason} (the ₹${charge!.toFixed(2)} charge waived)` : ask.reason]);
  return {
    ok: true as const, rooms: 1, reference: stay.reference,
    charged: owed && !waive ? charge : 0, waived: waive,
  };
}
