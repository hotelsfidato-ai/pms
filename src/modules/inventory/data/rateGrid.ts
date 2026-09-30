import { fetchOr } from "@/data/repositories/http";

/* Each day's performance under its price on the Rates screen, for the
   hotel as a whole (D27-188, D27-194). Service: inventory.

   Paying rooms sold, ADR and revenue are the rate screens' own rule
   (D27-151): paying rooms only, no day use, at the booked nightly rate
   before tax. Occupancy is the one rule everywhere: complimentary in,
   over sellable rooms. */

export interface RateDay {
  date: string;
  paidSold: number;
  /** A percentage; null when the hotel had no rooms to sell. */
  occupancy: number | null;
  /** null when nothing was sold - a dash, never ₹0. */
  adr: number | null;
  revenue: number;
}

export async function getRateDays(
  hotelId: string, from: string, days = 14,
): Promise<RateDay[]> {
  if (!hotelId) return [];
  return fetchOr<RateDay[]>(
    `/api/hotels/${hotelId}/rates?from=${encodeURIComponent(from)}&days=${days}`,
    [],
  );
}
