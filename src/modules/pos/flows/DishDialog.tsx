import { useState, useMemo } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { unitPriceOf } from "@/modules/pos/lib/pricing";
import {
  Button, Dialog, DialogContent, Input,
} from "@/components/ui";
import type { MenuItem } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   THE DISH DIALOG

   Bhaaji Pau is Oil ₹300 or Butter ₹400, with sides at ₹25 each. This
   is where a biller says which, and it opens ONLY for a dish that has
   something to ask — a plain item goes straight onto the bill, because
   a dialog that always appears is a tap a waiter pays for on every
   single item.

   BUILT FOR A THUMB. 64px targets like the rest of the terminal, and
   the price moves as choices are made so nobody has to hold the
   arithmetic in their head while a table waits.

   THE VARIATION IS NOT OPTIONAL when one exists. The database refuses
   a line without it — an item that gained variations has a `price`
   column nobody has looked at since, and charging it puts a number on
   the bill that is on no menu. So Add stays disabled until one is
   chosen, and the reason is written where it is read.
   ══════════════════════════════════════════════════════════════════ */

export function DishDialog({
  item, open, onOpenChange, onAdd, busy,
}: {
  item: MenuItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (
    itemId: string, qty: number, note: string,
    variationId?: string, addonIds?: string[],
  ) => void;
  busy?: boolean;
}) {
  const [variationId, setVariationId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  /* Reopened for a different dish, so nothing carries over. A side left
     selected from the last dish is a charge nobody asked for. */
  const key = item?.id ?? "";
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setVariationId(null);
    setChosen(new Set());
    setQty(1);
    setNote("");
    setSearch("");
  }

  /* The formula lives in `pricing.ts` because the ORDER PAD needs the
     same number, and this dialog having its own copy is how the two
     start disagreeing. Same reason the server's copy is pinned by a
     test. */
  const unitPrice = useMemo(
    () => (item ? unitPriceOf(item, variationId, chosen) : 0),
    [item, variationId, chosen],
  );

  if (!item) return null;

  const needsVariation = item.variations.length > 0;
  const ready = !needsVariation || variationId !== null;

  const toggle = (id: string, group: MenuItem["addonGroups"][number]) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      /* A group with maxSelect 1 is a choice, not a list — taking a
         second one replaces the first rather than being refused, which
         is what a person expects from a row of buttons. */
      if (group.maxSelect === 1) {
        for (const a of group.addons) next.delete(a.id);
      }
      next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={item.name}
        description={
          needsVariation
            ? "Choose one, and any sides."
            : "Add sides, or a note for the kitchen."
        }
        footer={
          <div className="flex items-center gap-3 w-full">
            <span className="tabular text-md font-semibold text-ink-900">
              {money(unitPrice * qty)}
            </span>
            <div className="flex-1" />
            <Button variant="secondary" size="lg"
              onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary"
              size="lg"
              loading={busy}
              disabled={!ready}
              onClick={() => onAdd(
                item.id, qty, note,
                variationId ?? undefined,
                chosen.size ? [...chosen] : undefined,
              )}
            >
              Add
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {needsVariation && (
            <section>
              <h4 className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
                Variation
              </h4>
              <div className="flex gap-2 flex-wrap">
                {item.variations.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVariationId(v.id)}
                    className={cn(
                      "min-w-24 min-h-16 px-4 rounded-md border text-left cursor-pointer",
                      "transition-colors duration-200",
                      variationId === v.id
                        ? "border-brand-orange bg-orange-50"
                        : "border-grey-300 hover:bg-grey-50",
                    )}
                  >
                    <span className={cn(
                      "block text-base font-medium",
                      variationId === v.id ? "text-brand-orange-700" : "text-ink-900",
                    )}>
                      {v.label}
                    </span>
                    <span className="block tabular text-sm text-grey-600">
                      {money(v.price)}
                    </span>
                  </button>
                ))}
              </div>
              {!ready && (
                <p className="text-sm text-grey-600 mt-2">
                  This dish is sold by variation - it has no price of its own.
                </p>
              )}
            </section>
          )}

          {item.addonGroups.length > 0 && (
            <section>
              {/* One search across every group, as the screenshot has it.
                  A biller looking for onions does not know which group
                  they are filed under. */}
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sides"
                className="mb-3"
              />
              {item.addonGroups.map((g) => {
                const shown = g.addons.filter((a) =>
                  a.label.toLowerCase().includes(search.trim().toLowerCase()));
                if (!shown.length) return null;
                return (
                  <div key={g.id} className="mb-4 last:mb-0">
                    <h4 className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
                      {g.label}
                      {g.minSelect > 0 && (
                        <span className="text-brand-red ml-1">required</span>
                      )}
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {shown.map((a) => {
                        const off = a.offUntil
                          && Date.parse(a.offUntil) > Date.now();
                        return (
                          <button
                            key={a.id}
                            type="button"
                            disabled={Boolean(off)}
                            onClick={() => toggle(a.id, g)}
                            className={cn(
                              "min-h-16 px-3 rounded-md border text-left",
                              "transition-colors duration-200",
                              off
                                ? "border-grey-200 bg-grey-50 cursor-not-allowed"
                                : "cursor-pointer",
                              !off && chosen.has(a.id)
                                ? "border-success bg-green-50"
                                : !off && "border-grey-300 hover:bg-grey-50",
                            )}
                          >
                            <span className={cn(
                              "block text-base",
                              off ? "text-grey-500 line-through" : "text-ink-900",
                            )}>
                              {a.label}
                            </span>
                            <span className="block tabular text-sm text-grey-600">
                              {off ? "off today" : money(a.price)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          <section>
            <h4 className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
              Note for the kitchen
            </h4>
            {/* The list first, because it is what gets used, and because a
                picked note prints the same way every time. Free text
                stays underneath for the thing nobody anticipated. */}
            <div className="flex gap-2 flex-wrap mb-2">
              {PRESET_NOTES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNote(note === n ? "" : n)}
                  className={cn(
                    "min-h-11 px-3 rounded-md border text-base cursor-pointer",
                    "transition-colors duration-200",
                    note === n
                      ? "border-brand-orange bg-orange-50 text-brand-orange-700"
                      : "border-grey-300 text-grey-700 hover:bg-grey-50",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything else"
            />
          </section>

          <section className="flex items-center gap-3">
            <h4 className="text-2xs font-semibold uppercase tracking-wide text-grey-500">
              Quantity
            </h4>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="secondary" size="lg"
                onClick={() => setQty((q) => Math.max(1, q - 1))}>
                −
              </Button>
              <span className="tabular text-md font-semibold text-ink-900 w-10 text-center">
                {qty}
              </span>
              <Button variant="secondary" size="lg"
                onClick={() => setQty((q) => q + 1)}>
                +
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* The list from the screenshots. A picked note prints identically every
   time, which is what makes it readable on a docket at the pass — free
   text arrives as "less spicey", "LESS SPICY" and "little less spice". */
const PRESET_NOTES = [
  "Crispy", "Extra Garlic", "Less Butter",
  "Less Garlic", "Less Spicy", "Less Sugar",
];
