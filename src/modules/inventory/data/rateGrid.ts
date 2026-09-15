import { BUSINESS_DATE } from "@/data/repositories/businessDate";
import { fetchOr } from "@/data/repositories/http";
/* The rate grid.

   Service: inventory. Moved out of billing.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ── Rates ───────────────────────────────────────────────────────── */

export interface RateCell {
  date: string;
  rackRate: number;
  /** What rooms of this type actually sold for on the date. */
  soldAdr: number | null;
  sold: number;
  sellable: number;
}

export interface RateRow {
  roomType: string;
  rackRate: number;
  cells: RateCell[];
}

/**
 * Rack against achieved: a report on what rooms actually SOLD for,
 * against the room type's rack rate.
 *
 * Not to be confused with `getPriceGrid` in `rates.ts`, which is the
 * pricing calendar — what a room WILL cost. This one looks backwards
 * and that one forwards, and every difference in the achieved line
 * here is something a person negotiated on the day.
 */
export async function getRateGrid(
  hotelId: string,
  from = BUSINESS_DATE,
  days = 14,
): Promise<RateRow[]> {
  if (!hotelId) return [];
  return fetchOr<RateRow[]>(
    `/api/hotels/${hotelId}/rates?from=${encodeURIComponent(from)}&days=${days}`,
    [],
  );
}
