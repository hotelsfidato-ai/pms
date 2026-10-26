import type { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../../auth.ts";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S RESTAURANT ALLOWANCE (the owner's D27-355, D27-365 (1), D27-366)

   The owner takes up to a set amount a month from the restaurant free;
   above it, a set % off. Both are the hotel's settings (migration 240),
   typed by the owner or an Admin, blank until typed - no figure is built in.
   The month is the hotel's business month, from the 1st, nothing carried.

   The GM, the owner or an Admin settles a bill to it, through the till's own
   settle (till.ts, method "allowance"): what is left of the month pays first,
   as a tender of its own; the rest gets the % off and is paid there and then
   by cash, card or UPI. The % off is a discount on the bill (its amount before
   tax, so GST is on what is charged, as for any discount); the free part is a
   sale like any other, GST and all (D27-366, until the CA says otherwise).

   GET /:code/till/owner-allowance               the setting, this month's use and its bills
   PUT /:code/till/owner-allowance               { monthly, offPct }: the owner or an Admin
   GET /:code/till/orders/:id/owner-allowance    what this bill would be: free, % off, the rest

   Registered on the till's router by till.ts, as the KOT section is.
   ══════════════════════════════════════════════════════════════════ */

type App = Hono<{ Variables: { subject: string } }>;
type HotelFor = (client: Client, code: string) => Promise<string | null>;
const refuse = (reason: string) => ({ ok: false as const, reason });
const round2 = (n: number) => Math.round(n * 100) / 100;

export const ALLOWANCE_SETTERS: readonly string[] = ["owner", "admin"];
export const ALLOWANCE_SETTLERS: readonly string[] = ["owner", "admin", "gm"];
export const SETTLE_REFUSED = "Settling a bill to the owner's allowance is for the GM, the owner or an Admin.";
const SET_REFUSED = "The owner's allowance is set by the owner or an Admin.";
const NOT_SET = "The owner's allowance is not set. The owner or an Admin types it in Restaurant setup.";

async function holds(client: Client, hotelId: string, roles: readonly string[]): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `select exists (select 1 from staff_hotels sh
                     where sh.staff_id = app.current_user_id() and sh.hotel_id = $1
                       and sh.role = any($2::text[]))
            or app.is_group_admin() as ok`,
    [hotelId, roles]);
  return rows[0]!.ok;
}
export const maySettleAllowance = (client: Client, hotelId: string) => holds(client, hotelId, ALLOWANCE_SETTLERS);

interface Month { monthly: number | null; offPct: number | null; month: string; used: number; left: number | null }

/** The setting and this business month's use (settled bills only: a voided one gives it back). */
async function thisMonth(client: Client, hotelId: string): Promise<Month> {
  const { rows } = await client.query<{ monthly: string | null; off: string | null; month: string; used: string }>(
    `select h.owner_allowance_monthly::text as monthly, h.owner_allowance_off_pct::text as off,
            to_char(app.business_date(h.id), 'YYYY-MM') as month,
            coalesce((select sum(t.amount) from pos_order_tenders t join pos_orders o on o.id = t.order_id
                       where o.hotel_id = h.id and o.status = 'settled' and t.method = 'allowance'
                         and to_char(o.business_date, 'YYYY-MM') = to_char(app.business_date(h.id), 'YYYY-MM')), 0)::text as used
       from hotels h where h.id = $1`, [hotelId]);
  const r = rows[0]!;
  const monthly = r.monthly === null ? null : Number(r.monthly);
  const used = Number(r.used);
  return { monthly, offPct: r.off === null ? null : Number(r.off), month: r.month, used,
           left: monthly === null ? null : Math.max(0, round2(monthly - used)) };
}

export interface AllowancePlan {
  ok: true; monthly: number; offPct: number | null; left: number;
  /** The bill before, the % off's amount before tax, and the bill after it. */
  before: number; discountNet: number; after: number;
  /** The free part and the rest, on the bill as the database totals it (before any till round-off). */
  free: number; rest: number; reason: string | null;
}

/** What settling this bill to the allowance would do. Writes nothing. */
export async function allowancePlan(client: Client, hotelId: string, orderId: string): Promise<AllowancePlan | ReturnType<typeof refuse>> {
  const m = await thisMonth(client, hotelId);
  if (m.monthly === null) return refuse(NOT_SET);
  const { rows: o } = await client.query<{ status: string; discount: string; net: string; tax: string; gross: string }>(
    `select o.status, t.discount::text, t.net::text, t.tax::text, t.gross::text
       from pos_orders o, app.pos_order_total(o.id) t where o.id = $1 and o.hotel_id = $2`, [orderId, hotelId]);
  if (!o[0]) return refuse("No such order.");
  if (o[0].status !== "open") return refuse(`This order is already ${o[0].status}.`);
  if (Number(o[0].net) <= 0) return refuse("There is nothing on this order. Add an item, or abandon it.");
  if (Number(o[0].discount) > 0) {
    return refuse("A bill on the owner's allowance takes no other discount. Clear the discount first.");
  }
  const net = Number(o[0].net);
  const before = Number(o[0].gross);
  const left = m.left!;
  if (before <= left + 0.005) {
    return { ok: true, monthly: m.monthly, offPct: m.offPct, left, before, discountNet: 0, after: before,
             free: before, rest: 0, reason: null };
  }
  if (m.offPct === null) {
    return refuse(`This bill is more than the ₹${left.toFixed(2)} left of this month's allowance, and the % off above it is not set. `
      + "The owner or an Admin types it in Restaurant setup.");
  }
  /* The % off is on the part above the free amount, in what the owner pays (with tax):
     taken off the bill's amount before tax in the same proportion, so the tax follows it. */
  const offGross = (before - left) * m.offPct / 100;
  const discountNet = round2(offGross * net / before);
  const reason = `Owner's allowance: ${m.offPct}% off above the ₹${left.toFixed(2)} left of this month's ₹${m.monthly.toFixed(2)}`;
  await client.query("savepoint allowance_plan");
  try {
    await setDiscount(client, orderId, discountNet, reason);
    const { rows: t } = await client.query<{ gross: string }>("select gross::text from app.pos_order_total($1)", [orderId]);
    const after = Number(t[0]!.gross);
    return { ok: true, monthly: m.monthly, offPct: m.offPct, left, before, discountNet, after,
             free: left, rest: round2(after - left), reason };
  } finally {
    await client.query("rollback to savepoint allowance_plan");
  }
}

/** The % off, written as the bill's discount (a rule, not a biller's free-hand discount: no cap). */
export async function setDiscount(client: Client, orderId: string, discountNet: number, reason: string | null) {
  if (discountNet <= 0 || !reason) return;
  await client.query(
    `update pos_orders set discount_type = 'fixed', discount_value = $2, discount_amount = $2,
            discount_reason = $3, promotion_id = null, updated_at = now() where id = $1`,
    [orderId, discountNet.toFixed(2), reason]);
}

export function registerOwnerAllowance(till: App, hotelFor: HotelFor) {
  till.get("/:code/till/owner-allowance", async (c) => {
    const body = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const m = await thisMonth(client, hotelId);
      const { rows } = await client.query<{ order_no: string; date: string; free: string; discount: string; paid: string }>(
        `select o.order_no, to_char(o.business_date, 'YYYY-MM-DD') as date,
                coalesce(sum(t.amount) filter (where t.method = 'allowance'), 0)::text as free,
                coalesce(o.discount_amount, 0)::text as discount,
                coalesce(sum(t.amount) filter (where t.method <> 'allowance'), 0)::text as paid
           from pos_orders o left join pos_order_tenders t on t.order_id = o.id
          where o.hotel_id = $1 and o.on_owner_allowance and o.status = 'settled'
            and to_char(o.business_date, 'YYYY-MM') = $2
          group by o.id order by o.business_date, o.order_no`, [hotelId, m.month]);
      return {
        ...m,
        mayEdit: await holds(client, hotelId, ALLOWANCE_SETTERS),
        maySettle: await holds(client, hotelId, ALLOWANCE_SETTLERS),
        bills: rows.map((r) => ({ orderNo: r.order_no, date: r.date, free: Number(r.free),
                                  discount: Number(r.discount), paid: Number(r.paid) })),
      };
    });
    if (!body) return c.json({ error: "No such property." }, 404);
    return c.json(body);
  });

  till.put("/:code/till/owner-allowance", async (c) => {
    type Body = { monthly?: unknown; offPct?: unknown };
    const b = await c.req.json<Body>().catch(() => ({}) as Body);
    const amount = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const monthly = amount(b.monthly);
    const offPct = amount(b.offPct);
    if (monthly !== null && (!Number.isFinite(monthly) || monthly < 0 || monthly > 9_999_999)) {
      return c.json(refuse("The free amount a month is rupees, zero or more."), 409);
    }
    if (offPct !== null && (!Number.isFinite(offPct) || offPct < 0 || offPct > 100)) {
      return c.json(refuse("The % off is between 0 and 100."), 409);
    }
    const out = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      if (!(await holds(client, hotelId, ALLOWANCE_SETTERS))) return refuse(SET_REFUSED);
      await client.query(
        "update hotels set owner_allowance_monthly = $2, owner_allowance_off_pct = $3 where id = $1",
        [hotelId, monthly === null ? null : round2(monthly), offPct === null ? null : round2(offPct)]);
      return { ok: true as const };
    });
    if (!out) return c.json({ error: "No such property." }, 404);
    return c.json(out, out.ok ? 200 : 403);
  });

  till.get("/:code/till/orders/:id/owner-allowance", async (c) => {
    const out = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      if (!(await maySettleAllowance(client, hotelId))) return refuse(SETTLE_REFUSED);
      return allowancePlan(client, hotelId, c.req.param("id"));
    });
    if (!out) return c.json({ error: "No such property." }, 404);
    return c.json(out, out.ok ? 200 : 409);
  });
}
