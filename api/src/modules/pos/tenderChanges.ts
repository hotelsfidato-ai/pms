import type { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import { overCashLimit, PAN_NEEDED } from "../finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   A PAID BILL'S PAYMENT MODE, CHANGED (the owner's D27-363, 25 October)

   "Before the night audit we can change the mode of payment after the bill
   is closed; this is done only by the GM, with a reason." A settled
   restaurant bill's cash, card or UPI becomes another of the three - each
   part of a split bill on its own, the amounts as they were - by the GM, the
   owner or an Admin, with a reason, while its business day is still open.
   Every change is kept (pos_tender_changes, 237): from what to what, how
   much, why, who, when, and whether the drawer had already been counted -
   the day end lists them, so a counted drawer that no longer matches says
   why.

   Not a bill charged to a room or to a function: those are postings on a
   folio, reversed there. The cash rules stand: cash of ₹2,00,000 or more on
   one bill is refused, and more than ₹1,00,000 needs the PAN the bill does
   not have - void it and settle it again.

   POST /:code/till/orders/:id/tenders/change   { changes: [{ tenderId, method }], reason }

   Registered on the till's router by till.ts, as the KOT section is.
   ══════════════════════════════════════════════════════════════════ */

type App = Hono<{ Variables: { subject: string } }>;
type HotelFor = (client: Client, code: string) => Promise<string | null>;

const refuse = (reason: string) => ({ ok: false as const, reason });
const SIMPLE = ["cash", "card", "upi"] as const;
const LABEL: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI" };
export const MODE_CHANGERS: readonly string[] = ["owner", "admin", "gm"];
const WHO = "Changing how a paid bill was paid is for the GM, the owner or an Admin.";

async function mayChange(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `select exists (select 1 from staff_hotels sh
                     where sh.staff_id = app.current_user_id() and sh.hotel_id = $1
                       and sh.role = any($2::text[]))
            or app.is_group_admin() as ok`,
    [hotelId, MODE_CHANGERS]);
  return rows[0]!.ok;
}

/** The day's changes of payment mode, for the day end and the night audit. */
export async function tenderChanges(client: Client, hotelId: string, businessDate: string, outletId?: string) {
  const { rows } = await client.query<{
    order_no: string; table_ref: string | null; from_method: string; to_method: string; amount: string;
    reason: string; by: string | null; at: string; after_day_end: boolean;
  }>(
    `select o.order_no, o.table_ref, c.from_method, c.to_method, c.amount::text, c.reason,
            coalesce(s.full_name, hp.full_name) as by,
            app.hotel_clock(c.hotel_id, c.changed_at, 'HH24:MI') as at, c.after_day_end
       from pos_tender_changes c
       join pos_orders o on o.id = c.order_id
       left join staff s on s.id = c.changed_by
       left join app.hotel_people($1) hp on hp.id = c.changed_by
      where c.hotel_id = $1 and c.business_date = $2::date
        and ($3::uuid is null or o.outlet_id = $3::uuid)
      order by c.changed_at`,
    [hotelId, businessDate, outletId ?? null]);
  return rows.map((r) => ({
    orderNo: r.order_no, table: r.table_ref, from: LABEL[r.from_method] ?? r.from_method,
    to: LABEL[r.to_method] ?? r.to_method, amount: Number(r.amount), reason: r.reason, by: r.by, at: r.at,
    afterDayEnd: r.after_day_end,
  }));
}

export function registerTenderChanges(till: App, hotelFor: HotelFor): void {
  till.post("/:code/till/orders/:id/tenders/change", async (c) => {
    const input = await c.req.json().catch(() => ({})) as { changes?: unknown; reason?: unknown };
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 300) return c.json(refuse("Say why the payment mode is changed. The reason stays on the bill."), 409);
    const changes = Array.isArray(input.changes) ? input.changes as { tenderId?: unknown; method?: unknown }[] : [];
    if (changes.length === 0) return c.json(refuse("Pick the new payment mode."), 409);
    if (changes.some((x) => typeof x.tenderId !== "string" || !/^\d+$/.test(x.tenderId)
      || !(SIMPLE as readonly unknown[]).includes(x.method))) {
      return c.json(refuse("A payment becomes cash, card or UPI."), 409);
    }

    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      if (!(await mayChange(client, hotelId))) return { forbidden: WHO };
      const { rows: [o] } = await client.query<{
        id: string; status: string; business_date: string; outlet_id: string; payment_method: string | null;
        pan: string | null; form_97: boolean | null; non_resident: boolean | null;
      }>(
        `select id::text, status, business_date::text, outlet_id::text, payment_method, pan, form_97, non_resident
           from pos_orders where id::text = $1 and hotel_id = $2 for update`,
        [c.req.param("id"), hotelId]);
      if (!o) return refuse("No such bill.");
      if (o.status !== "settled") return refuse("Only a paid bill's payment mode is changed.");
      if (o.payment_method === "room" || o.payment_method === "function") {
        return refuse("This bill went to a guest's or a function's bill. Change it there.");
      }
      const businessDate = await businessDateFor(client, hotelId);
      if (o.business_date !== businessDate) {
        return refuse(`The night audit has closed ${o.business_date}. A payment mode is changed only before it.`);
      }
      const { rows: tenders } = await client.query<{ id: string; method: string; amount: string }>(
        "select id::text, method, amount::text from pos_order_tenders where order_id = $1 order by id", [o.id]);
      const byId = new Map(tenders.map((t) => [t.id, t]));
      const asked = changes.map((x) => ({ tenderId: x.tenderId as string, method: x.method as string }));
      for (const x of asked) {
        const t = byId.get(x.tenderId);
        if (!t) return refuse("That payment is not on this bill.");
        if (!(SIMPLE as readonly string[]).includes(t.method)) return refuse("Only cash, card and UPI change.");
      }
      const real = asked.filter((x) => byId.get(x.tenderId)!.method !== x.method);
      if (real.length === 0) return refuse("Nothing changes: pick a different mode.");

      /* The cash rules, on the bill as it will be. */
      const cash = tenders.reduce((n, t) => {
        const to = asked.find((x) => x.tenderId === t.id)?.method ?? t.method;
        return n + (to === "cash" ? Number(t.amount) : 0);
      }, 0);
      const over = overCashLimit(0, cash, "card or UPI");
      if (over) return refuse(over);
      if (cash > 100000 && !o.pan && !o.form_97 && !o.non_resident) {
        return refuse(`${PAN_NEEDED} This bill has none: void it and settle it again with the PAN.`);
      }

      const { rows: [closed] } = await client.query<{ yes: boolean }>(
        `select exists (select 1 from pos_day_ends where outlet_id = $1 and business_date = $2::date
                         and closed_at is not null) as yes`, [o.outlet_id, o.business_date]);
      for (const x of real) {
        const t = byId.get(x.tenderId)!;
        await client.query(
          `insert into pos_tender_changes
             (hotel_id, order_id, tender_id, from_method, to_method, amount, reason, business_date, after_day_end, changed_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10)`,
          [hotelId, o.id, t.id, t.method, x.method, t.amount, reason, o.business_date, closed!.yes, session.staffId]);
        await client.query(
          `update pos_order_tenders set method = $2, tendered = case when $2 = 'cash' then tendered else null end
            where id = $1`, [t.id, x.method]);
      }
      /* The bill's own mode: one payment's, or split. */
      await client.query(
        `update pos_orders o set payment_method = case
            when (select count(*) from pos_order_tenders t where t.order_id = o.id) = 1
              then (select t.method from pos_order_tenders t where t.order_id = o.id)
            else 'split' end
          where o.id = $1`, [o.id]);
      return { ok: true as const, changed: real.length, afterDayEnd: closed!.yes };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    if ("forbidden" in result) return c.json(refuse(result.forbidden as string), 403);
    return c.json(result, result.ok ? 200 : 409);
  });
}
