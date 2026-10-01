import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE TAX A PROPERTY ACTUALLY CHARGES — read, not set

   ADM-2, the owner's decision of 17 September (D17-37): Settings and the
   Properties cards show the tax actually used, with "-" where nothing is
   set. They printed `hotels.cgst_rate` + `sgst_rate` — a flat 2.5% + 2.5%
   that migration 067 replaced with `tax_rules`, per kind of supply and in
   slabs (a room at or under ₹7,500 at one rate, above it at another).

   The rules belong to FINANCE: its `GET /:code/tax` is the one reader of
   `tax_rules` the front desk and the till are billed from, and its
   `TaxRulesCard` on Configuration is where they are set. This asks that
   route over HTTP — as Settings already asks finance for the invoice
   series — rather than reading the table a second way. If its shape
   changes, this breaks: `MODULE.md`, "Leans on".

   A failed read THROWS. It must not come back as "nothing set": a dash
   is a statement that nobody has set a rate, and an unreachable server
   has not said that (MEMORY 251).
   ══════════════════════════════════════════════════════════════════ */

export type TaxKind = "room" | "restaurant" | "bar" | "banquet" | "spa" | "alcohol" | "laundry" | "other";

export interface TaxInUse {
  kind: TaxKind;
  /** Lowest boundary first. Empty means nobody has set a rate. */
  slabs: Array<{ overAmount: number; rate: number }>;
}

interface FinanceTaxSetup {
  kinds: Array<{
    kind: TaxKind;
    slabs: Array<{ overAmount: number; rate: number }>;
  }>;
}

export async function getTaxInUse(hotelCode: string): Promise<TaxInUse[]> {
  if (!hotelCode) return [];
  const body = await api<FinanceTaxSetup>(`/api/hotels/${hotelCode}/tax`);
  return body.kinds.map((k) => ({
    kind: k.kind,
    slabs: [...k.slabs]
      .map((s) => ({ overAmount: Number(s.overAmount), rate: Number(s.rate) }))
      .sort((a, b) => a.overAmount - b.overAmount),
  }));
}
