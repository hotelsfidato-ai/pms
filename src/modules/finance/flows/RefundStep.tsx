import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Banknote, Printer } from "lucide-react";
import { moneyPrecise } from "@/lib/format";
import {
  Button, Field, Input, NativeSelect, Textarea, toast,
  Dialog, DialogContent, DialogTrigger,
} from "@/components/ui";
import { getRefundOptions, giveRefund, type RefundBill } from "../data/refunds";

/* ══════════════════════════════════════════════════════════════════
   REFUND (the owner's D27-315 Part B)

   Its own step, so the bill shows it when the bill is overpaid and the
   check-out dialog can show the same when it needs to (Lane A's "Leaving
   early" is built beside it). It says what is owed back, and then one of
   three things: a notice (a company's credit, a booking site's stay), who
   may give it (anyone but the four), or the Refund button.

   The server decides every rule (api/src/modules/finance/refunds.ts): the
   ways and how much each may give back come from it, so the screen offers
   only what will be taken.
   ══════════════════════════════════════════════════════════════════ */

const WHO = "Refunds are given by the owner, an administrator, the general manager or the accountant. Ask one of them.";
const CEILING = "Cash is given back only below ₹20,000 on a bill; above it, by bank transfer. "
  + "This limit stands until the hotel's CA confirms it.";
const VOUCHER = "This prints a plain refund receipt. The GST refund voucher (Rule 51) waits for the hotel's CA.";

const REFERENCE_HINT: Record<string, string> = {
  upi: "The UPI reference", card: "The card approval code", cheque: "The cheque number",
  bank_transfer: "The transfer number (UTR)", netbanking: "The transfer number", wallet: "The wallet reference",
};

export function RefundStep({
  hotelId, stayId, onDone,
}: { hotelId: string; stayId: string; onDone: () => void }) {
  const options = useQuery({
    queryKey: ["refund-options", hotelId, stayId],
    queryFn: () => getRefundOptions(hotelId, stayId),
  });
  const [given, setGiven] = useState<string | null>(null);
  const bills = (options.data?.bills ?? []).filter((b) => b.credit > 0);

  if (!options.data || (bills.length === 0 && !given)) return null;

  return (
    <div className="rounded-lg border border-brand-yellow-100 bg-brand-yellow-50 p-3 space-y-2" data-refund-step>
      {bills.map((b) => (
        <div key={b.folioId} className="space-y-2">
          <p className="text-base text-ink-900">
            {moneyPrecise(b.credit)} is owed back to the guest.
          </p>
          {b.notice ? (
            <p className="text-sm text-grey-700" data-refund-notice>{b.notice}</p>
          ) : !options.data!.may ? (
            <p className="text-sm text-grey-700">{WHO}</p>
          ) : (
            <RefundDialog
              hotelId={hotelId} stayId={stayId} bill={b}
              onDone={(id) => { setGiven(id); void options.refetch(); onDone(); }}
            />
          )}
        </div>
      ))}
      {given && (
        <Link to={`/h/${hotelId}/stays/${stayId}/refunds/${given}`} target="_blank"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange hover:underline">
          <Printer className="size-4" />
          Print the refund receipt
        </Link>
      )}
    </div>
  );
}

function RefundDialog({
  hotelId, stayId, bill, onDone,
}: { hotelId: string; stayId: string; bill: RefundBill; onDone: (postingId: string) => void }) {
  const [open, setOpen] = useState(false);
  const first = bill.ways[0];
  const [method, setMethod] = useState(first?.label ?? "");
  const way = bill.ways.find((w) => w.label === method);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [pressKey, setPressKey] = useState(() => crypto.randomUUID());
  const value = Number(amount) || 0;
  const needsReference = way !== undefined && way.kind !== "cash";

  const pick = (label: string) => {
    setMethod(label);
    const w = bill.ways.find((x) => x.label === label);
    setAmount(w ? String(Math.min(w.upTo, bill.credit)) : "");
    setReference("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) pick(first?.label ?? ""); }}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm" disabled={bill.ways.length === 0}>
          <Banknote className="size-4" />
          Refund
        </Button>
      </DialogTrigger>
      <DialogContent title="Refund" description={`${moneyPrecise(bill.credit)} is owed back on this bill`}>
        <div className="space-y-4">
          <Field label="Back by" hint="The way the guest paid. Never cash for a card or UPI payment.">
            {({ id }) => (
              <NativeSelect id={id} value={method} onChange={(e) => pick(e.target.value)}>
                {bill.ways.map((w) => (
                  <option key={w.label} value={w.label}>{w.label} - up to {moneyPrecise(w.upTo)}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Amount">
            {({ id }) => (
              <Input id={id} numeric inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            )}
          </Field>
          {needsReference && (
            <Field label="Reference" hint={REFERENCE_HINT[way!.kind] ?? "Where the money can be traced"}>
              {({ id }) => (
                <Input id={id} value={reference} autoComplete="off"
                  onChange={(e) => setReference(e.target.value)} />
              )}
            </Field>
          )}
          <Field label="Why">
            {({ id }) => (
              <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>

          <div className="space-y-1 text-sm text-grey-600">
            <p>{CEILING}</p>
            <p>{VOUCHER}</p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving}
              disabled={!way || value <= 0 || value > way.upTo || !reason.trim()
                        || (needsReference && !reference.trim())}
              onClick={async () => {
                setSaving(true);
                try {
                  const res = await giveRefund(hotelId, stayId, {
                    folioId: bill.folioId, method, amount: value,
                    reference: reference.trim(), reason: reason.trim(),
                  }, pressKey);
                  if (res.ok && res.data) {
                    setPressKey(crypto.randomUUID());
                    toast.success(`${moneyPrecise(value)} refunded`, method);
                    setOpen(false);
                    onDone(res.data.id);
                  } else {
                    toast.error("Could not refund", res.reason);
                  }
                } finally {
                  setSaving(false);
                }
              }}
            >
              Give refund
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
