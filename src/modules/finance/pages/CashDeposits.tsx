import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { PiggyBank, Check, AlertTriangle, Plus, Undo2, FileImage } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong, dateShort, moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Skeleton, toast, EmptyState,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, Textarea, NativeSelect,
  StatusPill, DatePicker, ReadFailed,
} from "@/components/ui";
import {
  getCashDeposits, recordDeposit, reverseDeposit, verifyDeposit, explainDay, attachSlip,
  slipAddress, type DepositDay, type Deposit,
} from "@/modules/finance/data/deposits";

/* ══════════════════════════════════════════════════════════════════
   CASH DEPOSITS - the owner's D27-190 and D27-191

   Each closed day's cash to deposit, per cash point (the closing counts
   less the float kept, plus what went to the safe). The GM records each
   bank deposit against the day it banks, with the slip's photo; the owner
   or the accountant verifies. A day whose deposits differ stays red until
   somebody explains it. Append-only: a wrong line is reversed, never
   edited. One page: record, explain, verify and reverse all happen here.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

const figure = (n: number | null) => (n === null ? "-" : moneyPrecise(n));

export default function CashDepositsPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: ["cash-deposits", hotelId],
    queryFn: () => getCashDeposits(hotelId),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["cash-deposits", hotelId] });

  const [recordFor, setRecordFor] = useState<string | null>(null);
  const [explainFor, setExplainFor] = useState<DepositDay | null>(null);
  const [reverseOf, setReverseOf] = useState<Deposit | null>(null);

  const header = (
    <PageHeader
      title="Cash deposits"
      description="Each day's cash to deposit, what was banked, and who verified it."
    />
  );
  if (view.isLoading) return <Page>{header}<Skeleton className="h-64" /></Page>;
  if (!view.data) {
    return (
      <Page>{header}
        <Card><ReadFailed error={view.error} what="the cash deposits log" onRetry={() => void view.refetch()} /></Card>
      </Page>
    );
  }
  const d = view.data;

  return (
    <Page>
      {header}

      <Card className="mb-5">
        <CardHeader title="Cash to deposit"
          description="Per closed day: the closing counts less the float kept, plus what went to the safe." />
        <CardBody>
          {d.days.length === 0 ? (
            <EmptyState compact icon={<PiggyBank />} title="Nothing to deposit yet"
              description="A day appears here once its cash points have closed with the float they kept, and the night audit has closed the day." />
          ) : (
            <ul className="divide-y divide-grey-200">
              {d.days.map((day) => (
                <DayRow key={day.date} day={day} canRecord={d.canRecord}
                        onRecord={() => setRecordFor(day.date)}
                        onExplain={() => setExplainFor(day)} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Deposits" description="Newest first. A wrong line is reversed, never edited." />
        <CardBody>
          {d.deposits.length === 0 ? (
            <p className="text-grey-500">No deposit has been recorded yet.</p>
          ) : (
            <ul className="divide-y divide-grey-200">
              {d.deposits.map((x) => (
                <DepositRow key={x.id} hotelId={hotelId} deposit={x}
                            canRecord={d.canRecord} canVerify={d.canVerify}
                            onReverse={() => setReverseOf(x)} onDone={refresh} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {recordFor && (
        <RecordDialog hotelId={hotelId} days={d.days} date={recordFor}
                      onClose={() => setRecordFor(null)} onDone={refresh} />
      )}
      {explainFor && (
        <ExplainDialog hotelId={hotelId} day={explainFor}
                       onClose={() => setExplainFor(null)} onDone={refresh} />
      )}
      {reverseOf && (
        <ReverseDialog hotelId={hotelId} deposit={reverseOf}
                       onClose={() => setReverseOf(null)} onDone={refresh} />
      )}
    </Page>
  );
}

function DayRow({ day, canRecord, onRecord, onExplain }: {
  day: DepositDay; canRecord: boolean; onRecord: () => void; onExplain: () => void;
}) {
  const settled = day.difference !== null && Math.abs(day.difference) < 0.01;
  return (
    <li className="py-3.5 flex flex-wrap items-start gap-x-6 gap-y-2">
      <div className="min-w-44 flex-1">
        <p className="text-base font-medium">{dateLong(day.date)}</p>
        <p className="text-sm text-grey-600">
          {day.points.map((p) => `${p.point} ${figure(p.amount)}`).join(" · ")}
        </p>
        {day.explanation && (
          <p className="mt-1 text-sm text-grey-600">
            “{day.explanation.reason}” - {day.explanation.by ?? "-"}, {day.explanation.at}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-x-6 text-right tabular">
        <div><dt className="text-xs text-grey-500">To deposit</dt><dd className="text-base">{figure(day.toDeposit)}</dd></div>
        <div><dt className="text-xs text-grey-500">Deposited</dt><dd className="text-base">{moneyPrecise(day.deposited)}</dd></div>
        <div>
          <dt className="text-xs text-grey-500">Difference</dt>
          <dd className={cn("text-base font-medium", day.red ? "text-danger" : settled && "text-success")}>
            {figure(day.difference)}
          </dd>
        </div>
      </dl>
      {canRecord && (
        <div className="flex gap-2">
          <Button variant="secondary" className="h-11" onClick={onRecord}>
            <Plus className="size-4" /> Record deposit
          </Button>
          {day.red && (
            <Button variant="secondary" className="h-11" onClick={onExplain}>
              <AlertTriangle className="size-4" /> Explain
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function DepositRow({ hotelId, deposit: x, canRecord, canVerify, onReverse, onDone }: {
  hotelId: string; deposit: Deposit; canRecord: boolean; canVerify: boolean;
  onReverse: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  if (x.reversesId) {
    return (
      <li className="py-3 flex items-start gap-3 text-grey-600">
        <div className="min-w-0 flex-1">
          <p className="text-base">Reversal for {dateShort(x.businessDate)} - “{x.reason}”</p>
          <p className="text-sm">{x.recordedBy ?? "-"} · {x.recordedAt}</p>
        </div>
        <span className="text-base tabular">{moneyPrecise(x.amount)}</span>
      </li>
    );
  }

  const verify = async () => {
    setBusy(true);
    const res = await verifyDeposit(hotelId, x.id);
    setBusy(false);
    if (!res.ok) return toast.error("Not verified", res.reason);
    toast.success("Verified", `${moneyPrecise(x.amount)} for ${dateShort(x.businessDate)}.`);
    onDone();
  };
  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const res = await attachSlip(hotelId, x.id, file);
    setBusy(false);
    if (!res.ok) return toast.error("Photo not saved", res.reason);
    toast.success("Slip photo saved", `Slip ${x.slipNo}.`);
    onDone();
  };
  const openPhoto = async () => {
    const res = await slipAddress(hotelId, x.slipId!);
    if (!res.ok || !res.url) return toast.error("Not opened", res.ok ? "" : res.reason);
    window.open(res.url, "_blank");
  };

  return (
    <li className="py-3 flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className={cn("text-base", x.reversed && "line-through text-grey-500")}>
          {dateShort(x.businessDate)}'s cash · {x.bank} · slip {x.slipNo}
        </p>
        <p className="text-sm text-grey-600">
          Deposited {dateShort(x.depositedOn)} · recorded by {x.recordedBy ?? "-"}, {x.recordedAt}
          {x.verifiedAt && <> · verified by {x.verifiedBy ?? "-"}, {x.verifiedAt}</>}
        </p>
      </div>
      <span className="text-base font-medium tabular">{moneyPrecise(x.amount)}</span>
      <div className="flex flex-wrap items-center gap-2">
        {x.reversed && <StatusPill tone="neutral">Reversed</StatusPill>}
        {x.verifiedAt && <StatusPill tone="success"><Check className="size-3" /> Verified</StatusPill>}
        {x.slipId ? (
          <Button variant="secondary" className="h-11" onClick={() => void openPhoto()}>
            <FileImage className="size-4" /> Slip photo
          </Button>
        ) : !x.reversed && canRecord && (
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-grey-300 px-3 text-base">
            <FileImage className="size-4" /> Add slip photo
            <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={busy}
                   onChange={(e) => void addPhoto(e.target.files?.[0])} />
          </label>
        )}
        {!x.reversed && !x.verifiedAt && canVerify && (
          <Button variant="primary" className="h-11" disabled={busy} onClick={() => void verify()}>
            <Check className="size-4" /> Verify
          </Button>
        )}
        {!x.reversed && !x.verifiedAt && canRecord && (
          <Button variant="secondary" className="h-11" onClick={onReverse}>
            <Undo2 className="size-4" /> Reverse
          </Button>
        )}
      </div>
    </li>
  );
}

function RecordDialog({ hotelId, days, date, onClose, onDone }: {
  hotelId: string; days: DepositDay[]; date: string; onClose: () => void; onDone: () => void;
}) {
  const [day, setDay] = useState(date);
  const [amount, setAmount] = useState("");
  const [depositedOn, setDepositedOn] = useState("");
  const [bank, setBank] = useState("");
  const [slipNo, setSlipNo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = days.find((x) => x.date === day);

  const submit = async () => {
    setBusy(true);
    const res = await recordDeposit(hotelId,
      { businessDate: day, amount: Number(amount), depositedOn, bank, slipNo });
    if (!res.ok) { setBusy(false); return toast.error("Not recorded", res.reason); }
    /* The deposit stands without the photo; it can be added from its line. */
    const photo = file && res.id ? await attachSlip(hotelId, res.id, file) : null;
    setBusy(false);
    if (photo && !photo.ok) toast.error("Deposit recorded, photo not saved", photo.reason);
    else toast.success("Deposit recorded", `${moneyPrecise(Number(amount))} for ${dateShort(day)}.`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Record a deposit">
        <div className="space-y-4">
          <Field label="The day's cash it banks"
                 hint={chosen ? `To deposit ${figure(chosen.toDeposit)}, deposited so far ${moneyPrecise(chosen.deposited)}.` : undefined}>
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={day} onChange={(e) => setDay(e.target.value)}
                            className="h-12 text-base">
                {days.map((x) => <option key={x.date} value={x.date}>{dateLong(x.date)}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Amount deposited">
            {(f) => (
              <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0} value={amount}
                     onChange={(e) => setAmount(e.target.value)} className="h-12 text-lg tabular" />
            )}
          </Field>
          <Field label="Deposited on">
            {(f) => <DatePicker id={f.id} value={depositedOn} onChange={setDepositedOn} />}
          </Field>
          <Field label="Bank">
            {(f) => <Input {...fieldProps(f)} value={bank} onChange={(e) => setBank(e.target.value)} className="h-12 text-base" />}
          </Field>
          <Field label="Slip number" hint="As printed on the bank's slip. A slip for two days is one line per day, same number.">
            {(f) => <Input {...fieldProps(f)} value={slipNo} onChange={(e) => setSlipNo(e.target.value)} className="h-12 text-base" />}
          </Field>
          <Field label="Photo of the slip" hint="It can be added later from its line; it is verified only once it is there.">
            {(f) => (
              <input id={f.id} type="file" accept="image/*,application/pdf"
                     onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                     className={cn("block w-full min-h-12 text-base text-grey-700",
                       "file:mr-3 file:min-h-11 file:rounded-md file:border file:border-grey-300",
                       "file:bg-white file:px-3 file:text-base file:text-ink-900")} />
            )}
          </Field>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-12 flex-1"
                    disabled={busy || !amount || !depositedOn || !bank.trim() || !slipNo.trim()}
                    onClick={() => void submit()}>
              Record deposit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExplainDialog({ hotelId, day, onClose, onDone }: {
  hotelId: string; day: DepositDay; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const res = await explainDay(hotelId, day.date, reason);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Explained", dateLong(day.date));
    onClose();
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Why ${dateShort(day.date)} differs`}>
        <div className="space-y-4">
          <p className="text-base text-grey-600">
            To deposit {figure(day.toDeposit)}, deposited {moneyPrecise(day.deposited)}:
            a difference of {figure(day.difference)}.
          </p>
          <Field label="Why" hint="What the owner or the accountant needs, in a sentence.">
            {(f) => <Textarea {...fieldProps(f)} rows={3} value={reason} autoFocus
                              onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-12 flex-1" disabled={busy || !reason.trim()}
                    onClick={() => void submit()}>
              Save the explanation
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({ hotelId, deposit, onClose, onDone }: {
  hotelId: string; deposit: Deposit; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const res = await reverseDeposit(hotelId, deposit.id, reason);
    setBusy(false);
    if (!res.ok) return toast.error("Not reversed", res.reason);
    toast.success("Reversed", "Record it again with the right figures.");
    onClose();
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Reverse this deposit?">
        <div className="space-y-4">
          <p className="text-base text-grey-600">
            {moneyPrecise(deposit.amount)} for {dateShort(deposit.businessDate)}, slip {deposit.slipNo}.
            The line stays; a reversal is added beside it.
          </p>
          <Field label="Why" hint="This is the line somebody asks about.">
            {(f) => <Textarea {...fieldProps(f)} rows={2} value={reason} autoFocus
                              onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="danger" className="h-12 flex-1" disabled={busy || !reason.trim()}
                    onClick={() => void submit()}>
              Reverse it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
