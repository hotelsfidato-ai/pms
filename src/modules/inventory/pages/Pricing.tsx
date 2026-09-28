import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, format as fmt, getDaysInMonth, parseISO, startOfMonth } from "date-fns";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, Skeleton, ErrorState, Button, Input, Field,
  fieldProps, NativeSelect, Segmented, StatusPill, InfoButton, Checkbox, toast,
} from "@/components/ui";
import {
  getPricing, setBasis, setBasePrice, setOffset,
  type Pricing, type PriceSource,
} from "@/modules/inventory/data/pricing";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   PRICING — one base, and everything else a difference from it

   The owner asked for one screen, shaped like a calendar, holding the
   dates, the base and each difference (16 September 2026). This is it.

   THE TWO SENTENCES THIS SCREEN HAS TO MAKE TRUE

   "This room is the base price" — one figure, on a date, and every
   other price built from it. Change it and the whole system moves,
   which is visible here: the derived prices under a date are read back
   from the database, not computed in this file.

   "Where nothing is set, the base applies" — an unset difference is a
   DASH and the price beside it is the base. A dash is not a zero and
   this screen never turns one into the other.

   NOTHING IS PRICED WHEN THIS ARRIVES. Every figure is blank until
   somebody types it; the screen says what is missing rather than
   showing a confident number nobody has agreed to.
   ══════════════════════════════════════════════════════════════════ */

const ISO = "yyyy-MM-dd";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The label a person reads for where a price came from. */
const SOURCE_LABEL: Record<Exclude<PriceSource, null>, string> = {
  typed: "Set here",
  derived: "From the base",
  rack: "Old rack rate",
};

export default function PricingPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(() => startOfMonth(parseISO(BUSINESS_DATE)));
  const from = fmt(month, ISO);
  const days = getDaysInMonth(month);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pricing", hotelId, from],
    queryFn: () => getPricing(hotelId, from, days),
  });

  const [selected, setSelected] = useState<string>(BUSINESS_DATE);
  /* The owner asked for both: a figure typed for one date, or across a
     period. `until` is the LAST day a person means, inclusive — the
     half-open end goes to the server. */
  const [span, setSpan] = useState<"date" | "range">("date");
  const [until, setUntil] = useState<string>("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pricing"] });

  const applied = () => {
    const last = span === "range" && until ? until : selected;
    return {
      from: selected,
      /* Half-open: the day after the last day a person named. */
      to: fmt(addDays(parseISO(last), 1), ISO),
      words: span === "range" && until && until !== selected
        ? `${dateShort(selected)} to ${dateShort(last)}`
        : dateShort(selected),
    };
  };

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="Pricing" description="Loading…" />
        <Skeleton className="h-96" />
      </Page>
    );
  }

  if (error || !data) {
    return (
      <Page>
        <PageHeader title="Pricing" />
        <ErrorState error={error} onRetry={refetch} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Pricing"
        description="One base price - the cheapest room, one person, no breakfast. Every other price is that figure plus a difference, so changing the base moves them all."
      />

      {data.basis
        ? (
          <ChooseTheBase data={data} hotelId={hotelId} onDone={refresh} again />
        )
        : (
          <ChooseTheBase data={data} hotelId={hotelId} onDone={refresh} />
        )}

      {data.basis && (
        <>
          <Calendar
            data={data}
            month={month}
            onMonth={setMonth}
            selected={selected}
            onSelect={(d) => { setSelected(d); if (!until) setUntil(d); }}
          />

          <Card className="mt-5 px-4 py-3.5">
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div>
                <p className="text-2xs uppercase tracking-wide text-grey-500">
                  What you type applies to
                </p>
                <p className="text-md font-semibold text-ink-900 mt-0.5">
                  {applied().words}
                </p>
              </div>
              <Segmented
                value={span}
                onChange={(v) => setSpan(v)}
                options={[
                  { value: "date", label: "This date" },
                  { value: "range", label: "A period" },
                ]}
                className="ml-auto"
              />
              {span === "range" && (
                <Field label="Through, and including">
                  {(f) => (
                    <Input
                      {...fieldProps(f)}
                      type="date"
                      value={until}
                      min={selected}
                      onChange={(e) => setUntil(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>

            <TheBaseFigure
              data={data} hotelId={hotelId} applied={applied()} onDone={refresh}
            />

            <Differences
              data={data} hotelId={hotelId} applied={applied()}
              date={selected} onDone={refresh}
            />
          </Card>

          <WhatItComesTo data={data} date={selected} />
        </>
      )}
    </Page>
  );
}

/* ── Which room is the base ───────────────────────────────────────── */

function ChooseTheBase({
  data, hotelId, onDone, again,
}: {
  data: Pricing; hotelId: string; onDone: () => void;
  /** Already chosen: shown as a quiet line rather than a form. */
  again?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [roomTypeId, setRoomTypeId] = useState(data.basis?.roomTypeId ?? "");
  const [mealPlan, setMealPlan] = useState(data.basis?.mealPlan ?? "EP");

  const save = useMutation({
    mutationFn: () => setBasis(hotelId, { roomTypeId, mealPlan }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success("The base is set", "Every price that is not typed follows it now.");
        setOpen(false);
        onDone();
      } else {
        toast.error("That is not the base", r.reason);
      }
    },
  });

  if (again && !open) {
    return (
      <Card className="mb-5 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone="info">The base</StatusPill>
          <p className="text-base text-ink-900">
            <span className="font-medium">{data.basis!.roomType}</span>
            {" · "}{data.basis!.mealPlanName}
            {" · "}one person
          </p>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setOpen(true)}>
            Change which room is the base
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-5 px-4 py-3.5">
      {/* The section's note behind an (i), the same words (the owner, 27 September). */}
      <div className="flex items-center gap-1">
        <h2 className="text-md font-semibold text-ink-900">
          {again ? "Which room is the base?" : "Start by choosing the base room"}
        </h2>
        <InfoButton>{"The cheapest thing this property sells, for one person, with no meals. Every other price is built from it, so nothing else can be priced until this is set. It does not change how many people a room is sold for - that stays on the room type."}</InfoButton>
      </div>

      <div className="flex flex-wrap items-end gap-3 mt-3">
        <Field label="Room type" required>
          {(f) => (
            <NativeSelect
              {...fieldProps(f)}
              value={roomTypeId}
              onChange={(e) => setRoomTypeId(e.target.value)}
            >
              <option value="">Choose…</option>
              {data.roomTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.category ? `${t.category} · ${t.name}` : t.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Meal plan" required>
          {(f) => (
            <NativeSelect
              {...fieldProps(f)}
              value={mealPlan}
              onChange={(e) => setMealPlan(e.target.value)}
            >
              {data.mealPlans.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button
          variant="primary"
          disabled={!roomTypeId || save.isPending}
          onClick={() => save.mutate()}
        >
          {again ? "Make this the base" : "Set the base room"}
        </Button>
        {again && (
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        )}
      </div>
    </Card>
  );
}

/* ── The calendar ─────────────────────────────────────────────────── */

function Calendar({
  data, month, onMonth, selected, onSelect,
}: {
  data: Pricing;
  month: Date;
  onMonth: (d: Date) => void;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const basePrice = useMemo(() => {
    const map = new Map<string, { price: number | null; source: PriceSource }>();
    if (!data.basis) return map;
    for (const c of data.cells) {
      if (c.roomTypeId === data.basis.roomTypeId && c.mealPlan === data.basis.mealPlan) {
        map.set(c.date, { price: c.price, source: c.source });
      }
    }
    return map;
  }, [data]);

  const first = startOfMonth(month);
  /* Monday-first, like the rest of this product's calendars. */
  const lead = (first.getDay() + 6) % 7;
  const total = getDaysInMonth(month);

  return (
    <Card className="px-4 py-3.5">
      {/* The month arrows as the Calendar's week arrows: capsule icons. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button
          variant="secondary" size="icon"
          aria-label="The month before"
          onClick={() => onMonth(addMonths(month, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="text-md font-semibold text-ink-900">{fmt(month, "MMMM yyyy")}</h2>
        <Button
          variant="secondary" size="icon"
          aria-label="The month after"
          onClick={() => onMonth(addMonths(month, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        <p className="ml-auto text-sm text-grey-500">The base on each date</p>
      </div>

      {/* On a phone the month scrolls inside its card, so every figure
          stays whole (the Breathing Room Rule); the page never does. */}
      <div className="overflow-x-auto scrollbar-quiet">
      <div className="grid grid-cols-7 gap-2 min-w-[36rem]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-2xs uppercase tracking-wide text-grey-500 text-center pb-1">
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
        {Array.from({ length: total }, (_, i) => {
          const date = fmt(addDays(first, i), ISO);
          const cell = basePrice.get(date);
          /* ONLY A TYPED FIGURE IS THE BASE. Reading `price` alone showed a
             property with no base its old RACK rate on every date, under the
             words "the base on each date" — a figure covering two people,
             read as one person's. */
          const set = cell?.source === "typed" && cell.price != null;
          const isSelected = date === selected;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              /* Named, because the text inside is "25" and "₹3,000" in two
                 spans — which the accessibility tree read as a button with
                 no name at all. A month of those is thirty-one anonymous
                 buttons to anybody not looking at the screen. */
              aria-label={`${dateShort(date)}${set ? `, base ${money(cell!.price!)}` : ", no base set"}`}
              className={cn(
                "min-h-14 rounded-lg border px-2 py-1.5 text-left cursor-pointer press-tile",
                isSelected
                  ? "border-brand-orange bg-brand-orange-50"
                  : "border-grey-200 hover:bg-grey-50",
              )}
            >
              {/* grey-600: a selected cell is tinted, where grey-500 is
                  4.38:1. The date is the label of the whole control. */}
              <span className="block text-sm tabular text-grey-600">{i + 1}</span>
              <span
                className={cn(
                  "block text-sm tabular truncate",
                  set ? "text-ink-900 font-medium" : "text-grey-600",
                )}
              >
                {/* A dash until somebody types one, and never a zero. */}
                {set ? money(cell!.price!) : "-"}
              </span>
            </button>
          );
        })}
      </div>
      </div>
    </Card>
  );
}

/* ── The base figure itself ───────────────────────────────────────── */

function TheBaseFigure({
  data, hotelId, applied, onDone,
}: {
  data: Pricing; hotelId: string;
  applied: { from: string; to: string; words: string };
  onDone: () => void;
}) {
  const current = data.cells.find(
    (c) => c.date === applied.from
      && c.roomTypeId === data.basis?.roomTypeId
      && c.mealPlan === data.basis?.mealPlan,
  );
  /* A base is a figure somebody typed for the basis pair. Anything else
     answering — the room type's old rack rate — is NOT the base, and showing
     it as one presents a two-person figure as a one-person one. */
  const base = current?.source === "typed" ? current.price : null;
  const rackInstead = current?.source === "rack" ? current.price : null;
  const [value, setValue] = useState("");
  /* X-1 (D27-120): a base of 0 only when ticked Free. */
  const [free, setFree] = useState(false);

  const save = useMutation({
    mutationFn: (price: number | null) =>
      setBasePrice(hotelId, { from: applied.from, to: applied.to, price,
                              ...(free && price === 0 ? { free } : {}) }),
    onSuccess: (r, price) => {
      if (r.ok) {
        toast.success(
          price === null ? "The base is cleared" : "The base is set",
          `${applied.words}. Every price that is not typed follows it.`,
        );
        setValue(""); setFree(false);
        onDone();
      } else {
        toast.error("That base was not set", r.reason);
      }
    },
  });

  return (
    <div className="border-t border-grey-100 pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40">
          <p className="text-2xs uppercase tracking-wide text-grey-500">
            The base, one person, no meals
          </p>
          <p className="text-2xl font-semibold text-ink-900 tabular mt-0.5">
            {base == null ? <span className="text-grey-500">-</span> : money(base)}
          </p>
          {base == null && rackInstead != null && (
            <p className="text-2xs text-grey-500 mt-1 max-w-56 leading-relaxed">
              Not set. Until it is, this room still quotes its old rack rate of{" "}
              <span className="tabular">{money(rackInstead)}</span>, which covers
              the people the room type is sold for - not one.
            </p>
          )}
        </div>
        <Field label="Set it to">
          {(f) => (
            <Input
              {...fieldProps(f)}
              inputMode="decimal"
              placeholder="₹"
              value={free ? "0" : value}
              onChange={(e) => setValue(e.target.value)}
              disabled={free}
              className="w-36"
            />
          )}
        </Field>
        <Checkbox label="Free" checked={free} onCheckedChange={setFree} className="mb-3" />
        <Button
          variant="primary"
          disabled={(value.trim() === "" && !free) || save.isPending}
          onClick={() => {
            const n = free ? 0 : Number(value);
            if (!Number.isFinite(n) || n < 0) {
              toast.error("That is not a price", "A price is zero or more.");
              return;
            }
            save.mutate(n);
          }}
        >
          Save
        </Button>
        {base != null && (
          <Button
            variant="secondary"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Clear it
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── The differences ──────────────────────────────────────────────── */

function Differences({
  data, hotelId, applied, date, onDone,
}: {
  data: Pricing; hotelId: string;
  applied: { from: string; to: string; words: string };
  date: string; onDone: () => void;
}) {
  const covering = (kind: "room_type" | "meal_plan", id: string) =>
    data.offsets.find(
      (o) => o.kind === kind
        && (kind === "room_type" ? o.roomTypeId === id : o.mealPlan === id)
        && o.from <= date
        && (o.to === null || date < o.to),
    ) ?? null;

  return (
    <div className="border-t border-grey-100 pt-4 mt-4">
      <div className="flex items-center gap-1 mb-3">
        <h3 className="text-md font-semibold text-ink-900">The differences</h3>
        <InfoButton>{"In rupees, above the base. Where nothing is set, the base applies - which is a dash here, not a zero. A meal plan is priced per person; a room type, per room."}</InfoButton>
      </div>

      {/* Rows under a hairline, two columns once there is room: they
          were bordered boxes inside the card (a card in a card). */}
      <div className="grid lg:grid-cols-2 gap-x-6">
        {data.roomTypes
          .filter((t) => t.id !== data.basis?.roomTypeId)
          .map((t) => (
            <OneDifference
              key={t.id}
              name={t.category ? `${t.category} · ${t.name}` : t.name}
              note={`sleeps ${t.maxOccupancy}`}
              offset={covering("room_type", t.id)}
              hotelId={hotelId}
              applied={applied}
              onDone={onDone}
              input={{ kind: "room_type", roomTypeId: t.id }}
            />
          ))}
        {data.mealPlans
          .filter((p) => p.code !== data.basis?.mealPlan)
          .map((p) => (
            <OneDifference
              key={p.code}
              name={p.name}
              note="per person"
              offset={covering("meal_plan", p.code)}
              hotelId={hotelId}
              applied={applied}
              onDone={onDone}
              input={{ kind: "meal_plan", mealPlan: p.code }}
            />
          ))}
      </div>
    </div>
  );
}

function OneDifference({
  name, note, offset, hotelId, applied, onDone, input,
}: {
  name: string;
  note: string;
  offset: { amount: number; label: string | null } | null;
  hotelId: string;
  applied: { from: string; to: string; words: string };
  onDone: () => void;
  input: { kind: "room_type" | "meal_plan"; roomTypeId?: string; mealPlan?: string };
}) {
  const [value, setValue] = useState("");

  const save = useMutation({
    mutationFn: (amount: number | null) =>
      setOffset(hotelId, { ...input, from: applied.from, to: applied.to, amount }),
    onSuccess: (r, amount) => {
      if (r.ok) {
        toast.success(
          amount === null ? `${name} follows the base` : `${name} is set`,
          applied.words,
        );
        setValue("");
        onDone();
      } else {
        toast.error(`${name} was not changed`, r.reason);
      }
    },
  });

  return (
    <div className="flex flex-wrap items-end gap-2 py-3 border-t border-grey-100">
      <div className="min-w-36 flex-1">
        <p className="text-sm font-medium text-ink-900 truncate">{name}</p>
        <p className="text-2xs text-grey-500">{note}</p>
        <p className="text-md tabular mt-1">
          {offset ? money(offset.amount) : <span className="text-grey-500">-</span>}
        </p>
      </div>
      <Input
        inputMode="decimal"
        placeholder="₹"
        aria-label={`Difference for ${name}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-24"
      />
      <Button
        variant="secondary"
        disabled={value.trim() === "" || save.isPending}
        onClick={() => {
          const n = Number(value);
          if (!Number.isFinite(n)) {
            toast.error("That is not an amount", "A difference is an amount in rupees.");
            return;
          }
          save.mutate(n);
        }}
      >
        Set
      </Button>
      {offset && (
        <Button
          variant="secondary"
          disabled={save.isPending}
          onClick={() => save.mutate(null)}
        >
          Clear
        </Button>
      )}
    </div>
  );
}

/* ── What it all comes to ─────────────────────────────────────────── */

function WhatItComesTo({ data, date }: { data: Pricing; date: string }) {
  const cells = data.cells.filter((c) => c.date === date);

  return (
    <Card className="mt-5 px-4 py-3.5">
      <div className="flex items-center gap-1 mb-3">
        <h3 className="text-md font-semibold text-ink-900">
          What a room costs on {dateShort(date)}
        </h3>
        <InfoButton>{"Read back from the database, not worked out on this screen - this is the figure a booking would be quoted. Each says where it came from, because a price somebody typed and a price built from the base look identical otherwise."}</InfoButton>
      </div>

      <div className="overflow-x-auto scrollbar-quiet">
        <table className="w-full text-base">
          <thead>
            <tr className="text-2xs uppercase tracking-wide text-grey-500">
              <th className="text-left font-semibold py-1.5 pr-3 whitespace-nowrap">Room type</th>
              {data.mealPlans.map((p) => (
                <th key={p.code} className="text-right font-semibold py-1.5 px-3 whitespace-nowrap">{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.roomTypes.map((t) => (
              <tr key={t.id} className="border-t border-grey-100">
                <td className="py-2.5 pr-3">
                  <span className="text-ink-900">{t.name}</span>
                  {t.category && (
                    <span className="text-2xs text-grey-500 block">{t.category}</span>
                  )}
                </td>
                {data.mealPlans.map((p) => {
                  const cell = cells.find(
                    (c) => c.roomTypeId === t.id && c.mealPlan === p.code,
                  );
                  return (
                    <td key={p.code} className="py-2.5 px-3 text-right whitespace-nowrap">
                      <span className={cn("tabular", cell?.price == null && "text-grey-500")}>
                        {cell?.price == null ? "-" : money(cell.price)}
                      </span>
                      <span className="block text-2xs text-grey-500">
                        {cell?.source
                          ? `${SOURCE_LABEL[cell.source]}${cell.covers ? ` · ${cell.covers} person${cell.covers === 1 ? "" : "s"}` : ""}`
                          : "Not priced"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
