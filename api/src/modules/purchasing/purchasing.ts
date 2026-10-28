import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { renderPdf } from "../../reportRender.ts";
import { mayDeliverInto, receiveIntoStore, deliveryFactsProblem } from "../stores/index.ts";
import { orderDocument, type OrderLine } from "./orderDocument.ts";
import {
  VIEW_ROLES, SETTING_KEEPERS, PURCHASING_REFUSED, hasRoleAt, mayRaise,
} from "./purchasingGrants.ts";
import { priceProblem } from "../../validate.ts";
import { creditProblem, hotelToday, recordCredit, type CreditIn } from "./supplierDues.ts";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING — a request, an approval, an order, a delivery

   § 1 of docs/BUILD-PLAN-2026-09-18.md. The owner's answers are D18-2,
   D18-3 and D18-4.

   THIS SERVICE JOINS THINGS THAT ALREADY EXIST. It has no approvals
   engine of its own (076 has one, and one inbox), no supplier list of
   its own (094), and no stock ledger of its own (069, 112). Everything
   it adds is migration 116.

   FOUR RULES LIVE IN THE DATABASE, not here, because a control another
   endpoint can walk around is not a control (076's own words):

     who may raise one     app.may_raise_purchase — the per-property
                           SETTING of D18-2, not a list in this file
     nobody decides their  app.decide_approval (076)
       own request
     no order goes out     app.mark_purchase_ordered — refuses one not
       unapproved or         approved, one with a line nobody priced, and
       unpriced              one already sent
     no delivery against   app.mark_purchase_received
       an order never sent

   What is in this file is Rule 6: the same refusal, in the same words,
   before the person presses the button.

   ⚠ A REFUSAL RETURNED INSIDE `withSession` IS A COMMIT (MEMORY 243).
   Every refusal below therefore sits ABOVE the first write of its route,
   and the delivery route asks the Store once, for the whole delivery,
   before it writes any of it.
   ══════════════════════════════════════════════════════════════════ */

export const purchasing = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const forbid = (reason: string) => ({ forbidden: reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/* ── Where a request has got to ────────────────────────────────────
   ONE definition, computed once, on the server. The design critique of
   16 September found one booking reading three statuses across three
   screens; this service starts with the answer rather than arriving at
   it later. What the GM said is NOT copied onto the request — it is
   read from the approval row here.
   ═══════════════════════════════════════════════════════════════════ */
export type PurchaseState =
  | "waiting" | "refused" | "sent_back" | "ready" | "ordered" | "received" | "cancelled";

export function stateOf(
  status: string, approval: string | null,
): PurchaseState {
  if (status === "cancelled") return "cancelled";
  if (status === "received") return "received";
  if (status === "ordered") return "ordered";
  /* Still `requested`. No approval row means no rule called for one (076:
     a property with no rules can still buy nails), so it is ready. */
  if (approval === null || approval === "approved") return "ready";
  if (approval === "rejected") return "refused";
  if (approval === "clarify") return "sent_back";
  return "waiting";
}

/** What a person reads. The words are the screen's, kept beside the
    definition so the two cannot drift. */
export const STATE_WORDS: Record<PurchaseState, string> = {
  waiting: "Waiting for approval",
  refused: "Refused",
  sent_back: "Sent back",
  ready: "Ready to order",
  ordered: "Ordered",
  received: "Delivered",
  cancelled: "Cancelled",
};

/** What is on its way: each line of an order sent and not yet delivered.
    The Store's "Awaiting delivery" tile reads it (D27-238); its caller has
    asked its own grant first. Read only. */
export async function awaitingDelivery(
  client: Client, hotelId: string,
): Promise<{ itemId: string; storeId: string; quantity: number; reference: string }[]> {
  const { rows } = await client.query<{
    item_id: string; store_id: string; quantity: string; reference: string;
  }>(
    `select pl.item_id::text, r.store_id::text, pl.quantity::text, r.reference
       from purchase_requests r
       join purchase_request_lines pl on pl.request_id = r.id
      where r.hotel_id = $1 and r.status = 'ordered'
      order by r.ordered_at, r.reference, pl.line_no`,
    [hotelId]);
  return rows.map((r) => ({
    itemId: r.item_id, storeId: r.store_id, quantity: Number(r.quantity), reference: r.reference,
  }));
}

interface RequestRow {
  id: string; reference: string; status: string; reason: string;
  store_id: string; store: string;
  supplier_id: string | null; supplier: string | null;
  approval_id: string | null; approval_status: string | null;
  decision_note: string | null;
  requested_by_name: string | null; requested_at: string;
  ordered_at: string | null; ordered_by_name: string | null;
  received_at: string | null; received_by_name: string | null;
  decided_by_name: string | null;
  delivery_note: string | null;
  cancelled_reason: string | null;
  lines: string; unpriced: string; ordered_total: string | null;
}

/* `app.colleague_name` (096) rather than a join to `staff`: that table is
   row-secured and most roles read only their own row, so an INNER JOIN
   hides rows (MEMORY 283) and a LEFT JOIN leaves the name blank for the
   people the screen is for. Null reads as a dash. */
const REQUEST_SELECT = `
  select r.id::text, r.reference, r.status, r.reason,
         r.store_id::text, l.name as store,
         r.supplier_id::text, sup.name as supplier,
         r.approval_id::text, a.status as approval_status, a.decision_note,
         app.colleague_name(r.requested_by, r.hotel_id) as requested_by_name,
         r.requested_at::text,
         r.ordered_at::text, app.colleague_name(r.ordered_by, r.hotel_id) as ordered_by_name,
         r.received_at::text, app.colleague_name(r.received_by, r.hotel_id) as received_by_name,
         app.colleague_name(a.decided_by, r.hotel_id) as decided_by_name,
         r.delivery_note, r.cancelled_reason,
         (select count(*) from purchase_request_lines pl where pl.request_id = r.id)::text as lines,
         (select count(*) from purchase_request_lines pl
           where pl.request_id = r.id and pl.unit_price is null)::text as unpriced,
         (select case when count(*) filter (where pl.unit_price is null) > 0 then null
                      else sum(pl.quantity * pl.unit_price) end
            from purchase_request_lines pl where pl.request_id = r.id)::text as ordered_total
    from purchase_requests r
    join locations l on l.id = r.store_id
    left join suppliers sup on sup.id = r.supplier_id
    left join approvals a on a.id = r.approval_id`;

const asRequest = (r: RequestRow) => ({
  id: r.id,
  reference: r.reference,
  state: stateOf(r.status, r.approval_status),
  reason: r.reason,
  store: { id: r.store_id, name: r.store },
  supplier: r.supplier_id ? { id: r.supplier_id, name: r.supplier } : null,
  approvalId: r.approval_id,
  /* Money stays a string all the way to the wire: a JS number cannot hold
     every numeric(12,2) without loss, and this is where that matters
     (api/src/routes/approvals.ts says the same). Null where a line is
     still unpriced - a total over some of the lines is a smaller number
     presented as the whole bill. */
  total: r.ordered_total,
  lines: Number(r.lines),
  unpriced: Number(r.unpriced),
  requestedBy: r.requested_by_name,
  requestedAt: r.requested_at,
  decidedBy: r.decided_by_name,
  decisionNote: r.decision_note,
  orderedBy: r.ordered_by_name,
  orderedAt: r.ordered_at,
  receivedBy: r.received_by_name,
  receivedAt: r.received_at,
  deliveryNote: r.delivery_note,
  cancelledReason: r.cancelled_reason,
});

/** A refusal from the database, in the words it used. The functions in
    115 raise sentences somebody can act on, so they are passed through
    rather than replaced with "Something went wrong". */
function said(err: unknown): string | null {
  const e = err as { code?: string; message?: string };
  if (!e.message) return null;
  if (e.code === "23514" || e.code === "P0002" || e.code === "23503"
      || e.code === "22000" || e.code === "23505") {
    return e.message.replace(/^error:\s*/i, "");
  }
  return null;
}

/* ── The screen ────────────────────────────────────────────────────── */

purchasing.get("/:code/purchasing", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, VIEW_ROLES))) {
      return forbid(PURCHASING_REFUSED.view);
    }

    const { rows } = await client.query<RequestRow>(
      `${REQUEST_SELECT} where r.hotel_id = $1
        order by r.requested_at desc limit 200`, [hotelId]);

    const { rows: stores } = await client.query<{ id: string; name: string; main: boolean }>(
      `select id::text, name, id = app.main_store($1) as main
         from locations
        where hotel_id = $1 and kind = 'store' and is_active
        order by id = app.main_store($1) desc, name`, [hotelId]);

    const { rows: suppliers } = await client.query<{ id: string; name: string }>(
      `select id::text, name from suppliers
        where hotel_id = $1 and is_active order by name`, [hotelId]);

    /* READ ONLY, and it is the Store's catalogue (069). Purchasing asks
       for things the Store keeps, so the picker is that list; nothing
       here writes a row of it, and a delivery goes back through the
       Store's own door. */
    const { rows: items } = await client.query<{
      id: string; name: string; unit: string; on_hand: string;
    }>(
      `select i.id::text, i.name, i.unit, app.stock_on_hand(i.id)::text as on_hand
         from stock_items i
        where i.hotel_id = $1 and i.is_active
        order by i.name`, [hotelId]);

    return {
      me: {
        mayRaise: await mayRaise(client, hotelId),
        maySetRequesters: await hasRoleAt(client, hotelId, SETTING_KEEPERS),
      },
      stores: stores.map((s) => ({ id: s.id, name: s.name, isMain: s.main })),
      suppliers,
      items: items.map((i) => ({
        id: i.id, name: i.name, unit: i.unit, onHand: Number(i.on_hand),
      })),
      requests: rows.map(asRequest),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

purchasing.get("/:code/purchasing/requests/:id", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, VIEW_ROLES))) {
      return forbid(PURCHASING_REFUSED.view);
    }

    const { rows } = await client.query<RequestRow>(
      `${REQUEST_SELECT} where r.hotel_id = $1 and r.id = $2`,
      [hotelId, c.req.param("id")]);
    if (!rows[0]) return null;

    const { rows: lines } = await client.query<{
      id: string; line_no: number; item_id: string; item: string; unit: string;
      quantity: string; unit_price: string | null;
      received_quantity: string | null; received_unit_cost: string | null;
      note: string | null;
    }>(
      `select pl.id::text, pl.line_no, pl.item_id::text, i.name as item, i.unit,
              pl.quantity::text, pl.unit_price::text,
              pl.received_quantity::text, pl.received_unit_cost::text, pl.note
         from purchase_request_lines pl
         join stock_items i on i.id = pl.item_id
        where pl.request_id = $1
        order by pl.line_no`, [c.req.param("id")]);

    /* On credit (D27-370): the supplier's bill standing (a reversed one is
       followed by its correction, D27-372), and what is left on it. */
    const { rows: credit } = await client.query<{
      billNo: string; billDate: string; amount: string; dueOn: string; owed: string;
    }>(
      `select bill_no as "billNo", to_char(bill_date, 'YYYY-MM-DD') as "billDate", amount::text as amount,
              to_char(due_on, 'YYYY-MM-DD') as "dueOn", app.supplier_bill_owed(b.id)::text as owed
         from supplier_bills b where purchase_request_id = $1
          and not exists (select 1 from supplier_reversals x where x.bill_id = b.id)`, [c.req.param("id")]);

    return {
      request: asRequest(rows[0]),
      credit: credit[0] ?? null,
      lines: lines.map((l) => ({
        id: l.id, lineNo: l.line_no, itemId: l.item_id, item: l.item, unit: l.unit,
        quantity: l.quantity,
        /* Null is a real answer and it prints "-", never 0. */
        unitPrice: l.unit_price,
        receivedQuantity: l.received_quantity,
        receivedUnitCost: l.received_unit_cost,
        note: l.note,
      })),
    };
  });

  if (!body) return c.json({ error: "No such request." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

/* ── Who may raise one (D18-2) ─────────────────────────────────────
   The setting the owner asked for: changeable at any time, without a
   deploy. A ROLE and not a person, because staff leave.
   ═══════════════════════════════════════════════════════════════════ */

purchasing.get("/:code/purchasing/requesters", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, VIEW_ROLES))) {
      return forbid(PURCHASING_REFUSED.view);
    }

    /* Every role a person can be given, and whether this property lets it
       raise a request. The whole list, because the screen is a set of
       switches and a switch that is off still has to be shown. */
    const { rows } = await client.query<{ role: string; is_active: boolean }>(
      `select r.role, coalesce(pr.is_active, false) as is_active
         from unnest(app.assignable_roles()) as r(role)
         left join purchase_requesters pr
                on pr.hotel_id = $1 and pr.role = r.role
        where r.role <> 'automation'
        order by r.role`, [hotelId]);

    return {
      mayChange: await hasRoleAt(client, hotelId, SETTING_KEEPERS),
      roles: rows.map((r) => ({ role: r.role, mayRaise: r.is_active })),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

purchasing.put("/:code/purchasing/requesters/:role", async (c) => {
  type Body = { mayRaise?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  if (typeof input.mayRaise !== "boolean") {
    return c.json(refuse("Say whether this role may raise a request, or may not."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* ⚠ ABOVE THE FIRST WRITE (MEMORY 243). */
    if (!(await hasRoleAt(client, hotelId, SETTING_KEEPERS))) {
      return forbid(PURCHASING_REFUSED.setting);
    }

    const role = c.req.param("role");
    const { rows: known } = await client.query<{ ok: boolean }>(
      "select $1 = any (app.assignable_roles()) and $1 <> 'automation' as ok", [role]);
    if (!known[0]?.ok) return refuse("That is not a role a person can be given.");

    /* Switched off, never deleted: who was allowed to buy things last
       March is part of the record of what was bought. */
    await client.query(
      `insert into purchase_requesters (hotel_id, role, is_active, set_by)
       values ($1, $2, $3, app.current_user_id())
       on conflict (hotel_id, role) do update
          set is_active = excluded.is_active,
              set_by = excluded.set_by,
              set_at = now()`,
      [hotelId, role, input.mayRaise]);

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Raising one ───────────────────────────────────────────────────── */

purchasing.post("/:code/purchasing/requests", async (c) => {
  type Line = { itemId?: string; quantity?: number; unitPrice?: number | null;
                 unitPriceFree?: boolean; note?: string };
  type Body = { storeId?: string; reason?: string; lines?: Line[] };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const reason = input.reason?.trim();
  if (!input.storeId) return c.json(refuse("Which store is this for?"), 409);
  if (!reason) {
    return c.json(refuse(
      "Say what this is for. Whoever approves it has to know what they are "
      + "approving."), 409);
  }
  const lines = input.lines ?? [];
  if (lines.length === 0) return c.json(refuse("What is being asked for?"), 409);

  for (const l of lines) {
    if (!l.itemId) return c.json(refuse("Every line names an item."), 409);
    const q = Number(l.quantity);
    if (!Number.isFinite(q) || q <= 0) {
      return c.json(refuse("How much of it? A line for nothing is not a line."), 409);
    }
    if (l.unitPrice !== undefined && l.unitPrice !== null
        && (!Number.isFinite(Number(l.unitPrice)) || Number(l.unitPrice) < 0)) {
      return c.json(refuse("A price is zero or more, or nothing at all."), 409);
    }
    /* ST-2, X-1 (D27-120): a ₹0 line went to the GM and was approved. */
    const zeroLine = priceProblem(l.unitPrice === null || l.unitPrice === undefined
      ? null : Number(l.unitPrice), l.unitPriceFree === true);
    if (zeroLine) return c.json(refuse(zeroLine), 409);
  }
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) {
    return c.json(refuse(
      "The same item is on this request twice. Put it on one line."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* ⚠ THE SETTING, ASKED BEFORE THE FIRST WRITE (MEMORY 243). */
    if (!(await mayRaise(client, hotelId))) return forbid(PURCHASING_REFUSED.raise);

    try {
      const { rows: ref } = await client.query<{ reference: string }>(
        "select app.next_purchase_reference($1) as reference", [hotelId]);

      const { rows: made } = await client.query<{ id: string }>(
        `insert into purchase_requests
           (hotel_id, reference, store_id, reason, requested_by)
         values ($1,$2,$3,$4,$5) returning id::text`,
        [hotelId, ref[0]!.reference, input.storeId, reason, session.staffId]);
      const id = made[0]!.id;

      for (const [i, l] of lines.entries()) {
        await client.query(
          `insert into purchase_request_lines
             (hotel_id, request_id, line_no, item_id, quantity, unit_price, note)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [hotelId, id, i + 1, l.itemId, l.quantity,
           l.unitPrice === undefined || l.unitPrice === null ? null : l.unitPrice,
           l.note?.trim() || null]);
      }

      /* THE AMOUNT THE APPROVER SEES, or nothing. Null where a line has
         no agreed price: a part total shown as the whole is exactly the
         invented figure this project refuses. */
      const { rows: sum } = await client.query<{ amount: string | null }>(
        `select case when count(*) filter (where unit_price is null) > 0 then null
                     else sum(quantity * unit_price) end::text as amount
           from purchase_request_lines where request_id = $1`, [id]);

      /* The ONE approvals engine (076). It returns null when no rule
         calls for an approval, which means proceed - so a property whose
         rule somebody switched off can still buy nails. */
      const { rows: ap } = await client.query<{ id: string | null }>(
        `select app.request_approval($1::uuid, 'purchase', 'purchase_requests',
                                     $2::uuid, $3::text, $4::numeric, $5::uuid) as id`,
        [hotelId, id, reason, sum[0]!.amount, session.staffId]);

      if (ap[0]?.id) {
        await client.query(
          "update purchase_requests set approval_id = $1 where id = $2",
          [ap[0].id, id]);
      }

      const { rows } = await client.query<RequestRow>(
        `${REQUEST_SELECT} where r.id = $1`, [id]);
      return { ok: true as const, request: asRequest(rows[0]!) };
    } catch (err) {
      /* A throw ROLLS BACK; a returned refusal would not (MEMORY 243).
         So anything the database refuses is re-thrown after its sentence
         is read, and nothing half-written is kept. */
      const sentence = said(err);
      if (sentence) throw Object.assign(new Error(sentence), { refusal: sentence });
      throw err;
    }
  }).catch((err: unknown) => {
    const sentence = (err as { refusal?: string }).refusal;
    if (sentence) return refuse(sentence);
    throw err;
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Pricing a line ────────────────────────────────────────────────
   Before the order goes out, and only then: what a supplier was told
   they would be paid does not change afterwards.
   ═══════════════════════════════════════════════════════════════════ */

purchasing.put("/:code/purchasing/requests/:id/lines/:lineId", async (c) => {
  type Body = { unitPrice?: number | null; free?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const price = input.unitPrice;
  if (price !== null && (price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0)) {
    return c.json(refuse("A price is zero or more, or nothing at all."), 409);
  }
  const zero = priceProblem(price === null ? null : Number(price), input.free === true);  /* X-1 */
  if (zero) return c.json(refuse(zero), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayRaise(client, hotelId))) return forbid(PURCHASING_REFUSED.raise);

    const { rows } = await client.query<{ status: string }>(
      `select r.status from purchase_requests r
         join purchase_request_lines pl on pl.request_id = r.id
        where r.hotel_id = $1 and r.id = $2 and pl.id = $3`,
      [hotelId, c.req.param("id"), c.req.param("lineId")]);
    if (!rows[0]) return refuse("No such line on that request.");
    if (rows[0].status !== "requested") {
      return refuse(
        "This order has already gone to the supplier. What they were told they "
        + "would be paid does not change afterwards.");
    }

    await client.query(
      "update purchase_request_lines set unit_price = $1 where id = $2",
      [price ?? null, c.req.param("lineId")]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Sending it to a supplier (D18-3) ──────────────────────────────── */

purchasing.post("/:code/purchasing/requests/:id/order", async (c) => {
  type Body = { supplierId?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!input.supplierId) return c.json(refuse("Who is this ordered from?"), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayRaise(client, hotelId))) return forbid(PURCHASING_REFUSED.raise);

    const { rows: here } = await client.query<{ id: string }>(
      "select id::text from purchase_requests where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id")]);
    if (!here[0]) return refuse("No such request.");

    try {
      await client.query(
        "select app.mark_purchase_ordered($1::uuid, $2::uuid, $3::uuid)",
        [c.req.param("id"), input.supplierId, session.staffId]);
    } catch (err) {
      const sentence = said(err);
      if (sentence) throw Object.assign(new Error(sentence), { refusal: sentence });
      throw err;
    }

    const { rows } = await client.query<RequestRow>(
      `${REQUEST_SELECT} where r.id = $1`, [c.req.param("id")]);
    return { ok: true as const, request: asRequest(rows[0]!) };
  }).catch((err: unknown) => {
    const sentence = (err as { refusal?: string }).refusal;
    if (sentence) return refuse(sentence);
    throw err;
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

purchasing.post("/:code/purchasing/requests/:id/cancel", async (c) => {
  type Body = { reason?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse(
      "Say why this is cancelled. Whoever asked for it has to know what to do "
      + "next."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayRaise(client, hotelId))) return forbid(PURCHASING_REFUSED.raise);

    const { rows } = await client.query<{ status: string }>(
      "select status from purchase_requests where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id")]);
    if (!rows[0]) return refuse("No such request.");
    if (rows[0].status === "received") {
      return refuse("This has already been delivered. It cannot be cancelled.");
    }
    if (rows[0].status === "cancelled") return refuse("That was already cancelled.");

    await client.query(
      `update purchase_requests
          set status = 'cancelled', cancelled_at = now(),
              cancelled_by = $1, cancelled_reason = $2
        where id = $3`,
      [session.staffId, reason, c.req.param("id")]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── The delivery ──────────────────────────────────────────────────
   What was ordered and what came MAY DIFFER, and both stay on the
   record. The stock itself is written by the STORE, through its own
   front door — this service never writes `stock_movements`.
   ═══════════════════════════════════════════════════════════════════ */

purchasing.post("/:code/purchasing/requests/:id/delivery", async (c) => {
  type Body = {
    note?: string;
    lines?: {
      lineId?: string; receivedQuantity?: number; receivedUnitCost?: number | null;
      /** The bill's GST for the line, all three or none, and its expiry (D27-238). */
      gstRate?: number | null; gstAmount?: number | null; gstClaimable?: boolean | null;
      expiresOn?: string | null;
    }[];
    /** On credit: the supplier's bill - number, date, amount, due date (D27-370). */
    credit?: CreditIn | null;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const lines = input.lines ?? [];
  if (lines.length === 0) return c.json(refuse("What came?"), 409);
  const credit = input.credit ?? null;
  const creditWrong = credit && creditProblem(credit);
  if (creditWrong) return c.json(refuse(creditWrong), 409);

  for (const l of lines) {
    if (!l.lineId) return c.json(refuse("Every line says which item it is."), 409);
    const q = Number(l.receivedQuantity);
    if (!Number.isFinite(q) || q < 0) {
      return c.json(refuse(
        "How much of each came? Nothing at all is 0, and it stays on the "
        + "record beside what was ordered."), 409);
    }
    if (l.receivedUnitCost !== undefined && l.receivedUnitCost !== null
        && (!Number.isFinite(Number(l.receivedUnitCost)) || Number(l.receivedUnitCost) < 0)) {
      return c.json(refuse("A cost is zero or more, or nothing at all."), 409);
    }
    /* The Store's own check, before anything is written (MEMORY 243). */
    const facts = deliveryFactsProblem(l);
    if (facts) return c.json(refuse(facts), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      status: string; store_id: string; reference: string; supplier: string | null; supplier_id: string | null;
    }>(
      `select r.status, r.store_id::text, r.reference, sup.name as supplier, r.supplier_id::text
         from purchase_requests r
         left join suppliers sup on sup.id = r.supplier_id
        where r.hotel_id = $1 and r.id = $2`,
      [hotelId, c.req.param("id")]);
    const order = rows[0];
    if (!order) return refuse("No such request.");
    if (order.status !== "ordered") {
      return refuse(
        `A delivery is received against an order that has been sent. This one `
        + `is ${STATE_WORDS[stateOf(order.status, null)].toLowerCase()}.`);
    }

    /* ⚠ ASKED ONCE, FOR THE WHOLE DELIVERY, AND BEFORE THE FIRST WRITE.
       Putting stock on a shelf is the Store's rule, so the Store answers
       it; and a refusal returned after the first line was written would
       be a COMMIT of half a delivery (MEMORY 243). */
    const refusal = await mayDeliverInto(client, hotelId, order.store_id);
    if (refusal) return forbid(refusal);
    if (credit) {
      if (!order.supplier) return refuse("This order names no supplier, so its bill cannot be put on credit.");
      if (credit.billDate! > await hotelToday(client, hotelId)) return refuse("A bill is not dated in the future.");
    }

    const known = new Map<string, { itemId: string }>();
    const { rows: mine } = await client.query<{ id: string; item_id: string }>(
      "select id::text, item_id::text from purchase_request_lines where request_id = $1",
      [c.req.param("id")]);
    for (const l of mine) known.set(l.id, { itemId: l.item_id });
    for (const l of lines) {
      if (!known.has(l.lineId!)) return refuse("That line is not on this order.");
    }
    /* ⚠ AND EACH LINE ONLY ONCE (19 September, found by audit). This checked
       that every line BELONGED to the order and not that it appeared once.
       Send the same lineId twice and the loop below ran twice for it: the
       `received_quantity` update is idempotent and recorded 40, while
       `receiveIntoStore` wrote TWO receipts - the store showing 80 kg of rice
       against an order whose own record says 40 came. Nothing refused it, so
       it committed, and the stock ledger is append-only: undoing it needs a
       reversing movement and somebody noticing first.

       Refused here, ABOVE the first write, because a refusal returned inside
       `withSession` after a write is a commit (MEMORY 243). */
    const seen = new Set<string>();
    for (const l of lines) {
      if (seen.has(l.lineId!)) {
        return refuse("That line is on this delivery twice. Put the whole "
          + "quantity received on one line.");
      }
      seen.add(l.lineId!);
    }

    const received: { item: string; quantity: number; store: string; onHandHere: number }[] = [];

    for (const l of lines) {
      const qty = Number(l.receivedQuantity);
      const cost = l.receivedUnitCost === undefined || l.receivedUnitCost === null
        ? null : Number(l.receivedUnitCost);

      /* BOTH FIGURES STAY. `quantity` is what was ordered and is never
         written over; this is what turned up beside it. */
      const gst = l.gstRate === undefined || l.gstRate === null ? null : l;
      await client.query(
        `update purchase_request_lines
            set received_quantity = $1, received_unit_cost = $2,
                gst_rate = $4, gst_amount = $5, gst_claimable = $6, expires_on = $7::date
          where id = $3`,
        [qty, cost, l.lineId, gst?.gstRate ?? null, gst?.gstAmount ?? null,
         gst?.gstClaimable ?? null, l.expiresOn || null]);

      /* Nothing came of this one: recorded as 0 above, and no movement -
         a receipt of nothing is not a receipt. */
      if (qty === 0) continue;

      const put = await receiveIntoStore(client, hotelId, session.staffId, {
        itemId: known.get(l.lineId!)!.itemId,
        storeId: order.store_id,
        quantity: qty,
        unitCost: cost,
        supplier: order.supplier,
        reference: order.reference,
        gstRate: gst?.gstRate ?? null, gstAmount: gst?.gstAmount ?? null,
        gstClaimable: gst?.gstClaimable ?? null, expiresOn: l.expiresOn || null,
      });
      /* Everything that can refuse a whole delivery was asked above, so
         a refusal here is a fault, not a decision. THROWN, so the
         transaction rolls back rather than keeping half of it. */
      if (!put.ok) throw new Error(`The Store refused a line of ${order.reference}: ${put.reason}`);
      received.push({
        item: put.item, quantity: qty, store: put.store, onHandHere: put.onHandHere,
      });
    }

    try {
      await client.query(
        "select app.mark_purchase_received($1::uuid, $2::uuid, $3::text)",
        [c.req.param("id"), session.staffId, input.note ?? null]);
    } catch (err) {
      const sentence = said(err);
      if (sentence) throw Object.assign(new Error(sentence), { refusal: sentence });
      throw err;
    }

    /* On credit: the supplier's bill goes on the Supplier dues (D27-370). */
    if (credit) {
      await recordCredit(client, {
        hotelId, staffId: session.staffId, supplier: order.supplier!, supplierId: order.supplier_id,
        credit: credit as Required<CreditIn>, purchaseRequestId: c.req.param("id"),
      });
    }

    return { ok: true as const, received };
  }).catch((err: unknown) => {
    const sentence = (err as { refusal?: string }).refusal;
    if (sentence) return refuse(sentence);
    throw err;
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── The order, as a PDF in the group's layout (D18-3) ─────────────
   Made by the SHARED renderer. Held to a file name in the path for the
   reason reportFiles.ts gives: a bare `:file` would swallow the routes
   above it.
   ═══════════════════════════════════════════════════════════════════ */

purchasing.get("/:code/purchasing/orders/:file{[0-9a-f-]+\\.pdf}", async (c) => {
  const id = c.req.param("file").replace(/\.pdf$/, "");

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return { status: 404 as const, error: "No such property." };
    if (!(await hasRoleAt(client, hotelId, VIEW_ROLES))) {
      return { status: 403 as const, error: PURCHASING_REFUSED.view };
    }

    /* Its own query rather than the list's: a document says different
       things (the supplier's address, the property's GSTIN) and reads
       its dates in the PROPERTY's time zone, never the server's
       (MEMORY 297, migration 113). */
    const { rows } = await client.query<{
      reference: string; reason: string; store: string;
      supplier: string | null; sup_contact: string | null; sup_phone: string | null;
      sup_email: string | null; sup_gstin: string | null; sup_address: string | null;
      requested_by_name: string | null; decided_by_name: string | null;
      ordered_on: string | null; today: string;
      hotel_code: string; hotel_name: string;
      hotel_address: string | null; hotel_gstin: string | null; hotel_tz: string;
      hotel_test: boolean;
    }>(
      `select r.reference, r.reason, l.name as store,
              sup.name as supplier, sup.contact as sup_contact, sup.phone as sup_phone,
              sup.email as sup_email, sup.gstin as sup_gstin, sup.address as sup_address,
              app.colleague_name(r.requested_by, r.hotel_id) as requested_by_name,
              app.colleague_name(a.decided_by, r.hotel_id) as decided_by_name,
              app.hotel_day(r.hotel_id, r.ordered_at)::text as ordered_on,
              app.hotel_day(r.hotel_id, now())::text as today,
              h.code as hotel_code, h.name as hotel_name,
              h.address_line as hotel_address, h.gstin as hotel_gstin,
              h.test_of is not null as hotel_test,
              h.timezone as hotel_tz
         from purchase_requests r
         join hotels h on h.id = r.hotel_id
         join locations l on l.id = r.store_id
         left join suppliers sup on sup.id = r.supplier_id
         left join approvals a on a.id = r.approval_id
        where r.hotel_id = $1 and r.id = $2`,
      [hotelId, id]);
    const r = rows[0];
    if (!r) return { status: 404 as const, error: "No such order." };

    const { rows: lines } = await client.query<{
      line_no: number; item: string; unit: string;
      quantity: string; unit_price: string | null;
    }>(
      `select pl.line_no, i.name as item, i.unit, pl.quantity::text, pl.unit_price::text
         from purchase_request_lines pl
         join stock_items i on i.id = pl.item_id
        where pl.request_id = $1 order by pl.line_no`, [id]);

    const { rows: me } = await client.query<{ name: string }>(
      "select full_name as name from staff where id = app.current_user_id()");

    const doc = orderDocument({
      reference: r.reference,
      date: r.ordered_on ?? r.today,
      supplier: r.supplier
        ? {
            name: r.supplier, contact: r.sup_contact, phone: r.sup_phone,
            email: r.sup_email, gstin: r.sup_gstin, address: r.sup_address,
          }
        : null,
      deliverTo: r.store,
      raisedBy: r.requested_by_name,
      approvedBy: r.decided_by_name,
      reason: r.reason,
      property: {
        code: r.hotel_code, name: r.hotel_name, address: r.hotel_address,
        gstin: r.hotel_gstin, timezone: r.hotel_tz,
        /* D27-296: a test hotel's order is marked TEST · NOT VALID. */
        ...(r.hotel_test ? { test: true } : {}),
      },
      lines: lines.map((l): OrderLine => ({
        lineNo: l.line_no, item: l.item, unit: l.unit,
        quantity: Number(l.quantity),
        unitPrice: l.unit_price === null ? null : Number(l.unit_price),
      })),
    });

    return {
      status: 200 as const, doc, reference: r.reference,
      by: { name: me[0]?.name ?? "-", at: new Date(), timezone: r.hotel_tz },
    };
  });

  if (result.status !== 200) return c.json({ error: result.error }, result.status);

  const body = await renderPdf(result.doc, result.by);
  return c.body(new Uint8Array(body), 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${result.reference}.pdf"`,
  });
});
