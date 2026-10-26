import { Hono } from "hono";
import { barStockGate } from "./barGate.ts";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { BAR_KEEPERS, holdsRoleAt, STOCK_ROLES } from "./stockGrants.ts";
import { barCounter, barStore } from "./stores.ts";

/* ══════════════════════════════════════════════════════════════════
   THE COUNTER ASKS THE STORE (the owner's D27-361, 22 October)

   "There are 30 bottles in the store and the counter requested 5 bottles,
   so the approval will be given to move it from the store to the counter."
   The bar manager (or any bar keeper) asks for whole NIPs, bottles or
   packets; the GM or the Inventory Manager - an administrator or the owner
   too - approves, never their own ask; approving moves each line from the
   Bar store to the Bar counter (app.transfer_stock, a 'transfer' pair), or
   rejects it with a note. A store short of a drink is refused before
   anything moves, naming it: reject, and the counter asks again.

   GET  /:code/bar/requests                 waiting first, then the last 30
   POST /:code/bar/requests                 { lines: [{ itemId, quantity }], note }
   POST /:code/bar/requests/:id/approve
   POST /:code/bar/requests/:id/reject      { note }
   ══════════════════════════════════════════════════════════════════ */

export const barRequests = new Hono<{ Variables: { subject: string } }>();
/* Bar stock switched off: every route here refused (D27-367). */
barRequests.use("/:code/bar/*", barStockGate);

const refuse = (reason: string) => ({ ok: false as const, reason });
export const BAR_APPROVERS: readonly string[] = ["owner", "admin", "gm", "stores"];
const ASK_REFUSED = "Asking the store is for the bar manager (the Bar role), the Inventory Manager, "
  + "the general manager, an administrator and the owner.";
const DECIDE_REFUSED = "The general manager or the Inventory Manager approves the counter's ask "
  + "(an administrator or the owner too).";
const READ_REFUSED = "The bar's asks are for whoever sees the Store, and the bar manager.";

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

barRequests.get("/:code/bar/requests", async (c) => {
  const body = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, [...STOCK_ROLES.view, ...BAR_KEEPERS]))) return { forbidden: READ_REFUSED };
    const store = await barStore(client, hotelId);
    const { rows } = await client.query<{
      id: string; status: string; note: string | null; decision_note: string | null;
      requested_by: string | null; requested_by_id: string; requested_at: string;
      decided_by: string | null; decided_at: string | null;
      lines: { itemId: string; name: string; quantity: number; countAs: string | null; inStore: number | null }[];
    }>(
      `select r.id::text, r.status, r.note, r.decision_note,
              a.full_name as requested_by, r.requested_by::text as requested_by_id,
              to_char(r.requested_at at time zone h.timezone, 'DD Mon, HH24:MI') as requested_at,
              d.full_name as decided_by,
              to_char(r.decided_at at time zone h.timezone, 'DD Mon, HH24:MI') as decided_at,
              (select json_agg(json_build_object(
                        'itemId', l.item_id, 'name', i.name, 'quantity', l.quantity, 'countAs', i.count_as,
                        'inStore', case when $2::uuid is null then null else app.stock_on_hand(i.id, $2::uuid) end)
                      order by i.name)
                 from bar_request_lines l join stock_items i on i.id = l.item_id
                where l.request_id = r.id) as lines
         from bar_requests r
         join hotels h on h.id = r.hotel_id
         left join staff a on a.id = r.requested_by
         left join staff d on d.id = r.decided_by
        where r.hotel_id = $1
          and (r.status = 'pending' or r.id in (
               select id from bar_requests where hotel_id = $1 and status <> 'pending'
                order by decided_at desc limit 30))
        order by (r.status = 'pending') desc, coalesce(r.decided_at, r.requested_at) desc`,
      [hotelId, store?.id ?? null]);
    return {
      mayAsk: await holdsRoleAt(client, hotelId, BAR_KEEPERS),
      mayApprove: await holdsRoleAt(client, hotelId, BAR_APPROVERS),
      requests: rows.map((r) => ({
        id: r.id, status: r.status, note: r.note, decisionNote: r.decision_note,
        requestedBy: r.requested_by, mine: r.requested_by_id === session.staffId, requestedAt: r.requested_at,
        decidedBy: r.decided_by, decidedAt: r.decided_at,
        lines: (r.lines ?? []).map((l) => ({ ...l, quantity: Number(l.quantity), inStore: l.inStore === null ? null : Number(l.inStore) })),
      })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden as string), 403);
  return c.json(body);
});

barRequests.post("/:code/bar/requests", async (c) => {
  type Line = { itemId?: unknown; quantity?: unknown };
  const input = await c.req.json<{ lines?: Line[]; note?: unknown }>().catch(() => ({}) as { lines?: Line[]; note?: unknown });
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) return c.json(refuse("Ask for at least one drink."), 409);
  if (lines.some((l) => typeof l.itemId !== "string" || !Number.isInteger(l.quantity) || (l.quantity as number) <= 0)) {
    return c.json(refuse("Each drink asked for in whole NIPs, bottles or packets, more than none."), 409);
  }
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) return c.json(refuse("A drink is on the ask twice."), 409);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 300) : null;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleAt(client, hotelId, BAR_KEEPERS))) return { forbidden: ASK_REFUSED };
    if (!(await barStore(client, hotelId)) || !(await barCounter(client, hotelId))) {
      return refuse("This hotel has no Bar store and Bar counter to move between.");
    }
    const { rows: known } = await client.query<{ id: string }>(
      `select id::text from stock_items
        where hotel_id = $1 and category = 'Bar' and is_active and id::text = any($2)`,
      [hotelId, lines.map((l) => l.itemId)]);
    if (known.length !== lines.length) return refuse("A drink asked for is not on the bar's list.");
    const { rows: [req] } = await client.query<{ id: string }>(
      `insert into bar_requests (hotel_id, business_date, requested_by, note)
       values ($1, $2::date, $3, $4) returning id::text`,
      [hotelId, await businessDateFor(client, hotelId), session.staffId, note]);
    for (const l of lines) {
      await client.query(
        "insert into bar_request_lines (hotel_id, request_id, item_id, quantity) values ($1, $2, $3, $4)",
        [hotelId, req!.id, l.itemId, l.quantity]);
    }
    return { ok: true as const, id: req!.id };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/** The ask, if it is this hotel's and still waiting, and the person may decide it. */
async function decidable(client: Client, hotelId: string, id: string, staffId: string) {
  if (!(await holdsRoleAt(client, hotelId, BAR_APPROVERS))) return { forbidden: DECIDE_REFUSED };
  const { rows: [r] } = await client.query<{ status: string; requested_by: string }>(
    "select status, requested_by::text from bar_requests where hotel_id = $1 and id::text = $2 for update",
    [hotelId, id]);
  if (!r) return refuse("No such ask.");
  if (r.status !== "pending") return refuse(`This ask was ${r.status} already.`);
  if (r.requested_by === staffId) return refuse("Somebody else approves your own ask.");
  return null;
}

barRequests.post("/:code/bar/requests/:id/approve", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const id = c.req.param("id");
    const no = await decidable(client, hotelId, id, session.staffId);
    if (no) return no;
    const store = await barStore(client, hotelId);
    const counter = await barCounter(client, hotelId);
    if (!store || !counter) return refuse("This hotel has no Bar store and Bar counter to move between.");
    const { rows: lines } = await client.query<{ id: string; item_id: string; name: string; quantity: string; have: string }>(
      `select l.id::text, l.item_id::text, i.name, l.quantity::text, app.stock_on_hand(l.item_id, $2)::text as have
         from bar_request_lines l join stock_items i on i.id = l.item_id
        where l.request_id::text = $1 order by i.name`,
      [id, store.id]);
    /* Every line checked before the first move: a refusal returned here is a
       commit (MEMORY 243), so nothing may have moved by then. */
    const short = lines.filter((l) => Number(l.have) < Number(l.quantity))
      .map((l) => `${l.name} (the store has ${Number(l.have)}, ${Number(l.quantity)} asked)`);
    if (short.length) return refuse(`The store is short: ${short.join(", ")}. Nothing was moved.`);
    for (const l of lines) {
      const { rows: [t] } = await client.query<{ pair: string }>(
        "select app.transfer_stock($1, $2, $3, $4, $5, $6)::text as pair",
        [l.item_id, store.id, counter.id, l.quantity, session.staffId, "The counter's ask, approved"]);
      await client.query("update bar_request_lines set transfer_id = $2 where id::text = $1", [l.id, t!.pair]);
    }
    await client.query(
      "update bar_requests set status = 'approved', decided_by = $2, decided_at = now() where id::text = $1",
      [id, session.staffId]);
    return { ok: true as const, moved: lines.length };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

barRequests.post("/:code/bar/requests/:id/reject", async (c) => {
  const input = await c.req.json<{ note?: unknown }>().catch(() => ({}) as { note?: unknown });
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!note || note.length > 300) return c.json(refuse("Say why, for the counter."), 409);
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const id = c.req.param("id");
    const no = await decidable(client, hotelId, id, session.staffId);
    if (no) return no;
    await client.query(
      `update bar_requests set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
        where id::text = $1`, [id, session.staffId, note]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});
