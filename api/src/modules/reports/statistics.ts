import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { monthStart } from "../../businessDate.ts";
import { dailyFigures, sumDays, propertyFor, isoDateParam } from "./figures.ts";
import { pct, ratio } from "./document.ts";

/* ══════════════════════════════════════════════════════════════════
   STATISTICS — occupancy, ADR, RevPAR, for the Dashboard and the
   property page

   Every figure is dailyFigures() in figures.ts, which the Manager
   report and Monthly and Yearly statistics add up too. The definitions
   live there, once, and are the owner's (17 September):

     available   app.sellable_rooms(hotel, date): the rooms minus the
                 blocks covering that date.
     sold        room-nights occupied, complimentary ones INCLUDED, as
                 the owner's eZee reports count them. Cancelled, no-show
                 and day-use occupy no night.
     revenue     room charges, each on the night it pays for. Extras,
                 food and tax never enter ADR.

   Monthly and yearly statistics used to be here as bare arrays; they
   are reports now, built in builders/statistics.ts.
   ══════════════════════════════════════════════════════════════════ */

export const statistics = new Hono<{ Variables: { subject: string } }>();

statistics.get("/:code/statistics/daily", async (c) => {
  const fromParam = isoDateParam(c.req.query("from"));
  const toParam = isoDateParam(c.req.query("to"));

  const body = await withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code"));
    if (!property) return null;
    const from = fromParam ?? monthStart(property.businessDate);
    const to = toParam ?? property.businessDate;

    return (await dailyFigures(client, property.id, from, to)).map((d) => ({
      date: d.date,
      availableRooms: d.available,
      roomsSold: d.sold,
      occupancyPct: pct(d.sold, d.available),
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

statistics.get("/:code/statistics/period", async (c) => {
  const fromParam = isoDateParam(c.req.query("from"));
  const toParam = isoDateParam(c.req.query("to"));

  const body = await withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code"));
    if (!property) return null;
    const from = fromParam ?? monthStart(property.businessDate);
    const to = toParam ?? property.businessDate;

    const t = sumDays(await dailyFigures(client, property.id, from, to));

    /* Rates from the TOTALS, never averaged from daily averages. */
    return {
      from,
      to,
      availableRoomNights: t.available,
      roomsSold: t.sold,
      occupancyPct: pct(t.sold, t.available),
      adr: ratio(t.room, t.sold),
      revpar: ratio(t.room, t.available),
      roomRevenue: t.room,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

statistics.get("/:code/statistics/snapshot", async (c) => {
  const dateParam = isoDateParam(c.req.query("date"));

  const body = await withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code"));
    if (!property) return null;
    const date = dateParam ?? property.businessDate;

    const day = (await dailyFigures(client, property.id, date, date))[0];
    if (!day) return null;

    return {
      date: day.date,
      available: day.available,
      sold: day.sold,
      vacant: day.available - day.sold,
      occupancyPct: pct(day.sold, day.available),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
