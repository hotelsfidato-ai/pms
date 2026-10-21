import type { OrderLine } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   ONE LINE PER DISH (the owner's D27-353, 21 October)

   A beer sent, food a quarter of an hour later, then a second beer: two
   lines in the database, because each round is its own KOT (D27-148), and
   so "Kingfisher 1" twice on the bill. The bill and the order screens show
   it once, "2× Kingfisher", where it was first ordered. The same dish, size,
   further choices, sides, add-ons, note and price - anything else differing
   keeps it apart; a struck line stays its own.

   Display only: nothing stored changes, and the KOTs stay one per round.
   The merged line carries the NEWEST round's id, so a −, + or × acts on
   that round's own line, under the server's rules for it; a screen whose
   button works from a quantity looks that line up by its id first.
   ══════════════════════════════════════════════════════════════════ */

export function oneLinePerDish(lines: readonly OrderLine[]): OrderLine[] {
  const kids = (id: string) => lines.filter((c) => c.parentLineId === id);
  const kidKey = (c: OrderLine) => JSON.stringify([c.name, c.unitPrice, c.addonId ?? null, c.extra ?? null]);
  const key = (l: OrderLine) => l.voided ? `struck ${l.id}` : JSON.stringify([
    l.itemId ?? null, l.name, l.variationId ?? null, l.unitPrice, l.taxRate, l.note ?? "",
    l.numberedAddons ?? null, [...(l.moreChoiceIds ?? [])].sort(), l.extra ?? null,
    kids(l.id).filter((c) => !c.voided).map((c) => `${kidKey(c)} ${c.qty / l.qty}`).sort(),
  ]);

  const groups = new Map<string, OrderLine[]>();
  for (const l of lines) {
    if (l.parentLineId !== null) continue;
    const k = key(l);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  const out: OrderLine[] = [];
  for (const same of groups.values()) {
    const newest = same[same.length - 1]!;
    out.push({ ...newest, qty: same.reduce((n, l) => n + l.qty, 0) });
    const children = same.flatMap((l) => kids(l.id));
    const live = new Map<string, OrderLine[]>();
    for (const c of children.filter((c) => !c.voided)) live.set(kidKey(c), [...(live.get(kidKey(c)) ?? []), c]);
    for (const alike of live.values()) {
      out.push({ ...alike[alike.length - 1]!, qty: alike.reduce((n, c) => n + c.qty, 0) });
    }
    out.push(...children.filter((c) => c.voided));
  }
  return out;
}
