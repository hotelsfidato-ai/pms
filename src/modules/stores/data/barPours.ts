import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   WHAT EACH BAR DISH TAKES (the owner's D27-354) - the screen's calls.
   The server's half: api/src/modules/stores/barPours.ts.
   ══════════════════════════════════════════════════════════════════ */

export interface Pour { stockItemId: string; ml: number | null; units: number | null }

export interface BarDish {
  itemId: string; item: string; category: string;
  variationId: string | null; size: string | null;
  /** What it takes now; null when nothing is set. */
  pour: Pour | null;
  /** What the names suggest, for one not set: shown, saved only when chosen. */
  proposed: Pour | null;
}

export interface BarPours {
  store: { id: string; name: string; isActive: boolean } | null;
  /** The bar's drinks, what the bar store holds of each, how each is counted
      and where it sits in the excise registers (D27-361). */
  drinks: {
    id: string; name: string; unit: string; sizeMl: number | null; onHand: number | null;
    countAs: "poured" | "whole" | "packet"; packSize: number | null; brand: string | null;
    liquor: string | null; imported: boolean;
  }[];
  dishes: BarDish[];
}

export const getBarPours = (hotelId: string) => api<BarPours>(`/api/hotels/${hotelId}/bar/pours`);

export async function saveBarPours(hotelId: string, pours: Array<Pour & { itemId: string; variationId: string | null }
  | { itemId: string; variationId: string | null; stockItemId: null; ml: null; units: null }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await api(`/api/hotels/${hotelId}/bar/pours`, { method: "PUT", body: JSON.stringify({ pours }) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
