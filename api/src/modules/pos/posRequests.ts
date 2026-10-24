import type { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession, type Session } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import { discountOrder, discountProblem, noChargeBill, strikeLine, voidBill } from "./till.ts";

/* ══════════════════════════════════════════════════════════════════
   A WAITER'S REQUEST TO THE GM (the owner's D27-363, 25 October)

   "If somebody sends it for approval, the GM approves it from his side."
   A waiter or cashier may not strike a dish the kitchen has, give a
   discount, give a bill free (NC) or void a paid bill; until now they were
   refused and the GM had to come to the same screen. Now they SEND it, with
   a reason: a pos_requests row (237) and an approval (kind 'pos_request')
   in the GM's inbox and bell. The GM, the owner or an Admin approves -
   never the one who asked - and approving DOES it, as them, through the
   very functions the till's own buttons use (till.ts), so every check of
   the till is asked again at that moment: the dish still on the bill, the
   bill still open, the day still open, the discount under its cap. A
   refusal then leaves the request waiting and says why. Rejected, the
   waiter's screen says why.

   POST /:code/till/orders/:id/requests
        { kind: strike_line | discount | no_charge | void_bill, reason,
          lineId?, type?, value?, reference? }

   Registered on the till's router by till.ts, as the KOT section is.
   ══════════════════════════════════════════════════════════════════ */

type App = Hono<{ Variables: { subject: string } }>;
type HotelFor = (client: Client, code: string) => Promise<string | null>;
type Act = { ok: true } | { ok: false; reason: string };

const refuse = (reason: string) => ({ ok: false as const, reason });
const KINDS = ["strike_line", "discount", "no_charge", "void_bill"] as const;
type Kind = typeof KINDS[number];
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function registerPosRequests(till: App, hotelFor: HotelFor): void {
  till.post("/:code/till/orders/:id/requests", async (c) => {
    const input = await c.req.json().catch(() => ({})) as {
      kind?: unknown; reason?: unknown; lineId?: unknown; type?: unknown; value?: unknown; reference?: unknown;
    };
    const kind = input.kind as Kind;
    if (!(KINDS as readonly unknown[]).includes(kind)) return c.json(refuse("Ask for a strike, a discount, NC or a void."), 409);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 300) return c.json(refuse("Say why, for the GM."), 409);
    if (kind === "discount") {
      const problem = discountProblem(input.type, input.value, reason);
      if (problem) return c.json(refuse(problem), 409);
    }
    if (kind === "strike_line" && !(typeof input.lineId === "string" && /^\d+$/.test(input.lineId))) {
      return c.json(refuse("Which dish?"), 409);
    }
    const reference = typeof input.reference === "string" && input.reference.trim() ? input.reference.trim().slice(0, 60) : null;

    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const orderId = c.req.param("id");
      const { rows: [o] } = await client.query<{
        id: string; status: string; order_no: string; table_ref: string | null; business_date: string;
        payment_method: string | null; payable: string; other_paid: boolean;
      }>(
        `select o.id::text, o.status, o.order_no, o.table_ref, o.business_date::text, o.payment_method,
                (select payable from app.pos_order_total(o.id))::text as payable,
                exists (select 1 from pos_order_tenders t where t.order_id = o.id and t.method <> 'cash') as other_paid
           from pos_orders o where o.id::text = $1 and o.hotel_id = $2`,
        [orderId, hotelId]);
      if (!o) return refuse("No such order.");
      const where = `${o.table_ref ?? "no table"} · bill ${o.order_no}`;
      let summary = "";
      let amount: number | null = Number(o.payable);
      let lineId: string | null = null;
      const details: Record<string, unknown> = {};

      if (kind === "void_bill") {
        if (o.status !== "settled") return refuse("Only a paid bill is voided.");
        if (o.payment_method === "room" || o.payment_method === "function") {
          return refuse("This bill went to a guest's or a function's bill: it is reversed there.");
        }
        if (o.business_date !== await businessDateFor(client, hotelId)) {
          return refuse("Only a bill of today's business day can be voided.");
        }
        if (o.other_paid && !reference) return refuse("Give the refund's reference: the UPI reference or the card approval.");
        details["reference"] = reference;
        summary = `Void the paid bill, ${rupees(amount)} - ${where}`;
      } else {
        if (o.status !== "open") return refuse(`This bill is already ${o.status}.`);
        if (kind === "strike_line") {
          const { rows: [l] } = await client.query<{ name: string; qty: string; kot_no: number | null; sent: boolean; value: string }>(
            `select name, qty::text, kot_no, kot_status <> 'pending' as sent, (qty * unit_price)::text as value
               from pos_order_lines where id = $1 and order_id = $2 and not voided`,
            [input.lineId, o.id]);
          if (!l) return refuse("That dish is already struck, or is not on this bill.");
          if (!l.sent) return refuse("The kitchen does not have this yet: take it off yourself.");
          lineId = input.lineId as string;
          amount = Number(l.value);
          summary = `Strike ${Number(l.qty)} x ${l.name}${l.kot_no ? ` (KOT ${l.kot_no})` : ""} - ${where}`;
        } else if (kind === "discount") {
          const value = Number(input.value);
          details["type"] = input.type;
          details["value"] = value;
          amount = input.type === "fixed" ? value : null;
          summary = `Discount ${input.type === "percent" ? `${value}%` : rupees(value)} on ${rupees(Number(o.payable))} - ${where}`;
        } else {
          summary = `NC, the bill free: ${rupees(Number(o.payable))} - ${where}`;
        }
      }

      const { rows: [dup] } = await client.query(
        `select 1 from pos_requests where order_id = $1 and kind = $2 and status = 'pending'
            and line_id is not distinct from $3::bigint`, [o.id, kind, lineId]);
      if (dup) return refuse("This is already with the GM.");
      /* Somebody must be there to decide, or nothing is written (MEMORY 243). */
      const { rows: [rule] } = await client.query(
        "select 1 from approval_rules where hotel_id = $1 and kind = 'pos_request' and is_active", [hotelId]);
      if (!rule) return refuse("Nobody is set to approve these at this hotel. Call the GM.");

      const { rows: [r] } = await client.query<{ id: string }>(
        `insert into pos_requests (hotel_id, order_id, line_id, kind, details, summary, reason, requested_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text`,
        [hotelId, o.id, lineId, kind, JSON.stringify(details), summary, reason, session.staffId]);
      const { rows: [a] } = await client.query<{ id: string | null }>(
        "select app.request_approval($1, 'pos_request', 'pos_requests', $2::uuid, $3, $4, $5)::text as id",
        [hotelId, r!.id, `${summary}. Why: ${reason}`, amount, session.staffId]);
      if (!a?.id) throw new Error("A request was written with no approval: the rule went away under it.");
      await client.query("update pos_requests set approval_id = $2 where id = $1", [r!.id, a.id]);
      return { ok: true as const, id: r!.id };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });
}

/** The request behind an approval, done as the approver (routes/approvals.ts
    calls this through the service's front door before it marks the approval
    approved). A refusal leaves both waiting. */
export async function performPosRequest(client: Client, session: Session, hotelId: string, requestId: string): Promise<Act> {
  const { rows: [r] } = await client.query<{
    order_id: string; line_id: string | null; kind: Kind; details: Record<string, unknown>; reason: string; status: string;
  }>(
    `select order_id::text, line_id::text, kind, details, reason, status
       from pos_requests where id::text = $1 and hotel_id = $2 for update`, [requestId, hotelId]);
  if (!r) return refuse("No such request.");
  if (r.status !== "pending") return refuse(`This request was ${r.status} already.`);
  const why = `${r.reason} (asked, approved)`;
  let done: Act;
  if (r.kind === "strike_line") {
    done = await strikeLine(client, session, hotelId, r.order_id, r.line_id!, why);
  } else if (r.kind === "discount") {
    const problem = discountProblem(r.details["type"], r.details["value"], why);
    done = problem ? refuse(problem)
      : await discountOrder(client, r.order_id, hotelId, r.details["type"] as "percent" | "fixed", Number(r.details["value"]), why);
  } else if (r.kind === "no_charge") {
    done = await noChargeBill(client, session, hotelId, r.order_id, why);
  } else {
    done = await voidBill(client, session, hotelId, r.order_id, why, (r.details["reference"] as string | null) ?? null);
  }
  if (!done.ok) return done;
  await client.query(
    "update pos_requests set status = 'approved', decided_by = $2, decided_at = now() where id::text = $1",
    [requestId, session.staffId]);
  return { ok: true };
}

/** The request behind an approval, rejected with the approver's note. */
export async function rejectPosRequest(client: Client, session: Session, requestId: string, note: string): Promise<void> {
  await client.query(
    `update pos_requests set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
      where id::text = $1 and status = 'pending'`,
    [requestId, session.staffId, note]);
}
