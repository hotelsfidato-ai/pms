import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { DUES_ROLES, PURCHASING_REFUSED, hasRoleAt } from "./purchasingGrants.ts";

/* ══════════════════════════════════════════════════════════════════
   SUPPLIER DUES - what we owe suppliers (the owner's D27-370, 27 October;
   the follow-ups D27-372, 28 October)

   Goods that come on credit: the delivery (purchasing.ts) or the bar bill
   (barBills.ts) records the supplier's bill - its number, date, amount and
   due date - as a row of `supplier_bills` (246). Against a bill (249):
   payments, any part of what is left, each with its method, reference
   (required unless cash), who handed over the money, and the TDS the
   Accountant deducted; credit notes, against the bill or the supplier; and
   reversals, with a reason, of a wrong bill, payment or credit note. Nothing
   is edited or deleted. No cash drawer is touched (the owner).

   GET  /:code/purchasing/dues[?all=1]          owed (all=1: settled too): DUES_ROLES
   POST /:code/purchasing/dues/:id/payment      a payment: DUES_ROLES
   POST /:code/purchasing/dues/credit-notes     a credit note: DUES_ROLES
   POST /:code/purchasing/dues/reverse          a reversal: DUES_ROLES

   The Inventory Manager records the bill on a delivery but does not see the
   dues or pay them (the owner). Every refusal comes before the first write
   (MEMORY 243); the database refuses a bill settled past its amount and a
   bill reversed while a payment on it stands (249).
   ══════════════════════════════════════════════════════════════════ */

export const supplierDues = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const forbid = (reason: string) => ({ forbidden: reason });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A real calendar date written YYYY-MM-DD, or false. */
export const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** Money as typed: more than zero, at most two decimals. */
const isMoney = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e10 && Math.round(v * 100) === v * 100;

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
  hotelId: string; staffId: string; supplier: string; supplierId: string | null; credit: Required<CreditIn>;
  purchaseRequestId?: string | null; barPurchaseId?: string | null; replacesId?: string;
}): Promise<void> {
  await client.query(
    `insert into supplier_bills
       (hotel_id, purchase_request_id, bar_purchase_id, supplier, supplier_id, bill_no, bill_date, amount,
        due_on, recorded_by, replaces_id)
     values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9::date, $10, $11)`,
    [row.hotelId, row.purchaseRequestId ?? null, row.barPurchaseId ?? null, row.supplier, row.supplierId,
     row.credit.billNo.trim(), row.credit.billDate, row.credit.amount, row.credit.dueOn, row.staffId,
     row.replacesId ?? null]);
}

/** One way a delivered order's bill differs from the order (D27-383 item 11):
    more billed than came, a price above the agreed one, a GST rate other than
    the agreed one. `billed` is the bill's figure; `against` is what came or
    what was agreed. Money and figures stay strings to the wire. */
export interface Difference {
  lineId: string; item: string; unit: string; kind: "quantity" | "price" | "gst"; billed: string; against: string;
}

/** The json of an order's differences, from app.purchase_differences (270):
    the one definition, which the payment's trigger reads too. */
const DIFFERENCES = (order: string) => `coalesce((select json_agg(json_build_object(
    'lineId', d.line_id, 'item', d.item, 'unit', d.unit, 'kind', d.kind,
    'billed', d.billed::text, 'against', d.against::text)
    order by d.line_no, array_position(array['quantity', 'price', 'gst'], d.kind))
   from app.purchase_differences(${order}) d), '[]')`;

export async function differencesOf(client: Client, requestId: string): Promise<Difference[]> {
  const { rows } = await client.query<{ d: Difference[] }>(`select ${DIFFERENCES("$1::uuid")} as d`, [requestId]);
  return rows[0]!.d;
}

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/** Live: not reversed. */
const LIVE = (alias: string, column: string) =>
  `not exists (select 1 from supplier_reversals x where x.${column} = ${alias}.id)`;

/** What is owed to a supplier now: what is left on its bills, less its live
    credit notes not against a bill. */
async function supplierOwed(client: Client, hotelId: string, supplierId: string): Promise<number> {
  const { rows } = await client.query<{ owed: string }>(
    `select coalesce((select sum(app.supplier_bill_owed(b.id)) from supplier_bills b
                       where b.hotel_id = $1 and b.supplier_id = $2), 0)
          - coalesce((select sum(n.amount) from supplier_credit_notes n
                       where n.hotel_id = $1 and n.supplier_id = $2 and n.bill_id is null
                         and ${LIVE("n", "credit_note_id")}), 0) as owed`,
    [hotelId, supplierId]);
  return Number(rows[0]!.owed);
}

/* A refusal the database makes (249's triggers) under a race the checks
   above it could not see: said in its own sentence, not as a fault. */
const dbRefusal = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  if (e.code === "23514" && e.message && !e.message.includes("violates")) return refuse(e.message);
  throw err;
};

/* ── The dues ─────────────────────────────────────────────────────── */

supplierDues.get("/:code/purchasing/dues", async (c) => {
  const all = c.req.query("all") === "1";
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, DUES_ROLES))) return forbid(PURCHASING_REFUSED.dues);
    const { rows } = await client.query<{
      id: string; supplier_id: string | null; supplier: string; bill_no: string; bill_date: string;
      amount: string; due_on: string; owed: string; order_id: string | null; order_ref: string | null;
      bar: boolean; replaces: string | null;
      differences: Difference[];
      payments: { id: string; paidOn: string; method: string; reference: string | null; amount: string;
                  tdsSection: string | null; tdsRate: string | null; tdsAmount: string | null;
                  handedOverBy: string | null; recordedBy: string | null; differencesSeenBy: string | null;
                  reversed: { on: string; reason: string } | null }[];
      notes: { id: string; noteNo: string; noteDate: string; amount: string; issuedBy: string; reason: string;
               reversed: { on: string; reason: string } | null }[];
    }>(
      `select b.id::text, b.supplier_id::text, coalesce(s.name, b.supplier) as supplier, b.bill_no,
              to_char(b.bill_date, 'YYYY-MM-DD') as bill_date, b.amount::text,
              to_char(b.due_on, 'YYYY-MM-DD') as due_on, app.supplier_bill_owed(b.id)::text as owed,
              b.purchase_request_id::text as order_id, r.reference as order_ref,
              b.bar_purchase_id is not null as bar,
              (select o.bill_no from supplier_bills o where o.id = b.replaces_id) as replaces,
              ${DIFFERENCES("b.purchase_request_id")} as differences,
              coalesce((select json_agg(json_build_object(
                  'id', p.id, 'paidOn', to_char(p.paid_on, 'YYYY-MM-DD'), 'method', p.method,
                  'reference', p.reference, 'amount', p.amount::text, 'tdsSection', p.tds_section,
                  'tdsRate', p.tds_rate::text, 'tdsAmount', p.tds_amount::text,
                  'handedOverBy', p.handed_over_by, 'recordedBy', app.colleague_name(p.recorded_by, p.hotel_id),
                  'differencesSeenBy', app.colleague_name(p.differences_seen_by, p.hotel_id),
                  'reversed', (select json_build_object('on', to_char(x.reversed_on, 'YYYY-MM-DD'), 'reason', x.reason)
                                 from supplier_reversals x where x.payment_id = p.id))
                  order by p.paid_on, p.recorded_at)
                 from supplier_payments p where p.bill_id = b.id), '[]') as payments,
              coalesce((select json_agg(json_build_object(
                  'id', n.id, 'noteNo', n.note_no, 'noteDate', to_char(n.note_date, 'YYYY-MM-DD'),
                  'amount', n.amount::text, 'issuedBy', n.issued_by, 'reason', n.reason,
                  'reversed', (select json_build_object('on', to_char(x.reversed_on, 'YYYY-MM-DD'), 'reason', x.reason)
                                 from supplier_reversals x where x.credit_note_id = n.id))
                  order by n.note_date, n.recorded_at)
                 from supplier_credit_notes n where n.bill_id = b.id), '[]') as notes
         from supplier_bills b
         left join suppliers s on s.id = b.supplier_id
         left join purchase_requests r on r.id = b.purchase_request_id
        where b.hotel_id = $1 and ${LIVE("b", "bill_id")}
          and ($2 or app.supplier_bill_owed(b.id) > 0)
        order by lower(coalesce(s.name, b.supplier)), b.due_on, b.bill_date, b.bill_no
        limit 500`, [hotelId, all]);

    /* Credit notes against the supplier, not a bill: they lower its total. */
    const { rows: credits } = await client.query<{
      id: string; supplier_id: string; supplier: string; note_no: string; note_date: string;
      amount: string; issued_by: string; reason: string;
    }>(
      `select n.id::text, n.supplier_id::text, s.name as supplier, n.note_no,
              to_char(n.note_date, 'YYYY-MM-DD') as note_date, n.amount::text, n.issued_by, n.reason
         from supplier_credit_notes n join suppliers s on s.id = n.supplier_id
        where n.hotel_id = $1 and n.bill_id is null and ${LIVE("n", "credit_note_id")}
        order by n.note_date, n.recorded_at`, [hotelId]);

    const { rows: suppliers } = await client.query<{ id: string; name: string }>(
      "select id::text, name from suppliers where hotel_id = $1 and is_active order by name", [hotelId]);

    /* Money stays a string to the wire, as everywhere in purchasing. */
    const live = <T extends { reversed: unknown }>(list: T[]) => list.filter((x) => !x.reversed);
    return {
      today: await hotelToday(client, hotelId),
      suppliers,
      bills: rows.map((r) => {
        const paid = live(r.payments).reduce((s, p) => s + Number(p.amount), 0);
        const tds = live(r.payments).reduce((s, p) => s + Number(p.tdsAmount ?? 0), 0);
        const credited = live(r.notes).reduce((s, n) => s + Number(n.amount), 0);
        const owed = Number(r.owed);
        return {
          id: r.id, supplierId: r.supplier_id, supplier: r.supplier, billNo: r.bill_no, billDate: r.bill_date,
          amount: r.amount, dueOn: r.due_on, owed: r.owed,
          paid: paid.toFixed(2), tds: tds.toFixed(2), credited: credited.toFixed(2),
          status: owed === 0 ? "paid" as const : owed < Number(r.amount) ? "part-paid" as const : "unpaid" as const,
          replaces: r.replaces,
          from: r.bar ? { kind: "bar" as const } : { kind: "order" as const, id: r.order_id, reference: r.order_ref },
          /* Where the bill differs from its order (D27-383 item 11): paying it
             asks whoever pays to confirm they have seen these. */
          differences: r.differences,
          payments: r.payments.map((p) => ({
            id: p.id, paidOn: p.paidOn, method: p.method, reference: p.reference, amount: p.amount,
            tds: p.tdsSection ? { section: p.tdsSection, rate: p.tdsRate, amount: p.tdsAmount } : null,
            handedOverBy: p.handedOverBy, recordedBy: p.recordedBy, differencesSeenBy: p.differencesSeenBy,
            reversed: p.reversed,
          })),
          creditNotes: r.notes,
        };
      }),
      credits: credits.map((n) => ({
        id: n.id, supplierId: n.supplier_id, supplier: n.supplier, noteNo: n.note_no, noteDate: n.note_date,
        amount: n.amount, issuedBy: n.issued_by, reason: n.reason,
      })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

/* ── A payment ────────────────────────────────────────────────────── */

const METHODS = ["cash", "cheque", "bank", "upi"] as const;
const SECTIONS = ["194C", "194Q", "194J", "194I"] as const;

supplierDues.post("/:code/purchasing/dues/:id/payment", async (c) => {
  type Body = { amount?: number; method?: string; reference?: string | null; paidOn?: string;
                handedOverBy?: string; tds?: { section?: string; rate?: number; amount?: number } | null;
                /** "I have seen how this bill differs from its order" (D27-383 item 11). */
                differencesSeen?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!UUID.test(c.req.param("id"))) return c.json(refuse("No such bill here."), 409);
  if (!isMoney(input.amount)) return c.json(refuse("Type the amount paid to the supplier: more than zero."), 409);
  if (!METHODS.includes(input.method as (typeof METHODS)[number])) {
    return c.json(refuse("How was it paid? Cash, cheque, bank or UPI."), 409);
  }
  const reference = input.reference?.trim() || null;
  if (!reference && input.method !== "cash") {
    return c.json(refuse("A cheque, bank or UPI payment needs its reference: the cheque or transaction number."), 409);
  }
  if (reference && reference.length > 80) return c.json(refuse("A reference is at most 80 characters."), 409);
  if (!isDate(input.paidOn)) return c.json(refuse("Pick the date it was paid."), 409);
  const handedOverBy = input.handedOverBy?.trim() ?? "";
  if (!handedOverBy) return c.json(refuse("Who handed over the money? Type their name."), 409);
  if (handedOverBy.length > 80) return c.json(refuse("A name is at most 80 characters."), 409);
  const tds = input.tds ?? null;
  if (tds) {
    if (!SECTIONS.includes(tds.section as (typeof SECTIONS)[number])) {
      return c.json(refuse("Pick the TDS section: 194C, 194Q, 194J or 194I."), 409);
    }
    if (typeof tds.rate !== "number" || !Number.isFinite(tds.rate) || tds.rate <= 0 || tds.rate > 100) {
      return c.json(refuse("Type the TDS rate in per cent: more than zero, at most 100."), 409);
    }
    if (!isMoney(tds.amount)) return c.json(refuse("Type the TDS amount deducted: more than zero."), 409);
  }
  const paidOn = input.paidOn;
  const settles = Math.round((input.amount + (tds?.amount ?? 0)) * 100) / 100;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* ⚠ ABOVE THE FIRST WRITE (MEMORY 243). */
    if (!(await hasRoleAt(client, hotelId, DUES_ROLES))) return forbid(PURCHASING_REFUSED.pay);
    const { rows } = await client.query<{ bill_date: string; reversed: boolean; owed: string; differs: number }>(
      `select to_char(bill_date, 'YYYY-MM-DD') as bill_date, exists (select 1 from supplier_reversals x where x.bill_id = b.id) as reversed,
              app.supplier_bill_owed(b.id)::text as owed,
              (select count(*)::int from app.purchase_differences(b.purchase_request_id)) as differs
         from supplier_bills b where b.hotel_id = $1 and b.id = $2`, [hotelId, c.req.param("id")]);
    const bill = rows[0];
    if (!bill) return refuse("No such bill here.");
    if (bill.reversed) return refuse("This bill was reversed; nothing more is recorded against it.");
    const owed = Number(bill.owed);
    if (owed <= 0) return refuse("Nothing is left to pay on this bill.");
    if (settles > owed) return refuse(`That is more than is left on the bill: ${rupees(owed)}, the TDS included.`);
    if (paidOn > await hotelToday(client, hotelId)) return refuse("A payment is not dated in the future.");
    if (paidOn < bill.bill_date) return refuse("A payment is not dated before the bill it pays.");
    /* THE BILL DIFFERS FROM ITS ORDER (D27-383 item 11): never refused, but
       paid only by somebody who says they have seen it - their name is kept
       on the payment. 270's trigger refuses the same. */
    if (bill.differs > 0 && input.differencesSeen !== true) {
      return refuse(`This bill differs from its order in ${bill.differs === 1 ? "one place" : `${bill.differs} places`}. `
        + "Confirm you have seen the differences, then record the payment.");
    }

    await client.query(
      `insert into supplier_payments
         (hotel_id, bill_id, paid_on, method, reference, amount, handed_over_by, tds_section, tds_rate, tds_amount,
          recorded_by, differences_seen_by)
       values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [hotelId, c.req.param("id"), paidOn, input.method, reference, input.amount, handedOverBy,
       tds?.section ?? null, tds?.rate ?? null, tds?.amount ?? null, session.staffId,
       bill.differs > 0 ? session.staffId : null]);
    return { ok: true as const, owed: (owed - settles).toFixed(2) };
  }).catch(dbRefusal);
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── A credit note, money only ────────────────────────────────────── */

supplierDues.post("/:code/purchasing/dues/credit-notes", async (c) => {
  type Body = { supplierId?: string | null; billId?: string | null; issuedBy?: string; noteNo?: string;
                noteDate?: string; amount?: number; reason?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const billId = input.billId || null;
  const supplierId = billId ? null : input.supplierId || null;
  if (billId ? !UUID.test(billId) : !supplierId || !UUID.test(supplierId)) {
    return c.json(refuse("Which supplier, or which bill, is the credit note against?"), 409);
  }
  if (input.issuedBy !== "supplier" && input.issuedBy !== "hotel") {
    return c.json(refuse("Whose credit note is it: the supplier's, or ours?"), 409);
  }
  const noteNo = input.noteNo?.trim() ?? "";
  if (!noteNo) return c.json(refuse("Type the credit note's number."), 409);
  if (noteNo.length > 60) return c.json(refuse("A credit note number is at most 60 characters."), 409);
  if (!isDate(input.noteDate)) return c.json(refuse("Pick the credit note's date."), 409);
  if (!isMoney(input.amount)) return c.json(refuse("Type the credit note's amount: more than zero."), 409);
  const reason = input.reason?.trim() ?? "";
  if (!reason) return c.json(refuse("Say what the credit note is for."), 409);
  if (reason.length > 200) return c.json(refuse("A reason is at most 200 characters."), 409);
  const noteDate = input.noteDate;
  const amount = input.amount;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* ⚠ ABOVE THE FIRST WRITE (MEMORY 243). */
    if (!(await hasRoleAt(client, hotelId, DUES_ROLES))) return forbid(PURCHASING_REFUSED.pay);
    if (noteDate > await hotelToday(client, hotelId)) return refuse("A credit note is not dated in the future.");
    let supplier = supplierId;
    if (billId) {
      const { rows } = await client.query<{ supplier_id: string | null; bill_date: string; reversed: boolean; owed: string }>(
        `select b.supplier_id::text, to_char(b.bill_date, 'YYYY-MM-DD') as bill_date,
                exists (select 1 from supplier_reversals x where x.bill_id = b.id) as reversed, app.supplier_bill_owed(b.id)::text as owed
           from supplier_bills b where b.hotel_id = $1 and b.id = $2`, [hotelId, billId]);
      const bill = rows[0];
      if (!bill) return refuse("No such bill here.");
      if (bill.reversed) return refuse("This bill was reversed; nothing more is recorded against it.");
      if (!bill.supplier_id) {
        return refuse("This bill's supplier was typed, not picked from the list: record the credit note against the supplier.");
      }
      if (noteDate < bill.bill_date) return refuse("A credit note is not dated before the bill it is against.");
      if (amount > Number(bill.owed)) return refuse(`That is more than is left on the bill: ${rupees(Number(bill.owed))}.`);
      supplier = bill.supplier_id;
    } else {
      const { rows } = await client.query("select 1 from suppliers where hotel_id = $1 and id = $2", [hotelId, supplierId]);
      if (!rows.length) return refuse("No such supplier here.");
      const owed = await supplierOwed(client, hotelId, supplierId!);
      if (amount > owed) return refuse(`That is more than is owed to this supplier: ${rupees(Math.max(owed, 0))}.`);
    }
    await client.query(
      `insert into supplier_credit_notes
         (hotel_id, supplier_id, bill_id, issued_by, note_no, note_date, amount, reason, recorded_by)
       values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)`,
      [hotelId, supplier, billId, input.issuedBy, noteNo, noteDate, amount, reason, session.staffId]);
    return { ok: true as const };
  }).catch(dbRefusal);
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── A reversal, with its reason ──────────────────────────────────── */

const KINDS = { bill: "bill_id", payment: "payment_id", "credit-note": "credit_note_id" } as const;
const TABLES = { bill: "supplier_bills", payment: "supplier_payments", "credit-note": "supplier_credit_notes" } as const;

supplierDues.post("/:code/purchasing/dues/reverse", async (c) => {
  type Body = { kind?: string; id?: string; reason?: string; correct?: CreditIn | null };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const kind = input.kind as keyof typeof KINDS;
  if (!Object.hasOwn(KINDS, kind ?? "") || !UUID.test(input.id ?? "")) return c.json(refuse("What is being reversed?"), 409);
  const reason = input.reason?.trim() ?? "";
  if (!reason) return c.json(refuse("Say why it is reversed."), 409);
  if (reason.length > 200) return c.json(refuse("A reason is at most 200 characters."), 409);
  /* A wrong bill may be followed by its right one: the same delivery or bar bill. */
  const correct = kind === "bill" ? input.correct ?? null : null;
  const wrong = correct && creditProblem(correct);
  if (wrong) return c.json(refuse(wrong), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* ⚠ ABOVE THE FIRST WRITE (MEMORY 243). */
    if (!(await hasRoleAt(client, hotelId, DUES_ROLES))) return forbid(PURCHASING_REFUSED.pay);
    const { rows } = await client.query<{ reversed: boolean }>(
      `select exists (select 1 from supplier_reversals x where x.${KINDS[kind]} = t.id) as reversed
         from ${TABLES[kind]} t where t.hotel_id = $1 and t.id = $2`, [hotelId, input.id]);
    if (!rows[0]) return refuse("Nothing like that is recorded here.");
    if (rows[0].reversed) return refuse("This was already reversed.");
    const today = await hotelToday(client, hotelId);

    type Source = { supplier: string; supplier_id: string | null; purchase_request_id: string | null;
                    bar_purchase_id: string | null };
    let bill: Source | undefined;
    if (kind === "bill") {
      const { rows: standing } = await client.query(
        `select 1 from supplier_payments p where p.bill_id = $1 and ${LIVE("p", "payment_id")}
         union all
         select 1 from supplier_credit_notes n where n.bill_id = $1 and ${LIVE("n", "credit_note_id")}`, [input.id]);
      if (standing.length) return refuse("Reverse the payments and credit notes on this bill first.");
      if (correct && correct.billDate! > today) return refuse("A bill is not dated in the future.");
      ({ rows: [bill] } = await client.query<Source>(
        `select supplier, supplier_id::text, purchase_request_id::text, bar_purchase_id::text
           from supplier_bills where id = $1`, [input.id]));
    }

    await client.query(
      `insert into supplier_reversals (hotel_id, ${KINDS[kind]}, reason, reversed_on, reversed_by)
       values ($1, $2, $3, $4::date, $5)`, [hotelId, input.id, reason, today, session.staffId]);
    if (correct && bill) {
      await recordCredit(client, {
        hotelId, staffId: session.staffId, supplier: bill.supplier, supplierId: bill.supplier_id,
        credit: correct as Required<CreditIn>, purchaseRequestId: bill.purchase_request_id,
        barPurchaseId: bill.bar_purchase_id, replacesId: input.id!,
      });
    }
    return { ok: true as const };
  }).catch(dbRefusal);
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});
