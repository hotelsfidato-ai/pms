import type { Client } from "./db.ts";

/* ══════════════════════════════════════════════════════════════════
   A STAY'S FOLIO, OPENED ON DEMAND

   Every posting needs a folio. A reservation has one from check-in, so
   `folioFor` opens one on demand rather than failing on a stay that has
   not been billed yet — an empty folio is a normal state.

   Two services call it: the front desk at check-in, and finance for every
   charge and payment. It sits in the core so that neither reaches into
   the other. Moved here unchanged from api/src/routes/operations.ts on
   15 September (docs/SERVICE-FOLDERS-PLAN.md).
   ══════════════════════════════════════════════════════════════════ */

export async function folioFor(
  client: Client, hotelId: string, stayId: string,
): Promise<string | null> {
  const { rows: existing } = await client.query<{ id: string }>(
    "select id from folios where hotel_id = $1 and reservation_id = $2 limit 1",
    [hotelId, stayId],
  );
  if (existing[0]) return existing[0].id;

  const { rows: res } = await client.query(
    "select 1 from reservations where hotel_id = $1 and id = $2",
    [hotelId, stayId],
  );
  if (!res.length) return null;

  const { rows: made } = await client.query<{ id: string }>(
    `insert into folios (hotel_id, reservation_id, status)
     values ($1, $2, 'open') returning id`,
    [hotelId, stayId],
  );
  return made[0]?.id ?? null;
}
