import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";
import { addBarDrink, barDrinks, barStore, receiveIntoStore } from "../stores/index.ts";
import { BAR_RECORDERS, PURCHASING_REFUSED, VIEW_ROLES, hasRoleAt } from "./purchasingGrants.ts";

/* ══════════════════════════════════════════════════════════════════
   BAR BILLS (the owner's D27-354, 21 October)

   Purchasing's Bar side: a bill that has already come is recorded as it
   is - the supplier, its number and date, its drinks with the bottles and
   the cost per bottle as paid (liquor is not under GST), and a photo of it
   (POST /:code/attachments, table "bar_purchases"). No approval. Each
   drink goes into the bar's store at once, through the Store's own door
   (receiveIntoStore), as a receipt pointing at its bill. A drink the bar's
   list lacks is added to it on the way ("Add another drink").

   GET  /:code/bar/drinks      the bar's store and its drinks, with what it holds
   GET  /:code/bar/purchases   the bills of the last 60 days, newest first
   POST /:code/bar/purchases   one bill: who may is BAR_RECORDERS (the owner,
                               an administrator, the GM, the Inventory Manager)

   Every refusal comes before the first write (MEMORY 243).
   ══════════════════════════════════════════════════════════════════ */

export const barBills = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const forbid = (reason: string) => ({ forbidden: reason });

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
    if (!(await hasRoleAt(client, hotelId, VIEW_ROLES))) return forbid(PURCHASING_REFUSED.view);
    const store = await barStore(client, hotelId);
    return { store, drinks: await barDrinks(client, hotelId, store?.id ?? null) };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(refuse(body.forbidden), 403);
  return c.json(body);
});

barBills.get("/:code/bar/purchases", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, VIEW_ROLES))) return forbid(PURCHASING_REFUSED.view);
    const { rows } = await client.query<{
      id: string; supplier: string; bill_no: string; bill_date: string; recorded_by: string | null;
      recorded_at: string; photo_id: string | null;
      lines: { item: string; unit: string; sizeMl: number | null; quantity: number; unitCost: number | null }[];
    }>(
      `select p.id::text, p.supplier, p.bill_no, to_char(p.bill_date, 'YYYY-MM-DD') as bill_date,
              s.full_name as recorded_by, to_char(p.recorded_at, 'DD Mon, HH24:MI') as recorded_at,
              (select a.id::text from attachments a
                where a.hotel_id = p.hotel_id and a.subject_table = 'bar_purchases'
                  and a.subject_id = p.id order by a.uploaded_at desc limit 1) as photo_id,
              coalesce((select json_agg(json_build_object(
                         'item', i.name, 'unit', i.unit, 'sizeMl', i.size_ml,
                         'quantity', m.quantity, 'unitCost', m.unit_cost) order by m.id)
                  from stock_movements m join stock_items i on i.id = m.item_id
                 where m.bar_purchase_id = p.id and m.reverses_id is null), '[]') as lines
         from bar_purchases p
         left join staff s on s.id = p.recorded_by
        where p.hotel_id = $1 and p.bill_date >= current_date - 60
        order by p.bill_date desc, p.recorded_at desc`,
      [hotelId]);
    return {
      purchases: rows.map((r) => ({
        id: r.id, supplier: r.supplier, billNo: r.bill_no, billDate: r.bill_date,
        recordedBy: r.recorded_by, recordedAt: r.recorded_at, photoId: r.photo_id,
        lines: r.lines.map((l) => ({ ...l, quantity: Number(l.quantity),
          unitCost: l.unitCost === null ? null : Number(l.unitCost) })),
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
  bottles?: number; costPerBottle?: number;
};

barBills.post("/:code/bar/purchases", async (c) => {
  type Body = { supplier?: string; billNo?: string; billDate?: string; lines?: LineIn[] };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const supplier = input.supplier?.trim() ?? "";
  const billNo = input.billNo?.trim() ?? "";
  const billDate = input.billDate ?? "";
  const lines = Array.isArray(input.lines) ? input.lines : [];

  /* The bill's own facts, before anything is asked of the database. */
  if (!supplier) return c.json(refuse("Who is the bill from? Type the supplier."), 409);
  if (supplier.length > 120) return c.json(refuse("A supplier's name is at most 120 characters."), 409);
  if (!billNo) return c.json(refuse("Type the bill's number, as printed on it."), 409);
  if (billNo.length > 60) return c.json(refuse("A bill number is at most 60 characters."), 409);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) return c.json(refuse("Pick the bill's date."), 409);
  if (lines.length === 0) return c.json(refuse("Add at least one drink from the bill."), 409);
  for (const l of lines) {
    if (!l.itemId && !l.newDrink) return c.json(refuse("Pick each drink, or add it as another drink."), 409);
    if (l.newDrink) {
      const name = l.newDrink.name?.trim() ?? "";
      if (!name) return c.json(refuse("Type the name of the drink being added."), 409);
      if (!l.newDrink.unit?.trim()) return c.json(refuse(`What is ${name} counted in? A bottle, a can, a packet.`), 409);
      const ml = l.newDrink.sizeMl;
      if (ml !== null && ml !== undefined && (!Number.isInteger(ml) || ml < 1 || ml > 20000)) {
        return c.json(refuse(`${name}: a bottle's size is in whole ml, from 1 to 20,000.`), 409);
      }
    }
    if (!Number.isFinite(l.bottles) || (l.bottles ?? 0) <= 0) {
      return c.json(refuse("How many came of each drink? More than none."), 409);
    }
    /* The price as paid, never a default (no default prices). */
    if (!Number.isFinite(l.costPerBottle) || (l.costPerBottle ?? -1) < 0) {
      return c.json(refuse("Type the cost of each drink as on the bill: zero or more."), 409);
    }
  }

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
      `insert into bar_purchases (hotel_id, supplier, bill_no, bill_date, business_date, recorded_by)
       values ($1, $2, $3, $4::date, $5::date, $6) returning id::text`,
      [hotelId, supplier, billNo, billDate, today, session.staffId]);
    for (const l of lines) {
      let itemId = l.itemId ?? null;
      if (!itemId) {
        const added = await addBarDrink(client, hotelId, {
          name: l.newDrink!.name!.trim(), unit: l.newDrink!.unit!.trim(), sizeMl: l.newDrink!.sizeMl ?? null });
        if (!added.ok) throw new Error(added.reason);
        itemId = added.id;
      }
      const got = await receiveIntoStore(client, hotelId, session.staffId, {
        itemId, storeId: store.id, quantity: l.bottles!, unitCost: l.costPerBottle!,
        supplier, reference: `Bill ${billNo}`, barPurchaseId: bill!.id,
      });
      /* Checked above; should the Store refuse after all, nothing stays. */
      if (!got.ok) throw new Error(got.reason);
    }
    return { ok: true as const, id: bill!.id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});
