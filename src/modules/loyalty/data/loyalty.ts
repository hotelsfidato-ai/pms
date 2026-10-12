import { api, ApiError } from "@/lib/api";
import { call } from "@/data/repositories/http";
import type { AdminResult } from "@/data/repositories/result";

/* Loyalty (D27-178, D27-179). The rules are the database's; the server
   answers a refusal as a sentence, which these return as a value. */

export interface LoyaltyStay {
  id: string;
  reference: string;
  room: string | null;
  guestId: string;
  name: string;
  hasPhone: boolean;
  member: boolean;
  /** Null for a guest who is not a member. */
  points: number | null;
  /** False for a booking site's or an agent's booking: no points off it (L14). */
  direct: boolean;
}

export interface LoyaltyScreen {
  /** The programme's name and earn rate: group settings, null until set (L1, L8). */
  name: string | null;
  pointsPer100: number | null;
  /** What the guest agrees to (L4); null while the programme has no name. */
  words: string | null;
  maySetRules: boolean;
  isOn: boolean;
  isManager: boolean;
  /** Reception and above may take points off a bill; not the Accountant (D27-305). */
  mayRedeem: boolean;
  stays: LoyaltyStay[];
}

export const getLoyalty = (hotelId: string) =>
  api<LoyaltyScreen>(`/api/hotels/${hotelId}/loyalty`);

export const saveRules = (hotelId: string, name: string, pointsPer100: number | null) =>
  call(`/api/hotels/${hotelId}/loyalty/rules`, "PUT", { name, pointsPer100 });

export const joinLoyalty = (hotelId: string, guestId: string) =>
  call(`/api/hotels/${hotelId}/loyalty/guests/${guestId}/join`, "POST", { agreed: true });

export const leaveLoyalty = (hotelId: string, guestId: string) =>
  call(`/api/hotels/${hotelId}/loyalty/guests/${guestId}/leave`, "POST", {});

/** Points off the stay's room charges. `pressKey` is one per press, so a
    double tap takes the points once. */
export async function spendPoints(
  hotelId: string, stayId: string, points: number, pressKey: string,
): Promise<AdminResult> {
  try {
    await api(`/api/hotels/${hotelId}/loyalty/stays/${stayId}/redeem`, {
      method: "POST", body: JSON.stringify({ points }), headers: { "idempotency-key": pressKey },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export interface StatementLine {
  id: number;
  kind: "earn" | "redeem" | "adjust" | "lapse";
  points: number;
  reason: string | null;
  at: string;
  hotelName: string;
  reference: string | null;
  /** A use whose discount line was reversed on the bill: the points came back. */
  undone: boolean;
}

export interface LoyaltyCard {
  member: { since: string; hotelName: string } | null;
  points: number;
  statement: StatementLine[];
}

export const getCard = (hotelId: string, guestId: string) =>
  api<LoyaltyCard>(`/api/hotels/${hotelId}/loyalty/guests/${guestId}`);

export const adjustPoints = (hotelId: string, guestId: string, points: number, reason: string) =>
  call(`/api/hotels/${hotelId}/loyalty/guests/${guestId}/adjust`, "POST", { points, reason });

export interface HotelMonth { hotelCode: string; hotelName: string; earned: number; used: number }

export const getByHotel = (hotelId: string, month: string) =>
  api<HotelMonth[]>(`/api/hotels/${hotelId}/loyalty/by-hotel?month=${month}`);
