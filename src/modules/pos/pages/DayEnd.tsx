import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  Check, Lock, AlertTriangle, Banknote, ArrowDownLeft, ArrowUpRight,
  Wallet, HandCoins, Plus, Receipt, DoorOpen, Percent, Gift,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong, money, moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Field, fieldProps, Input,
  NativeSelect, Textarea, Skeleton, EmptyState, toast,
  Dialog, DialogContent, DialogClose, StatusPill, FigureRow, FigureTile,
} from "@/components/ui";
import { getDayEnd, recordMovement, openDay, countDrawer, closeDay, type DayEnd, type MovementKind } from "@/modules/pos/data/till";
import { ReadFailed, ReadStale } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   THE DAY END

   Three steps, in the order the money is actually reconciled:

     Overview  →  Cash  →  Finalize

   THE NIGHT AUDIT'S SHAPE, deliberately, and not a second one. The
   hotel's audit refuses to close while something is wrong and NAMES
   it, because the two possible truths lead to opposite postings and
   only a person at the desk knows which. A restaurant close has the
   same character: an open bill and an uncleared table are questions
   a person answers.

   A DRAWER THAT DOES NOT BALANCE IS NOT ONE OF THEM. The money is
   already whatever it is, and a shift that cannot close is worse
   than a difference written down with a reason. So the variance is
   shown loudly, in one place, BEFORE the close — and then it closes.

   THE STEPS DO NOT LOCK. A cashier who has counted and then sees a
   bill still open has to go back, and a wizard that only moves
   forward would be closed and reopened rather than used.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

type Step = "overview" | "cash" | "finalize";

const STEPS: { id: Step; label: string; hint: string }[] = [
  { id: "overview", label: "Overview", hint: "What the shift did" },
  { id: "cash",     label: "Cash",     hint: "What is in the tin" },
  { id: "finalize", label: "Finalize", hint: "Close the day" },
];

/* The notes and coins in circulation. Nobody counts a ₹1 coin into a
   restaurant till, and offering it is a row people tab past. */
const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2];

const MOVEMENTS: { kind: MovementKind; label: string; hint: string;
                   sign: -1 | 1; icon: typeof Plus }[] = [
  { kind: "expense",        label: "Expense",    sign: -1, icon: ArrowUpRight,
    hint: "Paid out of the drawer - a delivery of vegetables, a repair" },
  { kind: "top_up",         label: "Cash in",    sign: 1,  icon: ArrowDownLeft,
    hint: "Change brought from the safe" },
  { kind: "withdrawal",     label: "To the safe", sign: -1, icon: Lock,
    hint: "Cash taken out mid-shift" },
  { kind: "due_collection", label: "Due paid",   sign: 1,  icon: HandCoins,
    hint: "A bill settled to an account, paid now in cash" },
];

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", card: "Card", upi: "UPI",
  room: "To a room", due: "Due", comp: "Complimentary",
  /* D17-21: on a banquet function's bill. Business done, not in the tin. */
  function: "To a function",
};

/** The property this page is closing, by name.

    ⚠ THE PAGE'S OWN CODE, not the property "in view": the store follows
    the address in an effect, so for a moment it can still name the last
    hotel — and this name goes on the button that closes a day. The code
    is the fallback, because it is still true; a plausible wrong name is
    not. */
function useHotelName(code: string): string {
  const hotels = useSession((s) => s.hotels);
  return hotels.find((h) => h.code === code)?.name ?? code;
}

/** "Tuesday, 25 August 2026 · 5 Elements Akkalkot" — the owner's D17-20
    (17 September): the date in words and the hotel's name with it, so
    one property's close is never mistaken for another's. The same
    "what · where" order as every browser tab in the product. */
function dayAt(businessDate: string, hotelName: string): string {
  return `${dateLong(businessDate)} · ${hotelName}`;
}

export default function DayEndPage() {
  const hotelId = useHotel();
  const hotelName = useHotelName(hotelId);
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("overview");

  const day = useQuery({
    queryKey: ["day-end", hotelId],
    queryFn: () => getDayEnd(hotelId),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["day-end", hotelId] });

  if (day.isLoading) {
    return (
      <Page>
        <PageHeader title="Close restaurant day" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }
  /* POS-4. This said "This property has no restaurant configured" for
     every failure — a dropped line and a server fault included — to the
     person about to count the drawer. The server's own refusal, a fault
     and a missing outlet are three different answers now. */
  if (day.data === undefined && day.error) {
    return (
      <Page>
        <PageHeader title="Close restaurant day" />
        <Card>
          <ReadFailed
            error={day.error}
            what="the restaurant day"
            onRetry={() => void day.refetch()}
          />
        </Card>
      </Page>
    );
  }
  if (!day.data) {
    return (
      <Page>
        <PageHeader title="Close restaurant day" />
        <EmptyState
          title="No outlet"
          description="This property has no restaurant configured."
        />
      </Page>
    );
  }

  const d = day.data;

  return (
    <Page>
      <PageHeader
        title="Close restaurant day"
        description={`${hotelName} · ${d.outlet.name} · ${dateLong(d.businessDate)}`}
        /* A state, so a flat pill (the Tappable Rule): it cannot be tapped. */
        badge={d.closedAt ? (
          <StatusPill tone="success" dot={false}>
            <Lock className="size-3" />
            Closed {d.closedAt}{d.closedBy ? ` by ${d.closedBy}` : ""}
          </StatusPill>
        ) : undefined}
      />

      {/* The drawer's figures stay on screen when a refresh fails — but a
          cashier about to close must know they may be out of date. */}
      {day.error && (
        <ReadStale
          className="mb-5"
          error={day.error}
          loadedAt={day.dataUpdatedAt}
          onRetry={() => void day.refetch()}
        />
      )}

      {!d.opened && !d.closedAt && <OpenDay hotelId={hotelId} onDone={refresh} />}

      <Steps current={step} onPick={setStep} blockers={d.blockers.length} />

      {step === "overview" && <Overview day={d} />}
      {step === "cash" && (
        <CashStep hotelId={hotelId} day={d} onDone={refresh} />
      )}
      {step === "finalize" && (
        <Finalize hotelId={hotelId} hotelName={hotelName} day={d} onDone={refresh}
                  onBack={() => setStep("cash")} />
      )}
    </Page>
  );
}

/* ── The three steps ──────────────────────────────────────────────
   Touch targets, because this is done at a terminal at midnight by
   somebody who has been standing for nine hours. */
function Steps({ current, onPick, blockers }: {
  current: Step; onPick: (s: Step) => void; blockers: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 mb-5">
      {STEPS.map((s, i) => {
        const active = s.id === current;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            className={cn(
              "press-tile min-h-14 px-3.5 py-3 rounded-lg border text-left cursor-pointer",
              active
                ? "bg-ink-900 border-ink-900 text-white"
                : "bg-white border-grey-300 hover:border-grey-400",
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn(
                "size-6 rounded-full grid place-items-center text-xs font-semibold shrink-0",
                active ? "bg-white/20" : "bg-grey-100 text-grey-600",
              )}>
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-medium truncate">
                  {s.label}
                  {s.id === "finalize" && blockers > 0 && (
                    <span className="ml-1.5 text-warning">·</span>
                  )}
                </span>
                <span className={cn(
                  "block text-xs truncate",
                  active ? "text-white/70" : "text-grey-500",
                )}>
                  {s.hint}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Step one: what the shift did ────────────────────────────────── */
function Overview({ day }: { day: DayEnd }) {
  const s = day.summary;
  const methods = Object.entries(s.byMethod)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-5">
      {/* The Figure Rule: label with its chip, the figure, its note;
          level across the row. */}
      <FigureRow className="sm:grid-cols-2 lg:grid-cols-4">
        <FigureTile icon={<Receipt />} label="Settled" value={money(s.settledValue)}
                    note={`${s.settledOrders} ${s.settledOrders === 1 ? "bill" : "bills"}`} />
        {/* Not "cancelled and forgotten" — every one carries a reason,
            and the total is what walked out of the door. */}
        <FigureTile icon={<DoorOpen />} tone={s.abandonedOrders > 0 ? "yellow" : "neutral"}
                    label="Walked out"
                    value={s.abandonedOrders > 0
                      ? <span className="text-warning-dark">{money(s.abandonedValue)}</span>
                      : money(s.abandonedValue)}
                    note={`${s.abandonedOrders} abandoned`} />
        <FigureTile icon={<Percent />} label="Discount given" value={money(s.discountGiven)}
                    note="Off the settled bills" />
        <FigureTile icon={<Gift />} label="Complimentary" value={String(s.compOrders)}
                    note={s.compOrders === 1 ? "bill, nothing to pay" : "bills, nothing to pay"} />
      </FigureRow>

      <Card>
        <CardHeader title="How the money arrived" />
        <CardBody>
          {methods.length === 0 ? (
            <p className="text-grey-500">Nothing has been settled yet today.</p>
          ) : (
            <dl className="divide-y divide-grey-200">
              {methods.map(([method, amount]) => (
                <div key={method} className="flex items-baseline justify-between py-2.5">
                  <dt className="text-base">{METHOD_LABEL[method] ?? method}</dt>
                  <dd className="text-base font-medium tabular">{money(amount)}</dd>
                </div>
              ))}
            </dl>
          )}
          {/* The distinction the drawer stands or falls on. */}
          <p className="mt-3 text-sm text-grey-500">
            Only cash reaches the drawer. A card settlement and a bill
            charged to a room are business done - they are not in the tin.
            {s.byMethod["function"] !== undefined
              && " Nor is an order settled to a banquet function: the host pays for it on the function's bill."}
          </p>
        </CardBody>
      </Card>

      {/* D27-119: food taken off after the kitchen had it - who, and why. */}
      {(day.struck ?? []).length > 0 && (
        <Card>
          <CardHeader title="Struck after it reached the kitchen" />
          <CardBody>
            <ul className="divide-y divide-grey-200">
              {day.struck!.map((x, i) => (
                <li key={i} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base">{x.qty} × {x.name} - {x.reason ?? "-"}</p>
                    <p className="text-sm text-grey-500">
                      {x.orderNo}{x.table ? ` · ${x.table}` : ""} · {x.by ?? "-"} · {x.at}
                    </p>
                  </div>
                  <span className="text-base font-medium tabular shrink-0">{money(x.value)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* ── Step two: what is in the tin ─────────────────────────────────
   The arithmetic somebody argues about, laid out as a sum rather
   than as a total, so the disagreement lands on a line and not on
   the answer. */
function CashStep({ hotelId, day, onDone }: {
  hotelId: string; day: DayEnd; onDone: () => void;
}) {
  const closed = Boolean(day.closedAt);

  /* Seeded from the count that exists, so re-opening the step shows
     what was typed rather than an empty grid. */
  const [counts, setCounts] = useState<Record<number, string>>(() => {
    const seed: Record<number, string> = {};
    for (const d of day.cash.denominations) seed[d.value] = String(d.count);
    return seed;
  });
  const [saving, setSaving] = useState(false);

  const counted = useMemo(
    () => DENOMINATIONS.reduce(
      (sum, v) => sum + v * (Number(counts[v]) || 0), 0),
    [counts]);

  /* The float was counted at Open the day (D27-190) and is not retyped
     here, so the server's expected figure is the one shown. */
  const expected = day.cash.expected;
  const variance = counted - expected;

  const save = async () => {
    setSaving(true);
    const res = await countDrawer(hotelId, {
      denominations: DENOMINATIONS
        .map((v) => ({ value: v, count: Number(counts[v]) || 0 }))
        .filter((d) => d.count > 0),
    });
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Count saved", `${money(counted)} in the drawer.`);
    onDone();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <Card>
          <CardHeader
            title="Count the drawer"
            description="Notes and coins, as they come out of the tin."
          />
          <CardBody className="space-y-4">
            <NoteGrid counts={counts} onChange={setCounts} disabled={closed} />

            {!closed && (
              <Button onClick={save} disabled={saving || !day.opened} className="h-12 w-full text-base">
                {!day.opened ? "Open the day first"
                  : saving ? "Saving…" : `Save the count - ${money(counted)}`}
              </Button>
            )}
          </CardBody>
        </Card>

        <Movements hotelId={hotelId} day={day} onDone={onDone} />
      </div>

      <div className="space-y-3">
        <Card>
          <CardHeader title="The sum" />
          <CardBody>
            <dl className="divide-y divide-grey-200">
              {/* A dash until Open the day has counted it. */}
              <Line label="Opening float" value={day.opened ? day.cash.opening : null} />
              <Line label="Cash taken"
                    value={day.summary.byMethod["cash"] ?? 0} />
              {MOVEMENTS.map((m) => {
                const total = day.movements
                  .filter((x) => x.kind === m.kind)
                  .reduce((s, x) => s + x.amount, 0);
                if (total === 0) return null;
                return (
                  <Line key={m.kind} label={m.label}
                        value={m.sign * total} signed />
                );
              })}
              <div className="flex items-baseline justify-between py-3">
                <dt className="text-base font-medium">Expected</dt>
                <dd className="text-lg font-semibold tabular">
                  {moneyPrecise(expected)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between py-3">
                <dt className="text-base font-medium">Counted</dt>
                <dd className="text-lg font-semibold tabular">
                  {counted > 0 ? moneyPrecise(counted) : "-"}
                </dd>
              </div>
            </dl>

            {/* Loud, and in one place. */}
            <Variance amount={counted > 0 ? variance : null} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Line({ label, value, signed }: {
  label: string; value: number | null; signed?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <dt className="text-base text-grey-600">{label}</dt>
      <dd className="text-base tabular">
        {value === null ? "-" : <>
          {signed && value > 0 ? "+" : ""}
          {signed && value < 0 ? "−" : ""}
          {money(Math.abs(value))}
        </>}
      </dd>
    </div>
  );
}

/* Notes and coins, one row each - the float at Open the day and the tin at
   the count, added up the same way. */
function NoteGrid({ counts, onChange, disabled }: {
  counts: Record<number, string>;
  onChange: (update: (c: Record<number, string>) => Record<number, string>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {DENOMINATIONS.map((value) => {
        const n = Number(counts[value]) || 0;
        return (
          <div key={value}
               className="flex items-center gap-3 rounded-lg border border-grey-200 px-3.5 py-2">
            <span className="w-14 text-base font-medium tabular shrink-0">
              ₹{value}
            </span>
            <span className="text-grey-500">×</span>
            <Input
              type="number" inputMode="numeric" min={0}
              value={counts[value] ?? ""} disabled={disabled}
              placeholder="0"
              onChange={(e) => onChange(
                (c) => ({ ...c, [value]: e.target.value }))}
              className="h-12 w-24 text-lg tabular"
              aria-label={`Number of ₹${value} notes`}
            />
            {/* A dash, not a zero. Nobody counted zero here. */}
            <span className="ml-auto text-base tabular text-grey-600">
              {n > 0 ? money(value * n) : "-"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Open the day (D27-190) ───────────────────────────────────────
   The float counted before any cash is taken. Blank is not zero:
   Open waits until something is typed, and 0 is an answer only when
   somebody types it. */
function OpenDay({ hotelId, onDone }: { hotelId: string; onDone: () => void }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const typed = Object.values(counts).some((v) => v.trim() !== "");
  const opening = DENOMINATIONS.reduce((s, v) => s + v * (Number(counts[v]) || 0), 0);

  const open = async () => {
    setBusy(true);
    const res = await openDay(hotelId, { opening });
    setBusy(false);
    if (!res.ok) return toast.error("Not opened", res.reason);
    toast.success("Day open", `Starting with ${money(opening)}.`);
    onDone();
  };

  return (
    <Card className="mb-5">
      <CardHeader
        title="Open the day"
        description="Count the float in the tin. No cash is taken until you do - card, UPI and room charges go on."
      />
      <CardBody className="space-y-4">
        <NoteGrid counts={counts} onChange={setCounts} />
        <Button variant="primary" className="h-12 w-full text-base"
                disabled={busy || !typed} onClick={() => void open()}>
          <Wallet className="size-4" />
          {busy ? "Opening…" : typed ? `Open the day - ${money(opening)}` : "Count the float first"}
        </Button>
      </CardBody>
    </Card>
  );
}

function Variance({ amount }: { amount: number | null }) {
  if (amount === null) {
    return (
      <p className="mt-4 rounded-lg bg-grey-50 border border-grey-200 px-4 py-3 text-base text-grey-600">
        Nothing counted yet.
      </p>
    );
  }
  const balanced = Math.abs(amount) < 0.01;
  return (
    <div className={cn(
      "mt-4 rounded-lg border px-4 py-3",
      balanced ? "bg-success-50 border-success"
               : "bg-brand-yellow-50 border-brand-yellow",
    )}>
      <p className="flex items-center gap-2 text-base font-medium">
        {balanced
          ? <><Check className="size-4 text-success" /> The drawer balances</>
          : <><AlertTriangle className="size-4 text-warning-dark" />
              {amount > 0 ? "Over" : "Short"} by {moneyPrecise(Math.abs(amount))}</>}
      </p>
      {!balanced && (
        <p className="mt-1 text-sm text-grey-600">
          This does not stop the close. It has to be written down.
        </p>
      )}
    </div>
  );
}

/* ── Money in and out that is not a sale ─────────────────────────── */
function Movements({ hotelId, day, onDone }: {
  hotelId: string; day: DayEnd; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MovementKind>("expense");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const closed = Boolean(day.closedAt);
  const chosen = MOVEMENTS.find((m) => m.kind === kind)!;

  const submit = async () => {
    setSaving(true);
    const res = await recordMovement(hotelId, {
      kind, amount: Number(amount), reason,
    });
    setSaving(false);
    if (!res.ok) return toast.error("Not recorded", res.reason);
    setOpen(false); setAmount(""); setReason("");
    toast.success("Recorded", `${chosen.label} - ${money(Number(amount))}`);
    onDone();
  };

  return (
    <Card>
      <CardHeader
        title="In and out of the drawer"
        description="Money that was not a sale."
        actions={!closed && (
          <Button variant="secondary" onClick={() => setOpen(true)}
                  className="h-11">
            <Plus className="size-4" /> Record
          </Button>
        )}
      />
      <CardBody>
        {day.movements.length === 0 ? (
          <p className="text-grey-500">
            Nothing has gone in or out of the drawer today.
          </p>
        ) : (
          <ul className="divide-y divide-grey-200">
            {day.movements.map((m) => {
              const spec = MOVEMENTS.find((x) => x.kind === m.kind);
              const Icon = spec?.icon ?? Wallet;
              return (
                <li key={m.id} className="flex items-start gap-3 py-3">
                  <Icon className={cn(
                    "size-4 mt-1 shrink-0",
                    spec?.sign === 1 ? "text-success" : "text-grey-500",
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="text-base">{m.reason}</p>
                    <p className="text-sm text-grey-500">
                      {spec?.label ?? m.kind} · {m.recordedBy ?? "-"} · {m.at}
                    </p>
                  </div>
                  <span className="text-base font-medium tabular shrink-0">
                    {spec?.sign === 1 ? "+" : "−"}{money(m.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Money in or out">
          <div className="space-y-4">
            <Field label="What happened">
              {(f) => (
                <NativeSelect
                  {...fieldProps(f)}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as MovementKind)}
                  className="h-12 text-base"
                >
                  {MOVEMENTS.map((m) => (
                    <option key={m.kind} value={m.kind}>{m.label}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <p className="-mt-2 text-sm text-grey-500">{chosen.hint}</p>

            <Field label="How much">
              {(f) => (
                <Input
                  {...fieldProps(f)}
                  type="number" inputMode="decimal" min={0}
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="h-12 text-lg tabular" autoFocus
                />
              )}
            </Field>

            {/* Always. An unexplained hundred rupees out of a till is the
                thing a day end exists to surface, and "misc" is what
                people type when the field is optional. */}
            <Field label="What was it for"
                   hint="This is the line somebody asks about tomorrow.">
              {(f) => (
                <Textarea
                  {...fieldProps(f)}
                  rows={2} value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>

            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
              </DialogClose>
              <Button variant="primary"
                onClick={submit}
                disabled={saving || !amount || !reason.trim()}
                className="h-12 flex-1"
              >
                Record
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ── Step three: close it ─────────────────────────────────────────
   The blockers first, each one named, because a refusal a person
   cannot act on is worse than no refusal. */
function Finalize({ hotelId, hotelName, day, onDone, onBack }: {
  hotelId: string; hotelName: string; day: DayEnd;
  onDone: () => void; onBack: () => void;
}) {
  const [why, setWhy] = useState(day.cash.varianceReason ?? "");
  const [kept, setKept] = useState("");
  const [closing, setClosing] = useState(false);

  if (day.closedAt) {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <Lock className="mx-auto size-8 text-success" />
          <p className="mt-3 text-lg font-medium">
            {dayAt(day.businessDate, hotelName)} is closed
          </p>
          <p className="mt-1 text-grey-600">
            {day.closedAt}{day.closedBy ? ` by ${day.closedBy}` : ""}
          </p>
          {day.cash.varianceReason && (
            <p className="mt-3 text-base text-grey-600">
              “{day.cash.varianceReason}”
            </p>
          )}
          <p className="mt-4 text-sm text-grey-500">
            A correction is a movement on today, not an edit of yesterday.
          </p>
        </CardBody>
      </Card>
    );
  }

  const variance = day.cash.variance;
  const needsReason = variance !== null && Math.abs(variance) >= 0.01;
  /* D27-191: the float kept for tomorrow, typed at every close; the rest
     of the count is deposited. Blank is not zero. */
  const counted = day.cash.counted ?? 0;
  const keptNum = kept.trim() === "" ? null : Number(kept);
  const keptOk = keptNum !== null && Number.isFinite(keptNum) && keptNum >= 0 && keptNum <= counted;

  const close = async () => {
    setClosing(true);
    const res = await closeDay(hotelId, { varianceReason: why, keptCash: keptNum! });
    setClosing(false);
    if (!res.ok) return toast.error("Not closed", res.reason);
    toast.success("Day closed",
      `${dayAt(day.businessDate, hotelName)} is finalised.`);
    onDone();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader
          title="Before it closes"
          description="Only what a person has to decide."
        />
        <CardBody>
          {day.blockers.length === 0 ? (
            <p className="flex items-center gap-2 text-base">
              <Check className="size-4 text-success" />
              Nothing is outstanding.
            </p>
          ) : (
            <ul className="space-y-3">
              {day.blockers.map((b) => (
                <li key={b.id}
                    className="rounded-lg border border-brand-yellow bg-brand-yellow-50 px-4 py-3">
                  <p className="flex items-start gap-2 text-base">
                    <AlertTriangle className="size-4 mt-0.5 shrink-0 text-warning-dark" />
                    {b.reason}
                  </p>
                  {/* Named, so nobody hunts the floor for it. */}
                  {b.detail && (
                    <p className="mt-1 pl-6 text-base font-medium tabular">
                      {b.detail}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="The drawer" />
        <CardBody>
          <dl className="divide-y divide-grey-200">
            <Line label="Expected" value={day.cash.expected} />
            <div className="flex items-baseline justify-between py-2.5">
              <dt className="text-base text-grey-600">Counted</dt>
              <dd className="text-base tabular">
                {day.cash.counted === null ? "-" : money(day.cash.counted)}
              </dd>
            </div>
          </dl>

          <Variance amount={variance} />

          {needsReason && (
            <Field label="Why" className="mt-4"
                   hint="What a manager needs tomorrow is the sentence, not the number.">
              {(f) => (
                <Textarea
                  {...fieldProps(f)}
                  rows={3} value={why}
                  onChange={(e) => setWhy(e.target.value)}
                />
              )}
            </Field>
          )}

          {day.cash.counted !== null && (
            <Field label="Float kept for the next day" className="mt-4"
                   hint={keptOk
                     ? `To deposit: ${moneyPrecise(counted - keptNum!)}`
                     : `From ₹0 to the ${moneyPrecise(counted)} counted. The rest is deposited.`}>
              {(f) => (
                <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0}
                  value={kept} onChange={(e) => setKept(e.target.value)}
                  className="h-12 text-lg tabular" />
              )}
            </Field>
          )}

          {day.cash.counted === null && (
            <p className="mt-4 text-base text-grey-600">
              The drawer has not been counted.{" "}
              <button type="button" onClick={onBack}
                      className="font-medium text-brand-orange-700 hover:underline underline-offset-4 cursor-pointer">
                Count it
              </button>{" "}
              first.
            </p>
          )}

          <Button
            onClick={close}
            disabled={
              closing
              || day.blockers.length > 0
              || day.cash.counted === null
              || !keptOk
              || (needsReason && !why.trim())
            }
            /* TWO LINES, the day and then the hotel. On one line the
               label was 355px in a 317px button and ran out over both
               edges (measured 17 September, the drawer column at a desk).
               The spoken name keeps the whole sentence. */
            aria-label={closing
              ? undefined : `Close ${dayAt(day.businessDate, hotelName)}`}
            className="mt-4 h-auto min-h-12 w-full py-2 text-base whitespace-normal"
          >
            <Banknote className="size-4 shrink-0" />
            {closing ? "Closing…" : (
              <span className="text-left leading-snug">
                <span className="block">Close {dateLong(day.businessDate)}</span>
                <span className="block">{hotelName}</span>
              </span>
            )}
          </Button>
          <p className="mt-2 text-center text-sm text-grey-500">
            A closed day cannot be edited.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
