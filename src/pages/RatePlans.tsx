import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { IndianRupee, Plus, X, CalendarRange } from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise, dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, StatusPill, toast,
} from "@/components/ui";
import {
  getRates, setRackRate, addRate, removeRate,
  type RateRoomType, type RateRule,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   RATES — what a room costs

   Stage 9. Two things live here because a hotel of this size thinks of
   them as one:

     the RACK RATE   one number per room type, open-ended
     a SEASON        a price for a plan over a date range

   The group's instruction is the whole design brief: prices are not
   fixed, the team updates them, nothing is standard across properties.
   So this screen ships no number and suggests none. Every figure on it
   was typed by somebody at the hotel, and a type nobody has priced
   reads as a dash.

   WHY THE SEASONS CANNOT OVERLAP

   Two prices covering one day means nobody can say what the room
   costs, including the hotel. The database refuses it; this screen
   shows the refusal in words rather than letting a clerk discover it
   at a checkout six weeks later.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

export default function RatePlansPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();

  const board = useQuery({
    queryKey: ["rate-plans", hotelId],
    queryFn: () => getRates(hotelId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["rate-plans"] });
    /* The tape chart and the walk-in both read a room's rate. */
    void qc.invalidateQueries({ queryKey: ["stayview"] });
    void qc.invalidateQueries({ queryKey: ["rooms"] });
  };

  const data = board.data;
  const priced = (data?.roomTypes ?? []).filter((t) => t.rackRate !== null);

  return (
    <Page>
      <PageHeader
        title="Rate plans"
        description="What each room type costs, and what it costs in a season. Every price here is the hotel's own."
        badge={
          data ? (
            <StatusPill tone={priced.length === data.roomTypes.length ? "success" : "warning"}>
              {priced.length} of {data.roomTypes.length} priced
            </StatusPill>
          ) : undefined
        }
      />

      {data && priced.length < data.roomTypes.length && (
        <div className="flex items-start gap-3 rounded-md border border-brand-yellow-100 bg-brand-yellow-50 p-3.5 mb-5">
          <IndianRupee className="size-4 text-brand-yellow shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-base font-medium text-ink-900">
              {data.roomTypes.length - priced.length} room type
              {data.roomTypes.length - priced.length === 1 ? " has" : "s have"} no rate
            </p>
            <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
              A room with no rate cannot be sold at the desk — a walk-in into
              one is refused rather than checked in at a guessed figure. This
              system ships no prices; these are yours to set.
            </p>
          </div>
        </div>
      )}

      {/* ── The rack rate, one per type ─────────────────────────── */}
      <Card className="mb-6">
        <div className="px-4 pt-3.5 pb-1">
          <p className="text-2xs uppercase tracking-wide text-grey-500">
            Rack rate — the standing price
          </p>
        </div>
        <ul className="divide-y divide-grey-100">
          {(data?.roomTypes ?? []).map((t) => (
            <RackRow key={t.id} hotelId={hotelId} type={t} onDone={refresh} />
          ))}
          {data?.roomTypes.length === 0 && (
            <li className="px-4 py-6 text-sm text-grey-500 text-center">
              This property has no room types yet.
            </li>
          )}
        </ul>
      </Card>

      {/* ── Seasons ─────────────────────────────────────────────── */}
      <NewSeason
        hotelId={hotelId}
        types={data?.roomTypes ?? []}
        plans={data?.mealPlans ?? []}
        onDone={refresh}
      />

      <Card className="mt-5">
        <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
          <CalendarRange className="size-3.5 text-grey-400" />
          <p className="text-2xs uppercase tracking-wide text-grey-500">
            Seasons and plans
          </p>
        </div>
        {(data?.rates ?? []).length === 0 ? (
          <CardBody>
            <div className="text-center py-7">
              <CalendarRange className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">
                No season is set
              </p>
              <p className="text-base text-grey-500 mt-1.5 max-w-md mx-auto">
                Every room sells at its rack rate. Add a season above when a
                period or a meal plan is priced differently.
              </p>
            </div>
          </CardBody>
        ) : (
          <ul className="divide-y divide-grey-100">
            {(data?.rates ?? []).map((r) => (
              <SeasonRow key={r.id} hotelId={hotelId} rate={r} onDone={refresh} />
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}

/* ── One room type's standing price ───────────────────────────────── */

function RackRow({ hotelId, type, onDone }: {
  hotelId: string; type: RateRoomType; onDone: () => void;
}) {
  const [value, setValue] = useState(
    type.rackRate === null ? "" : String(type.rackRate),
  );
  const [busy, setBusy] = useState(false);

  const dirty = (type.rackRate === null ? "" : String(type.rackRate)) !== value;

  const save = async () => {
    const trimmed = value.trim();
    /* Blank CLEARS it. A hotel that has stopped selling a type should be
       able to say so, and a dash is the honest way to show it. */
    const rate = trimmed === "" ? null : Number(trimmed);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
      return toast.error("Not saved", "A rate must be zero or more.");
    }

    setBusy(true);
    const res = await setRackRate(hotelId, type.id, rate);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);

    toast.success(
      rate === null
        ? `${type.name} has no rate now`
        : `${type.name} is ${moneyPrecise(rate)}`,
      rate === null
        ? "It cannot be sold at the desk until it has one."
        : undefined,
    );
    onDone();
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 min-h-16">
      <div className="min-w-0 flex-1">
        <p className="text-base text-ink-900">{type.name}</p>
        <p className="text-2xs text-grey-500">
          {type.code} · {type.rooms} room{type.rooms === 1 ? "" : "s"} · sleeps{" "}
          {type.maxOccupancy}
          {type.rackRate === null && (
            <span className="text-brand-yellow"> · no rate set</span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-grey-500">₹</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder="—"
          aria-label={`Rack rate for ${type.name}`}
          className="w-28 h-11 px-3 rounded-md border border-grey-300 text-base tabular text-right"
        />
        <Button
          size="lg"
          variant={dirty ? "primary" : "secondary"}
          disabled={!dirty}
          loading={busy}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </li>
  );
}

/* ── Adding a season ──────────────────────────────────────────────── */

function NewSeason({ hotelId, types, plans, onDone }: {
  hotelId: string;
  types: RateRoomType[];
  plans: { code: string; name: string; includes: string }[];
  onDone: () => void;
}) {
  const [typeId, setTypeId] = useState("");
  const [plan, setPlan] = useState("EP");
  const [price, setPrice] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = typeId && plan && price.trim() && from;

  const submit = async () => {
    const amount = Number(price);
    if (!Number.isFinite(amount) || amount < 0) {
      return toast.error("Not added", "A price must be zero or more.");
    }

    setBusy(true);
    const res = await addRate(hotelId, {
      roomTypeId: typeId, mealPlan: plan, price: amount,
      from, to: to || null, label: label.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);

    toast.success(`${res.roomType} priced`, `${plan} · ${moneyPrecise(amount)}`);
    setPrice(""); setFrom(""); setTo(""); setLabel("");
    onDone();
  };

  const chosenPlan = plans.find((p) => p.code === plan);

  return (
    <Card>
      <div className="px-4 pt-3.5 pb-1">
        <p className="text-2xs uppercase tracking-wide text-grey-500">
          Price a season, or a meal plan
        </p>
      </div>
      <CardBody>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Labelled label="Room type">
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)}
              className="w-full h-11 px-2 rounded-md border border-grey-300 text-base">
              <option value="">Choose…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Labelled>

          <Labelled label="Meal plan" hint={chosenPlan?.includes}>
            <select value={plan} onChange={(e) => setPlan(e.target.value)}
              className="w-full h-11 px-2 rounded-md border border-grey-300 text-base">
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </Labelled>

          <Labelled label="Price per night">
            <input value={price} onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal" placeholder="0.00"
              className="w-full h-11 px-3 rounded-md border border-grey-300 text-base tabular" />
          </Labelled>

          <Labelled label="From">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full h-11 px-3 rounded-md border border-grey-300 text-base" />
          </Labelled>

          <Labelled
            label="Until"
            /* Half-open, like every range in this system. Said here because
               getting it wrong misprices one day and nobody notices. */
            hint="Not included. A season through 31 Dec ends on 1 Jan. Leave blank for no end."
          >
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full h-11 px-3 rounded-md border border-grey-300 text-base" />
          </Labelled>

          <Labelled label="Name it" hint="Winter, Diwali week — for your own eyes.">
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="Winter"
              className="w-full h-11 px-3 rounded-md border border-grey-300 text-base" />
          </Labelled>
        </div>

        <Button variant="primary" size="lg" className="mt-3.5 w-full sm:w-auto"
          disabled={!ready} loading={busy} onClick={() => void submit()}>
          <Plus className="size-4" />
          Add this price
        </Button>
      </CardBody>
    </Card>
  );
}

function Labelled({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wide text-grey-500 mb-1">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-2xs text-grey-500 mt-1 leading-relaxed">
          {hint}
        </span>
      )}
    </label>
  );
}

/* ── One season ───────────────────────────────────────────────────── */

function SeasonRow({ hotelId, rate, onDone }: {
  hotelId: string; rate: RateRule; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    const res = await removeRate(hotelId, rate.id);
    setBusy(false);
    if (!res.ok) return toast.error("Not removed", res.reason);
    toast.success("Price removed",
      "Bookings already taken keep the rate they were sold at.");
    onDone();
  };

  return (
    <li className={cn(
      "flex flex-wrap items-center gap-3 px-4 py-3 min-h-16",
      rate.isCurrent && "bg-brand-orange-50/40",
    )}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base text-ink-900">{rate.roomType}</span>
          <StatusPill tone="neutral">{rate.mealPlan}</StatusPill>
          {rate.label && (
            <span className="text-2xs text-grey-600">{rate.label}</span>
          )}
          {/* Which price is in force today. Without it a manager reading a
              list of six seasons has to work out the date arithmetic. */}
          {rate.isCurrent && <StatusPill tone="success">in force today</StatusPill>}
        </div>
        <p className="text-2xs text-grey-500 tabular mt-0.5">
          {dateLong(rate.from)} → {rate.to ? dateLong(rate.to) : "no end"}
          {rate.setBy && <span className="text-grey-400"> · set by {rate.setBy}</span>}
        </p>
      </div>

      <span className="tabular text-base text-ink-900">
        {moneyPrecise(rate.price)}
      </span>

      <Button variant="ghost" size="sm" loading={busy}
        onClick={() => void remove()} aria-label="Remove this price">
        <X className="size-4" />
      </Button>
    </li>
  );
}
