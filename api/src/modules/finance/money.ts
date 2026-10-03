import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { PAYMENT_KINDS } from "./paymentMethods.ts";

/* ══════════════════════════════════════════════════════════════════
   MONEY, IN THE SETTINGS CONSOLE (the owner's D27-259, migration 191)

   Each hotel's own lists: its ways of paying (a word on the bill, what it
   is in the books, On/Off, the default), its extra charges (the inclusions
   list, 065; a pickup or drop is one marked so), its room discounts (% or
   ₹ off each night) and the commission each source and agent contract
   carries. Edited by the owner, an administrator and the GM (roleGate).

   Delete only what nothing used; otherwise switch it Off. A price left
   blank is "included at no charge", never a zero (065).
   ══════════════════════════════════════════════════════════════════ */

export const money = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ["room", "food", "beverage", "spa", "laundry", "minibar", "telephone", "misc"];

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

type Result = { ok: true; id?: string } | { ok: false; reason: string } | null;
const answer = (c: { json: (b: unknown, s?: number) => Response }, r: Result) =>
  !r ? c.json({ error: "No such property." }, 404) : c.json(r, r.ok ? 200 : 409);

/* A database refusal a person can read: the name taken, or the trigger's own words. */
function readable(error: unknown, taken: string): { ok: false; reason: string } {
  const e = error as { code?: string; message?: string };
  if (e?.code === "23505") return refuse(taken);
  if (e?.code === "23514" && e.message && !e.message.includes("violates")) return refuse(e.message);
  throw error;
}

const money2 = (v: unknown): number | null | undefined =>
  v === undefined ? undefined : v === null || v === "" ? null : Number(v);

/* Rows reordered as the screen dragged them: 10, 20, 30 … */
async function reorder(client: Client, table: string, hotelId: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string" && UUID.test(i))) {
    return refuse("The order is a list of the rows.");
  }
  await client.query(
    `update ${table} t set sort_order = o.n * 10
       from unnest($2::uuid[]) with ordinality as o(id, n)
      where t.id = o.id and t.hotel_id = $1`, [hotelId, ids]);
  return { ok: true as const };
}

/* ── Payment methods ─────────────────────────────────────────────── */

/* A payment taken this way: by its word since 191; before 191 no word was
   kept, so such a payment counts against every method of its kind - Off,
   never deleted, is the safe side. */
const TAKEN = `(p.method_label = pm.label or (p.method_label is null and p.method = pm.kind))`;

money.get("/:code/payment-methods", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query(
      `select pm.id::text, pm.label, pm.kind, pm.is_active as "isActive",
              exists (select 1 from payments p where p.hotel_id = pm.hotel_id and ${TAKEN}) as used
         from payment_methods pm where pm.hotel_id = $1
        order by pm.sort_order, lower(pm.label)`, [hotelId]);
    const { rows: [h] } = await client.query<{ d: string }>(
      "select default_payment_method as d from hotels where id = $1", [hotelId]);
    return { methods: rows, defaultMethod: h!.d, kinds: PAYMENT_KINDS };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

function methodProblem(input: { label?: unknown; kind?: unknown }, partial: boolean) {
  if ((!partial || input.label !== undefined)
      && !(typeof input.label === "string" && input.label.trim())) return "What is it called?";
  if ((!partial || input.kind !== undefined) && !(String(input.kind) in PAYMENT_KINDS)) {
    return "Say what it is in the books: cash, card, UPI, bank transfer, cheque, wallet, net banking or bill to company.";
  }
  return null;
}

money.post("/:code/payment-methods", async (c) => {
  const input = await c.req.json<{ label?: string; kind?: string }>()
    .catch(() => ({}) as { label?: string; kind?: string });
  const problem = methodProblem(input, false);
  if (problem) return c.json(refuse(problem), 409);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into payment_methods (hotel_id, label, kind, sort_order)
         select $1, $2, $3, coalesce(max(sort_order), 0) + 10 from payment_methods where hotel_id = $1
         returning id::text`, [hotelId, input.label!.trim(), input.kind]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (e) { return readable(e, `"${input.label!.trim()}" is already on the list.`); }
  }));
});

money.patch("/:code/payment-methods/:id", async (c) => {
  const id = c.req.param("id");
  const input = await c.req.json<{ label?: string; kind?: string; isActive?: boolean }>()
    .catch(() => ({}) as { label?: string; kind?: string; isActive?: boolean });
  const problem = methodProblem(input, true);
  if (problem || !UUID.test(id)) return c.json(refuse(problem ?? "No such payment method."), 409);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rowCount } = await client.query(
        `update payment_methods set label = coalesce($3, label), kind = coalesce($4, kind),
                is_active = coalesce($5, is_active)
          where id = $2 and hotel_id = $1`,
        [hotelId, id, input.label?.trim() ?? null, input.kind ?? null, input.isActive ?? null]);
      return rowCount ? { ok: true as const } : refuse("No such payment method.");
    } catch (e) { return readable(e, `"${input.label?.trim()}" is already on the list.`); }
  }));
});

money.delete("/:code/payment-methods/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json(refuse("No such payment method."), 409);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query(
      `select 1 from payment_methods pm join payments p on p.hotel_id = pm.hotel_id and ${TAKEN}
        where pm.id = $2 and pm.hotel_id = $1 limit 1`, [hotelId, id]);
    if (rows.length) return refuse("Payments were taken this way. Switch it Off instead.");
    try {
      const { rowCount } = await client.query(
        "delete from payment_methods where id = $2 and hotel_id = $1", [hotelId, id]);
      return rowCount ? { ok: true as const } : refuse("No such payment method.");
    } catch (e) { return readable(e, ""); }
  }));
});

money.post("/:code/payment-methods/:id/default", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json(refuse("No such payment method."), 409);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rowCount } = await client.query(
        `update hotels h set default_payment_method = pm.label
           from payment_methods pm where pm.id = $2 and pm.hotel_id = $1 and h.id = $1`,
        [hotelId, id]);
      return rowCount ? { ok: true as const } : refuse("No such payment method.");
    } catch (e) { return readable(e, ""); }
  }));
});

money.put("/:code/payment-methods/order", async (c) => {
  const input = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    return hotelId ? reorder(client, "payment_methods", hotelId, input.ids) : null;
  }));
});

/* ── Extra charges: the inclusions list (065) ────────────────────── */

money.get("/:code/extra-charges", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query(
      `select i.id::text, i.name, i.description, i.default_rate::float8 as rate, i.category,
              i.is_transport as "isTransport", i.is_active as "isActive",
              exists (select 1 from reservation_inclusions ri where ri.inclusion_id = i.id) as used
         from inclusions i where i.hotel_id = $1
        order by i.sort_order, lower(i.name)`, [hotelId]);
    const { rows: [h] } = await client.query(
      `select early_checkin_charge::float8 as "earlyCheckinCharge",
              late_checkout_charge::float8 as "lateCheckoutCharge"
         from hotels where id = $1`, [hotelId]);
    return { charges: rows, ...h };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

type ChargeBody = {
  name?: string; description?: string | null; rate?: number | null;
  category?: string; isTransport?: boolean; isActive?: boolean;
};

function chargeProblem(input: ChargeBody, partial: boolean) {
  if ((!partial || input.name !== undefined) && !input.name?.trim()) return "What is it called?";
  const rate = money2(input.rate);
  if (rate != null && (!Number.isFinite(rate) || rate < 0)) {
    return "A price is zero or more, or blank when it is included at no charge.";
  }
  if (input.category !== undefined && !CATEGORIES.includes(input.category)) {
    return "Say which column of the bill it goes in.";
  }
  return null;
}

money.post("/:code/extra-charges", async (c) => {
  const input = await c.req.json<ChargeBody>().catch(() => ({}) as ChargeBody);
  const problem = chargeProblem(input, false);
  if (problem) return c.json(refuse(problem), 409);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into inclusions (hotel_id, name, description, default_rate, category,
                                 is_transport, sort_order)
         select $1, $2, nullif($3, ''), $4, $5, $6, coalesce(max(sort_order), 0) + 10
           from inclusions where hotel_id = $1
         returning id::text`,
        [hotelId, input.name!.trim(), input.description?.trim() ?? "", money2(input.rate) ?? null,
         input.category ?? "misc", input.isTransport === true]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (e) { return readable(e, `"${input.name!.trim()}" is already on the list.`); }
  }));
});

money.patch("/:code/extra-charges/:id", async (c) => {
  const id = c.req.param("id");
  const input = await c.req.json<ChargeBody>().catch(() => ({}) as ChargeBody);
  const problem = chargeProblem(input, true);
  if (problem || !UUID.test(id)) return c.json(refuse(problem ?? "No such charge."), 409);
  const rate = money2(input.rate);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rowCount } = await client.query(
        `update inclusions set
            name = coalesce($3, name),
            description = case when $4::boolean then nullif($5, '') else description end,
            default_rate = case when $6::boolean then $7::numeric else default_rate end,
            category = coalesce($8, category),
            is_transport = coalesce($9, is_transport),
            is_active = coalesce($10, is_active)
          where id = $2 and hotel_id = $1`,
        [hotelId, id, input.name?.trim() ?? null,
         input.description !== undefined, input.description?.trim() ?? "",
         rate !== undefined, rate ?? null,
         input.category ?? null, input.isTransport ?? null, input.isActive ?? null]);
      return rowCount ? { ok: true as const } : refuse("No such charge.");
    } catch (e) { return readable(e, `"${input.name?.trim()}" is already on the list.`); }
  }));
});

money.delete("/:code/extra-charges/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json(refuse("No such charge."), 409);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query(
      "select 1 from reservation_inclusions where inclusion_id = $1 limit 1", [id]);
    if (rows.length) return refuse("Bookings carry this charge. Switch it Off instead.");
    const { rowCount } = await client.query(
      "delete from inclusions where id = $2 and hotel_id = $1", [hotelId, id]);
    return rowCount ? { ok: true as const } : refuse("No such charge.");
  }));
});

money.put("/:code/extra-charges/order", async (c) => {
  const input = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    return hotelId ? reorder(client, "inclusions", hotelId, input.ids) : null;
  }));
});

/* ── Room discounts: % or ₹ off each night (146, 191) ────────────── */

money.get("/:code/discounts", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query(
      `select p.id::text, p.name, p.percent::float8 as percent, p.amount::float8 as amount,
              p.is_active as "isActive",
              exists (select 1 from reservations r where r.room_promotion_id = p.id) as used
         from room_promotions p where p.hotel_id = $1
        order by p.is_active desc, lower(p.name)`, [hotelId]);
    return { discounts: rows };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

type DiscountBody = { name?: string; percent?: number | null; amount?: number | null; isActive?: boolean };

/* Exactly one of % or ₹ (191's room_promotions_percent_sane). */
function discountProblem(input: DiscountBody, partial: boolean) {
  if ((!partial || input.name !== undefined) && !input.name?.trim()) return "What is it called?";
  if (partial && input.percent === undefined && input.amount === undefined) return null;
  const pct = money2(input.percent) ?? null, amt = money2(input.amount) ?? null;
  if ((pct === null) === (amt === null)) return "A discount is a percentage or an amount in rupees, one of the two.";
  if (pct !== null && !(pct > 0 && pct <= 100)) return "A percentage is above 0 and at most 100.";
  if (amt !== null && !(amt > 0)) return "An amount is above ₹0.";
  return null;
}

money.post("/:code/discounts", async (c) => {
  const input = await c.req.json<DiscountBody>().catch(() => ({}) as DiscountBody);
  const problem = discountProblem(input, false);
  if (problem) return c.json(refuse(problem), 409);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into room_promotions (hotel_id, name, percent, amount)
         values ($1, $2, $3, $4) returning id::text`,
        [hotelId, input.name!.trim(), money2(input.percent) ?? null, money2(input.amount) ?? null]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (e) { return readable(e, `"${input.name!.trim()}" is already on the list.`); }
  }));
});

money.patch("/:code/discounts/:id", async (c) => {
  const id = c.req.param("id");
  const input = await c.req.json<DiscountBody>().catch(() => ({}) as DiscountBody);
  const problem = discountProblem(input, true);
  if (problem || !UUID.test(id)) return c.json(refuse(problem ?? "No such discount."), 409);
  const both = input.percent !== undefined || input.amount !== undefined;
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rowCount } = await client.query(
        `update room_promotions set name = coalesce($3, name),
                percent = case when $4::boolean then $5::numeric else percent end,
                amount  = case when $4::boolean then $6::numeric else amount end,
                is_active = coalesce($7, is_active)
          where id = $2 and hotel_id = $1`,
        [hotelId, id, input.name?.trim() ?? null, both,
         money2(input.percent) ?? null, money2(input.amount) ?? null, input.isActive ?? null]);
      return rowCount ? { ok: true as const } : refuse("No such discount.");
    } catch (e) { return readable(e, `"${input.name?.trim()}" is already on the list.`); }
  }));
});

money.delete("/:code/discounts/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json(refuse("No such discount."), 409);
  return answer(c, await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query(
      "select 1 from reservations where room_promotion_id = $1 limit 1", [id]);
    if (rows.length) return refuse("Bookings were given this discount. Switch it Off instead.");
    const { rowCount } = await client.query(
      "delete from room_promotions where id = $2 and hotel_id = $1", [hotelId, id]);
    return rowCount ? { ok: true as const } : refuse("No such discount.");
  }));
});

/* ── Commission: each source's and each agent contract's (082, 177) ──
   Read here; a source's % is set through PUT booking-sources/:id/commission,
   a contract's on the contract. No payouts (LATER). */
money.get("/:code/commission", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows: sources } = await client.query(
      `select bs.id::text, bs.name, bs.kind, r.commission_pct::float8 as "commissionPct"
         from booking_sources bs
         left join booking_source_rates r on r.booking_source_id = bs.id and r.hotel_id = $1
        where bs.is_active
        order by lower(bs.name)`, [hotelId]);
    const { rows: contracts } = await client.query(
      `select k.id::text, k.name, co.id::text as "companyId", co.name as company,
              k.valid_from::text as "validFrom", k.valid_to::text as "validTo",
              k.commission_pct::float8 as "commissionPct"
         from contracts k join companies co on co.id = k.company_id
        where k.hotel_id = $1 and k.is_active and k.commission_pct is not null
        order by lower(co.name), k.valid_from desc`, [hotelId]);
    return { sources, contracts };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
