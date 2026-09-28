import { api, ApiError } from "@/lib/api";
import type { AdminResult } from "@/data/repositories/result";
import { write } from "@/data/repositories/http";
/* Rate plans and cancellation terms.

   Service: inventory. Moved out of admin.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ── Rates — what a room costs ────────────────────────────────────── */

export interface RateRoomType {
  id: string;
  code: string;
  name: string;
  /** NULL until the hotel sets one. Never 0 — see migration 032. */
  rackRate: number | null;
  maxOccupancy: number;
  rooms: number;
}

export interface RateRule {
  id: string;
  roomTypeId: string;
  roomType: string;
  mealPlan: string;
  price: number;
  from: string;
  /** null is open-ended, which is what a rack rate is. */
  to: string | null;
  label: string | null;
  setBy: string | null;
  isCurrent: boolean;
}

export interface RatesBoard {
  businessDate: string;
  roomTypes: RateRoomType[];
  mealPlans: { code: string; name: string; includes: string }[];
  rates: RateRule[];
}

export async function getRates(hotelId: string): Promise<RatesBoard | null> {
  if (!hotelId) return null;
  try {
    return await api<RatesBoard>(`/api/hotels/${hotelId}/rate-plans`);
  } catch {
    return null;
  }
}

export async function setRackRate(
  hotelId: string, roomTypeId: string, rate: number | null, free = false,
): Promise<AdminResult<{ roomType: string }>> {
  try {
    return await api(`/api/hotels/${hotelId}/room-types/${roomTypeId}/rate`, {
      method: "PUT",
      /* free: 0 is kept only when ticked Free (X-1, D27-120). */
      body: JSON.stringify({ rate, ...(free ? { free } : {}) }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export function addRate(
  hotelId: string,
  input: {
    roomTypeId: string; mealPlan: string; price: number;
    from: string; to?: string | null; label?: string; free?: boolean;
  },
): Promise<AdminResult<{ roomType: string }>> {
  return write(`/api/hotels/${hotelId}/rate-plans`, input);
}

export async function removeRate(
  hotelId: string, rateId: string,
): Promise<AdminResult> {
  try {
    await api(`/api/hotels/${hotelId}/rate-plans/${rateId}`, { method: "DELETE" });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/* ══════════════════════════════════════════════════════════════════
   CANCELLATION TERMS

   The night audit charged nothing on a no-show because nothing said
   what one costs. These let a property write its own terms down.

   Ships with none, like the prices. A property with no policy has no
   terms and the audit charges nothing — which is what it did before
   any of this existed, and is the honest answer rather than a figure
   nobody agreed to.
   ══════════════════════════════════════════════════════════════════ */

export const RETENTION_BASES = [
  { value: "nothing", label: "Nothing" },
  { value: "first_night", label: "The first night" },
  { value: "full_stay", label: "The whole stay" },
  { value: "percent", label: "A percentage of the booking" },
  { value: "flat", label: "A fixed amount" },
] as const;

export interface CancellationPolicy {
  id: string;
  name: string;
  freeUntilHours: number | null;
  cancelBasis: string;
  cancelPercent: number | null;
  cancelAmount: number | null;
  noShowBasis: string;
  noShowPercent: number | null;
  noShowAmount: number | null;
  bookings: number;
  /* The property's own choice of which terms a new booking gets. Not a
     shipped default — false on every policy until somebody says so. */
  appliesToNewBookings: boolean;
}

export async function listCancellationPolicies(
  hotelId: string,
): Promise<CancellationPolicy[]> {
  if (!hotelId) return [];
  return await api<CancellationPolicy[]>(
    `/api/hotels/${hotelId}/cancellation-policies`,
  );
}

export function addCancellationPolicy(
  hotelId: string,
  input: {
    name: string; freeUntilHours: number | null;
    cancelBasis: string; cancelPercent: number | null; cancelAmount: number | null;
    noShowBasis: string; noShowPercent: number | null; noShowAmount: number | null;
  },
): Promise<AdminResult> {
  return write(`/api/hotels/${hotelId}/cancellation-policies`, input);
}

export async function retireCancellationPolicy(
  hotelId: string, id: string,
): Promise<AdminResult> {
  try {
    await api(`/api/hotels/${hotelId}/cancellation-policies/${id}`, {
      method: "DELETE",
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

export async function setDefaultCancellationPolicy(
  hotelId: string, id: string, on: boolean,
): Promise<AdminResult<{ name: string | null }>> {
  /* Not through `write()`: that helper always POSTs and its third
     argument is a provisioning key, not a method. Passing "PUT" there
     would have sent a nonsense x-provisioning-key header on a POST to
     an endpoint that only answers PUT. */
  try {
    const result = await api<{ ok: true; name: string | null }>(
      `/api/hotels/${hotelId}/cancellation-policies/${id}/default`,
      { method: "PUT", body: JSON.stringify({ on }) },
    );
    return { ok: true, name: result.name };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
