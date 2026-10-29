import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { ChefHat, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, ErrorState, EmptyState, NativeSelect, Input, Segmented, toast,
  Dialog, DialogContent,
} from "@/components/ui";
import {
  getKitchenSheet, saveKitchenCount, markKitchenStore, getRecipes, saveRecipe,
  type KitchenSheet, type KitchenItem, type RecipeOwner, type Recipes,
} from "@/modules/stores/data/kitchen";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN'S STOCK (the owner's D27-373, D27-374): Inventory's
   Restaurant tab. TODAY'S SHEET - the kitchen store's day per item:
   opening, received, moved in and out, used by KOTs, wastage (struck
   dishes with their reasons), corrections, closing, and the closing count
   typed into it; below zero in red. RECIPES - what one of each dish takes,
   a size's, a side's and an add-on's own lines on top; the dishes with no
   recipe listed. The bar's Today's sheet and Set up (BarStock.tsx), for
   the kitchen. Also "Kitchen stock" in the kitchen manager's and the chef's
   Restaurant menu (D27-378), as Bar stock is the bar's.
   ══════════════════════════════════════════════════════════════════ */

export default function KitchenStockPage() {
  const { code = "" } = useParams<{ code: string }>();
  return (
    <Page>
      <PageHeader title="Kitchen stock"
        description="The kitchen's day: what came, what the KOTs used, what was wasted, what is left, and the count." />
      <KitchenStockBody code={code} />
    </Page>
  );
}

type Part = "sheet" | "recipes";

const figure = (n: number) => String(Math.round(n * 1000) / 1000);
/* A day's movement: blank when none, so what happened stands out. */
const moved = (n: number) => (Math.abs(n) < 0.0005 ? "" : figure(n));
const red = (n: number) => n < -0.0005 && "text-brand-red-700 font-medium";

export function KitchenStockBody({ code }: { code: string }) {
  const [params, setParams] = useSearchParams();
  const part: Part = params.get("part") === "recipes" ? "recipes" : "sheet";
  const go = (p: Part) => setParams((all) => {
    const next = new URLSearchParams(all);
    if (p === "sheet") next.delete("part"); else next.set("part", p);
    return next;
  }, { replace: true });
  return (
    <div className="space-y-4">
      <Segmented value={part} onChange={go}
        options={[{ value: "sheet", label: "Today's sheet" }, { value: "recipes", label: "Recipes" }]} />
      {part === "sheet" ? <Sheet code={code} /> : <RecipeList code={code} />}
    </div>
  );
}

/* ── Which store is the kitchen's ──────────────────────────────────── */

function StorePicker({ code, sheet, onDone }: { code: string; sheet: KitchenSheet; onDone: () => void }) {
  const [chosen, setChosen] = useState(sheet.store?.id ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const res = await markKitchenStore(code, chosen);
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Saved", `Every KOT now takes its recipe from ${res.store}.`);
    onDone();
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 flex-1 min-w-56">
        <span className="block text-xs text-grey-600">The kitchen's store</span>
        <NativeSelect value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Pick a store</option>
          {sheet.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </NativeSelect>
      </label>
      <Button variant="primary" loading={saving} disabled={!chosen || chosen === sheet.store?.id} onClick={() => void save()}>
        Mark it the kitchen's
      </Button>
    </div>
  );
}

/* ── Today's sheet ─────────────────────────────────────────────────── */

const TH = "text-2xs font-semibold uppercase tracking-wide text-grey-500 px-2 h-8 whitespace-nowrap text-right";
const TD = "px-2 py-1.5 text-right tabular whitespace-nowrap";
const FIRST = "sticky left-0 z-10 bg-white text-left border-r border-grey-200";

function Sheet({ code }: { code: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string | undefined>(undefined);
  const q = useQuery({ queryKey: ["kitchen-sheet", code, date ?? "today"], queryFn: () => getKitchenSheet(code, date) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["kitchen-sheet", code] });
    void qc.invalidateQueries({ queryKey: ["kitchen-recipes", code] });
  };

  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState title="The kitchen's sheet did not load" onRetry={() => void q.refetch()} />;
  const s = q.data;

  if (!s.store || changing) {
    return (
      <Card><CardBody className="space-y-3 text-sm text-grey-700">
        <p>{s.store ? "Pick the store every KOT takes its recipe from."
          : "No store is marked as the kitchen's yet, so a KOT takes nothing."}</p>
        {s.mayKeep ? <StorePicker code={code} sheet={s} onDone={() => { setChanging(false); refresh(); }} />
          : <p className="text-grey-600">The GM or the Inventory Manager marks it here.</p>}
        {changing && <Button variant="ghost" onClick={() => setChanging(false)}>Cancel</Button>}
      </CardBody></Card>
    );
  }

  const today = s.date === s.businessDate;
  const typed = s.items.filter((i) => (draft[i.id] ?? "").trim() !== "");
  const save = async () => {
    const lines: { itemId: string; book: number; counted: number }[] = [];
    for (const i of typed) {
      const n = Number(draft[i.id]);
      if (!Number.isFinite(n) || n < 0) return toast.error("Not saved", `${i.name}: a count is zero or more.`);
      lines.push({ itemId: i.id, book: i.onHand, counted: n });
    }
    setSaving(true);
    const res = await saveKitchenCount(code, lines);
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("The closing count is saved", res.recorded
      ? `${res.recorded} difference${res.recorded === 1 ? "" : "s"} corrected; ${res.matched} matched.`
      : "Everything counted matched the book.");
    setDraft({});
    refresh();
  };

  return (
    <Card className="overflow-hidden">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-xs text-grey-600">Day</span>
            <Input id="kitchen-sheet-day" type="date" className="w-44" value={s.date} max={s.businessDate}
              onChange={(e) => { setDate(e.target.value || undefined); setDraft({}); }} />
          </label>
          <p className="text-sm text-grey-600 flex-1 min-w-48">
            {s.store.name}{s.mayKeep && (
              <> · <button type="button" className="font-medium text-ink-900 underline underline-offset-2"
                onClick={() => setChanging(true)}>Change</button></>
            )}
          </p>
          {s.mayCount && (
            <Button variant="primary" loading={saving} disabled={typed.length === 0} onClick={() => void save()}>
              Save the closing count{typed.length ? ` (${typed.length})` : ""}
            </Button>
          )}
        </div>
        <p className="text-sm text-grey-600">
          {!today ? "An earlier day: the count is typed on today's sheet."
            : s.mayCount ? "The closing count: type each item you count, in its unit; a blank line is not counted. Below zero is red - a delivery or a count puts it right."
            : "Today. Below zero is red - a delivery or a count puts it right."}
        </p>
        {s.items.length === 0 ? (
          <EmptyState icon={<ChefHat />} title={`Nothing in ${s.store.name} yet`}
            description="A delivery or a move into it, or an item in a recipe, shows here." />
        ) : (
          <div className="overflow-x-auto scrollbar-quiet -mx-4 sm:mx-0" data-kitchen-sheet>
            <table className="w-full border-collapse text-sm">
              <thead className="bg-grey-50 border-b border-grey-200">
                <tr>
                  <th className={cn(TH, FIRST, "bg-grey-50 text-left")}>Item</th>
                  {["Opening", "Received", "Moved in", "Moved out", "Used by KOTs", "Wastage", "Corrected", "Closing",
                    "Counted", "Difference"].map((h) => <th key={h} className={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {s.items.map((i) => (
                  <tr key={i.id} className="border-b border-grey-100">
                    <td className={cn(TD, FIRST, "text-ink-900 font-medium")}>
                      {i.name} <span className="text-xs font-normal text-grey-500">{i.unit}</span>
                    </td>
                    <td className={cn(TD, red(i.opening))}>{figure(i.opening)}</td>
                    <td className={TD}>{moved(i.received)}</td>
                    <td className={TD}>{moved(i.movedIn)}</td>
                    <td className={TD}>{moved(i.movedOut)}</td>
                    <td className={TD}>{moved(i.used)}</td>
                    <td className={TD}>{moved(i.wasted)}</td>
                    <td className={TD}>{moved(i.corrected)}</td>
                    <td className={cn(TD, "font-medium text-ink-900", red(i.closing))} data-closing={i.closing < 0 ? "below-zero" : undefined}>
                      {figure(i.closing)}
                    </td>
                    <td className={TD}>
                      {s.mayCount ? (
                        <Input className="w-20 h-8 text-right tabular ml-auto" inputMode="decimal" aria-label={`Counted, ${i.name}, ${i.unit}`}
                          value={draft[i.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [i.id]: e.target.value }))} />
                      ) : i.counted === null ? "-" : figure(i.counted)}
                    </td>
                    <td className={TD}><Difference item={i} typed={s.mayCount ? draft[i.id] : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {s.wasted.length > 0 && (
          <div className="space-y-1" data-kitchen-wasted>
            <p className="text-sm font-semibold text-ink-900">Wastage on this day</p>
            <ul className="text-sm text-grey-700 space-y-0.5">
              {s.wasted.map((w, n) => (
                <li key={n}>
                  {w.item}: {figure(w.quantity)} {w.unit}{w.note ? ` - ${w.note}` : ""}{w.reference ? ` (${w.reference})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** The typed count against the book now, or the day's count against its book. */
function Difference({ item, typed }: { item: KitchenItem; typed: string | undefined }) {
  const now = typed !== undefined && typed.trim() !== "" && Number.isFinite(Number(typed)) ? Number(typed) : null;
  const diff = now !== null ? now - item.onHand
    : item.counted !== null && item.countBook !== null ? item.counted - item.countBook : null;
  if (diff === null) return <span className="text-grey-400">-</span>;
  if (Math.abs(diff) < 0.0005) return <span>matches</span>;
  return <span className="text-brand-red-700 font-medium">{diff > 0 ? "+" : ""}{figure(diff)}</span>;
}

/* ── Recipes ──────────────────────────────────────────────────────── */

const ownerKey = (o: RecipeOwner) => `${o.itemId}/${o.variationId}/${o.addonId}/${o.numberedAddonId}`;
const PART_OF: Record<RecipeOwner["kind"], string> = { dish: "", size: "Size", side: "Side", addon: "Add-on" };

function RecipeList({ code }: { code: string }) {
  const q = useQuery({ queryKey: ["kitchen-recipes", code], queryFn: () => getRecipes(code) });
  const [find, setFind] = useState("");
  const [editing, setEditing] = useState<RecipeOwner | null>(null);

  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState title="The recipes did not load" onRetry={() => void q.refetch()} />;
  const r = q.data;
  const shown = r.owners.filter((o) => o.name.toLowerCase().includes(find.trim().toLowerCase()));
  const sections = [...new Set(shown.map((o) => o.section))];

  return (
    <div className="space-y-4">
      {!r.store && (
        <Card><CardBody className="text-sm text-grey-700">
          No store is marked as the kitchen's yet, so no KOT takes a recipe. It is marked on Today's sheet.
        </CardBody></Card>
      )}
      {r.withoutRecipe.length > 0 && (
        <Card><CardBody className="space-y-1" data-without-recipe>
          <p className="text-base font-semibold text-ink-900">
            {r.withoutRecipe.length === 1 ? "One dish has no recipe" : `${r.withoutRecipe.length} dishes have no recipe`}
          </p>
          <p className="text-sm text-grey-600">They sell as today and take nothing from the kitchen store.</p>
          <p className="text-sm text-grey-700">{r.withoutRecipe.map((d) => d.name).join(", ")}</p>
        </CardBody></Card>
      )}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48">
              <p className="text-base font-semibold text-ink-900">What one of each takes</p>
              <p className="text-sm text-grey-600">
                {r.mayKeep ? "In each Store item's own unit. A size, a side or an add-on takes its own lines on top of the dish's."
                  : "Set by the GM or the Inventory Manager."}
              </p>
            </div>
            <Input className="w-56" placeholder="Find a dish" aria-label="Find a dish" value={find} onChange={(e) => setFind(e.target.value)} />
          </div>
          {r.owners.length === 0 ? (
            <EmptyState icon={<ChefHat />} title="No dish on the menu" description="The restaurant's dishes, their sizes, sides and add-ons show here." />
          ) : (
            <ul className="divide-y divide-grey-100" data-recipes>
              {sections.map((section) => (
                <Fragment key={section}>
                  <li className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-grey-500">{section}</li>
                  {shown.filter((o) => o.section === section).map((o) => (
                    <li key={ownerKey(o)} className={cn("py-2 flex flex-wrap items-center gap-2", o.kind === "size" && "pl-4")}>
                      <div className="flex-1 min-w-0">
                        <p className="text-base text-ink-900 break-words">
                          {o.name}{PART_OF[o.kind] && <span className="text-xs text-grey-500"> · {PART_OF[o.kind]}</span>}
                        </p>
                        <p className="text-sm text-grey-600 break-words">
                          {o.lines.length > 0 ? o.lines.map((l) => `${l.name} ${figure(l.quantity)} ${l.unit}`).join(", ")
                            : o.kind === "dish" ? "No recipe: takes nothing" : "Nothing extra"}
                        </p>
                      </div>
                      {r.mayKeep && <Button size="sm" variant="secondary" onClick={() => setEditing(o)}>Edit</Button>}
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {editing && <RecipeEditor code={code} owner={editing} recipes={r} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RecipeEditor({ code, owner, recipes, onClose }: { code: string; owner: RecipeOwner; recipes: Recipes; onClose: () => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState(() => owner.lines.map((l) => ({ stockItemId: l.stockItemId, quantity: figure(l.quantity) })));
  const [saving, setSaving] = useState(false);
  const unitOf = (id: string) => recipes.ingredients.find((i) => i.id === id)?.unit ?? "";
  const set = (n: number, patch: Partial<{ stockItemId: string; quantity: string }>) =>
    setLines((all) => all.map((l, i) => (i === n ? { ...l, ...patch } : l)));

  const save = async () => {
    const out: { stockItemId: string; quantity: number }[] = [];
    for (const l of lines) {
      if (!l.stockItemId && !l.quantity.trim()) continue;
      const q = Number(l.quantity);
      if (!l.stockItemId || !Number.isFinite(q) || q <= 0) {
        return toast.error("Not saved", "Each line: an item from the Store, and how much one takes - more than none.");
      }
      out.push({ stockItemId: l.stockItemId, quantity: q });
    }
    setSaving(true);
    const res = await saveRecipe(code, owner, out);
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Saved", out.length ? "Every KOT sent now takes it off the kitchen store." : "It takes nothing now.");
    void qc.invalidateQueries({ queryKey: ["kitchen-recipes", code] });
    void qc.invalidateQueries({ queryKey: ["kitchen-sheet", code] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent title={`Recipe: ${owner.name}`}
        description={owner.kind === "dish" ? "What one of this dish takes, in each item's own unit. No line: it takes nothing."
          : "Taken on top of the dish's own recipe. No line: nothing extra."}
        footer={<>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
        </>}>
        <div className="space-y-2">
          {lines.map((l, n) => (
            <div key={n} className="flex items-center gap-2">
              <NativeSelect className="flex-1 min-w-0" aria-label={`Ingredient ${n + 1}`} value={l.stockItemId}
                onChange={(e) => set(n, { stockItemId: e.target.value })}>
                <option value="">Pick an item</option>
                {recipes.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </NativeSelect>
              <Input className="w-24 text-right tabular" inputMode="decimal" aria-label={`How much, ingredient ${n + 1}`}
                value={l.quantity} onChange={(e) => set(n, { quantity: e.target.value })} />
              <span className="w-12 text-sm text-grey-600">{unitOf(l.stockItemId)}</span>
              <Button size="sm" variant="ghost" aria-label={`Remove ingredient ${n + 1}`}
                onClick={() => setLines((all) => all.filter((_, i) => i !== n))}><X /></Button>
            </div>
          ))}
          <Button variant="secondary" leadingIcon={<Plus />}
            onClick={() => setLines((all) => [...all, { stockItemId: "", quantity: "" }])}>Add an ingredient</Button>
          {recipes.ingredients.length === 0 && (
            <p className="text-sm text-grey-600">The Store has no item yet: add them in the Store first.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
