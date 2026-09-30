import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ChevronLeft, ChevronRight, Ban, LogIn, LogOut, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, percent } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { setsRates } from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, NativeSelect,
  Segmented, Checkbox,
} from "@/components/ui";
import { getInventory, setRestriction, type InventoryCell, type Restriction } from "@/modules/inventory/data/rates";
import {
  getPricing, setBasis, setBasePrice, setAddon,
  type Pricing, type Addons, type PricingCell,
} from "@/modules/inventory/data/pricing";
import { getRateDays, type RateDay } from "@/modules/inventory/data/rateGrid";
import { removeRate, setRackRate } from "@/modules/inventory/data/rateSetup";

/* ══════════════════════════════════════════════════════════════════
   RATES — one screen for the price and how the day sold (D27-188, D27-194)

   A room's price is a BASE plus ADD-ONS. The base is one guest, room
   only: each room type's own, or one base room type the others are
   derived from (+₹ or +%). The add-ons are set once per hotel - the meal
   plans per guest, double occupancy, extra adult, extra child - and ride
   on every base. The calendar changes only the base; the add-ons follow.

   Under each day, how it sold: paying rooms sold, occupancy, ADR and
   revenue (D27-151). Rooms left and the restrictions are the title
   row's other view. Replaces Pricing, Rate plans, the Rate calendar and
   Rate performance, whose addresses open this.

   Everyone who reads prices sees it; only the rate setters change
   anything, here and on the server.

   NO PRICE IS EVER INVENTED. Nothing set is a DASH, never a zero, and a
   price typed before the change is kept exactly and drawn as what it is.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

const DAYS = 14;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const dayLabel = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return {
    dow: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
    day: d.getUTCDate(),
    weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
  };
};

/** A figure, "Free" for a typed 0, or a dash for nothing set. */
const figure = (v: number | null) => (v === null ? "-" : v === 0 ? "Free" : money(v));

const ADDONS: { key: keyof Addons; kind: "meal_plan" | "double" | "extra_adult" | "extra_child"; plan?: string; label: string }[] = [
  { key: "CP", kind: "meal_plan", plan: "CP", label: "Breakfast (CP), per guest" },
  { key: "MAP", kind: "meal_plan", plan: "MAP", label: "MAP, per guest" },
  { key: "AP", kind: "meal_plan", plan: "AP", label: "AP, per guest" },
  { key: "AI", kind: "meal_plan", plan: "AI", label: "All inclusive (AI), per guest" },
  { key: "double", kind: "double", label: "Double occupancy (the second guest)" },
  { key: "extraAdult", kind: "extra_adult", label: "Extra adult (from the third guest)" },
  { key: "extraChild", kind: "extra_child", label: "Extra child (from the third guest)" },
];

export default function RatesPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const mayEdit = setsRates(useRole());
  const [from, setFrom] = useState<string | null>(null);
  const [view, setView] = useState<"prices" | "rooms">("prices");

  const inventory = useQuery({
    queryKey: ["inventory", hotelId, from],
    queryFn: () => getInventory(hotelId, from ?? undefined,
      from ? addDays(from, DAYS - 1) : undefined),
  });

  /* The window the SERVER chose on the first load (the business date)
     becomes the window the arrows move. */
  useEffect(() => {
    if (!from && inventory.data) setFrom(inventory.data.from);
  }, [from, inventory.data]);

  const pricing = useQuery({
    queryKey: ["pricing", hotelId, from],
    queryFn: () => getPricing(hotelId, from!, DAYS),
    enabled: Boolean(from),
  });
  const days = useQuery({
    queryKey: ["rate-days", hotelId, from],
    queryFn: () => getRateDays(hotelId, from!, DAYS),
    enabled: Boolean(from),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["inventory", hotelId] });
    void qc.invalidateQueries({ queryKey: ["pricing", hotelId] });
    void qc.invalidateQueries({ queryKey: ["rate-days", hotelId] });
  };

  const dates = useMemo(
    () => (from ? Array.from({ length: DAYS }, (_, i) => addDays(from, i)) : []),
    [from]);

  if (inventory.isLoading || !from) {
    return (
      <Page>
        <PageHeader title="Rates" description="Loading…" />
        <Skeleton className="h-96" />
      </Page>
    );
  }
  if (!inventory.data) {
    return (
      <Page>
        <PageHeader title="Rates" />
        <EmptyState
          title="No room types"
          description="Add room types to this property and the calendar fills in."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Rates"
        description="Each day's price, and how the day sold. The add-ons follow the base."
        actions={
          <>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary" size="icon"
              aria-label="Previous two weeks"
              onClick={() => setFrom(addDays(from, -DAYS))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium text-ink-900 tabular whitespace-nowrap">
              {dateShort(from)} – {dateShort(addDays(from, DAYS - 1))}
            </span>
            <Button
              variant="secondary" size="icon"
              aria-label="Next two weeks"
              onClick={() => setFrom(addDays(from, DAYS))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Segmented<"prices" | "rooms">
            value={view}
            onChange={setView}
            className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1"
            options={[
              { value: "prices", label: "Prices" },
              { value: "rooms", label: "Rooms left" },
            ]}
          />
          </>
        }
      />

      {view === "rooms" ? (
        <InventoryGrid
          hotelId={hotelId}
          dates={dates}
          cells={inventory.data.cells}
          restrictions={inventory.data.restrictions}
          onDone={refresh}
        />
      ) : pricing.isLoading || !pricing.data ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="flex flex-col gap-5">
          <SetupCard hotelId={hotelId} pricing={pricing.data} mayEdit={mayEdit} onDone={refresh} />
          <BaseGrid
            hotelId={hotelId}
            dates={dates}
            pricing={pricing.data}
            days={days.data ?? []}
            mayEdit={mayEdit}
            onDone={refresh}
          />
          <OlderPrices hotelId={hotelId} pricing={pricing.data} mayEdit={mayEdit} onDone={refresh} />
          <ReportLinks hotelId={hotelId} />
        </div>
      )}
    </Page>
  );
}

/* ── A scrolling grid, shared by both tabs ────────────────────────
   The room-type column is sticky because the dates run off the right
   of every screen this is used on, and a number with no row label is
   not information. */
function GridShell({ dates, children, corner }: {
  dates: string[]; corner: string; children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto scrollbar-quiet">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white border-b border-r border-grey-200 px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-grey-500 whitespace-nowrap min-w-36">
                {corner}
              </th>
              {dates.map((d) => {
                const { dow, day, weekend } = dayLabel(d);
                return (
                  <th
                    key={d}
                    className={cn(
                      "border-b border-grey-200 px-2 py-2 text-center font-medium min-w-18",
                      weekend && "bg-grey-50",
                    )}
                  >
                    <span className="block text-xs text-grey-500">{dow}</span>
                    <span className="block text-md font-semibold text-ink-900 tabular">{day}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          {children}
        </table>
      </div>
    </Card>
  );
}

/* ── Inventory ────────────────────────────────────────────────── */

function InventoryGrid({ hotelId, dates, cells, restrictions, onDone }: {
  hotelId: string; dates: string[];
  cells: InventoryCell[]; restrictions: Restriction[];
  onDone: () => void;
}) {
  const [editing, setEditing] = useState<
    { roomTypeId: string; roomType: string; date: string } | null>(null);

  const types = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of cells) if (!seen.has(c.roomTypeId)) seen.set(c.roomTypeId, c.roomType);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [cells]);

  const at = useMemo(() => {
    const m = new Map<string, InventoryCell>();
    for (const c of cells) m.set(`${c.roomTypeId}/${c.date}`, c);
    return m;
  }, [cells]);

  const ruleAt = useMemo(() => {
    const m = new Map<string, Restriction>();
    for (const r of restrictions) m.set(`${r.roomTypeId}/${r.date}`, r);
    return m;
  }, [restrictions]);

  if (types.length === 0) {
    return (
      <EmptyState title="No room types"
        description="Add room types to this property and both grids fill in." />
    );
  }

  return (
    <>
      <GridShell dates={dates} corner="Room type">
        <tbody>
          {types.map((t) => (
            <tr key={t.id}>
              <th className="sticky left-0 z-10 bg-white border-b border-r border-grey-200 px-3 py-2 text-left text-sm font-medium text-ink-900">
                {t.name}
              </th>
              {dates.map((d) => {
                const cell = at.get(`${t.id}/${d}`);
                const rule = ruleAt.get(`${t.id}/${d}`);
                const { weekend } = dayLabel(d);
                const closed = rule?.stopSell === true;
                const none = cell && cell.available === 0;
                return (
                  <td
                    key={d}
                    className={cn(
                      "border-b border-grey-200 p-0 text-center",
                      weekend && "bg-grey-50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setEditing({
                        roomTypeId: t.id, roomType: t.name, date: d })}
                      className={cn(
                        "w-full min-h-14 px-1 py-1.5 cursor-pointer",
                        "transition-colors duration-150 hover:bg-grey-100",
                        closed && "bg-brand-red-50",
                        !closed && none && "bg-brand-yellow-50",
                      )}
                      aria-label={`${t.name} on ${d}`}
                    >
                      {/* Available is the number a person acts on. */}
                      <span className={cn(
                        "block text-lg font-semibold tabular",
                        closed ? "text-danger" : none ? "text-warning-dark" : "text-ink-900",
                      )}>
                        {cell ? cell.available : "-"}
                      </span>
                      <span className="block text-xs text-grey-500 tabular">
                        {cell ? `${cell.sold}/${cell.sellable}` : ""}
                      </span>
                      {rule && <RuleMarks rule={rule} />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </GridShell>

      <Legend />

      {editing && (
        <RestrictionDialog
          hotelId={hotelId}
          target={editing}
          existing={ruleAt.get(`${editing.roomTypeId}/${editing.date}`)}
          onClose={() => setEditing(null)}
          onDone={onDone}
        />
      )}
    </>
  );
}

function RuleMarks({ rule }: { rule: Restriction }) {
  return (
    <span className="flex items-center justify-center gap-0.5 mt-0.5">
      {rule.stopSell && <Ban className="size-3 text-danger" aria-label="Stop sell" />}
      {rule.closedArrival && <LogIn className="size-3 text-warning-dark" aria-label="Closed to arrival" />}
      {rule.closedDeparture && <LogOut className="size-3 text-warning-dark" aria-label="Closed to departure" />}
      {(rule.minNights || rule.maxNights) && (
        <span className="text-xs text-grey-600 tabular">
          {rule.minNights ?? ""}
          {rule.minNights && rule.maxNights ? "–" : ""}
          {rule.maxNights ?? ""}
        </span>
      )}
    </span>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-grey-600">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-3 rounded-xs bg-brand-red-50 border border-danger" />
        Stop sell
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-3 rounded-xs bg-brand-yellow-50 border border-brand-yellow" />
        Nothing left
      </span>
      <span className="flex items-center gap-1.5">
        <LogIn className="size-3.5 text-warning-dark" /> Closed to arrival
      </span>
      <span className="flex items-center gap-1.5">
        <LogOut className="size-3.5 text-warning-dark" /> Closed to departure
      </span>
      <span className="text-grey-500">
        The small figures are <b>paying rooms sold / sellable</b>. Complimentary
        and tentative rooms hold a room but are left out; occupancy on the reports
        counts complimentary rooms.
      </span>
    </div>
  );
}

/* ── How rates are built ──────────────────────────────────────────── */

function SetupCard({ hotelId, pricing, mayEdit, onDone }: {
  hotelId: string; pricing: Pricing; mayEdit: boolean; onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { basis } = pricing;
  const derived = pricing.roomTypes.filter((t) => basis && t.id !== basis.roomTypeId);

  return (
    <Card>
      <CardHeader
        title="How rates are built"
        description={basis
          ? `Every room type is derived from ${basis.roomType}. The add-ons ride on every base.`
          : "Each room type has its own base. The add-ons ride on every base."}
        actions={mayEdit && (
          <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        )}
      />
      <CardBody>
        <dl className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2 text-sm">
          {derived.map((t) => (
            <div key={t.id} className="flex justify-between gap-4">
              <dt className="text-grey-600">{t.name}</dt>
              <dd className={cn("tabular", t.difference ? "text-ink-900" : "text-grey-500")}>
                {t.difference === null ? "-"
                  : t.difference.unit === "percent"
                    ? `${t.difference.amount >= 0 ? "+" : ""}${t.difference.amount}%`
                    : `${t.difference.amount >= 0 ? "+" : "-"}${money(Math.abs(t.difference.amount))}`}
              </dd>
            </div>
          ))}
          {ADDONS.map((a) => (
            <div key={a.key} className="flex justify-between gap-4">
              <dt className="text-grey-600">{a.label}</dt>
              <dd className={cn("tabular", pricing.addons[a.key] === null ? "text-grey-500" : "text-ink-900")}>
                {figure(pricing.addons[a.key])}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-grey-500">
          A base covers one guest, room only. A dash is not set: nothing that needs it is sold.
        </p>
      </CardBody>
      {editing && (
        <SetupDialog hotelId={hotelId} pricing={pricing}
          onClose={() => setEditing(false)} onDone={onDone} />
      )}
    </Card>
  );
}

type Amount = { value: string; free: boolean };
const amountOf = (v: number | null): Amount =>
  ({ value: v === null || v === 0 ? "" : String(v), free: v === 0 });
/** What the form holds, as the API takes it: null clears, 0 only when Free. */
const sent = (a: Amount): number | null =>
  (a.free ? 0 : a.value.trim() === "" ? null : Number(a.value));

function SetupDialog({ hotelId, pricing, onClose, onDone }: {
  hotelId: string; pricing: Pricing; onClose: () => void; onDone: () => void;
}) {
  const [baseType, setBaseType] = useState(pricing.basis?.roomTypeId ?? "");
  const [diffs, setDiffs] = useState(() => Object.fromEntries(pricing.roomTypes.map((t) => [
    t.id, { value: t.difference ? String(t.difference.amount) : "", unit: t.difference?.unit ?? "rupees" },
  ])));
  const [addons, setAddons] = useState(() => Object.fromEntries(
    ADDONS.map((a) => [a.key, amountOf(pricing.addons[a.key])])) as Record<keyof Addons, Amount>);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const steps: (() => Promise<{ ok: true } | { ok: false; reason: string }>)[] = [];
    if (baseType !== (pricing.basis?.roomTypeId ?? "")) {
      steps.push(() => setBasis(hotelId, baseType || null));
    }
    if (baseType) {
      for (const t of pricing.roomTypes) {
        if (t.id === baseType) continue;
        const d = diffs[t.id]!;
        const amount = d.value.trim() === "" ? null : Number(d.value);
        if (amount === (t.difference?.amount ?? null)
            && (amount === null || d.unit === t.difference?.unit)) continue;
        steps.push(() => setAddon(hotelId, {
          kind: "room_type", roomTypeId: t.id, amount, unit: d.unit as "rupees" | "percent",
        }));
      }
    }
    for (const a of ADDONS) {
      const amount = sent(addons[a.key]);
      if (amount === pricing.addons[a.key]) continue;
      steps.push(() => setAddon(hotelId, {
        kind: a.kind, ...(a.plan ? { mealPlan: a.plan } : {}),
        amount, ...(amount === 0 ? { free: true } : {}),
      }));
    }
    for (const step of steps) {
      const res = await step();
      if (!res.ok) {
        setSaving(false);
        onDone();
        return toast.error("Not saved", res.reason);
      }
    }
    setSaving(false);
    toast.success("Saved", "Every price follows the base and the add-ons.");
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="How rates are built">
        <div className="space-y-4">
          <Field label="Room types" hint="Derived: the others are the base room type plus a difference.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={baseType}
                onChange={(e) => setBaseType(e.target.value)}>
                <option value="">Each room type has its own base</option>
                {pricing.roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>Derived from {t.name}</option>
                ))}
              </NativeSelect>
            )}
          </Field>

          {baseType && pricing.roomTypes.filter((t) => t.id !== baseType).map((t) => (
            <div key={t.id} className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <Field label={`${t.name}: more than the base`} hint="Empty is not set - a dash, not sold.">
                {(f) => (
                  <Input {...fieldProps(f)} type="number" inputMode="decimal" numeric
                    value={diffs[t.id]!.value} placeholder="-"
                    onChange={(e) => setDiffs({ ...diffs, [t.id]: { ...diffs[t.id]!, value: e.target.value } })} />
                )}
              </Field>
              <NativeSelect aria-label={`${t.name}: rupees or percent`}
                value={diffs[t.id]!.unit}
                onChange={(e) => setDiffs({ ...diffs, [t.id]: { ...diffs[t.id]!, unit: e.target.value as "rupees" | "percent" } })}>
                <option value="rupees">₹</option>
                <option value="percent">%</option>
              </NativeSelect>
            </div>
          ))}

          {ADDONS.map((a) => (
            <div key={a.key} className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <Field label={a.label}>
                {(f) => (
                  <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0} numeric
                    value={addons[a.key].free ? "0" : addons[a.key].value} placeholder="-"
                    disabled={addons[a.key].free}
                    onChange={(e) => setAddons({ ...addons, [a.key]: { value: e.target.value, free: false } })} />
                )}
              </Field>
              <Checkbox label="Free" checked={addons[a.key].free}
                onCheckedChange={(on) => setAddons({ ...addons, [a.key]: { value: "", free: on } })} />
            </div>
          ))}

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="flex-1" disabled={saving}
              onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── The calendar: each type's base, and each day's performance ───── */

function BaseGrid({ hotelId, dates, pricing, days, mayEdit, onDone }: {
  hotelId: string; dates: string[]; pricing: Pricing; days: RateDay[];
  mayEdit: boolean; onDone: () => void;
}) {
  const [editing, setEditing] = useState<
    { roomTypeId: string; roomType: string; date: string; price: number | null } | null>(null);
  const plan = pricing.basis?.mealPlan ?? "EP";

  const at = useMemo(() => {
    const m = new Map<string, PricingCell>();
    for (const c of pricing.cells) if (c.mealPlan === plan) m.set(`${c.roomTypeId}/${c.date}`, c);
    return m;
  }, [pricing.cells, plan]);
  const dayAt = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  if (pricing.roomTypes.length === 0) {
    return <EmptyState title="No room types" description="Add room types and the calendar fills in." />;
  }

  /* Mode b: only the base room type's base is typed here; the rest follow it. */
  const editable = (id: string) => mayEdit && (!pricing.basis || pricing.basis.roomTypeId === id);
  const PERFORMANCE: { label: string; show: (d: RateDay) => string }[] = [
    { label: "Paying rooms sold", show: (d) => String(d.paidSold) },
    { label: "Occupancy", show: (d) => (d.occupancy === null ? "-" : percent(d.occupancy, 0)) },
    { label: "ADR", show: (d) => (d.adr === null ? "-" : money(d.adr)) },
    { label: "Revenue", show: (d) => money(d.revenue) },
  ];

  return (
    <>
      <GridShell dates={dates} corner="Base, one guest, room only">
        <tbody>
          {pricing.roomTypes.map((t) => (
            <tr key={t.id}>
              <th className="sticky left-0 z-10 bg-white border-b border-r border-grey-200 px-3 py-2 text-left text-sm font-medium text-ink-900">
                {t.name}
              </th>
              {dates.map((d) => {
                const cell = at.get(`${t.id}/${d}`);
                const { weekend } = dayLabel(d);
                const older = cell?.source === "rack" || (cell?.covers ?? 1) > 1;
                const derived = cell?.source === "derived";
                const content = cell?.price === null || cell?.price === undefined ? (
                  <span className="block text-base text-grey-500">-</span>
                ) : (
                  <span className={cn(
                    "block text-base tabular",
                    older ? "text-grey-500 italic"
                      : derived ? "text-grey-600" : "text-ink-900 font-semibold",
                  )}>
                    {money(cell.price)}
                  </span>
                );
                const title = older
                  ? `A price set before, covering ${cell?.covers ?? 2} guests`
                  : derived ? `From ${pricing.basis?.roomType ?? "the base room type"}` : undefined;
                return (
                  <td key={d} className={cn("border-b border-grey-200 p-0 text-center", weekend && "bg-grey-50")}>
                    {editable(t.id) ? (
                      <button
                        type="button"
                        onClick={() => setEditing({
                          roomTypeId: t.id, roomType: t.name, date: d,
                          price: older || derived ? null : cell?.price ?? null,
                        })}
                        title={title}
                        className="w-full min-h-14 px-1 py-2 cursor-pointer transition-colors duration-150 hover:bg-grey-100"
                        aria-label={`${t.name} on ${d}`}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className="min-h-14 px-1 py-2 grid place-items-center" title={title}>{content}</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {PERFORMANCE.map((p, i) => (
            <tr key={p.label} className={cn(i === 0 && "border-t-2 border-grey-300")}>
              <th className="sticky left-0 z-10 bg-white border-b border-r border-grey-200 px-3 py-1.5 text-left text-xs font-medium text-grey-600">
                {p.label}
              </th>
              {dates.map((d) => {
                const day = dayAt.get(d);
                return (
                  <td key={d} className={cn("border-b border-grey-200 px-1 py-1.5 text-center text-sm tabular text-grey-700",
                    dayLabel(d).weekend && "bg-grey-50")}>
                    {day ? p.show(day) : "-"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </GridShell>

      <div className="-mt-2 flex flex-wrap gap-x-6 gap-y-2 text-xs text-grey-600">
        <span><b className="text-ink-900">4,000</b> a base</span>
        <span className="text-grey-600">4,000 from the base room type</span>
        <span className="text-grey-500 italic">4,000 a price set before (covers 2)</span>
        <span className="text-grey-500">- not priced</span>
        <span className="text-grey-500">
          Paying rooms sold, ADR and revenue leave complimentary rooms and day use out;
          occupancy counts complimentary rooms, as the reports do.
        </span>
      </div>

      {editing && (
        <BaseDialog hotelId={hotelId} target={editing}
          onClose={() => setEditing(null)} onDone={onDone} />
      )}
    </>
  );
}

function BaseDialog({ hotelId, target, onClose, onDone }: {
  hotelId: string;
  target: { roomTypeId: string; roomType: string; date: string; price: number | null };
  onClose: () => void; onDone: () => void;
}) {
  const [price, setPrice] = useState(target.price === null || target.price === 0 ? "" : String(target.price));
  /* X-1 (D27-120): 0 only when ticked Free; empty is not priced yet. */
  const [free, setFree] = useState(target.price === 0);
  const [until, setUntil] = useState(target.date);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const nights = Math.max(1,
    Math.round((Date.parse(`${until}T00:00:00Z`)
      - Date.parse(`${target.date}T00:00:00Z`)) / 86_400_000) + 1);

  const save = async (clearing: boolean) => {
    setSaving(true);
    const res = await setBasePrice(hotelId, {
      roomTypeId: target.roomTypeId,
      from: target.date,
      /* Half-open: `to` is the first day NOT covered. */
      to: addDays(until, 1),
      price: clearing ? null : free ? 0 : Number(price),
      ...(free && !clearing ? { free } : {}),
    });
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(clearing ? "Base cleared" : "Base set",
      `${target.roomType} · ${nights} ${nights === 1 ? "day" : "days"} from ${dateShort(target.date)}`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`${target.roomType} · base`}>
        <div className="space-y-4">
          <Field label="Base per night" hint="One guest, room only. The add-ons follow it.">
            {(f) => (
              <Input {...fieldProps(f)} ref={first}
                type="number" inputMode="decimal" min={0}
                value={free ? "0" : price} onChange={(e) => setPrice(e.target.value)}
                disabled={free} className="text-lg tabular" />
            )}
          </Field>
          <Checkbox label="Free" checked={free} onCheckedChange={setFree} />
          <Field label="Through" hint="The last day this base applies to.">
            {(f) => (
              <Input {...fieldProps(f)} type="date" min={target.date}
                value={until} onChange={(e) => setUntil(e.target.value)} />
            )}
          </Field>
          <p className="text-sm text-grey-600">
            {nights === 1
              ? `${dateShort(target.date)} only.`
              : `${nights} days, ${dateShort(target.date)} through ${dateShort(until)}.`}
          </p>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="flex-1">Cancel</Button>
            </DialogClose>
            {target.price !== null && (
              <Button variant="secondary" disabled={saving} onClick={() => void save(true)}>
                Clear
              </Button>
            )}
            <Button variant="primary" className="flex-1"
              disabled={saving || (price.trim() === "" && !free)}
              onClick={() => void save(false)}>
              {saving ? "Saving…" : "Set base"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Prices typed before the change, kept exactly (D27-194) ────────── */

function OlderPrices({ hotelId, pricing, mayEdit, onDone }: {
  hotelId: string; pricing: Pricing; mayEdit: boolean; onDone: () => void;
}) {
  const [removing, setRemoving] = useState<{ what: string; run: () => Promise<{ ok: boolean; reason?: string }> } | null>(null);
  const name = (id: string) => pricing.roomTypes.find((t) => t.id === id)?.name ?? "";
  const racks = pricing.roomTypes.filter((t) => t.rack !== null);
  if (pricing.older.length === 0 && racks.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Prices set before"
        description="Kept exactly as they were: each covers the guests it always did, and wins over the base on its dates." />
      <CardBody className="pt-0">
        <ul className="divide-y divide-grey-100">
          {pricing.older.map((o) => {
            const what = `${name(o.roomTypeId)} · ${o.mealPlan} · ${money(o.price)}, covers ${o.covers}`;
            return (
              <li key={o.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="text-ink-900">{what}</span>
                  <span className="block text-grey-500">
                    {dateShort(o.from)}{o.to ? ` to ${dateShort(addDays(o.to, -1))}` : " onwards"}
                    {o.label ? ` · ${o.label}` : ""}
                  </span>
                </span>
                {mayEdit && (
                  <Button variant="secondary" onClick={() => setRemoving({
                    what, run: () => removeRate(hotelId, o.id) })}>Remove</Button>
                )}
              </li>
            );
          })}
          {racks.map((t) => {
            const what = `${t.name} · old rack rate ${money(t.rack!)}, covers ${t.baseOccupancy}`;
            return (
              <li key={t.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="text-ink-900">{what}</span>
                  <span className="block text-grey-500">Used only on dates no base covers.</span>
                </span>
                {mayEdit && (
                  <Button variant="secondary" onClick={() => setRemoving({
                    what, run: () => setRackRate(hotelId, t.id, null) })}>Remove</Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
      {removing && (
        <Dialog open onOpenChange={(o) => { if (!o) setRemoving(null); }}>
          <DialogContent title="Remove this price?">
            <p className="text-sm text-grey-600 mb-4">
              {removing.what}. Its dates then take the base and the add-ons, or a dash where
              there is no base. Bookings already made keep their rate.
            </p>
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="secondary" className="flex-1">Cancel</Button>
              </DialogClose>
              <Button variant="danger" className="flex-1" onClick={async () => {
                const res = await removing.run();
                setRemoving(null);
                if (!res.ok) return toast.error("Not removed", res.reason ?? "");
                toast.success("Removed", removing.what);
                onDone();
              }}>Remove</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

/* ── The reports, one tap away ────────────────────────────────────── */

function ReportLinks({ hotelId }: { hotelId: string }) {
  const LINKS = [
    { label: "Manager report", to: "/reports/manager" },
    { label: "Monthly occupancy", to: "/reports/monthly-occupancy" },
    { label: "Monthly statistics", to: "/reports/monthly-stats" },
    { label: "Revenue outlook", to: `/h/${hotelId}/revenue-outlook` },
  ];
  return (
    <nav aria-label="Reports" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="text-brand-orange-700 hover:underline">{l.label}</Link>
      ))}
    </nav>
  );
}

/* ── Setting a restriction ────────────────────────────────────── */

function RestrictionDialog({ hotelId, target, existing, onClose, onDone }: {
  hotelId: string;
  target: { roomTypeId: string; roomType: string; date: string };
  existing: Restriction | undefined;
  onClose: () => void; onDone: () => void;
}) {
  const [stopSell, setStopSell] = useState(existing?.stopSell ?? false);
  const [coa, setCoa] = useState(existing?.closedArrival ?? false);
  const [cod, setCod] = useState(existing?.closedDeparture ?? false);
  const [min, setMin] = useState(existing?.minNights?.toString() ?? "");
  const [max, setMax] = useState(existing?.maxNights?.toString() ?? "");
  const [until, setUntil] = useState(target.date);
  const [saving, setSaving] = useState(false);

  const days = Math.max(1,
    Math.round((Date.parse(`${until}T00:00:00Z`)
      - Date.parse(`${target.date}T00:00:00Z`)) / 86_400_000) + 1);

  const save = async () => {
    setSaving(true);
    const res = await setRestriction(hotelId, {
      roomTypeId: target.roomTypeId,
      from: target.date,
      /* Inclusive here — the API applies across [from, to] with a
         generate_series, unlike the rate range. */
      to: until,
      stopSell, closedArrival: coa, closedDeparture: cod,
      minNights: min.trim() === "" ? null : Number(min),
      maxNights: max.trim() === "" ? null : Number(max),
    });
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Applied",
      `${target.roomType} · ${days} ${days === 1 ? "day" : "days"}`);
    onClose();
    onDone();
  };

  const Toggle = ({ on, set, label, hint }: {
    on: boolean; set: (v: boolean) => void; label: string; hint: string;
  }) => (
    <button
      type="button"
      onClick={() => set(!on)}
      className={cn(
        "w-full min-h-14 px-4 py-3 rounded-lg border text-left cursor-pointer",
        "flex items-center gap-3 press-tile",
        on ? "bg-ink-900 border-ink-900 text-white"
           : "bg-white border-grey-300 hover:border-grey-400",
      )}
    >
      <span className={cn(
        "size-5 rounded-xs grid place-items-center shrink-0 border",
        on ? "bg-white/20 border-white/40" : "border-grey-300",
      )}>
        {on && <Check className="size-3.5" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className={cn("block text-xs",
          on ? "text-white/70" : "text-grey-500")}>{hint}</span>
      </span>
    </button>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`${target.roomType} · ${dateShort(target.date)}`}>
        <div className="space-y-3">
          <Toggle on={stopSell} set={setStopSell}
            label="Stop sell" hint="Nothing may be booked at all" />
          <Toggle on={coa} set={setCoa}
            label="Closed to arrival"
            hint="A stay may not begin here - protects a long weekend" />
          <Toggle on={cod} set={setCod}
            label="Closed to departure" hint="A stay may not end here" />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum nights">
              {(f) => (
                <Input {...fieldProps(f)} type="number" inputMode="numeric" min={1}
                  value={min} onChange={(e) => setMin(e.target.value)}
                  placeholder="-" numeric />
              )}
            </Field>
            <Field label="Maximum nights">
              {(f) => (
                <Input {...fieldProps(f)} type="number" inputMode="numeric" min={1}
                  value={max} onChange={(e) => setMax(e.target.value)}
                  placeholder="-" numeric />
              )}
            </Field>
          </div>

          <Field label="Through" hint="Apply the same rules to every day up to here.">
            {(f) => (
              <Input {...fieldProps(f)} type="date" min={target.date}
                value={until} onChange={(e) => setUntil(e.target.value)} />
            )}
          </Field>

          <p className="text-sm text-grey-600">
            {days === 1 ? `${dateShort(target.date)} only.`
                        : `${days} days, ${dateShort(target.date)} through ${dateShort(until)}.`}
            {" "}Clearing everything removes the rule rather than storing a
            row that says nothing.
          </p>

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="flex-1" disabled={saving}
                    onClick={() => void save()}>
              {saving ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
