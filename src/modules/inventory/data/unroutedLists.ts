import { fetchOr } from "@/data/repositories/http";
import { BUSINESS_DATE } from "@/data/repositories/businessDate";
/* Room types and rate plans as the old directory listed them. Their two screens (RoomTypesPage, RatePlansPage) are routed nowhere — kept, not deleted, pending the owner (PENDING.md).

   Service: inventory. Moved out of directory.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ── Room types and rate plans ───────────────────────────────────── */

export interface RoomTypeRecord {
  type: string;
  rooms: number;
  sellable: number;
  maxOccupancy: number;
  rackRate: number;
  numbers: string[];
}

export async function listRoomTypes(hotelId: string): Promise<RoomTypeRecord[]> {
  if (!hotelId) return [];
  return fetchOr<RoomTypeRecord[]>(
    `/api/hotels/${hotelId}/room-types?asOn=${BUSINESS_DATE}`,
    [],
  );
}

export interface RatePlanRecord {
  code: string;
  name: string;
  includes: string;
  /** Where the live system shows it, e.g. "Deluxe CP". */
  seenAs: string | null;
}

export async function listRatePlans(): Promise<RatePlanRecord[]> {
  return fetchOr<RatePlanRecord[]>("/api/hotels/rate-plans", []);
}
