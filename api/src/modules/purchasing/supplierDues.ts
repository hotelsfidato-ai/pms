import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { DUES_ROLES, PURCHASING_REFUSED, hasRoleAt } from "./purchasingGrants.ts";

/* ══════════════════════════════════════════════════════════════════
   SUPPLIER DUES - what we owe suppliers (the owner's D27-370, 27 October)

   Goods that come on credit: the delivery (purchasing.ts) or the bar bill
   (barBills.ts) records the supplier's bill - its number, date, amount and
   due date - as a row of `supplier_bills` (246). This file lists the bills
   still owed and records a payment, which pays the bill WHOLE and takes it
   off the list. No cash drawer is touched (the owner).

   GET  /:code/purchasing/dues                 the bills still owed: DUES_ROLES
   POST /:code/purchasing/dues/:id/payment     paid: DUES_ROLES

   The Inventory Manager records the bill on a delivery but does not see the
   dues or pay them (the owner). Every refusal comes before the first write
   (MEMORY 243); the database refuses a bill paid twice (246).
   ══════════════════════════════════════════════════════════════════ */

export const supplierDues = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const forbid = (reason: string) => ({ forbidden: reason });

/** A real calendar date written YYYY-MM-DD, or false. */
export const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** The property's calendar day, not its business day: a hotel whose night
    audit is behind still receives today's bills and pays today. */
export async function hotelToday(client: Client, hotelId: string): Promise<string> {
  const { rows } = await client.query<{ today: string }>(
    "select to_char((now() at time zone timezone)::date, 'YYYY-MM-DD') as today from hotels where id = $1",
    [hotelId]);
  return rows[0]!.today;
}

/** A supplier's bill on credit. A bar bill brings its own number, date and
    amount and sends only `dueOn`. */
export interface CreditIn { billNo?: string; billDate?: string; amount?: number; dueOn?: string }

/** What is wrong with a bill on credit, in a sentence, or null. Asked before
    anything is written. */
export function creditProblem(c: CreditIn): string | null {
  if (!c.billNo?.trim()) return "Type the supplier's bill number, as printed on it.";
  if (c.billNo.trim().length > 60) return "A bill number is at most 60 characters.";
  if (!isDate(c.billDate)) return "Pick the date on the supplier's bill.";
  if (typeof c.amount !== "number" || !Number.isFinite(c.amount) || c.amount <= 0 || c.amount >= 1e10) {
    return "Type the bill's amount, as printed on it: more than zero.";
  }
  if (!isDate(c.dueOn)) return "Pick the date the bill is due.";
  if (c.dueOn < c.billDate) return "A bill is due on its own date or later, not before it.";
  return null;
}

/** The bill, written. Its caller has asked creditProblem and every refusal. */
export async function recordCredit(client: Client, row: {
  hotelId: string; staffId: string; supplier: string; credit: Required<CreditIn>;
  purchaseRequestId?: string; barPurchaseId?: string;
}): Promise<void> {
  await client.query(
    `insert into supplier_bills
       (hotel_id, purchase_request_id, bar_purchase_id, supplier, bill_no, bill_date, amount, due_on, recorded_by)
     values ($1, $2, $3, $4, $5, $6::date, $7, $8::date, $9)`,
    [row.hotelId, row.purchaseRequestId ?? null, row.barPurchaseId ?? null, row.supplier,
     row.credit.billNo.trim(), row.credit.billDate, row.credit.amount, row.credit.dueOn, row.staffId]);
}

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

supplierDues.get("/:code/purchasing/dues", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, DUES_ROLES))) return forbid(PURCHASING_REFUSED.dues);
    const { rows } = await client.query<{
      id: string; supplier: string; bill_no: string; bill_date: string; amount: string; due_on: string;
      order_id: string | null; order_ref: string | null; bar: boolean;
    }>(
      `select b.id::text, b.supplier, b.bill_no, to_char(b.bill_date, 'YYYY-MM-DD') as bill_date,
              b.amount::text, to_char(b.due_on, 'YYYY-MM-DD') as due_on,
              b.purchase_request_id::text as order_id, r.reference as order_ref,
              b.bar_purchase_id is not null as bar
         from supplier_bills b
         left join purchase_requests r on r.id = b.purchase_request_id
        where b.hotel_id = $1 and b.paid_on is null
        order by lower(b.supplier), b.due_on, b.bill_date, b.bill_no`, [hotelId]);
    return {
      today: await hotelToday(client, hotelId),
      /* Money stays a string to the wire, as everywhere in purchasing. */
      bills: rows.map((r) => ({
        id: r.id, supplier: r.supplier, billNo: r.bill_no, billDate: r.bill_date,
        amount: r.amount, dueOn: r.due_on,
        from: r.bar ? { kind: "bar" as const } : { kind: "order" as const, id: r.order_id, reference: r.order_ref },
      })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

const METHODS = ["cash", "cheque", "bank", "upi"] as const;

supplierDues.post("/:code/purchasing/dues/:id/payment", async (c) => {
  type Body = { method?: string; reference?: string | null; paidOn?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!METHODS.includes(input.method as (typeof METHODS)[number])) {
    return c.json(refuse("How was it paid? Cash, cheque, bank or UPI."), 409);
  }
  const reference = input.reference?.trim() || null;
  if (reference && reference.length > 80) return c.json(refuse("A reference is at most 80 characters."), 409);
  if (!isDate(input.paidOn)) return c.json(refuse("Pick the date it was paid."), 409);
  const paidOn = input.paidOn;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* ⚠ ABOVE THE FIRST WRITE (MEMORY 243). */
    if (!(await hasRoleAt(client, hotelId, DUES_ROLES))) return forbid(PURCHASING_REFUSED.pay);
    const { rows } = await client.query<{ bill_date: string; paid: boolean }>(
      `select to_char(bill_date, 'YYYY-MM-DD') as bill_date, paid_on is not null as paid
         from supplier_bills where hotel_id = $1 and id::text = $2`, [hotelId, c.req.param("id")]);
    const bill = rows[0];
    if (!bill) return refuse("No such bill here.");
    if (bill.paid) return refuse("This bill is already marked paid.");
    if (paidOn > await hotelToday(client, hotelId)) return refuse("A payment is not dated in the future.");
    if (paidOn < bill.bill_date) return refuse("A payment is not dated before the bill it pays.");

    await client.query(
      `update supplier_bills
          set paid_on = $1::date, paid_method = $2, paid_reference = $3, paid_by = $4, paid_at = now()
        where hotel_id = $5 and id::text = $6`,
      [paidOn, input.method, reference, session.staffId, hotelId, c.req.param("id")]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});
