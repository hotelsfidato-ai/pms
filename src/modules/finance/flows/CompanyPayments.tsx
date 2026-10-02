import { useState } from "react";
import { Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateShort, moneyPrecise } from "@/lib/format";
import {
  Card, CardBody, CardHeader, Button, toast, Dialog, DialogContent, DialogClose,
  Field, fieldProps, Input, Textarea, NativeSelect, DatePicker, StatusPill,
} from "@/components/ui";
import {
  recordCompanyPayment, reverseCompanyPayment, type CompanyPaymentsView, type CompanyPayment,
} from "@/modules/finance/data/companyPayments";

/* ══════════════════════════════════════════════════════════════════
   A COMPANY PAYS WHAT IT OWES - the owner's D27-152, D27-239

   Recorded against the account the City ledger names (a company, or the
   booking site a booking came through), by the day the money reached the
   hotel. Nothing is assumed: the amount and the date are typed. A wrong
   line is reversed by its own line, with a reason (D27-125).
   ══════════════════════════════════════════════════════════════════ */

const keyOf = (a: { companyId: string | null; bookingSourceId: string | null }) =>
  a.companyId ? `c:${a.companyId}` : `s:${a.bookingSourceId}`;

export function RecordCompanyPayment({ hotelId, view, onClose, onDone }: {
  hotelId: string; view: CompanyPaymentsView; onClose: () => void; onDone: () => void;
}) {
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = view.accounts.find((a) => keyOf(a) === account);

  const submit = async () => {
    setBusy(true);
    const res = await recordCompanyPayment(hotelId, {
      companyId: chosen?.companyId ?? null, bookingSourceId: chosen?.bookingSourceId ?? null,
      amount: Number(amount), receivedOn, method, reference, note,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not recorded", res.reason);
    toast.success("Payment recorded", `${moneyPrecise(Number(amount))} from ${chosen?.name ?? "the account"}.`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Record a company's payment">
        <div className="space-y-4">
          <Field label="Who paid" hint="The company or booking site the City ledger names.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={account} onChange={(e) => setAccount(e.target.value)}
                            className="h-12 text-base">
                <option value="">Choose one…</option>
                {view.accounts.map((a) => <option key={keyOf(a)} value={keyOf(a)}>{a.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Amount received">
            {(f) => (
              <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0} value={amount}
                     onChange={(e) => setAmount(e.target.value)} className="h-12 text-lg tabular" />
            )}
          </Field>
          <Field label="Received on" hint="The day the money reached the hotel.">
            {(f) => <DatePicker id={f.id} value={receivedOn} onChange={setReceivedOn} />}
          </Field>
          <Field label="How">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={method} onChange={(e) => setMethod(e.target.value)}
                            className="h-12 text-base">
                <option value="">Choose one…</option>
                {Object.entries(view.methods).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Reference" hint="The bank's UTR or the cheque's number - what the accountant matches.">
            {(f) => <Input {...fieldProps(f)} value={reference} onChange={(e) => setReference(e.target.value)} className="h-12 text-base" />}
          </Field>
          <Field label="Note" hint="Optional.">
            {(f) => <Textarea {...fieldProps(f)} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-12 flex-1"
                    disabled={busy || !chosen || !(Number(amount) > 0) || !receivedOn || !method}
                    onClick={() => void submit()}>
              Record payment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* What companies paid, newest first. A reversal stays beside its line. */
export function PaymentsReceived({ hotelId, view, mayReverse, onDone }: {
  hotelId: string; view: CompanyPaymentsView; mayReverse: boolean; onDone: () => void;
}) {
  const [reverseOf, setReverseOf] = useState<CompanyPayment | null>(null);
  return (
    <Card className="mt-5">
      <CardHeader title="Payments received" description="Newest first. A wrong line is reversed, never edited." />
      <CardBody>
        {view.payments.length === 0 ? (
          <p className="text-grey-500">No company has paid yet. Record a payment when one arrives.</p>
        ) : (
          <ul className="divide-y divide-grey-200">
            {view.payments.map((p) => (
              <li key={p.id} className="py-3 flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-base", p.reversed && "line-through text-grey-500")}>
                    {p.reversesId ? `Reversal: ${p.account} - "${p.reason}"` : `${p.account} · ${p.method}${p.reference ? ` · ${p.reference}` : ""}`}
                  </p>
                  <p className="text-sm text-grey-600">
                    Received {dateShort(p.receivedOn)} · recorded by {p.recordedBy ?? "-"}, {p.recordedAt}
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                </div>
                <span className="text-base font-medium tabular">{moneyPrecise(p.amount)}</span>
                {p.reversed && <StatusPill tone="neutral">Reversed</StatusPill>}
                {mayReverse && !p.reversed && !p.reversesId && (
                  <Button variant="secondary" className="h-11" onClick={() => setReverseOf(p)}>
                    <Undo2 className="size-4" /> Reverse
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {reverseOf && (
        <ReverseDialog hotelId={hotelId} payment={reverseOf}
                       onClose={() => setReverseOf(null)} onDone={onDone} />
      )}
    </Card>
  );
}

function ReverseDialog({ hotelId, payment, onClose, onDone }: {
  hotelId: string; payment: CompanyPayment; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const res = await reverseCompanyPayment(hotelId, payment.id, reason);
    setBusy(false);
    if (!res.ok) return toast.error("Not reversed", res.reason);
    toast.success("Reversed", "Record it again with the right figures.");
    onClose();
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Reverse this payment?">
        <div className="space-y-4">
          <p className="text-base text-grey-600">
            {moneyPrecise(payment.amount)} from {payment.account}, received {dateShort(payment.receivedOn)}.
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
