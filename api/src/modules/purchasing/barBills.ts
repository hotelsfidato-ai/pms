import { Hono } from "hono";
import { barStockGate } from "../stores/index.ts";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import * as storage from "../../storage.ts";
import { StorageRefused } from "../../storage.ts";
import { addBarDrink, barDrinks, barStore, receiveIntoStore } from "../stores/index.ts";
import { BAR_RECORDERS, BAR_VIEW, PURCHASING_REFUSED, hasRoleAt } from "./purchasingGrants.ts";
import { creditProblem, recordCredit } from "./supplierDues.ts";

/* ══════════════════════════════════════════════════════════════════
   BAR BILLS (the owner's D27-354, 21 October)

   A bill that has already come is recorded AS PRINTED (the owner's answer,
   21 October evening, from the Amit Traders and Bharat Wines bills): the
   supplier, its number, date and T.P. (transport permit) number; each line's
   drink, MRP, cases and loose bottles, bottles to a case and rate per case;
   the handling charges, the TCS and the total printed on it. The lines, the
   handling and the TCS must make that total. A photo of it. No approval. Each
   drink goes into the bar's store at once, through the Store's own door
   (receiveIntoStore), in bottles, at the line's amount over its bottles. A
   drink the bar's list lacks is added to it on the way ("Add another drink").

   GET  /:code/bar/drinks             the bar's store and its drinks
   GET  /:code/bar/purchases          the bills of the last 60 days, newest first
   POST /:code/bar/purchases          one bill: BAR_RECORDERS
   POST /:code/bar/purchases/:id/photo   its photo (a form): BAR_RECORDERS
   GET  /:code/bar/purchases/:id/photo   the photo back: BAR_VIEW

   The photo has its own door because the Bar role, which records bills
   (the owner), holds no grant on the shared attachments routes.
   Every refusal comes before the first write (MEMORY 243).
   ══════════════════════════════════════════════════════════════════ */

export const barBills = new Hono<{ Variables: { subject: string } }>();
/* Bar stock switched off: every route here refused (D27-367). Looked up per request:
   the Store's front door imports this service back, so at load time it may not be there yet. */
barBills.use("/:code/bar/*", (c, next) => barStockGate(c, next));

const refuse = (reason: string) => ({ ok: false as const, reason });
const forbid = (reason: string) => ({ forbidden: reason });
const round2 = (n: number) => Math.round(n * 100) / 100;
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A printed total may differ from the lines by the bill's round-off. */
const ROUND_OFF = 1;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

const NO_BAR_STORE = "This hotel has no bar store. Mark one in Places and suppliers first.";

barBills.get("/:code/bar/drinks", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, BAR_VIEW))) return forbid(PURCHASING_REFUSED.view);
    const store = await barStore(client, hotelId);
    const drinks = await barDrinks(client, hotelId, store?.id ?? null);
    /* Bottles to a case, from each drink's last bill: typed once. */
    const { rows: cases } = await client.query<{ item_id: string; per_case: number }>(
      `select distinct on (item_id) item_id::text, per_case
         from bar_purchase_lines where hotel_id = $1
        order by item_id, (select recorded_at from bar_purchases p where p.id = purchase_id) desc`,
      [hotelId]);
    const perCase = new Map(cases.map((r) => [r.item_id, r.per_case]));
    return { store, drinks: drinks.map((d) => ({ ...d, perCase: perCase.get(d.id) ?? null })) };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

barBills.get("/:code/bar/purchases", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, BAR_VIEW))) return forbid(PURCHASING_REFUSED.view);
    const { rows } = await client.query<{
      id: string; supplier: string; bill_no: string; bill_date: string; tp_no: string | null;
      handling: string | null; tcs: string | null; bill_total: string | null;
      recorded_by: string | null; recorded_at: string; photo_id: string | null;
      credit: { dueOn: string; paidOn: string | null } | null;
      lines: { item: string; unit: string; sizeMl: number | null; mrp: string | null; perCase: number;
               cases: number; bottles: number; ratePerCase: string; amount: string }[];
    }>(
      `select p.id::text, p.supplier, p.bill_no, to_char(p.bill_date, 'YYYY-MM-DD') as bill_date, p.tp_no,
              p.handling::text, p.tcs::text, p.bill_total::text,
              s.full_name as recorded_by, app.hotel_clock(p.hotel_id, p.recorded_at, 'DD Mon, HH24:MI') as recorded_at,
              (select a.id::text from attachments a
                where a.hotel_id = p.hotel_id and a.subject_table = 'bar_purchases'
                  and a.subject_id = p.id order by a.uploaded_at desc limit 1) as photo_id,
              (select json_build_object('dueOn', to_char(sb.due_on, 'YYYY-MM-DD'),
                                        'paidOn', to_char(sb.paid_on, 'YYYY-MM-DD'))
                 from supplier_bills sb where sb.bar_purchase_id = p.id) as credit,
              coalesce((select json_agg(json_build_object(
                         'item', i.name, 'unit', i.unit, 'sizeMl', i.size_ml, 'mrp', l.mrp::text,
                         'perCase', l.per_case, 'cases', l.cases, 'bottles', l.bottles,
                         'ratePerCase', l.rate_per_case::text, 'amount', l.amount::text) order by m.id)
                  from bar_purchase_lines l
                  join stock_items i on i.id = l.item_id
                  join stock_movements m on m.id = l.movement_id
                 where l.purchase_id = p.id), '[]') as lines
         from bar_purchases p
         left join staff s on s.id = p.recorded_by
        where p.hotel_id = $1 and p.bill_date >= current_date - 60
        order by p.bill_date desc, p.recorded_at desc`,
      [hotelId]);
    const num = (v: string | null) => (v === null ? null : Number(v));
    return {
      purchases: rows.map((r) => ({
        id: r.id, supplier: r.supplier, billNo: r.bill_no, billDate: r.bill_date, tpNo: r.tp_no,
        handling: num(r.handling), tcs: num(r.tcs), total: num(r.bill_total),
        recordedBy: r.recorded_by, recordedAt: r.recorded_at, photoId: r.photo_id,
        /* On credit (D27-370): when it is due, and when it was paid. Null: paid on the day. */
        credit: r.credit,
        lines: r.lines.map((l) => ({ ...l, mrp: num(l.mrp), ratePerCase: Number(l.ratePerCase),
          amount: Number(l.amount) })),
      })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

type LineIn = {
  itemId?: string;
  newDrink?: { name?: string; unit?: string; sizeMl?: number | null };
  mrp?: number | null; perCase?: number; cases?: number; bottles?: number; ratePerCase?: number;
};

const whole = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
const money = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 1e10;
const optionalMoney = (n: unknown) => n === null || n === undefined || money(n);

/** A line's amount as the bill works it: the rate per case for the cases,
    and a case's share of it for each loose bottle. */
export const lineAmount = (l: { perCase: number; cases: number; bottles: number; ratePerCase: number }) =>
  round2(l.ratePerCase * (l.cases + l.bottles / l.perCase));

barBills.post("/:code/bar/purchases", async (c) => {
  type Body = { supplier?: string; billNo?: string; billDate?: string; tpNo?: string | null;
                handling?: number | null; tcs?: number | null; total?: number; lines?: LineIn[];
                /** On credit, its due date: the bill goes on the Supplier dues (D27-370). */
                dueOn?: string | null };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const supplier = input.supplier?.trim() ?? "";
  const billNo = input.billNo?.trim() ?? "";
  const billDate = input.billDate ?? "";
  const tpNo = input.tpNo?.trim() || null;
  const lines = Array.isArray(input.lines) ? input.lines : [];

  /* The bill's own facts, before anything is asked of the database. */
  if (!supplier) return c.json(refuse("Who is the bill from? Type the supplier."), 409);
  if (supplier.length > 120) return c.json(refuse("A supplier's name is at most 120 characters."), 409);
  if (!billNo) return c.json(refuse("Type the bill's number, as printed on it."), 409);
  if (billNo.length > 60) return c.json(refuse("A bill number is at most 60 characters."), 409);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) return c.json(refuse("Pick the bill's date."), 409);
  if (tpNo && tpNo.length > 60) return c.json(refuse("A T.P. number is at most 60 characters."), 409);
  if (lines.length === 0) return c.json(refuse("Add at least one drink from the bill."), 409);
  for (const l of lines) {
    if (!l.itemId && !l.newDrink) return c.json(refuse("Pick each drink, or add it as another drink."), 409);
    if (l.newDrink) {
      const name = l.newDrink.name?.trim() ?? "";
      if (!name) return c.json(refuse("Type the name of the drink being added."), 409);
      if (!l.newDrink.unit?.trim()) return c.json(refuse(`What is ${name} counted in? A bottle, a can, a packet.`), 409);
      const ml = l.newDrink.sizeMl;
      if (ml !== null && ml !== undefined && !whole(ml, 1, 20000)) {
        return c.json(refuse(`${name}: a bottle's size is in whole ml, from 1 to 20,000.`), 409);
      }
    }
    if (!whole(l.perCase, 1, 1000)) return c.json(refuse("How many bottles to a case? A whole number, 1 or more."), 409);
    if (!whole(l.cases, 0, 100000) || !whole(l.bottles, 0, 100000)) {
      return c.json(refuse("Cases and loose bottles are whole numbers, zero or more."), 409);
    }
    if (l.cases! + l.bottles! === 0) return c.json(refuse("How many came of each drink? More than none."), 409);
    /* The price as printed, never a default (no default prices). */
    if (!money(l.ratePerCase)) return c.json(refuse("Type each line's rate per case as on the bill: zero or more."), 409);
    if (!optionalMoney(l.mrp)) return c.json(refuse("An MRP is zero or more, or left empty."), 409);
  }
  if (!optionalMoney(input.handling) || !optionalMoney(input.tcs)) {
    return c.json(refuse("Handling charges and TCS are zero or more, or left empty."), 409);
  }
  if (!money(input.total)) return c.json(refuse("Type the bill's total, as printed on it."), 409);
  const amounts = lines.map((l) => lineAmount(l as Required<Pick<LineIn, "perCase" | "cases" | "bottles" | "ratePerCase">>));
  const made = round2(amounts.reduce((s, a) => s + a, 0) + (input.handling ?? 0) + (input.tcs ?? 0));
  if (Math.abs(made - input.total!) > ROUND_OFF) {
    return c.json(refuse(
      `The lines, handling and TCS make ${rupees(made)}; the bill says ${rupees(input.total!)}. `
      + "Check the cases, the rates and the charges against the bill."), 409);
  }
  /* On credit (D27-370): the bill's own number, date and total, and when it is due. */
  const credit = input.dueOn ? { billNo, billDate, amount: input.total!, dueOn: input.dueOn } : null;
  const creditWrong = credit && creditProblem(credit);
  if (creditWrong) return c.json(refuse(creditWrong), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, BAR_RECORDERS))) return forbid(PURCHASING_REFUSED.barBill);

    /* The calendar, not the business day: a hotel whose night audit is behind
       still receives today's bills. */
    const { rows: [cal] } = await client.query<{ today: string }>(
      "select to_char((now() at time zone timezone)::date, 'YYYY-MM-DD') as today from hotels where id = $1", [hotelId]);
    if (billDate > cal!.today) return refuse("A bill is not dated in the future.");
    const today = await businessDateFor(client, hotelId);
    const store = await barStore(client, hotelId);
    if (!store) return refuse(NO_BAR_STORE);
    if (!store.isActive) return refuse(`${store.name} is switched off. Switch it on in Places and suppliers.`);

    const { rows: twice } = await client.query(
      "select 1 from bar_purchases where hotel_id = $1 and lower(supplier) = lower($2) and lower(bill_no) = lower($3)",
      [hotelId, supplier, billNo]);
    if (twice.length) return refuse(`Bill ${billNo} from ${supplier} is already recorded.`);

    const known = new Set((await barDrinks(client, hotelId, null)).map((d) => d.id));
    for (const l of lines) {
      if (l.itemId && !known.has(l.itemId)) return refuse("A drink picked is not on the bar's list.");
    }
    const adding = lines.filter((l) => l.newDrink).map((l) => l.newDrink!.name!.trim().toLowerCase());
    if (new Set(adding).size !== adding.length) return refuse("The same drink is added twice. Add it once.");
    const { rows: taken } = await client.query<{ name: string }>(
      "select name from stock_items where hotel_id = $1 and lower(name) = any($2::text[])", [hotelId, adding]);
    if (taken.length) return refuse(`"${taken[0]!.name}" is already on the store's list. Pick it instead.`);

    /* ── Written: the bill, any drink added, then each line into the bar's store ── */
    const { rows: [bill] } = await client.query<{ id: string }>(
      `insert into bar_purchases
         (hotel_id, supplier, bill_no, bill_date, business_date, recorded_by, tp_no, handling, tcs, bill_total)
       values ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10) returning id::text`,
      [hotelId, supplier, billNo, billDate, today, session.staffId, tpNo,
       input.handling ?? null, input.tcs ?? null, input.total]);
    for (const [n, l] of lines.entries()) {
      let itemId = l.itemId ?? null;
      if (!itemId) {
        const added = await addBarDrink(client, hotelId, {
          name: l.newDrink!.name!.trim(), unit: l.newDrink!.unit!.trim(), sizeMl: l.newDrink!.sizeMl ?? null });
        if (!added.ok) throw new Error(added.reason);
        itemId = added.id;
      }
      const bottles = l.cases! * l.perCase! + l.bottles!;
      const got = await receiveIntoStore(client, hotelId, session.staffId, {
        itemId, storeId: store.id, quantity: bottles, unitCost: round2(amounts[n]! / bottles),
        supplier, reference: `Bill ${billNo}`, barPurchaseId: bill!.id,
      });
      /* Checked above; should the Store refuse after all, nothing stays. */
      if (!got.ok) throw new Error(got.reason);
      await client.query(
        `insert into bar_purchase_lines
           (hotel_id, purchase_id, item_id, movement_id, mrp, per_case, cases, bottles, rate_per_case, amount)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [hotelId, bill!.id, itemId, got.id, l.mrp ?? null, l.perCase, l.cases, l.bottles, l.ratePerCase, amounts[n]]);
    }
    if (credit) {
      await recordCredit(client, { hotelId, staffId: session.staffId, supplier, credit, barPurchaseId: bill!.id });
    }
    return { ok: true as const, id: bill!.id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── The bill's photo ─────────────────────────────────────────────── */

barBills.post("/:code/bar/purchases/:id/photo", async (c) => {
  const billId = c.req.param("id");
  if (!UUID.test(billId)) return c.json(refuse("Which bill is this photo of?"), 409);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json(refuse("No file was sent."), 409);
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  try {
    storage.checkAcceptable(contentType, bytes.byteLength);
  } catch (error) {
    if (error instanceof StorageRefused) return c.json(refuse(error.message), 409);
    throw error;
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, BAR_RECORDERS))) return forbid(PURCHASING_REFUSED.barBill);
    const { rows } = await client.query("select 1 from bar_purchases where id = $1 and hotel_id = $2", [billId, hotelId]);
    if (!rows.length) return refuse("No such bar bill here.");

    const stored = await storage.put(hotelId, contentType, bytes);
    try {
      const { rows: [att] } = await client.query<{ id: string }>(
        `insert into attachments
           (hotel_id, subject_table, subject_id, filename, content_type,
            byte_size, sha256, storage_backend, storage_key, uploaded_by)
         values ($1, 'bar_purchases', $2::uuid, $3, $4, $5, $6, $7, $8, $9)
         returning id::text`,
        [hotelId, billId, file.name || `bill.${contentType.split("/")[1]}`, contentType,
         stored.byteSize, stored.sha256, stored.backend, stored.key, session.staffId]);
      return { ok: true as const, id: att!.id };
    } catch (error) {
      /* The bytes are already on disk: removed, or nothing points at them. */
      await storage.remove(stored.key);
      if ((error as { code?: string }).code === "23505") return refuse("That photo is already on this bill.");
      throw error;
    }
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

barBills.get("/:code/bar/purchases/:id/photo", async (c) => {
  const billId = c.req.param("id");
  if (!UUID.test(billId)) return c.json({ error: "No such file." }, 404);
  const found = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId || !(await hasRoleAt(client, hotelId, BAR_VIEW))) return null;
    const { rows } = await client.query<{ filename: string; content_type: string; storage_key: string; storage_backend: string }>(
      `select filename, content_type, storage_key, storage_backend from attachments
        where hotel_id = $1 and subject_table = 'bar_purchases' and subject_id = $2::uuid
        order by uploaded_at desc limit 1`, [hotelId, billId]);
    return rows[0] ?? null;
  });
  /* Not found, not yours and not allowed are one answer (attachments.ts). */
  if (!found || found.storage_backend !== "disk") return c.json({ error: "No such file." }, 404);
  try {
    const bytes = await storage.get(found.storage_key);
    c.header("Content-Type", found.content_type);
    c.header("Content-Disposition", `inline; filename="${found.filename.replace(/["\\\r\n]/g, "")}"`);
    c.header("Cache-Control", "private, max-age=300");
    return c.body(bytes as unknown as ArrayBuffer);
  } catch {
    return c.json({ error: "The record is here but the file is missing from the store." }, 410);
  }
});
