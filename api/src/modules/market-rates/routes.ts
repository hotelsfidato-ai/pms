import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { isoDateParam } from "../reports/index.ts";
import { serpApiKey } from "./sweep.ts";

/* ══════════════════════════════════════════════════════════════════
   RIVALS' PRICES: WHAT A PERSON READS, AND THE SWITCH (D27-270)

     GET  /:code/market-rates?from&to   each night's latest check: the
                                        nearby hotels and their prices,
                                        cheapest first. Revenue management
                                        reads this, and only this.
     GET  /:code/market-rates/switch    on or off here, whether the server
                                        has its key, the last check day
     PUT  /:code/market-rates/switch    switch it

   Who: the read is the people who see prices (the role gate's `rate`
   view); the switch is the owner, an administrator or the GM (the role
   gate's room_config, and the table's app.manages_hotel behind it).
   A night nobody checked is simply not in the answer: the screen shows a
   dash, never a nought.
   ══════════════════════════════════════════════════════════════════ */

export const marketRates = new Hono<{ Variables: { subject: string } }>();

const NO_SUCH = { error: "No such property, or it is not yours to see." };

export interface Rival { name: string; price: number; source: string | null }
export interface CheckedNight { date: string; checkedAt: string; hotels: Rival[] }

marketRates.get("/:code/market-rates", async (c) => {
  const from = isoDateParam(c.req.query("from"));
  const to = isoDateParam(c.req.query("to"));
  if (!from || !to) return c.json({ error: "Say from and to, as YYYY-MM-DD." }, 400);
  const nights = await withSession(c.get("subject"), async (client) => {
    const { rows: hotel } = await client.query<{ id: string }>(
      "select id::text from hotels where code = upper($1)", [c.req.param("code")]);
    if (!hotel[0]) return null;
    const { rows } = await client.query<{
      date: string; checked_at: string; name: string; price: number; source: string | null;
    }>(
      `select m.stay_date::text as date, m.fetched_at as checked_at, m.competitor as name,
              m.lowest_price::float8 as price, m.source
         from market_rates m
        where m.hotel_id = $1 and m.stay_date between $2 and $3
          and m.fetched_at = (select max(x.fetched_at) from market_rates x
                               where x.hotel_id = m.hotel_id and x.stay_date = m.stay_date)
        order by m.stay_date, m.lowest_price, m.competitor`,
      [hotel[0].id, from, to]);
    const by = new Map<string, CheckedNight>();
    for (const r of rows) {
      const night = by.get(r.date) ?? { date: r.date, checkedAt: new Date(r.checked_at).toISOString(), hotels: [] };
      night.hotels.push({ name: r.name, price: r.price, source: r.source });
      by.set(r.date, night);
    }
    return [...by.values()];
  });
  return nights ? c.json({ nights }) : c.json(NO_SUCH, 404);
});

const hotelManaged = async (client: Client, code: string): Promise<string | null> => {
  const { rows } = await client.query<{ id: string; may: boolean }>(
    "select id::text, app.manages_hotel(id) as may from hotels where code = upper($1)", [code]);
  return rows[0]?.may ? rows[0].id : null;
};

marketRates.get("/:code/market-rates/switch", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      is_on: boolean; last_run_on: string | null; changed_by: string | null; changed_at: string;
    }>(
      `select s.is_on, s.last_run_on::text, p.full_name as changed_by, s.changed_at
         from market_rate_settings s left join staff p on p.id = s.changed_by
        where s.hotel_id = $1`, [hotelId]);
    const s = rows[0];
    return {
      isOn: s?.is_on ?? false,
      keySet: serpApiKey() !== null,
      lastRunOn: s?.last_run_on ?? null,
      changedBy: s?.changed_by ?? null,
      changedAt: s?.changed_at ?? null,
    };
  });
  return body ? c.json(body) : c.json(NO_SUCH, 404);
});

marketRates.put("/:code/market-rates/switch", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (typeof input["isOn"] !== "boolean") return c.json({ error: "Say whether it is on or off." }, 400);
  const done = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return false;
    await client.query(
      `insert into market_rate_settings (hotel_id, is_on, changed_by, changed_at)
       values ($1, $2, $3, now())
       on conflict (hotel_id) do update set
         is_on = excluded.is_on, changed_by = excluded.changed_by, changed_at = now()`,
      [hotelId, input["isOn"], session.staffId]);
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});
