import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2, Plus, Receipt, LogOut, Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import {
  CHARGE_CATEGORIES, PAYMENT_METHODS, taxOn, splitTax, roundOff,
  type ChargeCategory, type PaymentMethod,
} from "@/lib/rules";
import {
  Button, Field, Input, NativeSelect, StatusPill, Tooltip, toast,
  Dialog, DialogContent, DialogTrigger,
} from "@/components/ui";
import {
  getFolioPostings, getFolioBalance, postCharge, reverseCharge,
  settle, checkOut, checkOutAllowed, reverseChargeAllowed,
  type Posting, type Stay,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   FLOWS B AND C — charge, settle, check out

   The ledger is append-only and this panel makes that legible rather
   than hiding it. A wrong posting is reversed; the reversal appears
   as its own line, in rose, and the original stays visible with a
   strike through it.

   Check-out is shown DISABLED with its reason while a balance is
   outstanding — never hidden. That is Rule 6, and it is the point of
   the whole departure flow.
   ══════════════════════════════════════════════════════════════════ */

const USER = "front desk";

export function FolioPanel({
  hotelId, stay, businessDate,
}: {
  hotelId: string;
  stay: Stay;
  businessDate: string;
}) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();

  const postings = useQuery({
    queryKey: ["folio-postings", hotelId, stay.id],
    queryFn: () => getFolioPostings(hotelId, stay.id),
  });
  const balance = useQuery({
    queryKey: ["folio-balance", hotelId, stay.id],
    queryFn: () => getFolioBalance(hotelId, stay.id),
  });
  const checkoutPermitted = useQuery({
    queryKey: ["checkout-allowed", hotelId, stay.id, balance.data],
    queryFn: () => checkOutAllowed(hotelId, stay.id),
  });

  const lines = postings.data ?? [];
  const due = balance.data ?? 0;

  return (
    <div className="space-y-5">
      <BalanceHeader stay={stay} balance={due} />

      <LedgerList
        lines={lines}
        hotelId={hotelId}
        stayId={stay.id}
        onChanged={refresh}
      />

      <div className="flex flex-wrap gap-2">
        <AddChargeDialog
          hotelId={hotelId}
          stay={stay}
          businessDate={businessDate}
          onDone={refresh}
        />
        <SettleDialog
          hotelId={hotelId}
          stay={stay}
          balance={due}
          businessDate={businessDate}
          onDone={refresh}
        />
        <InvoiceDialog stay={stay} lines={lines} balance={due} />
      </div>

      {/* Rule 6 — blocked, visible, and it says why */}
      <div className="pt-4 border-t border-grey-200">
        <CheckOutButton
          allowed={checkoutPermitted.data?.allowed ?? false}
          reason={checkoutPermitted.data?.reason}
          onCheckOut={async () => {
            const res = await checkOut(hotelId, stay.id, USER);
            if (res.ok) {
              toast.success(`${stay.guest} checked out`, `Room ${stay.roomNumber} is now dirty and on housekeeping's board.`);
              refresh();
            } else {
              toast.error("Could not check out", res.reason);
            }
          }}
        />
      </div>
    </div>
  );
}

function BalanceHeader({ stay, balance }: { stay: Stay; balance: number }) {
  const tone = balance > 0 ? "danger" : balance < 0 ? "info" : "success";
  const label = balance > 0 ? "Outstanding" : balance < 0 ? "Overpaid" : "Settled";
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <p className="text-2xs font-semibold uppercase tracking-wide text-grey-400">
          Folio balance
        </p>
        <p
          className={cn(
            "text-2xl font-semibold tabular mt-0.5",
            balance > 0 ? "text-brand-red" : balance < 0 ? "text-info" : "text-success",
          )}
        >
          {money(Math.abs(balance))}
        </p>
      </div>
      <div className="text-right">
        <StatusPill tone={tone} dot>{label}</StatusPill>
        <p className="text-2xs text-grey-500 tabular mt-1.5">
          Room {stay.roomNumber} · {stay.reference}
        </p>
      </div>
    </div>
  );
}

function LedgerList({
  lines, hotelId, stayId, onChanged,
}: {
  lines: Posting[];
  hotelId: string;
  stayId: string;
  onChanged: () => void;
}) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-grey-500 py-6 text-center">
        Nothing posted to this folio yet.
      </p>
    );
  }

  let running = 0;

  return (
    <div className="border border-grey-200 rounded-md overflow-hidden">
      <div className="bg-grey-50 border-b border-grey-200 px-3 py-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500">
          Postings — append only
        </p>
      </div>
      <ul className="divide-y divide-grey-100">
        {lines.map((p) => {
          if (!p.reversed) running += p.amount + p.tax;
          const isReversal = p.kind === "reversal";
          return (
            <li
              key={p.id}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5",
                p.reversed && "opacity-55",
              )}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-base",
                    isReversal ? "text-brand-rose font-medium" : "text-ink-900",
                    p.reversed && "line-through",
                  )}
                >
                  {p.description}
                </p>
                <p className="text-2xs text-grey-500 tabular mt-0.5">
                  {dateShort(p.businessDate)} · {p.category}
                  {p.method ? ` · ${p.method}` : ""} · {p.user}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p
                  className={cn(
                    "text-base tabular font-medium",
                    isReversal ? "text-brand-rose"
                      : p.amount < 0 ? "text-success" : "text-ink-900",
                    p.reversed && "line-through",
                  )}
                >
                  {p.amount < 0 ? "−" : ""}{money(Math.abs(p.amount + p.tax))}
                </p>
                {!p.reversed && (
                  <p className="text-2xs text-grey-400 tabular">
                    bal {money(running)}
                  </p>
                )}
              </div>

              <ReverseButton
                hotelId={hotelId}
                stayId={stayId}
                posting={p}
                onDone={onChanged}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReverseButton({
  hotelId, stayId, posting, onDone,
}: {
  hotelId: string;
  stayId: string;
  posting: Posting;
  onDone: () => void;
}) {
  const permitted = useQuery({
    queryKey: ["reverse-allowed", hotelId, stayId, posting.id, posting.reversed],
    queryFn: () => reverseChargeAllowed(hotelId, stayId, posting.id),
  });
  const allowed = permitted.data?.allowed ?? false;

  const button = (
    <button
      type="button"
      disabled={!allowed}
      onClick={async () => {
        const res = await reverseCharge(hotelId, stayId, posting.id, USER);
        if (res.ok) {
          toast.success("Posting reversed", "The reversal is its own line — nothing was edited.");
          onDone();
        } else {
          toast.error("Could not reverse", res.reason);
        }
      }}
      aria-label={`Reverse ${posting.description}`}
      className={cn(
        "shrink-0 p-1.5 rounded-sm transition-colors duration-150",
        allowed
          ? "text-grey-400 hover:text-brand-rose hover:bg-brand-rose-50"
          : "text-grey-300 cursor-not-allowed",
      )}
    >
      <Undo2 className="size-3.5" />
    </button>
  );

  /* Disabled WITH a reason, never hidden. */
  return permitted.data?.reason ? (
    <Tooltip content={permitted.data.reason}>{button}</Tooltip>
  ) : (
    button
  );
}

function AddChargeDialog({
  hotelId, stay, businessDate, onDone,
}: {
  hotelId: string;
  stay: Stay;
  businessDate: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ChargeCategory>("Food");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [taxable, setTaxable] = useState(true);

  const value = Number(amount) || 0;
  const tax = taxable ? taxOn(value) : 0;
  const split = splitTax(value);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus className="size-4" />
          Add charge
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Post a charge"
        description={`Room ${stay.roomNumber} · ${stay.guest}`}
      >
        <div className="space-y-4">
          <Field label="Category">
            {({ id }) => (
              <NativeSelect
                id={id}
                value={category}
                onChange={(e) => setCategory(e.target.value as ChargeCategory)}
              >
                {CHARGE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </NativeSelect>
            )}
          </Field>

          <Field label="Description">
            {({ id }) => (
              <Input
                id={id}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Two coffees, room service"
              />
            )}
          </Field>

          <Field label="Amount" hint="Before tax">
            {({ id }) => (
              <Input
                id={id}
                numeric
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            )}
          </Field>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={taxable}
              onChange={(e) => setTaxable(e.target.checked)}
              className="size-4 rounded-xs accent-brand-orange"
            />
            <span className="text-base text-ink-900">
              Taxable — CGST 2.5% + SGST 2.5%
            </span>
          </label>

          {value > 0 && (
            <div className="rounded-md bg-grey-50 border border-grey-200 p-3 space-y-1">
              <Row label="Charge" value={money(value)} />
              {taxable && (
                <>
                  <Row label="CGST 2.5%" value={money(split.cgst)} muted />
                  <Row label="SGST 2.5%" value={money(split.sgst)} muted />
                </>
              )}
              <div className="pt-1 border-t border-grey-200">
                <Row label="Total" value={money(value + tax)} bold />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!description.trim() || value === 0}
              onClick={async () => {
                const res = await postCharge(hotelId, stay.id, {
                  category, description, amount: value, taxable, businessDate, user: USER,
                });
                if (res.ok) {
                  toast.success("Charge posted", `${money(value + tax)} on room ${stay.roomNumber}`);
                  setDescription(""); setAmount("");
                  setOpen(false);
                  onDone();
                } else {
                  toast.error("Could not post", res.reason);
                }
              }}
            >
              Post charge
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettleDialog({
  hotelId, stay, balance, businessDate, onDone,
}: {
  hotelId: string;
  stay: Stay;
  balance: number;
  businessDate: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [amount, setAmount] = useState("");

  const outstanding = Math.max(balance, 0);
  const value = Number(amount) || 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) setAmount(String(outstanding)); }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={balance <= 0}>
          <Receipt className="size-4" />
          Settle
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Settle folio"
        description={`${money(outstanding)} outstanding · ${stay.guest}`}
      >
        <div className="space-y-4">
          <Field label="Method">
            {({ id }) => (
              <NativeSelect
                id={id}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </NativeSelect>
            )}
          </Field>

          <Field
            label="Amount"
            hint={method === "Bill to company" ? "Transfers to the city ledger" : undefined}
          >
            {({ id }) => (
              <Input
                id={id}
                numeric
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            )}
          </Field>

          <div className="rounded-md bg-grey-50 border border-grey-200 p-3 space-y-1">
            <Row label="Outstanding" value={money(outstanding)} />
            <Row label="Paying" value={money(value)} muted />
            <div className="pt-1 border-t border-grey-200">
              <Row
                label="Remaining"
                value={money(Math.round((outstanding - value) * 100) / 100)}
                bold
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={value <= 0}
              onClick={async () => {
                const res = await settle(hotelId, stay.id, {
                  method, amount: value, businessDate, user: USER,
                });
                if (res.ok) {
                  toast.success(`${money(value)} received`, method);
                  setOpen(false);
                  onDone();
                } else {
                  toast.error("Could not settle", res.reason);
                }
              }}
            >
              Take payment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDialog({
  stay, lines, balance,
}: {
  stay: Stay;
  lines: Posting[];
  balance: number;
}) {
  const live = lines.filter((p) => !p.reversed && p.kind !== "payment");
  const net = live.reduce((t, p) => t + p.amount, 0);
  const tax = live.reduce((t, p) => t + p.tax, 0);
  const { rounded, adjustment } = roundOff(net + tax);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Printer className="size-4" />
          Invoice
        </Button>
      </DialogTrigger>
      <DialogContent title="Tax invoice" description="Print preview">
        {/* Georgia is retained for printed documents, and only there. */}
        <div className="print-serif bg-white border border-grey-200 rounded-md p-6">
          <p className="text-xl text-ink-900">Tax Invoice</p>
          <p className="text-base text-grey-600">5 Elements By Fidato Hotels</p>
          <p className="text-xs text-grey-500 mt-1">
            Akkalkot, Solapur District · GSTIN 27AAAAA0000A1Z5
          </p>

          <div className="mt-5 pt-4 border-t border-grey-200 space-y-1 text-base">
            <Row label="Guest" value={stay.guest} />
            <Row label="Room" value={`${stay.roomNumber} · ${stay.roomType}`} />
            <Row label="Stay" value={`${dateShort(stay.arrival)} – ${dateShort(stay.departure)}`} />
          </div>

          <ul className="mt-4 pt-4 border-t border-grey-200 space-y-1.5">
            {live.map((p) => (
              <li key={p.id} className="flex justify-between gap-4 text-base">
                <span className="text-grey-700 min-w-0 truncate">{p.description}</span>
                <span className="tabular shrink-0">{money(p.amount)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 pt-4 border-t border-grey-200 space-y-1">
            <Row label="Net" value={money(net)} />
            <Row label="CGST 2.5%" value={money(tax / 2)} muted />
            <Row label="SGST 2.5%" value={money(tax / 2)} muted />
            {adjustment !== 0 && (
              <Row label="Round off" value={money(adjustment)} muted />
            )}
            <div className="pt-1.5 border-t border-grey-200">
              <Row label="Total" value={money(rounded)} bold />
            </div>
            <Row
              label={balance > 0 ? "Outstanding" : "Paid"}
              value={money(Math.abs(balance))}
              muted
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CheckOutButton({
  allowed, reason, onCheckOut,
}: {
  allowed: boolean;
  reason?: string;
  onCheckOut: () => void;
}) {
  const button = (
    <Button
      className="w-full"
      disabled={!allowed}
      onClick={onCheckOut}
      data-checkout
    >
      <LogOut className="size-4" />
      Check out
    </Button>
  );

  return (
    <div className="space-y-2">
      {reason ? <Tooltip content={reason}>{button}</Tooltip> : button}
      {reason && (
        <p className="text-xs text-brand-red text-center" data-checkout-reason>
          {reason}
        </p>
      )}
    </div>
  );
}

function Row({
  label, value, muted, bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className={cn("text-sm", muted ? "text-grey-500" : "text-grey-700")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular shrink-0",
          bold ? "text-base font-semibold text-ink-900" : "text-sm text-ink-900",
        )}
      >
        {value}
      </span>
    </div>
  );
}
