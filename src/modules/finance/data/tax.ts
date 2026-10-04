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

/** "alcohol" is VAT, not GST (D21-91), and is listed only where the property
    is switched on for it (D21-90). */
export type TaxKind = "room" | "restaurant" | "bar" | "banquet" | "spa" | "alcohol" | "laundry" | "other";

export interface TaxSlab {
  id: string;
  /** The rate applies above this amount. 0 is the base slab, and a
      kind without one has a hole under its lowest rate. */
  overAmount: number;
  rate: number;
  note: string | null;
  setBy: string | null;
  /** Half-open by the business date (D27-258 Q7): null from = always,
      null to = current. */
  validFrom: string | null;
  validTo: string | null;
}

export interface TaxKindRules {
  kind: TaxKind;
  /** The SAC printed on its lines (D27-258 Q6). Null: not said - rooms keep
      996311 as every invoice has, the others are a dash. */
  sac: string | null;
  slabs: TaxSlab[];
}

/** Rooms' code when nobody has said another: what invoices have always carried. */
export const sacShown = (rules: Pick<TaxKindRules, "kind" | "sac">): string =>
  rules.sac ?? (rules.kind === "room" ? "996311" : "-");

export interface MenuCategoryTax {
  name: string;
  /** Null cannot be sold — the till refuses and names the category. */
  kind: TaxKind | null;
  items: number;
}

export interface TaxSetup {
  /** Whether the property is switched on for alcohol (D21-90). The
      "alcohol" kind is in `kinds` only when it is. */
  servesAlcohol: boolean;
  kinds: TaxKindRules[];
  categories: MenuCategoryTax[];
}

export async function getTaxSetup(hotelId: string): Promise<TaxSetup> {
  if (!hotelId) return { servesAlcohol: false, kinds: [], categories: [] };
  return api<TaxSetup>(`/api/hotels/${hotelId}/tax`);
}

/** The rate one charge of this kind and value will carry, from the server's
    one slab rule (`app.gst_rate_or_null`) - or null where nobody has set
    one, which a screen prints as a dash, never 0%. */
export async function getTaxRate(
  hotelId: string, kind: TaxKind, amount: number,
): Promise<{ rate: number | null; scheme: "gst" | "vat" }> {
  return api(`/api/hotels/${hotelId}/tax/${kind}/rate?amount=${encodeURIComponent(String(amount))}`);
}

/** Replaces every slab for one kind. Whole-kind rather than row-by-row
    because the slabs only mean anything together — saving them one at a
    time passes through states where an ordinary room has no rate. An
    empty list puts the kind back to unset. */
export async function setTaxRules(
  hotelId: string,
  kind: TaxKind,
  slabs: { overAmount: number; rate: number; note?: string | null;
           validFrom?: string | null; validTo?: string | null }[],
): Promise<Result<{ slabs: number }>> {
  return call(`/api/hotels/${hotelId}/tax/${kind}`, "PUT", { slabs });
}

/** Six digits, or null to clear it (the CA's code, never suggested). */
export async function setTaxSac(hotelId: string, kind: TaxKind, sacCode: string | null): Promise<Result> {
  return call(`/api/hotels/${hotelId}/tax/${kind}/sac`, "PUT", { sacCode });
}

export async function setCategoryTaxKind(
  hotelId: string, category: string, kind: TaxKind | null,
): Promise<Result> {
  return call(
    `/api/hotels/${hotelId}/menu-categories/${encodeURIComponent(category)}/tax-kind`,
    "PATCH", { kind });
}

/** A room rate that includes GST, split as the booking will keep it (D27-195):
    the rate before GST and its slab, the nearest total not above the figure,
    or the server's refusal (the slab gap, no room rule). */
export async function getRateBeforeGst(
  hotelId: string, gross: number,
): Promise<{ ok: true; pre: number; rate: number; total: number } | { ok: false; reason: string }> {
  return api(`/api/hotels/${hotelId}/tax/room/before-gst?gross=${encodeURIComponent(String(gross))}`);
}
