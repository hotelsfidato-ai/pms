import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Wallet, Lock, Check, AlertTriangle, ArrowRightLeft, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Skeleton, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, Textarea,
  NativeSelect,
} from "@/components/ui";
import { getCashierDrawer, openCashierShift, recordCashierMovement, countCashierDrawer, closeCashierShift, type CashierDrawer } from "@/modules/finance/data/cashier";

/* ══════════════════════════════════════════════════════════════════
   CASHIERING — the front desk shift

   This was the last placeholder route in the application, and its own
   note said why: "unspecified — placeholder until the live flow is
   observed." It has now been observed. Open with a float, take
   receipts, count the drawer, hand over to whoever is on next.

   THE POS DAY END'S SHAPE, deliberately, and not a second idea. That
   close already answers the same questions, and a front office that
   reasons about its cash differently from its restaurant is one where
   the two get compared and nobody can.

   ONLY CASH REACHES THE DRAWER. A card receipt and a bill left on a
   folio are business done; counting either leaves the desk
   permanently short by the amount of work done properly.

   A DIFFERENCE DOES NOT STOP THE HANDOVER. The money is already
   whatever it is, and a desk that cannot hand over is worse than a
   difference written down with a reason.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

/* The notes and coins a front desk actually holds. */
const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2];

const MOVEMENTS = [
  { kind: "expense" as const, label: "Paid out",
    hint: "A taxi, a courier - money that left the drawer", sign: -1 },
  { kind: "top_up" as const, label: "Cash in",
    hint: "Change brought from the safe", sign: 1 },
  { kind: "withdrawal" as const, label: "To the safe",
    hint: "Cash taken out mid-shift", sign: -1 },
];

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", card: "Card", upi: "UPI", netbanking: "Net banking",
  wallet: "Wallet", cheque: "Cheque", bank_transfer: "Bank transfer",
  city_ledger: "To a company account", unrecorded: "Method not recorded",
};

export default function CashieringPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();

  const view = useQuery({
    queryKey: ["cashier-drawer", hotelId],
    queryFn: () => getCashierDrawer(hotelId),
  });

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["cashier-drawer", hotelId] });

  if (view.isLoading) {
    return (
      <Page>
        <PageHeader title="Cashiering" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  const data = view.data;

  return (
    <Page>
      <PageHeader
        title="Cashiering"
        description={data
          ? `Your drawer · ${dateShort(data.businessDate)}`
          : "Your drawer"}
      />
      {!data || !data.shift ? (
        <OpenDrawer hotelId={hotelId} previous={data?.previous ?? null}
                    onDone={refresh} />
      ) : (
        <Shift hotelId={hotelId} shift={data.shift}
               colleagues={data.colleagues} onDone={refresh} />
      )}
    </Page>
  );
}

/* ── No drawer open ───────────────────────────────────────────────
   A real state, not an error: the shift has not started. */
function OpenDrawer({ hotelId, previous, onDone }: {
  hotelId: string;
  previous: { closedAt: string; counted: number; handedTo: string | null } | null;
  onDone: () => void;
}) {
  /* COUNTED, NEVER ASSUMED (D27-190): a blank float used to open as ₹0.
     Open waits until something is typed; 0 only when somebody types it. */
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const typed = Object.values(counts).some((v) => v.trim() !== "");
  const opening = DENOMINATIONS.reduce((s, v) => s + v * (Number(counts[v]) || 0), 0);

  const open = async () => {
    setBusy(true);
    const res = await openCashierShift(hotelId, opening);
    setBusy(false);
    if (!res.ok) return toast.error("Not opened", res.reason);
    toast.success("Drawer open", `Starting with ${money(opening)}.`);
    onDone();
  };

  return (
    <div className="max-w-lg">
      <Card>
        <CardHeader
          title="No drawer open"
          description="Start a shift by counting in what you have been given."
        />
        <CardBody className="space-y-4">
          <p className="text-sm text-grey-600">
            The opening float: what is in the drawer before you take anything.
          </p>
          <NoteGrid counts={counts} onChange={setCounts} />
          <Button variant="primary" className="h-12 w-full text-base"
                  disabled={busy || !typed} onClick={() => void open()}>
            <Wallet className="size-4" />
            {busy ? "Opening…" : typed ? `Open the drawer - ${money(opening)}` : "Count the float first"}
          </Button>
        </CardBody>
      </Card>

      {previous && (
        <p className="mt-4 text-sm text-grey-600">
          Your last shift closed {previous.closedAt} with{" "}
          <b className="tabular">{money(previous.counted)}</b>
          {previous.handedTo
            ? <>, handed to {previous.handedTo}.</>
            : <>, handed to nobody.</>}
        </p>
      )}
    </div>
  );
}

/* ── The shift ────────────────────────────────────────────────── */
function Shift({ hotelId, shift, colleagues, onDone }: {
  hotelId: string; shift: CashierDrawer;
  colleagues: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [movementOpen, setMovementOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const [counts, setCounts] = useState<Record<number, string>>(() => {
    const seed: Record<number, string> = {};
    for (const d of shift.denominations) seed[d.value] = String(d.count);
    return seed;
  });
  const [saving, setSaving] = useState(false);

  const counted = useMemo(
    () => DENOMINATIONS.reduce((s, v) => s + v * (Number(counts[v]) || 0), 0),
    [counts]);

  const cashTaken = shift.receipts.find((r) => r.method === "cash")?.amount ?? 0;
  const variance = counted - shift.expected;

  const save = async () => {
    setSaving(true);
    const res = await countCashierDrawer(hotelId, DENOMINATIONS
      .map((v) => ({ value: v, count: Number(counts[v]) || 0 }))
      /* Everything typed, a mistake included, so the server can refuse it
         (QA FI-10: a −3 was dropped here and saved as nothing). */
      .filter((d) => d.count !== 0));
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Count saved", `${money(counted)} in the drawer.`);
    onDone();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Taken this shift"
            description={`Open since ${shift.openedAt}.`}
          />
          <CardBody>
            {shift.receipts.length === 0 ? (
              <p className="text-grey-500">
                Nothing has been taken yet this shift.
              </p>
            ) : (
              <dl className="divide-y divide-grey-200">
                {shift.receipts.map((r) => (
                  <div key={r.method}
                       className="flex items-baseline justify-between py-2.5">
                    <dt className="text-base">
                      {METHOD_LABEL[r.method] ?? r.method}
                      <span className="ml-2 text-sm text-grey-500">
                        {r.count} {r.count === 1 ? "receipt" : "receipts"}
                      </span>
                    </dt>
                    <dd className="text-base font-medium tabular">
                      {money(r.amount)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-3 text-sm text-grey-500">
              Only cash reaches the drawer. A card receipt and a bill left on
              a folio are business done - they are not in the tin.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Count the drawer"
            description="Notes and coins, as they come out."
          />
          <CardBody className="space-y-4">
            <NoteGrid counts={counts} onChange={setCounts} />
            <Button variant="primary" onClick={() => void save()} disabled={saving}
                    className="h-12 w-full text-base">
              {saving ? "Saving…" : `Save the count - ${money(counted)}`}
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="In and out of the drawer"
            description="Money that was not a receipt."
            actions={
              <Button variant="secondary" className="h-11"
                      onClick={() => setMovementOpen(true)}>
                <Plus className="size-4" /> Record
              </Button>
            }
          />
          <CardBody>
            {shift.movements.length === 0 ? (
              <p className="text-grey-500">
                Nothing has gone in or out of the drawer this shift.
              </p>
            ) : (
              <ul className="divide-y divide-grey-200">
                {shift.movements.map((m) => {
                  const spec = MOVEMENTS.find((x) => x.kind === m.kind);
                  return (
                    <li key={m.id} className="flex items-start gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-base">{m.reason}</p>
                        <p className="text-sm text-grey-500">
                          {spec?.label ?? m.kind} · {m.recordedBy} · {m.at}
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
        </Card>
      </div>

      {/* ── The sum ──────────────────────────────────────────── */}
      <Card className="h-fit lg:sticky lg:top-4">
        <CardHeader title="The drawer" />
        <CardBody>
          <dl className="divide-y divide-grey-200">
            <Line label="Opening float" value={shift.opening} />
            <Line label="Cash taken" value={cashTaken} />
            {MOVEMENTS.map((m) => {
              const total = shift.movements
                .filter((x) => x.kind === m.kind)
                .reduce((s, x) => s + x.amount, 0);
              if (total === 0) return null;
              return <Line key={m.kind} label={m.label}
                           value={m.sign * total} signed />;
            })}
            <div className="flex items-baseline justify-between py-3">
              <dt className="text-base font-medium">Expected</dt>
              <dd className="text-lg font-semibold tabular">
                {moneyPrecise(shift.expected)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between py-3">
              <dt className="text-base font-medium">Counted</dt>
              <dd className="text-lg font-semibold tabular">
                {counted > 0 ? moneyPrecise(counted) : "-"}
              </dd>
            </div>
          </dl>

          <Variance amount={counted > 0 ? variance : null} />

          <Button className="mt-4 h-12 w-full text-base"
                  disabled={shift.counted === null}
                  onClick={() => setCloseOpen(true)}>
            <ArrowRightLeft className="size-4" />
            Close and hand over
          </Button>
          {shift.counted === null && (
            <p className="mt-2 text-center text-sm text-grey-500">
              Save the count first.
            </p>
          )}
        </CardBody>
      </Card>

      {movementOpen && (
        <MovementDialog hotelId={hotelId}
                        onClose={() => setMovementOpen(false)} onDone={onDone} />
      )}
      {closeOpen && (
        <CloseDialog hotelId={hotelId} shift={shift} colleagues={colleagues}
                     onClose={() => setCloseOpen(false)} onDone={onDone} />
      )}
    </div>
  );
}

/* Notes and coins, one row each - the float at open and the drawer at the
   count, added up the same way. */
function NoteGrid({ counts, onChange }: {
  counts: Record<number, string>;
  onChange: (update: (c: Record<number, string>) => Record<number, string>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {DENOMINATIONS.map((value) => {
        const n = Number(counts[value]) || 0;
        return (
          <div key={value}
               className="flex items-center gap-3 rounded-lg border border-grey-200 px-3 py-2">
            <span className="w-14 text-base font-medium tabular shrink-0">
              ₹{value}
            </span>
            <span className="text-grey-500">×</span>
            <Input
              type="number" inputMode="numeric" min={0}
              value={counts[value] ?? ""} placeholder="0"
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

function Line({ label, value, signed }: {
  label: string; value: number; signed?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <dt className="text-base text-grey-600">{label}</dt>
      <dd className="text-base tabular">
        {signed && value > 0 ? "+" : ""}
        {signed && value < 0 ? "−" : ""}
        {money(Math.abs(value))}
      </dd>
    </div>
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
    <div className={cn("mt-4 rounded-lg border px-4 py-3",
      balanced ? "bg-success-50 border-success" : "bg-brand-yellow-50 border-brand-yellow")}>
      <p className="flex items-center gap-2 text-base font-medium">
        {balanced
          ? <><Check className="size-4 text-success" /> The drawer balances</>
          : <><AlertTriangle className="size-4 text-warning-dark" />
              {amount > 0 ? "Over" : "Short"} by {moneyPrecise(Math.abs(amount))}</>}
      </p>
      {!balanced && (
        <p className="mt-1 text-sm text-grey-600">
          This does not stop the handover. It has to be written down.
        </p>
      )}
    </div>
  );
}

function MovementDialog({ hotelId, onClose, onDone }: {
  hotelId: string; onClose: () => void; onDone: () => void;
}) {
  const [kind, setKind] = useState<"expense" | "top_up" | "withdrawal">("expense");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = MOVEMENTS.find((m) => m.kind === kind)!;

  const submit = async () => {
    setBusy(true);
    const res = await recordCashierMovement(hotelId,
      { kind, amount: Number(amount), reason });
    setBusy(false);
    if (!res.ok) return toast.error("Not recorded", res.reason);
    toast.success("Recorded", `${chosen.label} - ${money(Number(amount))}`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Money in or out">
        <div className="space-y-4">
          <Field label="What happened">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={kind}
                onChange={(e) => setKind(e.target.value as "expense")}
                className="h-12 text-base">
                {MOVEMENTS.map((m) => (
                  <option key={m.kind} value={m.kind}>{m.label}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <p className="-mt-2 text-sm text-grey-500">{chosen.hint}</p>

          <Field label="How much">
            {(f) => (
              <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0}
                value={amount} onChange={(e) => setAmount(e.target.value)}
                className="h-12 text-lg tabular" autoFocus />
            )}
          </Field>

          {/* Always. An unexplained hundred rupees out of a drawer is the
              thing a shift close exists to surface. */}
          <Field label="What was it for"
                 hint="This is the line somebody asks about tomorrow.">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={2} value={reason}
                onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-12 flex-1"
                    disabled={busy || !amount || !reason.trim()}
                    onClick={() => void submit()}>
              Record
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({ hotelId, shift, colleagues, onClose, onDone }: {
  hotelId: string; shift: CashierDrawer;
  colleagues: { id: string; name: string }[];
  onClose: () => void; onDone: () => void;
}) {
  const [why, setWhy] = useState(shift.varianceReason ?? "");
  const [handOverTo, setHandOverTo] = useState("");
  const [busy, setBusy] = useState(false);

  const variance = shift.variance;
  const needsReason = variance !== null && Math.abs(variance) >= 0.01;

  const submit = async () => {
    setBusy(true);
    const res = await closeCashierShift(hotelId, {
      varianceReason: why,
      handOverTo: handOverTo || null,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not closed", res.reason);
    toast.success("Shift closed",
      handOverTo
        ? `Handed to ${colleagues.find((c) => c.id === handOverTo)?.name ?? "the next shift"}.`
        : "Handed to nobody - the drawer is closed.");
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Close and hand over">
        <div className="space-y-4">
          <Variance amount={variance} />

          {needsReason && (
            <Field label="Why"
                   hint="What a manager needs tomorrow is the sentence, not the number.">
              {(f) => (
                <Textarea {...fieldProps(f)} rows={3} value={why}
                  onChange={(e) => setWhy(e.target.value)} autoFocus />
              )}
            </Field>
          )}

          <Field
            label="Hand the drawer to"
            hint="Leave empty if nobody is taking it - the last close of the night hands over to no one."
          >
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={handOverTo}
                onChange={(e) => setHandOverTo(e.target.value)}
                className="h-12 text-base">
                <option value="">Nobody</option>
                {colleagues.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Not yet</Button>
            </DialogClose>
            <Button variant="primary" className="h-12 flex-1"
                    disabled={busy || (needsReason && !why.trim())}
                    onClick={() => void submit()}>
              <Lock className="size-4" />
              Close the shift
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
