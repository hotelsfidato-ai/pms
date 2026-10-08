import type { MenuItem, MenuVariation } from "@/modules/pos/data/till";

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

   2. `api/test/modules/pos/padTotal.test.ts` PRICES THE SAME LINES BOTH WAYS and
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
  /* The choice of each further type (D27-192): each ADDS its price to
     the first type's, which carries the dish's. */
  moreChoiceIds: Iterable<string> | null | undefined = undefined,
): number {
  const [first, ...later] = typesOf(item);
  const base = first
    ? first.choices.find((v) => v.id === variationId)?.price ?? 0
    : item.price;
  const more = new Set(moreChoiceIds ?? []);
  const added = later.flatMap((t) => t.choices)
    .filter((v) => more.has(v.id))
    .reduce((sum, v) => sum + v.price, 0);

  const wanted = new Set(addonIds ?? []);
  const sides = wanted.size === 0
    ? 0
    : item.addonGroups
        .flatMap((g) => g.addons)
        .filter((a) => wanted.has(a.id))
        .reduce((sum, a) => sum + a.price, 0);

  return base + added + sides;
}

/** A dish's variation types, in order (D27-192), each under the heading
    a waiter reads. A menu cached before the types reads as one type. */
export function typesOf(item: MenuItem): {
  typeNo: number; heading: string; choices: MenuVariation[];
}[] {
  const byType = new Map<number, MenuVariation[]>();
  for (const v of item.variations) {
    const n = v.typeNo ?? 1;
    byType.set(n, [...(byType.get(n) ?? []), v]);
  }
  return [...byType.entries()].sort(([a], [b]) => a - b)
    .map(([typeNo, choices]) => ({ typeNo, heading: headingOf(choices[0]!), choices }));
}

/** "Size", "Quantity", an Option's own heading, or "Variation" for one
    whose kind nobody has picked yet (carried over, D27-195). */
export function headingOf(v: MenuVariation): string {
  return v.heading ?? (v.kind === "size" ? "Size"
    : v.kind === "quantity" ? "Quantity" : "Variation");
}

/** The labels that go with those ids, so the pad can show a line
    without holding the menu — a draft reopened after a menu refresh
    still reads as the waiter wrote it. */
export function chosenLabels(
  item: MenuItem,
  variationId: string | null | undefined,
  addonIds: Iterable<string> | null | undefined,
  moreChoiceIds: Iterable<string> | null | undefined = undefined,
): { variationLabel?: string; addonLabels: string[] } {
  const wanted = new Set(addonIds ?? []);
  /* Every choice, in type order, as the kitchen's docket reads them. */
  const picked = new Set([variationId, ...(moreChoiceIds ?? [])]);
  const variationLabel = typesOf(item).flatMap((t) => t.choices)
    .filter((v) => picked.has(v.id)).map((v) => v.label).join(", ") || undefined;
  const addonLabels = item.addonGroups
    .flatMap((g) => g.addons)
    .filter((a) => wanted.has(a.id))
    .map((a) => a.label);
  return { ...(variationLabel ? { variationLabel } : {}), addonLabels };
}

/* ══════════════════════════════════════════════════════════════════
   THE NUMBERED ADD-ONS ON A DISH (D27-289)

   ⚠ THE SAME RULE AS THE SERVER'S `api/src/modules/pos/numberedAddons.ts`
   (`priceWithAddons`, `nameWithAddons`), for the same reason as above: the
   waiter sees "₹430" before Send. `padTotal.test.ts` prices and names the
   same choices both ways. The server's figure wins on the bill.
   ══════════════════════════════════════════════════════════════════ */

/** One of a dish with its numbered add-ons: each add-on's price times how
    many, worked in paise as the server does, so the two round alike. */
export function priceWithAddons(
  base: number, addons: readonly { price: number; qty: number }[],
): number {
  const paise = (rupees: number) => Math.round(rupees * 100);
  return (paise(base) + addons.reduce((sum, a) => sum + paise(a.price) * a.qty, 0)) / 100;
}

/** "Veg Biryani with add-on Kebab"; "… with add-ons Kebab ×2, Raita". In
    number order, as the server keeps them. */
export function nameWithAddons(
  dish: string, addons: readonly { name: string; qty: number }[],
): string {
  if (addons.length === 0) return dish;
  const parts = addons.map((a) => (a.qty > 1 ? `${a.name} ×${a.qty}` : a.name));
  return `${dish} with add-on${addons.length > 1 ? "s" : ""} ${parts.join(", ")}`;
}

/** The bill's small line under a dish with numbered add-ons (the owner's
    choice, D27-289): "Veg Biryani 310 · Kebab +120", "… · Kebab ×2 +240".
    One of the dish; the line above carries the quantity and the total. */
export function addonBreakdown(kept: {
  dish: string; base: number;
  addons: readonly { name: string; price: number; qty: number }[];
}): string {
  const n = (rupees: number) => rupees.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return [
    `${kept.dish} ${n(kept.base)}`,
    ...kept.addons.map((a) => `${a.name}${a.qty > 1 ? ` ×${a.qty}` : ""} ${
      a.price === 0 ? "Free" : `+${n(a.price * a.qty)}`}`),
  ].join(" · ");
}
