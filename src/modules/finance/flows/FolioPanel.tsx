import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Undo2, Plus, Receipt, LogOut, Printer, ArrowLeftRight,
  Split as SplitIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";
import { money, dateShort } from "@/lib/format";
import {
  CHARGE_CATEGORIES, PAYMENT_METHODS,
  type ChargeCategory, type PaymentMethod,
} from "@/lib/rules";
import { getTaxRate } from "@/modules/finance/data/tax";
import {
  Button, Field, Input, NativeSelect, StatusPill, Tooltip, toast,
  Dialog, DialogContent, DialogTrigger,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel,
} from "@/components/ui";
import { getFolioPostings, getFolioBalance, postCharge, reverseCharge, settle, reverseChargeAllowed } from "@/modules/finance/data/postings";
import { checkOut, checkOutAllowed, earlyArrival } from "@/modules/front-desk";
import { type Posting, type Stay } from "@/data/repositories";
import { listStayFolios, openFolio, transferPosting, listBillingCompanies, type StayFolio } from "@/modules/finance/data/folios";
import { LateCheckOutFlow } from "@/modules/front-desk";
import { getStayBill } from "@/modules/finance/data/bill";
import { BillPrint } from "./BillPrint";

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

/* No `const USER = "front desk"` (MEMORY 256, as FD-2 did for check-in and
   the walk-in): the server never read it. A line is signed by whoever is
   signed in (`posted_by`, 101), and the bill prints that person's name. */

export function FolioPanel({
  hotelId, stay, businessDate,
}: {
  hotelId: string;
  stay: Stay;
  businessDate: string;
}) {
  const qc = useQueryClient();
  const [lateOut, setLateOut] = useState(false);
  const refresh = () => qc.invalidateQueries();

  /* D24-18: each act only for a role the server's gate lets do it (roleGate,
     from the one matrix): a charge or a second bill is invoice create, a
     payment payment create, a reversal or a move invoice edit, the check-out
     reservation edit. The interim bill is a read the server does not gate:
     whoever may see bills, invoice view (the owner's D25-29). */
  const role = useRole();
  const mayCharge = can(role, "create", "invoice");
  const mayChange = can(role, "edit", "invoice");
  const mayPay = can(role, "create", "payment");
  const mayPrint = can(role, "view", "invoice");
  const mayCheckOut = can(role, "edit", "reservation");

  const postings = useQuery({
    queryKey: ["folio-postings", hotelId, stay.id],
    queryFn: () => getFolioPostings(hotelId, stay.id),
  });
  const balance = useQuery({
    queryKey: ["folio-balance", hotelId, stay.id],
    queryFn: () => getFolioBalance(hotelId, stay.id),
  });
  /* The property's own clock and its late charge. Read here rather
     than passed down, because the dialog must show the real figure —
     a screen that says "₹1,000" while the property charges nothing is
     worse than one that says nothing. */
  const clock = useQuery({
    queryKey: ["early-arrival", hotelId],
    queryFn: () => earlyArrival(hotelId),
    enabled: !!hotelId,
  });

  const checkoutPermitted = useQuery({
    queryKey: ["checkout-allowed", hotelId, stay.id, balance.data],
    queryFn: () => checkOutAllowed(hotelId, stay.id),
    enabled: mayCheckOut,
  });
  const stayFolios = useQuery({
    queryKey: ["stay-folios", hotelId, stay.id],
    queryFn: () => listStayFolios(hotelId, stay.id),
  });

  /* null is every bill at once. A stay with one folio never sees the
     strip, so this stays null and the ledger reads exactly as before. */
  const [only, setOnly] = useState<string | null>(null);

  const folios = stayFolios.data ?? [];
  const all = postings.data ?? [];
  const lines = only === null ? all : all.filter((p) => p.folioId === only);
  /* null: no bill yet (D17-16). The header says so; settling and the
     invoice work on the zero they always did, since nothing is owed. */
  const billed = balance.data ?? null;
  const due = billed ?? 0;

  return (
    <div className="space-y-5">
      <BalanceHeader stay={stay} balance={billed} />

      <FolioStrip folios={folios} active={only} onPick={setOnly} />

      <LedgerList
        lines={lines}
        hotelId={hotelId}
        stayId={stay.id}
        folios={folios}
        mayChange={mayChange}
        onChanged={refresh}
      />

      <div className="flex flex-wrap gap-2">
        {mayCharge && (
          <AddChargeDialog
            hotelId={hotelId}
            stay={stay}
            businessDate={businessDate}
            onDone={refresh}
          />
        )}
        {mayPay && (
          <SettleDialog
            hotelId={hotelId}
            stay={stay}
            balance={due}
            businessDate={businessDate}
            onDone={refresh}
          />
        )}
        {mayPrint && <InvoiceDialog hotelId={hotelId} stayId={stay.id} />}
        {mayCharge && <SplitBillButton hotelId={hotelId} stayId={stay.id} onDone={refresh} />}
      </div>

      {lateOut && (
        <LateCheckOutFlow
          hotelId={hotelId}
          stay={stay}
          checkOutTime={clock.data?.checkOutTime ?? "check-out time"}
          charge={clock.data?.lateCharge ?? null}
          open
          onOpenChange={(o) => { if (!o) setLateOut(false); }}
          onDone={refresh}
        />
      )}

      {/* Rule 6 — blocked, visible, and it says why */}
      {mayCheckOut && <div className="pt-4 border-t border-grey-200">
        <CheckOutButton
          allowed={checkoutPermitted.data?.allowed ?? false}
          reason={checkoutPermitted.data?.reason}
          onCheckOut={async () => {
            const res = await checkOut(hotelId, stay.id);
            if (res.ok) {
              toast.success(`${stay.guest} checked out`, `Room ${stay.roomNumber} is now dirty and on housekeeping's board.`);
              refresh();
              return;
            }
            /* THE WAY THROUGH, not another toast.
               This refusal used to be a dead end: press, read why it
               will not work, press again. Five identical toasts stacked
               up in the owner's screenshot, which is what that loop
               looks like. Rule 6 says a blocked action is shown with
               its reason; it does not say the reason is the end of the
               conversation. */
            if (res.needs === "late-reason") {
              setLateOut(true);
              return;
            }
            toast.error("Could not check out", res.reason);
          }}
        />
      </div>}
    </div>
  );
}

/** The mark for a figure nobody has — the same one the stay table prints. */
const DASH_MARK = "-";

function BalanceHeader({ stay, balance }: { stay: Stay; balance: number | null }) {
  if (balance === null) {
    return (
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500">
            Balance
          </p>
          <p className="text-2xl font-semibold tabular mt-0.5 text-grey-500">{DASH_MARK}</p>
        </div>
        <div className="text-right">
          <StatusPill tone="neutral" dot>No bill yet</StatusPill>
          <p className="text-2xs text-grey-500 tabular mt-1.5">
            Room {stay.roomNumber} · {stay.reference}
          </p>
        </div>
      </div>
    );
  }
  const tone = balance > 0 ? "danger" : balance < 0 ? "info" : "success";
  const label = balance > 0 ? "Outstanding" : balance < 0 ? "Overpaid" : "Settled";
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500">
          Balance
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
  lines, hotelId, stayId, folios, mayChange, onChanged,
}: {
  lines: Posting[];
  hotelId: string;
  stayId: string;
  folios: StayFolio[];
  mayChange: boolean;
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
          Postings - append only
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
                  {p.method ? ` · ${p.method}` : ""} · {p.user ?? "-"}
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
                  <p className="text-2xs text-grey-500 tabular">
                    bal {money(running)}
                  </p>
                )}
              </div>

              {mayChange && (
                <>
                  <TransferButton
                    hotelId={hotelId}
                    posting={p}
                    folios={folios}
                    onDone={onChanged}
                  />
                  <ReverseButton
                    hotelId={hotelId}
                    stayId={stayId}
                    posting={p}
                    onDone={onChanged}
                  />
                </>
              )}
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
        const res = await reverseCharge(hotelId, stayId, posting.id);
        if (res.ok) {
          toast.success("Posting reversed", "The reversal is its own line - nothing was edited.");
          onDone();
        } else {
          toast.error("Could not reverse", res.reason);
        }
      }}
      aria-label={`Reverse ${posting.description}`}
      className={cn(
        "shrink-0 p-1.5 rounded-sm transition-colors duration-150",
        allowed
          ? "text-grey-500 hover:text-brand-rose hover:bg-brand-rose-50"
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

  /* THE RATE THIS CHARGE WILL REALLY CARRY, from the server's one slab rule.
     Everything the desk posts follows the room's GST (postings.ts), and a
     room's rate turns on the amount - so this asks for this amount. It
     printed "CGST 2.5% + SGST 2.5%" whatever the property had set, and
     whatever the charge came to (22 September). Nobody has set one: a dash,
     and the post is refused with the reason. */
  const rateQuery = useQuery({
    queryKey: ["tax-rate", hotelId, "room", value],
    queryFn: () => getTaxRate(hotelId, "room", value),
    enabled: open && taxable && !!hotelId,
    placeholderData: keepPreviousData,
  });
  const rate = rateQuery.data ? rateQuery.data.rate : undefined;
  const rateText = rateQuery.isError ? "not loaded"
    : rate === undefined ? "…"
    : rate === null ? "-" : `${rate}%`;
  const tax = !taxable ? 0 : typeof rate === "number" ? Math.round(value * rate) / 100 : null;
  /* CGST takes the half, SGST the rest - the bill's own split (app.stay_bill). */
  const cgst = tax === null ? null : Math.round((tax / 2) * 100) / 100;
  const half = typeof rate === "number" ? `${Math.round((rate / 2) * 100) / 100}%` : rateText;

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
            <span className="text-base text-ink-900" data-charge-rate>
              Taxable - GST {rateText}
            </span>
          </label>

          {value > 0 && (
            <div className="rounded-md bg-grey-50 border border-grey-200 p-3 space-y-1">
              <Row label="Charge" value={money(value)} />
              {taxable && (
                <>
                  <Row label={`CGST ${half}`}
                       value={cgst === null || tax === null ? "-" : money(cgst)} muted />
                  <Row label={`SGST ${half}`}
                       value={cgst === null || tax === null ? "-" : money(tax - cgst)} muted />
                </>
              )}
              <div className="pt-1 border-t border-grey-200">
                <Row label="Total" value={tax === null ? "-" : money(value + tax)} bold />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary"
              disabled={!description.trim() || value === 0}
              onClick={async () => {
                const res = await postCharge(hotelId, stay.id, {
                  category, description, amount: value, taxable, businessDate,
                });
                if (res.ok) {
                  toast.success("Charge posted", `${money(value + (tax ?? 0))} on room ${stay.roomNumber}`);
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
  const [pan, setPan] = useState("");
  const [form97, setForm97] = useState(false);

  const outstanding = Math.max(balance, 0);
  const value = Number(amount) || 0;
  /* D25-40 (Rule 159): more than ₹1,00,000 in cash at once needs the PAN or
     Form 97. The server decides, and refuses cash of ₹2,00,000 or more. */
  const asksPan = method === "Cash" && value > 100000;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) setAmount(String(outstanding)); }}
    >
      <DialogTrigger asChild>
        {/* THE BILL'S ONE MAIN ACTION is the next step: settle while money
            is owed, then check out (below) once it is not — never both
            orange at once. Not before arrival: then checking in, in the
            panel's header, is the act. */}
        <Button
          variant={balance > 0 && stay.status !== "due-in" ? "primary" : "secondary"}
          size="sm"
          disabled={balance <= 0}
        >
          <Receipt className="size-4" />
          Settle
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Settle bill"
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

          {asksPan && (
            <div className="space-y-3">
              <Field label="Guest's PAN"
                hint="More than ₹1,00,000 in cash at once needs it (Income-tax Rule 159). Not asked of a guest from abroad.">
                {({ id }) => (
                  <Input id={id} value={pan} disabled={form97} maxLength={10}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                    placeholder="ABCDE1234F" autoComplete="off" />
                )}
              </Field>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={form97}
                  onChange={(e) => setForm97(e.target.checked)}
                  className="size-4 rounded-xs accent-brand-orange" />
                <span className="text-base text-ink-900">No PAN: Form 97 taken</span>
              </label>
            </div>
          )}

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
            <Button variant="primary"
              disabled={value <= 0}
              onClick={async () => {
                const res = await settle(hotelId, stay.id, {
                  method, amount: value, businessDate,
                  ...(asksPan ? (form97 ? { form97 } : { pan }) : {}),
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

/* THE PRINTED BILL (D21-10). It fetches the one definition of the bill,
   `app.stay_bill`, only when the dialog opens, and draws it with the same
   layout the guest's page uses. It used to add up the lines here, with a
   made-up GSTIN and a fixed 2.5% printed on every bill, and counted a
   reversing line while leaving out the line it reversed (21 September).

   D22-7: it is the "Interim bill", as on the guest's page, before check-out
   and after (the owner, 24 September): it carries no invoice number, and
   "Tax Invoice" read as the final one. The numbered tax invoice is issued
   on Invoices. The button says the same words (D24-25). */
function InvoiceDialog({ hotelId, stayId }: { hotelId: string; stayId: string }) {
  const [open, setOpen] = useState(false);
  const bill = useQuery({
    queryKey: ["stay-bill", hotelId, stayId],
    queryFn: () => getStayBill(hotelId, stayId),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Printer className="size-4" />
          Interim bill
        </Button>
      </DialogTrigger>
      <DialogContent title="Interim bill" description="Print preview">
        {bill.data ? (
          <BillPrint bill={bill.data} title="Interim bill" />
        ) : bill.isError ? (
          <p className="text-sm text-brand-red">The bill could not be read. Try again.</p>
        ) : bill.isFetched ? (
          <p className="text-sm text-grey-600">This stay has no bill yet.</p>
        ) : (
          <p className="text-sm text-grey-600">One moment…</p>
        )}
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
      /* Primary only once it may happen — while it is blocked, Settle
         above is the step, and two orange buttons would say neither. */
      variant={allowed ? "primary" : "secondary"}
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

/* ══════════════════════════════════════════════════════════════════
   THE BILLS ON THIS STAY

   006 modelled two folios on one stay — "a company pays the room while
   the guest pays their own bar tab" — and nothing ever opened a second
   one. The commonest corporate arrangement in an Indian hotel was
   settled by issuing one bill and letting the company argue about the
   bar.

   Shown only once there is something to show. A leisure guest with one
   folio does not need a tab strip explaining that they have one bill,
   so the strip appears when a second folio exists and the button that
   creates one sits with the other actions.
   ══════════════════════════════════════════════════════════════════ */
function FolioStrip({
  folios, active, onPick,
}: {
  folios: StayFolio[];
  active: string | null;
  onPick: (id: string | null) => void;
}) {
  if (folios.length < 2) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1">
      <FolioTab
        label="Everything"
        balance={folios.reduce((n, f) => n + f.balance, 0)}
        active={active === null}
        onClick={() => onPick(null)}
      />
      {folios.map((f) => (
        <FolioTab
          key={f.id}
          /* A guest folio has no company and that is not a gap. */
          label={f.billTo === "company" ? f.company ?? "Company" : "Guest"}
          balance={f.balance}
          active={active === f.id}
          onClick={() => onPick(f.id)}
        />
      ))}
    </div>
  );
}

function FolioTab({ label, balance, active, onClick }: {
  label: string; balance: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 min-h-11 px-3.5 rounded-md border text-left",
        "transition-colors duration-150 cursor-pointer",
        active
          ? "border-brand-orange bg-brand-orange-50"
          : "border-grey-200 bg-white hover:border-grey-300",
      )}
    >
      <span className="block text-sm text-grey-600">{label}</span>
      <span className="block text-base tabular font-medium text-ink-900">
        {money(balance)}
      </span>
    </button>
  );
}

/** Open a second bill on this stay. */
function SplitBillButton({ hotelId, stayId, onDone }: {
  hotelId: string; stayId: string; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

  /* listCompanies() is the DIRECTORY's accounts report — it merges the
     companies table with booking sources and keys the result by a
     slug, so its id is not a uuid and the insert failed with
     `invalid input syntax for type uuid: "fidato-hotels"`. */
  const companies = useQuery({
    queryKey: ["billing-companies", hotelId],
    queryFn: () => listBillingCompanies(hotelId),
    enabled: open,
  });

  const save = async () => {
    setBusy(true);
    const res = await openFolio(hotelId, stayId, {
      billTo: "company", companyId,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not opened", res.reason);
    toast.success(
      "Second bill opened",
      "Move charges onto it from the ledger above.",
    );
    setOpen(false);
    onDone();
  };

  const list = companies.data ?? [];

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <SplitIcon className="size-4" />
        Split the bill
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Split the bill"
          description="A second bill on this stay, settled by a company."
        >
          {list.length === 0 ? (
            /* No invented company, and no free-text one either: a
               company on a bill is a GSTIN and an address on a
               statutory document, not a name somebody typed. */
            <p className="text-base text-grey-600">
              No companies are on file yet. Add one under Companies
              first - a company bill carries their GSTIN and address.
            </p>
          ) : (
            <div className="space-y-4">
              <Field label="Who is paying the second bill?" required>
                {({ id }) => (
                  <NativeSelect
                    id={id}
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                  >
                    <option value="">Choose a company…</option>
                    {list.map((co) => (
                      <option key={co.id} value={co.id}>{co.name}</option>
                    ))}
                  </NativeSelect>
                )}
              </Field>

              <div className="flex justify-end">
                <Button variant="primary"
                  onClick={() => void save()}
                  disabled={busy || !companyId}
                >
                  Open the second bill
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Move one charge onto another bill on this stay. */
function TransferButton({
  hotelId, posting, folios, onDone,
}: {
  hotelId: string; posting: Posting; folios: StayFolio[]; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  /* Nothing to move it to, nothing to move. A payment stays where it
     was taken and a reversed line no longer exists — both refused by
     the server too, but a button that only ever says no is worse than
     no button. */
  const targets = folios.filter(
    (f) => f.id !== posting.folioId && f.status === "open",
  );
  if (
    targets.length === 0
    || posting.reversed
    || posting.kind !== "charge"
  ) return null;

  const move = async (toFolioId: string) => {
    setBusy(true);
    const res = await transferPosting(hotelId, posting.id, toFolioId);
    setBusy(false);
    if (!res.ok) return toast.error("Not moved", res.reason);
    toast.success(
      "Moved",
      "Reversed on one bill and posted on the other - nothing was edited.",
    );
    onDone();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label={`Move ${posting.description} to another bill`}
          className={cn(
            "shrink-0 flex items-center justify-center size-9 rounded-md",
            "text-grey-500 hover:text-ink-900 hover:bg-grey-50",
            "cursor-pointer transition-colors duration-150",
          )}
        >
          <ArrowLeftRight className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {targets.map((f) => (
          <DropdownMenuItem key={f.id} onSelect={() => void move(f.id)}>
            {f.billTo === "company" ? f.company ?? "Company" : "Guest"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
