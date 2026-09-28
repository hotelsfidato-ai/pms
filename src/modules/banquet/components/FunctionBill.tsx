import { useState } from "react";
import { Link } from "react-router";
import { Receipt } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise } from "@/lib/format";
import { can } from "@/lib/permissions";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/rules";
import { useRole } from "@/lib/session";
import {
  Card, CardHeader, CardBody, Button, toast, Checkbox,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, NativeSelect,
} from "@/components/ui";
import {
  billBanquetEvent, payBanquetEvent, invoiceBanquetEvent, type BanquetEvent,
} from "@/modules/banquet/data/banquet";

/* ══════════════════════════════════════════════════════════════════
   THE FUNCTION'S BILL (BQ-1; the owner's D27-132 to D27-138)

   Reached from the function's own page, nowhere else. Confirming opened
   it; from then:
     Take an advance   a payment on this bill, as a room's advance is -
                       no GST receipt voucher until the CA answers (B5)
     Bill the function the hall and every course go on it under the
                       Banquet GST rule; price and courses are then fixed
     Settle            a payment until nothing is owed
     Issue tax invoice finance's own invoice, then its page and credit note
   Owner, Admin and GM take money and bill it; the Accountant may also
   issue the invoice. The server asks the same (roleGate).
   ══════════════════════════════════════════════════════════════════ */

export function FunctionBill({
  hotelId, event: e, onDone,
}: {
  hotelId: string; event: BanquetEvent; onDone: () => void;
}) {
  const role = useRole();
  const mayTakeMoney = can(role, "approve", "reservation");
  const mayInvoice = can(role, "approve", "invoice");
  const [paying, setPaying] = useState(false);
  const [billing, setBilling] = useState(false);
  const [invoicing, setInvoicing] = useState(false);

  const billed = e.status === "completed";
  const balance = e.bill?.balance ?? 0;

  return (
    <Card>
      <CardHeader title="The bill" />
      <CardBody className="space-y-3">
        {e.bill === null ? (
          <p className="text-sm text-grey-600">Nothing is on the bill yet.</p>
        ) : (
          <dl>
            <Row label={billed ? "Billed" : "Charged so far"} value={money(e.bill.charges)} />
            <Row label="GST" value={money(e.bill.tax)} />
            <Row label="Paid" value={money(e.bill.paid)} />
            <div className="mt-1 border-t border-grey-100 pt-2">
              <Row label={balance < 0 ? "Paid ahead" : "Balance"} value={money(Math.abs(balance))} strong />
            </div>
          </dl>
        )}

        {e.status === "confirmed" && (
          <p className="text-sm text-grey-600">
            An advance is a payment on this bill. No GST receipt voucher is
            issued for it yet: the CA has not answered on advances.
          </p>
        )}

        {e.invoice && (
          <p className="flex items-center gap-1.5 text-sm">
            <Receipt className="size-3.5 shrink-0 text-grey-400" />
            <Link className="font-medium text-brand-orange-700 hover:underline underline-offset-4"
                  to={`/h/${hotelId}/invoices/doc/${e.invoice}`}>
              Tax invoice {e.invoice}
            </Link>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {mayTakeMoney && e.status === "confirmed" && (
            <>
              <Button variant="secondary" onClick={() => setPaying(true)}>Take an advance</Button>
              <Button variant="primary" onClick={() => setBilling(true)}>Bill the function</Button>
            </>
          )}
          {mayTakeMoney && billed && balance > 0 && (
            <Button variant="primary" onClick={() => setPaying(true)}>Settle</Button>
          )}
          {mayInvoice && billed && !e.invoice && (
            <Button variant={balance > 0 ? "secondary" : "primary"} onClick={() => setInvoicing(true)}>
              Issue tax invoice
            </Button>
          )}
        </div>
      </CardBody>

      {paying && (
        <PayDialog hotelId={hotelId} event={e} advance={!billed}
                   onClose={() => setPaying(false)}
                   onDone={() => { setPaying(false); onDone(); }} />
      )}
      {billing && (
        <Confirm
          title="Bill the function"
          text={"The hall and every course go on this bill under the Banquet GST "
            + "rate. After this the price, the courses and the restaurant orders "
            + "are fixed; a correction is a credit note."}
          act="Bill the function"
          onClose={() => setBilling(false)}
          run={() => billBanquetEvent(hotelId, e.id)}
          done={() => { setBilling(false); toast.success("Billed"); onDone(); }}
        />
      )}
      {invoicing && (
        <Confirm
          title="Issue the tax invoice"
          text={`A tax invoice is issued to ${e.hostName} (or the company the function is billed to), `
            + "with the next number of the series. A number once taken cannot be taken back."}
          act="Issue tax invoice"
          onClose={() => setInvoicing(false)}
          run={() => invoiceBanquetEvent(hotelId, e.id)}
          done={() => { setInvoicing(false); toast.success("Tax invoice issued"); onDone(); }}
        />
      )}
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm leading-[22px]">
      <dt className="text-grey-500">{label}</dt>
      <dd className={cn("tabular", strong ? "text-base font-semibold text-ink-900" : "font-medium text-grey-700")}>
        {value}
      </dd>
    </div>
  );
}

function Confirm({
  title, text, act, onClose, run, done,
}: {
  title: string; text: string; act: string;
  onClose: () => void; run: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const res = await run();
    setBusy(false);
    if (!res.ok) return toast.error("Not done", res.reason);
    done();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={title}
        footer={
          <>
            <DialogClose asChild><Button variant="secondary">Not now</Button></DialogClose>
            <Button variant="primary" loading={busy} onClick={() => void go()}>{act}</Button>
          </>
        }
      >
        <p className="text-sm text-ink-700">{text}</p>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({
  hotelId, event: e, advance, onClose, onDone,
}: {
  hotelId: string; event: BanquetEvent; advance: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const owed = Math.max(e.bill?.balance ?? 0, 0);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [amount, setAmount] = useState(advance ? "" : String(owed));
  const [pan, setPan] = useState("");
  const [form97, setForm97] = useState(false);
  const [asCredit, setAsCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  /* One per press, kept until it lands (the release fixes' FIN-11). */
  const [pressKey, setPressKey] = useState(() => crypto.randomUUID());

  const value = Number(amount) || 0;
  /* Rule 159: more than ₹1,00,000 in cash at once needs a PAN or Form 97. */
  const asksPan = method === "Cash" && value > 100000;
  /* D27-4: after the bill, more than it is held as credit once ticked. */
  const extra = advance ? 0 : Math.round((value - owed) * 100) / 100;

  const submit = async () => {
    setBusy(true);
    const res = await payBanquetEvent(hotelId, e.id, {
      method, amount: value,
      ...(asksPan ? (form97 ? { form97 } : { pan }) : {}),
      ...(extra > 0 ? { heldAsCredit: true } : {}),
    }, pressKey);
    setBusy(false);
    if (!res.ok) return toast.error("Not taken", res.reason);
    setPressKey(crypto.randomUUID());
    toast.success(`${money(value)} received`, method);
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={advance ? "Take an advance" : "Settle the bill"}
        description={advance
          ? `${e.title} · a payment on the function's bill`
          : `${money(owed)} outstanding · ${e.title}`}
        footer={
          <>
            <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
            <Button variant="primary" loading={busy}
                    disabled={value <= 0 || (extra > 0 && !asCredit)}
                    onClick={() => void submit()}>
              Take payment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Method">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={method}
                            onChange={(ev) => setMethod(ev.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Amount">
            {(f) => (
              <Input {...fieldProps(f)} numeric inputMode="decimal" value={amount}
                     onChange={(ev) => { setAmount(ev.target.value); setAsCredit(false); }} />
            )}
          </Field>
          {asksPan && (
            <div className="space-y-3">
              <Field label="Payer's PAN"
                     hint="More than ₹1,00,000 in cash at once needs it (Income-tax Rule 159).">
                {(f) => (
                  <Input {...fieldProps(f)} value={pan} disabled={form97} maxLength={10}
                         placeholder="ABCDE1234F" autoComplete="off"
                         onChange={(ev) => setPan(ev.target.value.toUpperCase())} />
                )}
              </Field>
              <Checkbox label="No PAN: Form 97 taken" checked={form97} onCheckedChange={setForm97} />
            </div>
          )}
          {extra > 0 && (
            <div className="rounded-lg bg-brand-yellow-50 border border-brand-yellow-100 p-3 space-y-2">
              <p className="text-sm text-brand-yellow-800">
                This is {moneyPrecise(extra)} more than the bill; it will be held as the host's credit.
              </p>
              <Checkbox label="Hold it as the host's credit" checked={asCredit} onCheckedChange={setAsCredit} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
