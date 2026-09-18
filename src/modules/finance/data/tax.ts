import { api } from "@/lib/api";
/* GST rules, once, for both sides of the house.

   Service: finance. Moved out of roomSetup.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

import { call } from "@/data/repositories/http";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

/* ══════════════════════════════════════════════════════════════════
   GST, ONCE, FOR BOTH SIDES OF THE HOUSE

   A KIND is what is being sold. A SLAB is a rate that applies above an
   amount, because the rate on a room turns on what the room costs:
   5% at or under ₹7,500, 18% above it.

   Everything the front desk posts — the night, an early arrival, a
   late departure, laundry — follows 'room'. Every menu category names
   the kind it sells under, which is how a bar section on the same card
   carries a different rate from the food.

   A kind with no slabs is UNSET, and unset refuses to bill. It does
   not bill at zero. That is the same rule as every price in this
   system: a dash is an admission, a zero is a claim.
   ══════════════════════════════════════════════════════════════════ */

export type TaxKind = "room" | "restaurant" | "bar" | "banquet" | "other";

export interface TaxSlab {
  id: string;
  /** The rate applies above this amount. 0 is the base slab, and a
      kind without one has a hole under its lowest rate. */
  overAmount: number;
  rate: number;
  note: string | null;
  setBy: string | null;
}

export interface TaxKindRules {
  kind: TaxKind;
  slabs: TaxSlab[];
}

export interface MenuCategoryTax {
  name: string;
  /** Null cannot be sold — the till refuses and names the category. */
  kind: TaxKind | null;
  items: number;
}

export interface TaxSetup {
  kinds: TaxKindRules[];
  categories: MenuCategoryTax[];
}

export async function getTaxSetup(hotelId: string): Promise<TaxSetup> {
  if (!hotelId) return { kinds: [], categories: [] };
  return api<TaxSetup>(`/api/hotels/${hotelId}/tax`);
}

/** Replaces every slab for one kind. Whole-kind rather than row-by-row
    because the slabs only mean anything together — saving them one at a
    time passes through states where an ordinary room has no rate. An
    empty list puts the kind back to unset. */
export async function setTaxRules(
  hotelId: string,
  kind: TaxKind,
  slabs: { overAmount: number; rate: number; note?: string | null }[],
): Promise<Result<{ slabs: number }>> {
  return call(`/api/hotels/${hotelId}/tax/${kind}`, "PUT", { slabs });
}

export async function setCategoryTaxKind(
  hotelId: string, category: string, kind: TaxKind | null,
): Promise<Result> {
  return call(
    `/api/hotels/${hotelId}/menu-categories/${encodeURIComponent(category)}/tax-kind`,
    "PATCH", { kind });
}
