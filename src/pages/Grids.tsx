import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ChevronLeft, ChevronRight, Ban, LogIn, LogOut, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui";
import {
  getInventory, getPriceGrid, setRate, setRestriction,
  type InventoryCell, type PriceCell, type Restriction,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE TWO GRIDS

   A revenue manager's day: how many rooms are left, and what they
   cost. Same date window, two tabs, because the two questions are
   asked together — you close a date because it is nearly full, and
   you price it because it is not.

   NO PRICE IS EVER INVENTED. A cell with nothing behind it renders a
   DASH. Not a zero: zero is a claim that the room is free, and it is
   a claim that would post a zero-value charge at the night audit and
   halve an ADR. Seven database assertions exist to keep that true and
   this screen is where a person would first see it broken.

   A PRICE SOMEBODY CHOSE AND A PRICE NOBODY LOOKED AT ARE DRAWN
   DIFFERENTLY. ₹4,099 set for this Saturday and ₹4,099 inherited from
   the room type are different facts. Shown identically, a whole
   season stays at the default because it looked deliberate.

   OCCUPIED AND SOLD ARE BOTH SHOWN. Occupied includes complimentary
   and tentative, because they hold a room nobody else can have. Sold
   is the statistics definition that feeds occupancy and ADR. A grid
   showing one of them disagrees with the Manager Report while both
   are right.
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

export default function GridsPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const [from, setFrom] = useState<string | null>(null);

  const inventory = useQuery({
    queryKey: ["inventory", hotelId, from],
    queryFn: () => getInventory(hotelId, from ?? undefined,
      from ? addDays(from, DAYS - 1) : undefined),
  });

  /* The window the SERVER chose on the first load becomes the window
     the arrows move. Picking today in the browser would be the wrong
     day for a hotel whose business date has not rolled yet. */
  useEffect(() => {
    if (!from && inventory.data) setFrom(inventory.data.from);
  }, [from, inventory.data]);

  const prices = useQuery({
    queryKey: ["price-grid", hotelId, from],
    queryFn: () => getPriceGrid(hotelId, from ?? undefined,
      from ? addDays(from, DAYS - 1) : undefined),
    enabled: Boolean(from),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["inventory", hotelId] });
    void qc.invalidateQueries({ queryKey: ["price-grid", hotelId] });
  };

  const dates = useMemo(
    () => (from ? Array.from({ length: DAYS }, (_, i) => addDays(from, i)) : []),
    [from]);

  if (inventory.isLoading || !from) {
    return (
      <Page>
        <PageHeader title="Inventory and rates" description="Loading…" />
        <Skeleton className="h-96" />
      </Page>
    );
  }
  if (!inventory.data) {
    return (
      <Page>
        <PageHeader title="Inventory and rates" />
        <EmptyState
          title="No room types"
          description="Add room types to this property and both grids fill in."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Inventory and rates"
        description="How many rooms are left, and what they cost."
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="secondary" className="h-11 w-11 p-0"
              aria-label="Previous two weeks"
              onClick={() => setFrom(addDays(from, -DAYS))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-2 text-base tabular whitespace-nowrap">
              {from} → {addDays(from, DAYS - 1)}
            </span>
            <Button
              variant="secondary" className="h-11 w-11 p-0"
              aria-label="Next two weeks"
              onClick={() => setFrom(addDays(from, DAYS))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="rates">Rates</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <InventoryGrid
            hotelId={hotelId}
            dates={dates}
            cells={inventory.data.cells}
            restrictions={inventory.data.restrictions}
            onDone={refresh}
          />
        </TabsContent>

        <TabsContent value="rates">
          {prices.isLoading || !prices.data ? (
            <Skeleton className="h-96" />
          ) : (
            <RateGrid
              hotelId={hotelId}
              dates={dates}
              plans={prices.data.plans}
              cells={prices.data.cells}
              onDone={refresh}
            />
          )}
        </TabsContent>
      </Tabs>
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
    <Card className="mt-4 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white border-b border-r border-grey-200 px-3 py-2 text-left font-medium min-w-44">
                {corner}
              </th>
              {dates.map((d) => {
                const { dow, day, weekend } = dayLabel(d);
                return (
                  <th
                    key={d}
                    className={cn(
                      "border-b border-grey-200 px-2 py-2 text-center font-medium min-w-16",
                      weekend && "bg-grey-50",
                    )}
                  >
                    <span className="block text-xs text-grey-500">{dow}</span>
                    <span className="block tabular">{day}</span>
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
              <th className="sticky left-0 z-10 bg-white border-b border-r border-grey-200 px-3 py-2 text-left font-medium">
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
                        closed && "bg-red-50",
                        !closed && none && "bg-yellow-50",
                      )}
                      aria-label={`${t.name} on ${d}`}
                    >
                      {/* Available is the number a person acts on. */}
                      <span className={cn(
                        "block text-lg font-semibold tabular",
                        closed ? "text-danger" : none ? "text-warning-dark" : "text-ink-900",
                      )}>
                        {cell ? cell.available : "—"}
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
        <span className="text-[10px] text-grey-600 tabular">
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
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-grey-600">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-3 rounded bg-red-50 border border-danger" />
        Stop sell
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-3 rounded bg-yellow-50 border border-brand-yellow" />
        Nothing left
      </span>
      <span className="flex items-center gap-1.5">
        <LogIn className="size-3.5 text-warning-dark" /> Closed to arrival
      </span>
      <span className="flex items-center gap-1.5">
        <LogOut className="size-3.5 text-warning-dark" /> Closed to departure
      </span>
      <span className="text-grey-500">
        The small figures are <b>sold / sellable</b>. Complimentary and
        tentative rooms hold inventory but are not sold.
      </span>
    </div>
  );
}

/* ── Rates ────────────────────────────────────────────────────── */

function RateGrid({ hotelId, dates, plans, cells, onDone }: {
  hotelId: string; dates: string[];
  plans: { roomTypeId: string; roomType: string;
           mealPlan: string; mealPlanName: string }[];
  cells: PriceCell[];
  onDone: () => void;
}) {
  const [editing, setEditing] = useState<
    { roomTypeId: string; label: string; mealPlan: string;
      date: string; price: number | null } | null>(null);

  const at = useMemo(() => {
    const m = new Map<string, PriceCell>();
    for (const c of cells) m.set(`${c.roomTypeId}/${c.mealPlan}/${c.date}`, c);
    return m;
  }, [cells]);

  if (plans.length === 0) {
    return (
      <EmptyState title="No room types"
        description="Add room types to this property and both grids fill in." />
    );
  }

  return (
    <>
      <GridShell dates={dates} corner="Room type · plan">
        <tbody>
          {plans.map((p) => (
            <tr key={`${p.roomTypeId}/${p.mealPlan}`}>
              <th className="sticky left-0 z-10 bg-white border-b border-r border-grey-200 px-3 py-2 text-left font-medium">
                <span className="block">{p.roomType}</span>
                <span className="block text-xs text-grey-500 font-normal">
                  {p.mealPlan} · {p.mealPlanName}
                </span>
              </th>
              {dates.map((d) => {
                const cell = at.get(`${p.roomTypeId}/${p.mealPlan}/${d}`);
                const { weekend } = dayLabel(d);
                const inherited = cell?.source === "rack";
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
                        roomTypeId: p.roomTypeId,
                        label: `${p.roomType} · ${p.mealPlan}`,
                        mealPlan: p.mealPlan, date: d,
                        price: cell?.price ?? null,
                      })}
                      title={cell?.season ?? (inherited ? "The room type's own rate" : undefined)}
                      className={cn(
                        "w-full min-h-14 px-1 py-2 cursor-pointer",
                        "transition-colors duration-150 hover:bg-grey-100",
                      )}
                      aria-label={`${p.roomType} ${p.mealPlan} on ${d}`}
                    >
                      {/* A DASH, never a zero. Nothing covers this date and
                          the room type has no rate of its own — that is not
                          the same as the room being free. */}
                      {cell?.price === null || cell?.price === undefined ? (
                        <span className="block text-lg text-grey-300">—</span>
                      ) : (
                        <span className={cn(
                          "block text-base tabular",
                          /* Inherited is drawn quietly. It is a real price —
                             a booking would use it — but nobody chose it for
                             this date, and that is the thing a revenue
                             manager is scanning for. */
                          inherited
                            ? "text-grey-400 font-normal italic"
                            : "text-ink-900 font-semibold",
                        )}>
                          {money(cell.price)}
                        </span>
                      )}
                      {cell?.season && (
                        <span className="block text-[10px] text-grey-500 truncate">
                          {cell.season}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </GridShell>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-grey-600">
        <span><b className="text-ink-900">4,099</b> priced for the date</span>
        <span className="text-grey-400 italic">4,099 the room type&rsquo;s own rate, nobody set this date</span>
        <span className="text-grey-300">— nothing at all</span>
      </div>

      {editing && (
        <PriceDialog
          hotelId={hotelId}
          target={editing}
          onClose={() => setEditing(null)}
          onDone={onDone}
        />
      )}
    </>
  );
}

/* ── Setting a price ──────────────────────────────────────────── */

function PriceDialog({ hotelId, target, onClose, onDone }: {
  hotelId: string;
  target: { roomTypeId: string; label: string; mealPlan: string;
            date: string; price: number | null };
  onClose: () => void; onDone: () => void;
}) {
  const [price, setPrice] = useState(
    target.price === null ? "" : String(target.price));
  const [until, setUntil] = useState(target.date);
  const [label, setLabel] = useState("");
  const [extraAdult, setExtraAdult] = useState("");
  const [extraChild, setExtraChild] = useState("");
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);

  const nights = Math.max(1,
    Math.round((Date.parse(`${until}T00:00:00Z`)
      - Date.parse(`${target.date}T00:00:00Z`)) / 86_400_000) + 1);

  const save = async (clearing: boolean) => {
    setSaving(true);
    const res = await setRate(hotelId, {
      roomTypeId: target.roomTypeId,
      mealPlan: target.mealPlan,
      from: target.date,
      /* The API takes a half-open range: `to` is the first day NOT
         covered. The screen asks for the last day INCLUDED, because
         that is the question a person is actually answering. */
      to: addDays(until, 1),
      price: clearing ? null : Number(price),
      ...(label.trim() ? { label: label.trim() } : {}),
      /* Empty is NOT zero. An unpriced extra adult makes the whole tariff
         unknown, which is the honest answer — a quiet zero would quote the
         couple's price for three people. */
      ...(extraAdult.trim() === "" ? {} : { extraAdult: Number(extraAdult) }),
      ...(extraChild.trim() === "" ? {} : { extraChild: Number(extraChild) }),
    });
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(
      clearing ? "Price cleared" : "Price set",
      `${target.label} · ${nights} ${nights === 1 ? "day" : "days"} from ${target.date}`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={target.label}>
        <div className="space-y-4">
          <Field label="Price per night"
                 hint="Leave empty and use Clear to remove the price instead.">
            {(f) => (
              <Input
                {...fieldProps(f)} ref={first}
                type="number" inputMode="decimal" min={0}
                value={price} onChange={(e) => setPrice(e.target.value)}
                className="h-12 text-lg tabular"
              />
            )}
          </Field>

          <Field label="Through" hint="The last day this price applies to.">
            {(f) => (
              <Input
                {...fieldProps(f)}
                type="date" min={target.date}
                value={until} onChange={(e) => setUntil(e.target.value)}
                className="h-12 text-base"
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Extra adult"
                   hint="Per night, beyond the room's base occupancy.">
              {(f) => (
                <Input
                  {...fieldProps(f)}
                  type="number" inputMode="decimal" min={0}
                  value={extraAdult}
                  onChange={(e) => setExtraAdult(e.target.value)}
                  placeholder="—"
                  className="h-12 text-base tabular"
                />
              )}
            </Field>
            <Field label="Extra child" hint="Left empty means nobody has priced it.">
              {(f) => (
                <Input
                  {...fieldProps(f)}
                  type="number" inputMode="decimal" min={0}
                  value={extraChild}
                  onChange={(e) => setExtraChild(e.target.value)}
                  placeholder="—"
                  className="h-12 text-base tabular"
                />
              )}
            </Field>
          </div>

          <Field label="Season name" hint="Optional. “Diwali week”, “Wedding”.">
            {(f) => (
              <Input
                {...fieldProps(f)}
                value={label} onChange={(e) => setLabel(e.target.value)}
                className="h-12 text-base"
              />
            )}
          </Field>

          <p className="text-sm text-grey-600">
            {nights === 1
              ? `${target.date} only.`
              : `${nights} days, ${target.date} through ${until}.`}
            {" "}Whatever already covers those dates is split around this.
          </p>

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            {target.price !== null && (
              <Button
                variant="secondary" className="h-12"
                disabled={saving}
                onClick={() => void save(true)}
              >
                Clear
              </Button>
            )}
            <Button
              className="h-12 flex-1"
              disabled={saving || price.trim() === ""}
              onClick={() => void save(false)}
            >
              {saving ? "Saving…" : "Set price"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
        "w-full min-h-14 px-4 py-2.5 rounded-lg border text-left cursor-pointer",
        "flex items-center gap-3 transition-colors duration-150",
        on ? "bg-ink-900 border-ink-900 text-white"
           : "bg-white border-grey-300 hover:border-grey-400",
      )}
    >
      <span className={cn(
        "size-5 rounded grid place-items-center shrink-0 border",
        on ? "bg-white/20 border-white/40" : "border-grey-300",
      )}>
        {on && <Check className="size-3.5" />}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-medium">{label}</span>
        <span className={cn("block text-xs",
          on ? "text-white/70" : "text-grey-500")}>{hint}</span>
      </span>
    </button>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`${target.roomType} · ${target.date}`}>
        <div className="space-y-3">
          <Toggle on={stopSell} set={setStopSell}
            label="Stop sell" hint="Nothing may be booked at all" />
          <Toggle on={coa} set={setCoa}
            label="Closed to arrival"
            hint="A stay may not begin here — protects a long weekend" />
          <Toggle on={cod} set={setCod}
            label="Closed to departure" hint="A stay may not end here" />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum nights">
              {(f) => (
                <Input {...fieldProps(f)} type="number" inputMode="numeric" min={1}
                  value={min} onChange={(e) => setMin(e.target.value)}
                  placeholder="—" className="h-12 text-base tabular" />
              )}
            </Field>
            <Field label="Maximum nights">
              {(f) => (
                <Input {...fieldProps(f)} type="number" inputMode="numeric" min={1}
                  value={max} onChange={(e) => setMax(e.target.value)}
                  placeholder="—" className="h-12 text-base tabular" />
              )}
            </Field>
          </div>

          <Field label="Through" hint="Apply the same rules to every day up to here.">
            {(f) => (
              <Input {...fieldProps(f)} type="date" min={target.date}
                value={until} onChange={(e) => setUntil(e.target.value)}
                className="h-12 text-base" />
            )}
          </Field>

          <p className="text-sm text-grey-600">
            {days === 1 ? `${target.date} only.`
                        : `${days} days, ${target.date} through ${until}.`}
            {" "}Clearing everything removes the rule rather than storing a
            row that says nothing.
          </p>

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button className="h-12 flex-1" disabled={saving}
                    onClick={() => void save()}>
              {saving ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
