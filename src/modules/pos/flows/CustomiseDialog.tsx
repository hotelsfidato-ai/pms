import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { priceWithAddons, nameWithAddons } from "@/modules/pos/lib/pricing";
import { Button, Dialog, DialogContent } from "@/components/ui";
import type { LineAddon, NumberedAddon } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   CUSTOMISE: THE NUMBERED ADD-ONS ON ONE DISH (the owner's D27-289)

   "Add-on 2 = Kebab". Beside a dish not yet sent, Customise opens the
   numbered grid; a tap on 2 adds Kebab to THAT dish, a second tap makes
   it ×2, and × takes one off. The dish stays one line - "Veg Biryani
   with add-on Kebab" - and the price moves as the numbers are tapped,
   so nobody holds the arithmetic while a table waits.

   NOT THE DISH DIALOG, which stays exactly as it was: variations and
   Sides are chosen there. This is the owner's separate, numbered list,
   the same on every dish.

   Built for a thumb, as the dish dialog is: 64px targets, the number
   first and largest, because the number is what staff remember.
   ══════════════════════════════════════════════════════════════════ */

const MOST_OF_ONE = 9;

export function CustomiseDialog({
  open, onOpenChange, dish, base, addons, chosen: initial, busy, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dish as named before its add-ons. */
  dish: string;
  /** One of it before its add-ons. */
  base: number;
  /** The add-ons in use at this property, in number order. */
  addons: NumberedAddon[];
  /** What the dish already carries. */
  chosen: readonly LineAddon[];
  busy?: boolean;
  onDone: (chosen: LineAddon[]) => void;
}) {
  const [chosen, setChosen] = useState<LineAddon[]>([...initial]);
  /* Fresh each time it opens, on what the dish carries now. */
  useEffect(() => { if (open) setChosen([...initial]); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (a: NumberedAddon) => setChosen((prev) => {
    const have = prev.find((c) => c.id === a.id);
    if (have) {
      return have.qty >= MOST_OF_ONE ? prev
        : prev.map((c) => (c.id === a.id ? { ...c, qty: c.qty + 1 } : c));
    }
    return [...prev, { id: a.id, number: a.number, name: a.name, price: a.price, qty: 1 }]
      .sort((x, y) => x.number - y.number);
  });
  const less = (id: string) => setChosen((prev) => prev.flatMap((c) =>
    c.id !== id ? [c] : c.qty > 1 ? [{ ...c, qty: c.qty - 1 }] : []));

  const unit = priceWithAddons(base, chosen);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Customise ${dish}`}
        description="Tap a number to add it to this dish. Tap again for two."
        footer={
          <div className="flex items-center gap-3 w-full">
            <span className="tabular text-md font-semibold text-ink-900">{money(unit)}</span>
            <div className="flex-1" />
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy} onClick={() => onDone(chosen)}>
              Done
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* What the line will read, as the bill and the kitchen get it. */}
          <p className="text-base text-ink-900" aria-live="polite">
            {nameWithAddons(dish, chosen)}
          </p>

          {addons.length === 0 ? (
            <p className="text-sm text-grey-600 leading-relaxed">
              No add-ons yet. Whoever edits the menu adds them on the Menu screen, under Add-ons.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {addons.map((a) => {
                const off = Boolean(a.offUntil && Date.parse(a.offUntil) > Date.now());
                const n = chosen.find((c) => c.id === a.id)?.qty ?? 0;
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={off}
                    aria-label={`Add-on ${a.number}, ${a.name}${n ? `, ${n} on this dish` : ""}`}
                    onClick={() => add(a)}
                    className={cn(
                      "relative min-h-16 px-3.5 py-2 rounded-lg border text-left flex items-start gap-3",
                      off
                        ? "border-grey-200 bg-grey-50 cursor-not-allowed"
                        : "cursor-pointer press-tile",
                      !off && n > 0
                        ? "border-success bg-success-50"
                        : !off && "border-grey-300 bg-white hover:border-grey-400 hover:bg-grey-50",
                    )}
                  >
                    <span className={cn("tabular text-xl font-semibold leading-none pt-0.5",
                      off ? "text-grey-400" : "text-ink-900")}>
                      {a.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-base",
                        off ? "text-grey-500 line-through" : "text-ink-900")}>
                        {a.name}
                      </span>
                      <span className="block tabular text-sm text-grey-600">
                        {off ? "off today" : a.price === 0 ? "Free" : `+${money(a.price)}`}
                      </span>
                    </span>
                    {n > 0 && (
                      <span className="tabular text-sm font-semibold text-success-600">×{n}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {chosen.length > 0 && (
            <ul className="divide-y divide-grey-100 border-y border-grey-100">
              {chosen.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <span className="tabular text-sm text-grey-500 w-6">{c.number}</span>
                  <span className="flex-1 text-base text-ink-900">
                    {c.name}{c.qty > 1 ? ` ×${c.qty}` : ""}
                  </span>
                  <span className="tabular text-sm text-grey-600">
                    {c.price === 0 ? "Free" : `+${money(c.price * c.qty)}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`One less ${c.name}`}
                    onClick={() => less(c.id)}
                    className="press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-grey-500 hover:text-brand-red-700 hover:border-brand-red-100 hover:bg-brand-red-50 cursor-pointer"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
