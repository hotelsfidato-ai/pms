import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { folioBalance } from "../finance/index.ts";
import { propertyFor } from "./figures.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT DEPARTING GUESTS STILL OWE — the Dashboard's Due out tile
   (the owner's D27-243, 2 October)

   The guests due out on the hotel's business date who have not left; how
   many of them owe on their own bills, and how much. "Owes" is the night
   audit's rule (night-audit/checklist.ts): more than half a rupee. Each
   bill's balance is finance's (folioBalance), so this tile, the bill and
   the night audit cannot disagree. A group's master bill is not the
   guest's (D27-226): only bills on the stay itself count.

   Money owed: the role gate asks `invoice`, as the other money-owed reads
   do (D27-147), so the revenue manager is not let in.
   ══════════════════════════════════════════════════════════════════ */

export const dueOut = new Hono<{ Variables: { subject: string } }>();

dueOut.get("/:code/due-out", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code"));
    if (!property) return null;

    const { rows } = await client.query<{ stay: string; folio: string | null }>(
      `select r.id::text as stay, f.id::text as folio
         from reservations r
         left join folios f on f.reservation_id = r.id
        where r.hotel_id = $1 and r.status = 'checked_in' and r.check_out = $2::date`,
      [property.id, property.businessDate]);

    /* ponytail: one balance read per bill; a day's departures are a handful. */
    const owes = new Map<string, number>();
    for (const r of rows) {
      const balance = r.folio ? (await folioBalance(client, r.folio))?.balance ?? 0 : 0;
      owes.set(r.stay, (owes.get(r.stay) ?? 0) + balance);
    }
    const owing = [...owes.values()].filter((b) => b > 0.5);
    return {
      date: property.businessDate,
      leaving: owes.size,
      owing: owing.length,
      owed: Math.round(owing.reduce((t, b) => t + b, 0) * 100) / 100,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
