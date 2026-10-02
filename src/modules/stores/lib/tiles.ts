import type { StockItem, StoreSummary } from "@/modules/stores/data/stores";

/* ══════════════════════════════════════════════════════════════════
   THE STORE'S TILES (D27-238; the owner's meanings, D27-242 Q3)

   One definition for the Shelf and the Days view, so the two never count
   differently. Each answers for the place picked at the top, or for every
   place together.
   ══════════════════════════════════════════════════════════════════ */

export type Tile =
  | "below" | "runOut" | "received" | "issued" | "wasted" | "awaiting" | "notValued" | "notCounted";

export const TILES: { key: Tile; label: string; job: boolean }[] = [
  { key: "below", label: "Below level", job: true },
  { key: "runOut", label: "Run out", job: true },
  { key: "received", label: "Received today", job: false },
  { key: "issued", label: "Issued today", job: false },
  { key: "wasted", label: "Wasted today", job: false },
  { key: "awaiting", label: "Awaiting delivery", job: false },
  { key: "notValued", label: "Not valued", job: true },
  { key: "notCounted", label: "Not counted in 30 days", job: true },
];

export const isTile = (t: string | null): t is Tile => TILES.some((x) => x.key === t);

/** Days from one ISO date to another. */
const daysFrom = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Does this item answer this tile, in the picked place (or all)? */
export function inTile(tile: Tile, i: StockItem, picked: StoreSummary | null, today: string): boolean {
  const here = (places?: string[]) => (places ?? []).some((p) => !picked || p === picked.id);
  /* Where it is held now: the picked place, or every place holding some. */
  const heldAt = Object.entries(i.byStore)
    .filter(([p, n]) => n > 0 && (!picked || p === picked.id)).map(([p]) => p);
  switch (tile) {
    case "below": return picked ? i.lowIn.includes(picked.id) : i.low;
    /* Had some, holds none. */
    case "runOut": return picked
      ? i.heldIn.includes(picked.id) && (i.byStore[picked.id] ?? 0) <= 0
      : i.heldIn.length > 0 && i.onHand <= 0;
    case "received": return here(i.today.receipt);
    case "issued": return here(i.today.issue);
    /* Waste, and crockery broken. */
    case "wasted": return here(i.today.wastage) || here(i.today.breakage);
    case "awaiting": return Object.entries(i.onOrder).some(([s, q]) => q > 0 && (!picked || s === picked.id));
    case "notValued": return i.unitCost === null && heldAt.length > 0;
    /* Held somewhere not counted there for 30 days; never counted counts. */
    case "notCounted": return heldAt.some((p) => !i.lastCounted[p] || daysFrom(i.lastCounted[p]!, today) >= 30);
  }
}
