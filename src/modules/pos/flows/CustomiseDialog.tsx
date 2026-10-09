import { useState } from "react";
import { X, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { priceWithAddons, nameWithAddons } from "@/modules/pos/lib/pricing";
import { Button, Checkbox, Dialog, DialogContent, Field, fieldProps, Input } from "@/components/ui";
import type { CustomAddon, LineAddon, NumberedAddon } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   CUSTOMISE: THE ADD-ONS ON ONE DISH (the owner's D27-289, D27-291)

   "Add-on 2 = Kebab". Beside a dish not yet sent, Customise opens the
   numbered grid; a tap on 2 adds Kebab to THAT dish, a second tap makes
   it ×2, and × takes one off. The dish stays one line - "Veg Biryani
   with add-on Kebab" - and the price moves as the numbers are tapped,
   so nobody holds the arithmetic while a table waits.

   A CUSTOM ADD-ON (D27-291): something not on the list - a name, and a
   price or Free (never a default), with its own number. It is its own
   line under the dish, "+ Extra papad".

   ON A DISH THE KITCHEN ALREADY HAS (`sent`), nothing folds into it any
   more: every add-on chosen here - a number or a typed one - is a line of
   its own under the dish, and goes to the kitchen with the next Send.

   NOT THE DISH DIALOG, which stays exactly as it was: variations and
   Sides are chosen there. Built for a thumb, as the dish dialog is: 64px
   targets, the number first and largest, because the number is what
   staff remember.
   ══════════════════════════════════════════════════════════════════ */

const MOST_OF_ONE = 9;
/** As the server holds them (api extras.ts). */
const MOST_OF_A_CUSTOM = 99;
const LONGEST_NAME = 60;

export function CustomiseDialog({
  open, onOpenChange, dish, base, addons, chosen: initial, busy, onDone,
  qty = 1, loading = false, failed = false, onRetry, sent = false, customs: initialCustoms = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dish as named before its add-ons. */
  dish: string;
  /** One of it before its add-ons. */
  base: number;
  /** The add-ons in use at this property, in number order. */
  addons: NumberedAddon[];
  /** What the dish already carries (folded in, before Send). */
  chosen: readonly LineAddon[];
  busy?: boolean;
  /** `one` on a line of several: the add-ons go on ONE of them, split off
      (the owner's D27-290). `all` otherwise. On a sent dish, `chosen` is the
      numbered add-ons to put on as lines of their own. `customs` is every
      typed add-on the dialog ends with. */
  onDone: (chosen: LineAddon[], scope: "all" | "one", customs: CustomAddon[]) => void;
  /** How many of the dish are on this line. */
  qty?: number;
  /** The list is being read, or could not be: neither is "no add-ons yet"
      (every list draws four states - the audit of 9 October). */
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  /** The kitchen has this dish (D27-291): add-ons are lines of their own. */
  sent?: boolean;
  /** Typed add-ons already chosen for it (the pad's own line). */
  customs?: readonly CustomAddon[];
}) {
  /* Starts from what the dish carries. Each caller keys this by its line,
     so a different dish is a fresh dialog - never the last one's choices
     for a frame (the audit of 9 October). A sent dish starts empty: what
     is on it already is on the bill. */
  const [chosen, setChosen] = useState<LineAddon[]>(sent ? [] : [...initial]);
  const [customs, setCustoms] = useState<CustomAddon[]>([...initialCustoms]);
  /* On a line of several the panel ASKS - all of them, or just one (the
     owner's D27-290). Neither is chosen for them: Done waits - but only
     when the numbered add-ons change; a typed one is a line of its own. */
  const [scope, setScope] = useState<"all" | "one" | null>(qty > 1 && !sent ? null : "all");

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

  const key = (list: readonly LineAddon[]) => JSON.stringify(list.map((c) => [c.id, c.qty]));
  const numberedChanged = !sent && key(chosen) !== key(initial);
  const asks = qty > 1 && !sent && numberedChanged;

  const unit = priceWithAddons(base, chosen);
  const typed = customs.reduce((s, c) => s + c.price * c.qty, 0);
  /* What Done comes to: on a sent dish, only what is being added. */
  const figure = sent
    ? chosen.reduce((s, c) => s + c.price * c.qty, 0) + typed
    : (scope === "one" ? unit : unit * qty) + typed;
  const nothing = sent && chosen.length === 0 && customs.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={sent ? `Add to ${dish}` : `Customise ${dish}`}
        description={sent
          ? "The kitchen has this dish. Each add-on goes on as its own line under it, and to the kitchen with the next Send."
          : "Tap a number to add it to this dish. Tap again for two."}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3 w-full">
            <span className="tabular text-md font-semibold text-ink-900 mr-auto">
              {sent ? (nothing ? "-" : `+${money(figure)}`) : money(figure)}
            </span>
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy}
                    disabled={(asks && scope === null) || nothing}
                    onClick={() => onDone(chosen, scope ?? "all", customs)}>
              Done
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* What the line will read, as the bill and the kitchen get it. */}
          {!sent && (
            <p className="text-base text-ink-900" aria-live="polite">
              {nameWithAddons(dish, chosen)}
            </p>
          )}
          {/* A line of several: which of them (the owner's D27-290). */}
          {asks && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink-900">
                There are {qty} on this line. Put these add-ons on:
              </p>
              <div className="flex gap-2" role="radiogroup" aria-label="Which of them">
                {([["all", `All ${qty}`], ["one", "Just 1"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={scope === value}
                    onClick={() => setScope(value)}
                    className={
                      "press h-11 px-4 rounded-full border text-sm font-medium cursor-pointer "
                      + (scope === value
                        ? "border-success bg-success-50 text-ink-900"
                        : "border-grey-300 bg-white text-ink-900 hover:border-grey-400")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {scope === "all" && (
                <p className="text-sm text-brand-orange-700">
                  On each of the {qty}: {money(unit)} each, {money(unit * qty)} in all.
                </p>
              )}
              {scope === "one" && (
                <p className="text-sm text-brand-orange-700">
                  One of them, {money(unit)}, as its own line; the other {qty - 1} stay as they are.
                </p>
              )}
            </div>
          )}

          {addons.length === 0 && loading ? (
            <p className="text-sm text-grey-600">Reading the add-ons…</p>
          ) : addons.length === 0 && failed ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-brand-red-700 flex-1">
                The add-ons could not be read. Check the connection.
              </p>
              {onRetry && (
                <Button variant="secondary" size="sm" className="h-11" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          ) : addons.length === 0 ? (
            <p className="text-sm text-grey-600 leading-relaxed">
              No numbered add-ons yet. Whoever edits the menu adds them on the Menu screen, under Add-ons. A custom one can still be typed below.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                      <span className="block tabular text-sm text-grey-600 whitespace-nowrap">
                        {off ? "off today" : a.price === 0 ? "Free" : `+${money(a.price)}`}
                        {n > 0 && (
                          <span className="ml-2 font-semibold text-success-600">×{n}</span>
                        )}
                      </span>
                    </span>
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
                    {sent ? "+ " : ""}{c.name}{c.qty > 1 ? ` ×${c.qty}` : ""}
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

          <CustomForm onAdd={(c) => setCustoms((prev) => [...prev, c])} />

          {customs.length > 0 && (
            <ul className="divide-y divide-grey-100 border-y border-grey-100" aria-label="Custom add-ons">
              {customs.map((c, i) => (
                <li key={i} className="flex items-center gap-3 py-2">
                  <span className="flex-1 min-w-0 text-base text-ink-900 truncate">
                    + {c.name}{` ×${c.qty}`}
                  </span>
                  <span className="tabular text-sm text-grey-600">
                    {c.price === 0 ? "Free" : `+${money(c.price * c.qty)}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`Take off ${c.name}`}
                    onClick={() => setCustoms((prev) => prev.filter((_, j) => j !== i))}
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

/* ── A custom add-on (D27-291) ───────────────────────────────────────
   Closed until asked for, so the numbered grid stays the first thing a
   thumb meets. A name, and a price or Free - no default (the owner's rule:
   a blank is not zero) - and its own number, starting at 1. */
function CustomForm({ onAdd }: { onAdd: (c: CustomAddon) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [free, setFree] = useState(false);
  const [n, setN] = useState(1);

  const priceN = price.trim() === "" ? null : Number(price.trim());
  /* Rupees and paise, as typed: "40" or "40.50" (as the Add-ons tab). */
  const priceBad = !free && (priceN === null || !/^\d+(\.\d{1,2})?$/.test(price.trim()) || priceN <= 0);
  const nameBad = name.trim() === "" || name.trim().length > LONGEST_NAME;
  const ready = !nameBad && !priceBad;

  if (!open) {
    return (
      <Button variant="secondary" size="lg" className="w-full" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Custom add-on
      </Button>
    );
  }

  const add = () => {
    onAdd({ name: name.trim().replace(/\s+/g, " "), price: free ? 0 : priceN!, qty: n });
    setName(""); setPrice(""); setFree(false); setN(1);
  };

  return (
    <section className="rounded-lg border border-grey-200 p-3.5 space-y-3" aria-label="Custom add-on">
      <p className="text-sm font-medium text-ink-900">
        Custom add-on - something not on the list. Its own line under the dish.
      </p>
      <Field label="Name" required
             error={name.trim().length > LONGEST_NAME ? `At most ${LONGEST_NAME} letters, so the KOT can print it.` : undefined}>
        {(f) => (
          <Input {...fieldProps(f)} value={name} autoFocus placeholder="Extra papad"
                 onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <div className="flex items-end gap-3">
        <Field label="Price" required={!free} className="flex-1"
               hint="Taxed at the dish's own rate."
               error={!free && price.trim() !== "" && priceBad ? "Rupees, more than 0 - like 40 or 40.50. Or tick Free." : undefined}>
          {(f) => (
            <Input {...fieldProps(f)} value={free ? "" : price} inputMode="decimal"
                   disabled={free} placeholder={free ? "Free" : "40"}
                   onChange={(e) => setPrice(e.target.value)} />
          )}
        </Field>
        <div className="pb-3">
          <Checkbox label="Free" checked={free} onCheckedChange={setFree} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-grey-600 mr-1">How many</span>
        <button type="button" aria-label="One less" disabled={n <= 1}
                onClick={() => setN((x) => Math.max(1, x - 1))}
                className="press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-grey-600 hover:text-ink-900 disabled:opacity-40 cursor-pointer">
          <Minus className="size-4" />
        </button>
        <span className="tabular text-base font-medium text-ink-900 w-8 text-center" aria-live="polite">{n}</span>
        <button type="button" aria-label="One more" disabled={n >= MOST_OF_A_CUSTOM}
                onClick={() => setN((x) => Math.min(MOST_OF_A_CUSTOM, x + 1))}
                className="press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-grey-600 hover:text-ink-900 disabled:opacity-40 cursor-pointer">
          <Plus className="size-4" />
        </button>
        <div className="flex-1" />
        <Button variant="primary" size="lg" disabled={!ready} onClick={add}>
          Add
        </Button>
      </div>
    </section>
  );
}
