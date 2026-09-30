import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import { dailyFigures } from "../reports/index.ts";

/* Split out of api/src/routes/billing.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: inventory.

   30 September (D27-188, D27-194): each day's performance under its price
   on the Rates screen, for the hotel as a whole.

     Paying rooms sold, ADR, revenue   the rate screens' own rule (D27-151):
                                       paying rooms only - a complimentary
                                       room is sold for nothing and would pull
                                       the rate down - no day use, at the
                                       booked nightly rate, before tax
     Occupancy                         the one rule everywhere (D27-151, the
                                       Manager report's D17-62): complimentary
                                       in, over sellable rooms - read from the
                                       reports' own derivation, never a copy */
export const rateGrid = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

const round = (n: number) => Math.round(n * 100) / 100;

rateGrid.get("/:code/rates", async (c) => {
  const fromParam = c.req.query("from");
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 14), 1), 62);

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const from = fromParam ?? await businessDateFor(client, hotelId);

    const { rows } = await client.query<{
      date: string; last: string; sold: number; revenue: string | null;
    }>(
      `select d::date::text as date,
              ($2::date + ($3 - 1))::text as last,
              count(r.id) filter (where not r.is_complimentary)::int as sold,
              sum(r.agreed_rate) filter (where not r.is_complimentary)::text as revenue
         from generate_series($2::date, $2::date + ($3 - 1), interval '1 day') d
         left join reservations r
                on r.hotel_id = $1
               and r.status in ('confirmed','checked_in','checked_out')
               and d::date >= r.check_in
               and d::date <  r.check_out
        group by d
        order by d`,
      [hotelId, from, days],
    );
    const figures = rows.length === 0
      ? [] : await dailyFigures(client, hotelId, from, rows[0]!.last);

    return rows.map((r) => {
      const f = figures.find((x) => x.date === r.date);
      const revenue = r.revenue === null ? 0 : Number(r.revenue);
      return {
        date: r.date,
        paidSold: r.sold,
        /* null, a dash: no rooms to sell, or nothing sold to average. */
        occupancy: f && f.available > 0 ? round((f.sold / f.available) * 100) : null,
        adr: r.sold > 0 ? round(revenue / r.sold) : null,
        revenue: round(revenue),
      };
    });
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
