import type { MenuItem } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   WHAT ONE DISH COSTS

   ⚠ THIS RULE ALSO EXISTS ON THE SERVER, in `addOneLine`. That is a
   rule written in two places, which is the defect shape this codebase
   produces more often than any other — and it is here deliberately,
   because the owner decided a waiter must be able to answer "how much
   is that?" at the table without a round trip to Mumbai.

   Two things make it survivable, and both are load-bearing:

   1. IT IS WRITTEN ONCE ON THIS SIDE. The dish dialog and the order pad
      both call this function. Before it existed the dialog had its own
      copy, so the number a waiter saw while choosing sides and the
      number on the pad could already have disagreed.

   2. `api/test/padTotal.test.ts` PRICES THE SAME LINES BOTH WAYS and
      asserts they match. If you change how a dish is priced anywhere —
      here, in `addOneLine`, or in the database — that test is what
      catches you. Do not delete it to make a build pass.

   WHAT THIS IS NOT: the bill. No tax, no discount, no round-off, no
   service charge. Those belong to the server and the client never
   guesses at them.
   ══════════════════════════════════════════════════════════════════ */

/**
 * The price of ONE of this dish, sides included.
 *
 * A dish with variations has no price of its own — `item.price` is a
 * column nobody has looked at since the variations were added, and
 * charging it puts a number on the bill that is on no menu. So a
 * missing variation prices at zero here, and the caller must not offer
 * to add the line at all: `DishDialog` keeps Add disabled, and the
 * database refuses the line regardless.
 */
export function unitPriceOf(
  item: MenuItem,
  variationId: string | null | undefined,
  addonIds: Iterable<string> | null | undefined,
): number {
  const base = item.variations.length > 0
    ? item.variations.find((v) => v.id === variationId)?.price ?? 0
    : item.price;

  const wanted = new Set(addonIds ?? []);
  const sides = wanted.size === 0
    ? 0
    : item.addonGroups
        .flatMap((g) => g.addons)
        .filter((a) => wanted.has(a.id))
        .reduce((sum, a) => sum + a.price, 0);

  return base + sides;
}

/** The labels that go with those ids, so the pad can show a line
    without holding the menu — a draft reopened after a menu refresh
    still reads as the waiter wrote it. */
export function chosenLabels(
  item: MenuItem,
  variationId: string | null | undefined,
  addonIds: Iterable<string> | null | undefined,
): { variationLabel?: string; addonLabels: string[] } {
  const wanted = new Set(addonIds ?? []);
  const variationLabel = variationId
    ? item.variations.find((v) => v.id === variationId)?.label
    : undefined;
  const addonLabels = item.addonGroups
    .flatMap((g) => g.addons)
    .filter((a) => wanted.has(a.id))
    .map((a) => a.label);
  return { ...(variationLabel ? { variationLabel } : {}), addonLabels };
}
