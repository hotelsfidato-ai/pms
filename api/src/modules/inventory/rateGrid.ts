import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";

/* Split out of api/src/routes/billing.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: inventory.
   Rack rate against the rate achieved, per room type per day — the Rate
   performance screen. `hotelIdFor` and `round` are copies of billing's.
   One change since the move: an unpriced room type's rack rate travels as
   null, not 0 (INV-3, 16 September). */

export const rateGrid = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/* ── Rates ───────────────────────────────────────────────────────── */

rateGrid.get("/:code/rates", async (c) => {
  const fromParam = c.req.query("from");
  const days = Number(c.req.query("days") ?? 14);

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const from = fromParam ?? bd;

    /* Rack against achieved. Rack is flat because there is no published
       rate calendar — every difference in the achieved line is
       something a person negotiated on the day, which is exactly what
       a revenue manager wants to see.

       Sold counts PAYING rooms. A complimentary room is occupied and
       sold for nothing; counting it would disagree with the rate beside
       it and with Sold Room on the Manager Report. */
    const { rows } = await client.query<{
      room_type: string; base_rate: string | null; date: string;
      sold: string; sellable: string; sold_adr: string | null;
    }>(
      `with dates as (
         select d::date as date
           from generate_series($2::date, $2::date + ($3 - 1), interval '1 day') d
       ),
       types as (
         /* sort_order is SELECTED here because the query below groups and
            orders by it. It was not, so every call to this endpoint died
            on 'column t.sort_order does not exist' -- and the Rates
            screen showed an empty state that read like "Stage 9 has not
            landed yet" rather than "this request failed".

            An empty screen and a broken one look identical.

            (No backticks: this comment is inside a template literal, and
            one would end it. operations.ts already carries the same
            warning, which I had read.) */
         select id, name, base_rate, sort_order from room_types
          where hotel_id = $1 and is_active
       )
       select t.name as room_type, t.base_rate, dates.date::text,
              count(r.id) filter (where not r.is_complimentary)::text as sold,
              (select count(*) from rooms rm
                where rm.room_type_id = t.id and rm.is_active
                  and not exists (
                    select 1 from room_blocks b
                     where b.room_id = rm.id
                       and dates.date >= b.from_date
                       and (b.to_date is null or dates.date <= b.to_date)
                  ))::text                                           as sellable,
              avg(r.agreed_rate) filter (
                where not r.is_complimentary)::text                  as sold_adr
         from types t
         cross join dates
         left join reservations r
                on r.room_type_id = t.id
               and r.status in ('confirmed','checked_in','checked_out')
               and dates.date >= r.check_in
               and dates.date <  greatest(r.check_out, r.check_in + 1)
        group by t.id, t.name, t.base_rate, t.sort_order, dates.date
        order by t.sort_order, dates.date`,
      [hotelId, from, days],
    );

    const byType = new Map<string, {
      roomType: string; rackRate: number | null;
      cells: Array<{ date: string; rackRate: number | null; soldAdr: number | null; sold: number; sellable: number }>;
    }>();

    for (const r of rows) {
      /* null, not 0 (INV-3). `base_rate` is NULL until somebody prices the
         room type (032), and `Number(null)` is 0 — so this answered "rack
         ₹0" for every unpriced room, which a channel manager fed from here
         would push to the booking sites as a free room. */
      const rack = r.base_rate === null ? null : Number(r.base_rate);
      if (!byType.has(r.room_type)) {
        byType.set(r.room_type, { roomType: r.room_type, rackRate: rack, cells: [] });
      }
      byType.get(r.room_type)!.cells.push({
        date: r.date,
        rackRate: rack,
        soldAdr: r.sold_adr === null ? null : round(Number(r.sold_adr)),
        sold: Number(r.sold),
        sellable: Number(r.sellable),
      });
    }

    return [...byType.values()];
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
