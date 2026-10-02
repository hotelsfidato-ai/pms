import { fetchOr } from "@/data/repositories/http";

/** What the guests due out on the business date still owe (the owner's
    D27-243): who is leaving, how many owe on their own bills, and how much.
    The server asks `invoice` (D27-147), so only whoever sees money asks.
    Null when the property is not found: no figure, a dash. */
export interface DueOut {
  date: string;
  leaving: number;
  owing: number;
  owed: number;
}

export async function getDueOut(hotelId: string): Promise<DueOut | null> {
  if (!hotelId) return null;
  return fetchOr<DueOut | null>(`/api/hotels/${hotelId}/due-out`, null);
}
