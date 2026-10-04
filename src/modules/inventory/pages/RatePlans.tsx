import { useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { setsRates } from "@/lib/permissions";
import {
  Page, PageHeader, Card, Button, Skeleton, EmptyState, toast, Switch,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, NativeSelect,
} from "@/components/ui";
import { getInventory } from "@/modules/inventory/data/rates";
import { getPricing, getBreakup, setBasis, setAddon, type Pricing, type BreakupDay } from "@/modules/inventory/data/pricing";
import {
  getPlanSettings, getSources, setPlan, orderPlans, mealDaysInWords, PLAN_SETTINGS_KEY,
  type PlanSetting, type MealDays, type Source,
} from "@/modules/inventory/data/planSettings";

/* ══════════════════════════════════════════════════════════════════
   RATE PLANS - A TREE OVER THE ONE PRICING (the owner's D27-251, D27-258)

   A plan is "Room type · Meal plan", named by itself. Its price is the
   pricing's own (090/162) - nothing here is a second price:

     Master       the base room type on room only: set on Rates, and every
                  derived plan follows it
     Derived      another type's room only (+₹ or +% of the master), or any
                  type's meal plan (its room only + the hotel's meal add-on)
     Independent  a type with no difference, priced by its own base on Rates
                  (D27-258 Q2) - or every type when there is no master

   The figures are the server's break-up for the business date, for two
   guests (one for a room that sleeps one); a dash where nothing is set.
   Off: not offered for new bookings (Q3). Who sells it: none chosen =
   every source (Q4). EVERY ACTIVE ROOM TYPE is listed (D27-263).
   ══════════════════════════════════════════════════════════════════ */

const PLANS = ["EP", "CP", "MAP", "AP", "AI"] as const;
type Plan = (typeof PLANS)[number];
const PLAN_NAME: Record<Plan, string> = {
  EP: "Room only (EP)", CP: "Breakfast (CP)", MAP: "MAP", AP: "AP", AI: "All inclusive (AI)",
};
type Kind = "master" | "derived" | "independent";
const KIND_WORDS: Record<Kind, string> = { master: "Master", derived: "Derived", independent: "Independent" };

interface Row {
  key: string; roomTypeId: string; roomType: string; plan: Plan; name: string;
  kind: Kind; price: number | null; offset: number | null; setting: PlanSetting | undefined;
}

export default function RatePlansPage() {
  const hotelId = useUi((s) => s.hotelId);
  const mayEdit = setsRates(useRole());
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const today = useQuery({ queryKey: ["inventory", hotelId, null], queryFn: () => getInventory(hotelId) });
  const from = today.data?.from;
  const pricing = useQuery({ queryKey: ["pricing", hotelId, from], queryFn: () => getPricing(hotelId, from!, 1, "EP"), enabled: !!from });
  const settings = useQuery({ queryKey: PLAN_SETTINGS_KEY(hotelId), queryFn: () => getPlanSettings(hotelId) });
  const types = pricing.data?.roomTypes ?? [];
  const breakups = useQueries({
    queries: types.map((t) => ({
      queryKey: ["pricing-breakup", hotelId, from, t.id, 1],
      queryFn: () => getBreakup(hotelId, from!, 1, t.id),
      enabled: !!from,
    })),
  });

  const rows = useMemo(() => {
    if (!pricing.data || !settings.data) return [];
    return planRows(pricing.data, breakups.map((b) => b.data?.[0]), settings.data.plans);
  }, [pricing.data, settings.data, breakups]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PLAN_SETTINGS_KEY(hotelId) });
    void qc.invalidateQueries({ queryKey: ["pricing", hotelId] });
    void qc.invalidateQueries({ queryKey: ["pricing-breakup", hotelId] });
  };

  if (today.isLoading || pricing.isLoading || settings.isLoading) {
    return <Page><PageHeader title="Rate plans" description="Loading…" /><Skeleton className="h-64" /></Page>;
  }
  if (!pricing.data || !settings.data) {
    return <Page><PageHeader title="Rate plans" /><EmptyState title="The rate plans did not load" description="Nothing was changed." /></Page>;
  }

  const drop = async (onto: string) => {
    if (!dragging || dragging === onto) return;
    const keys = rows.map((r) => r.key).filter((k) => k !== dragging);
    keys.splice(keys.indexOf(onto), 0, dragging);
    setDragging(null);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const res = await orderPlans(hotelId, keys.map((k) => ({ roomTypeId: byKey.get(k)!.roomTypeId, mealPlan: byKey.get(k)!.plan })));
    if (!res.ok) return toast.error("Not moved", res.reason);
    refresh();
  };
  const toggle = async (r: Row, on: boolean) => {
    const res = await setPlan(hotelId, r.roomTypeId, r.plan, { isActive: on });
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(on ? "Offered for new bookings" : "Not offered for new bookings", r.name);
    refresh();
  };

  return (
    <Page>
      <PageHeader title="Rate plans"
        description="Each room type on each meal plan, named by itself. The price is set once, on Rates; the plans follow it." />
      <div className="flex flex-col gap-3">
        <p className="grid gap-2 sm:grid-cols-3 text-sm text-grey-600">
          <span><b className="text-ink-900">Master</b> - the base room on room only. Changing it moves every derived plan.</span>
          <span><b className="text-ink-900">Derived</b> - follows the master or its own room only, by a difference or the meal add-on.</span>
          <span><b className="text-ink-900">Independent</b> - its own base, typed on Rates.</span>
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No room types yet" description="Add room types under Rooms; each appears here on every meal plan it is sold on." />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-grey-100">
              {rows.map((r) => (
                <li key={r.key}
                    draggable={mayEdit}
                    onDragStart={() => setDragging(r.key)} onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => { if (mayEdit) e.preventDefault(); }} onDrop={() => void drop(r.key)}
                    className={cn("flex items-center gap-3 px-3 sm:px-4 min-h-14 py-2",
                      r.plan !== "EP" || r.kind === "derived" ? "sm:pl-10" : "")}>
                  {mayEdit && <GripVertical className="size-4 text-grey-300 shrink-0 cursor-grab max-sm:hidden" aria-hidden />}
                  <Switch checked={r.setting?.isActive ?? true} disabled={!mayEdit}
                          onCheckedChange={(on) => void toggle(r, on)} aria-label={`${r.name} offered`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink-900 break-words">{r.name}</span>
                    <span className={cn("inline-block mt-0.5 rounded-full px-2 text-xs font-semibold",
                      r.kind === "master" ? "bg-brand-orange-50 text-brand-orange-700"
                        : r.kind === "derived" ? "bg-success-50 text-success" : "bg-grey-100 text-grey-600")}>
                      {KIND_WORDS[r.kind]}
                    </span>
                  </span>
                  <span className="text-right tabular shrink-0">
                    <span className="block text-sm font-semibold text-ink-900">{r.price === null ? "-" : money(r.price)}</span>
                    {r.offset !== null && r.offset !== 0 && (
                      <span className="block text-xs text-success">{r.offset > 0 ? "+" : "-"}{money(Math.abs(r.offset))}</span>
                    )}
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>{mayEdit ? "Edit" : "View"}</Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="text-xs text-grey-500">
          Prices are for two guests on the business date ({from}); a dash is not priced. Off: not offered for new bookings -
          prices and bookings stay.
        </p>
      </div>
      {editing && (
        <PlanEditor hotelId={hotelId} row={editing} pricing={pricing.data} mayEdit={mayEdit}
          mealDays={settings.data.mealDays.find((d) => d.mealPlan === editing.plan)}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />
      )}
    </Page>
  );
}

/** The tree's rows, from the pricing alone: every active room type, on room
    only and on each meal plan the hotel sells (an add-on set). */
export function planRows(pricing: Pricing, days: (BreakupDay | undefined)[], settings: PlanSetting[]): Row[] {
  const basis = pricing.basis?.roomTypeId ?? null;
  const masterEP = basis ? days[pricing.roomTypes.findIndex((t) => t.id === basis)]?.EP ?? null : null;
  const sold = PLANS.filter((p) => p === "EP" || pricing.addons[p as "CP"] !== null);
  const at = new Map(settings.map((s) => [`${s.roomTypeId}/${s.mealPlan}`, s]));
  const rows: (Row & { sort: number })[] = [];
  pricing.roomTypes.forEach((t, i) => {
    const day = days[i];
    const typeKind: Kind = !basis ? "independent" : t.id === basis ? "master" : t.difference ? "derived" : "independent";
    sold.forEach((p, j) => {
      const price = day ? day[p] : null;
      const kind: Kind = p === "EP" ? typeKind : "derived";
      const setting = at.get(`${t.id}/${p}`);
      rows.push({
        key: `${t.id}/${p}`, roomTypeId: t.id, roomType: t.name, plan: p,
        name: `${t.name} · ${PLAN_NAME[p]}`, kind, price, setting,
        /* What it adds to the master (D27-251's green offset). */
        offset: price !== null && masterEP !== null && !(t.id === basis && p === "EP") ? price - masterEP : null,
        sort: setting?.position ?? (i + 1) * 100 + j,
      });
    });
  });
  /* The master first, as the tree's root; then the order the owner dragged. */
  return rows.sort((a, b) => (a.kind === "master" && a.plan === "EP" ? -1 : b.kind === "master" && b.plan === "EP" ? 1 : a.sort - b.sort));
}

/* The editor: what it is, its price, who sells it - with a summary that
   grows as you go (the plan page's section 3). */
function PlanEditor({ hotelId, row, pricing, mealDays, mayEdit, onClose, onDone }: {
  hotelId: string; row: Row; pricing: Pricing; mealDays: MealDays | undefined; mayEdit: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const [step, setStep] = useState(1);
  const type = pricing.roomTypes.find((t) => t.id === row.roomTypeId)!;
  const basis = pricing.basis;
  const [kind, setKind] = useState<Kind>(row.kind);
  const [amount, setAmount] = useState(type.difference ? String(type.difference.amount) : "");
  const [unit, setUnit] = useState<"rupees" | "percent">(type.difference?.unit ?? "rupees");
  const sources = useQuery({ queryKey: ["booking-sources", hotelId], queryFn: () => getSources(hotelId) });
  const [chosen, setChosen] = useState<Set<string>>(new Set(row.setting?.sources ?? []));
  const [busy, setBusy] = useState(false);
  const roomOnly = row.plan === "EP";
  const meals = mealDaysInWords(mealDays);

  const save = async () => {
    setBusy(true);
    const steps: (() => Promise<{ ok: true } | { ok: false; reason: string }>)[] = [];
    if (roomOnly && kind !== row.kind) {
      if (kind === "master") steps.push(() => setBasis(hotelId, row.roomTypeId));
      if (kind === "independent") steps.push(() => setAddon(hotelId, { kind: "room_type", roomTypeId: row.roomTypeId, amount: null, unit: "rupees" }));
    }
    if (roomOnly && kind === "derived") {
      const value = amount.trim() === "" ? null : Number(amount);
      if (value !== (type.difference?.amount ?? null) || unit !== (type.difference?.unit ?? "rupees")) {
        steps.push(() => setAddon(hotelId, { kind: "room_type", roomTypeId: row.roomTypeId, amount: value, unit }));
      }
    }
    const was = new Set(row.setting?.sources ?? []);
    if (chosen.size !== was.size || [...chosen].some((s) => !was.has(s))) {
      steps.push(() => setPlan(hotelId, row.roomTypeId, row.plan, { sources: [...chosen] }));
    }
    for (const s of steps) {
      const res = await s();
      if (!res.ok) { setBusy(false); return toast.error("Not saved", res.reason); }
    }
    setBusy(false);
    toast.success("Saved", row.name);
    onDone();
  };

  const kinds: Kind[] = !roomOnly ? ["derived"]
    : !basis ? ["master", "independent"]
    : row.roomTypeId === basis.roomTypeId ? ["master"] : ["master", "derived", "independent"];
  const sourceWords = chosen.size === 0 ? "Every source"
    : (sources.data ?? []).filter((s) => chosen.has(s.id)).map((s) => s.name).join(", ");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={row.name} description={`Step ${step} of 3: ${["What it is", "Its price", "Who sells it"][step - 1]}`}
        footer={
          <>
            <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
            {step > 1 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button>}
            {step < 3 && <Button variant="primary" onClick={() => setStep(step + 1)}>Next</Button>}
            {step === 3 && mayEdit && (
              <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Update"}</Button>
            )}
          </>
        }>
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <div className="space-y-3 min-w-0">
            {step === 1 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-grey-500">Room type</dt><dd className="text-ink-900">{row.roomType}</dd>
                <dt className="text-grey-500">Meal plan</dt><dd className="text-ink-900">{PLAN_NAME[row.plan]}</dd>
                <dt className="text-grey-500">Name</dt><dd className="text-ink-900">{row.name} <span className="text-grey-500">(by itself)</span></dd>
                <dt className="text-grey-500">Meals</dt><dd className="text-ink-900">{meals ?? "-"}</dd>
              </dl>
            )}
            {step === 2 && (
              <>
                <div role="radiogroup" aria-label="How it is priced" className="grid gap-2">
                  {kinds.map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={!mayEdit}
                      onClick={() => setKind(k)}
                      className={cn("text-left rounded-lg border px-3 py-2.5 text-sm",
                        kind === k ? "border-ink-900 bg-grey-50" : "border-grey-200 hover:border-grey-400")}>
                      <b className="block text-ink-900">{KIND_WORDS[k]}</b>
                      <span className="text-grey-600">{
                        k === "master" ? "The base: set on Rates; every derived plan follows it."
                          : k === "derived" ? (roomOnly
                            ? `Follows ${basis?.roomType ?? "the master"} by a difference.`
                            : `${row.roomType} · Room only plus the hotel's ${row.plan} add-on per guest (under How rates are built).`)
                          : "Its own base, typed on Rates."}</span>
                    </button>
                  ))}
                </div>
                {roomOnly && kind === "derived" && (
                  <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                    <Field label={`More than ${basis?.roomType ?? "the master"}`}>
                      {(f) => <Input {...fieldProps(f)} value={amount} inputMode="decimal" placeholder="-" disabled={!mayEdit}
                                     onChange={(e) => setAmount(e.target.value)} />}
                    </Field>
                    <NativeSelect aria-label="Rupees or percent" value={unit} disabled={!mayEdit}
                      onChange={(e) => setUnit(e.target.value as "rupees" | "percent")}>
                      <option value="rupees">₹</option><option value="percent">%</option>
                    </NativeSelect>
                  </div>
                )}
                {kind === "master" && row.kind !== "master" && (
                  <p className="text-sm text-warning-dark">Making it the master moves every derived plan to follow it.</p>
                )}
              </>
            )}
            {step === 3 && (
              <fieldset className="space-y-1">
                <legend className="text-sm text-grey-600 mb-2">None chosen: every source sells it.</legend>
                {(sources.data ?? []).filter((s) => s.isActive).map((s: Source) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-ink-900 min-h-11 cursor-pointer">
                    <input type="checkbox" checked={chosen.has(s.id)} disabled={!mayEdit}
                           onChange={() => setChosen((c) => { const n = new Set(c); if (!n.delete(s.id)) n.add(s.id); return n; })}
                           className="size-4 accent-brand-orange" />
                    {s.name}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          <aside className="rounded-lg bg-grey-50 p-3 text-sm space-y-1.5 self-start" aria-label="Summary">
            <p className="text-xs font-semibold uppercase tracking-[0.025em] text-grey-500">Summary</p>
            <p className="text-ink-900 font-medium">{row.name}</p>
            <p className="text-grey-600">{KIND_WORDS[kind]}</p>
            {meals && <p className="text-grey-600">{meals}</p>}
            {step >= 3 && <p className="text-grey-600">{sourceWords}</p>}
            <p className="pt-1.5 border-t border-grey-200 text-ink-900">
              {row.price === null ? "Not priced yet" : `${money(row.price)} per night, two guests`}
            </p>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
