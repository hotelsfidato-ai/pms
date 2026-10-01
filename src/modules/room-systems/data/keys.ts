import { api, ApiError } from "@/lib/api";

/* Key cards for a stay (D27-178): the server's record, and cutting cards.
   The room and the validity are the server's to decide, so the only things
   sent are how many cards, and whether one was lost. */

export interface KeyAct {
  act: "issue" | "cancel";
  why: "check_in" | "reissue" | "lost" | "check_out" | "move";
  cards: number | null;
  validUntil: string | null;
  room: string;
  outcome: "done" | "failed";
  /** The lock system's own words. */
  answer: string | null;
  /** Null where this person may not see a colleague's name: a dash. */
  by: string | null;
  at: string;
}

export interface StayKeys {
  connected: boolean;
  maxCards: number;
  /** When a card cut now would stop: the departure at the check-out time. */
  stayEnds: string;
  live: { room: string; cards: number; validUntil: string } | null;
  acts: KeyAct[];
}

export const keysKey = (hotelId: string, stayId: string) => ["key-cards", hotelId, stayId];

export const getKeys = (hotelId: string, stayId: string) =>
  api<StayKeys>(`/api/hotels/${hotelId}/stays/${stayId}/keys`);

export async function cutCards(
  hotelId: string, stayId: string, input: { cards: number; lost?: boolean },
): Promise<{ ok: true; answer: string } | { ok: false; reason: string }> {
  try {
    const out = await api<{ answer: string }>(`/api/hotels/${hotelId}/stays/${stayId}/keys`, {
      method: "POST", body: JSON.stringify(input) });
    return { ok: true, answer: out.answer };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
