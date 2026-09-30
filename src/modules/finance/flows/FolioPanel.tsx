import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Undo2, Plus, Receipt, LogOut, Printer, ArrowLeftRight, Pencil,
  Split as SplitIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";
import { money, moneyPrecise, dateShort } from "@/lib/format";
import {
  CHARGE_CATEGORIES, PAYMENT_METHODS,
  type ChargeCategory, type PaymentMethod,
} from "@/lib/rules";
import { getRateBeforeGst, getTaxRate } from "@/modules/finance/data/tax";
import {
  Button, Checkbox, Field, Input, NativeSelect, StatusPill, Tooltip, toast, Textarea, fieldProps,
  Dialog, DialogContent, DialogTrigger,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel,
} from "@/components/ui";
import { getFolioPostings, getFolioBalance, postCharge, reverseCharge, settle, reverseChargeAllowed, editCharge, changeRate, type BillLine } from "@/modules/finance/data/postings";
import { checkOut, checkOutAllowed, earlyArrival } from "@/modules/front-desk";
import { type Posting, type Stay } from "@/data/repositories";
import { listStayFolios, openFolio, transferPosting, listBillingCompanies, type StayFolio } from "@/modules/finance/data/folios";
import { LateCheckOutFlow } from "@/modules/front-desk";
import { getStayBill } from "@/modules/finance/data/bill";
import { billSections, sectionsTotal } from "@/modules/finance/sections";
import { BillPrint } from "./BillPrint";
import { useGroupSettings } from "@/modules/admin";

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
  /* Form III: where a foreign guest goes next, asked at check-out while
     they are at the desk (D27-25). The server refuses without it. */
  const foreign = (stay.nationality ?? "IN").toUpperCase() !== "IN";
  const [nextDestination, setNextDestination] = useState("");
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
  /* D27-157: the owner, an administrator or the GM - `approve` on a booking,
     the three who correct a closed day (the server asks the same). */
  const mayEdit = can(role, "approve", "reservation");

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
  const toCome = useStayDue(hotelId, stay);

  return (
    <div className="space-y-5">
      <BalanceHeader stay={stay} balance={billed} toCome={toCome} />

      <FolioStrip folios={folios} active={only} onPick={setOnly} />

      <LedgerList
        lines={lines}
        toCome={toCome}
        closing={closing(billed, toCome)}
        hotelId={hotelId}
        stayId={stay.id}
        folios={folios}
        mayChange={mayChange}
        mayEdit={mayEdit}
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
            folios={folios}
            active={only}
            businessDate={businessDate}
            onDone={refresh}
          />
        )}
        {mayPrint && <InvoiceDialog hotelId={hotelId} stayId={stay.id} />}
        {mayCharge && <SplitBillButton hotelId={hotelId} stayId={stay.id} onDone={refresh} />}
        {mayEdit && <ChangeRateButton hotelId={hotelId} stay={stay} onDone={refresh} />}
      </div>

      {lateOut && (
        <LateCheckOutFlow
          hotelId={hotelId}
          stay={stay}
          checkOutTime={clock.data?.checkOutTime ?? "check-out time"}
          charge={clock.data?.lateCharge ?? null}
          nextDestination={nextDestination}
          open
          onOpenChange={(o) => { if (!o) setLateOut(false); }}
          onDone={refresh}
        />
      )}

      {/* Rule 6 — blocked, visible, and it says why */}
      {mayCheckOut && <div className="pt-4 border-t border-grey-200 space-y-3">
        {foreign && (
          <Field label="Next destination" required
            hint="Form III reports where a foreign guest goes next.">
            {({ id }) => (
              <Input id={id} value={nextDestination}
                onChange={(e) => setNextDestination(e.target.value)} />
            )}
          </Field>
        )}
        <CheckOutButton
          allowed={(checkoutPermitted.data?.allowed ?? false)
                   && (!foreign || Boolean(nextDestination.trim()))}
          reason={checkoutPermitted.data?.reason}
          guest={stay.guest}
          room={stay.roomNumber}
          onCheckOut={async () => {
            const res = await checkOut(hotelId, stay.id, undefined, nextDestination.trim());
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

/** The bill's one closing figure and its word: the headline, and the last row
    under the sections (D27-200). */
function closing(balance: number | null, toCome: ToCome | null): { label: string; amount: number | null } {
  if (toCome) {
    const a = toCome.after;
    return { label: a === null || a > 0 ? "Due" : a < 0 ? "Overpaid" : "Settled", amount: a };
  }
  if (balance === null) return { label: "Balance", amount: null };
  return { label: balance > 0 ? "Outstanding" : balance < 0 ? "Overpaid" : "Settled", amount: balance };
}

function BalanceHeader({ stay, balance, toCome }: {
  stay: Stay; balance: number | null; toCome: ToCome | null;
}) {
  /* WHILE CHARGES ARE TO COME, THE HEADLINE IS WHAT IS DUE WITH THEM COUNTED
     (the owner's D27-199): the bill said "₹1,001 Overpaid" above a box saying
     ₹2,882.95 was due. The posted balance alone is not what the guest owes
     until the night audit has posted the night. */
  if (toCome) {
    const { after, received } = toCome;
    const { label } = closing(balance, toCome);
    return (
      <div className="flex items-baseline justify-between gap-4 flex-wrap" data-bill-headline>
        <div>
          <p className="text-sm font-medium text-grey-600">{label}</p>
          <p className={cn("text-2xl font-semibold tabular tracking-[-0.022em] mt-0.5",
            after === null ? "text-grey-500" : after > 0 ? "text-danger" : after < 0 ? "text-info" : "text-success")}>
            {after === null ? DASH_MARK : moneyPrecise(Math.abs(after))}
          </p>
          {received > 0 && (
            <p className="text-sm text-grey-600 tabular mt-0.5">Received {moneyPrecise(received)}</p>
          )}
        </div>
        <div className="text-right">
          <StatusPill tone="neutral" dot>Charges to come</StatusPill>
          <p className="text-2xs text-grey-500 tabular mt-1.5">
            Room {stay.roomNumber} · {stay.reference}
          </p>
        </div>
      </div>
    );
  }
  if (balance === null) {
    return (
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium text-grey-600">
            Balance
          </p>
          <p className="text-2xl font-semibold tabular tracking-[-0.022em] mt-0.5 text-grey-500">{DASH_MARK}</p>
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
        <p className="text-sm font-medium text-grey-600">
          Balance
        </p>
        <p
          className={cn(
            "text-2xl font-semibold tabular tracking-[-0.022em] mt-0.5",
            balance > 0 ? "text-danger" : balance < 0 ? "text-info" : "text-success",
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

/* CHARGES TO COME (D27-187): the nights the night audit has not posted yet,
   at the agreed rate with GST by the slab, a night rounded as the audit rounds
   it. Shown, never posted, and the balance due once they are, the advance
   counted, so the desk sees what is owed from check-in. HOW MANY NIGHTS is the
   server's answer, by the audit's own rule (`nightsToCome` on the bill, the
   review of 1 October): this counted the room lines on the stay's own bills,
   so a room billed to its group showed every night as to come, and a reversed
   night too (FIN-24). A rate with no GST rule gives a dash, and then no
   balance (no default price). Worked out once, for the headline and the box
   under the lines (D27-199). */
export interface ToCome {
  nights: number; rate: number; pct: number | null | undefined;
  /** Rupees. `tax` and `after` are null where no GST rule covers the rate. */
  charges: number; tax: number | null; after: number | null;
  /** What has been received on this bill, reversals taken off. */
  received: number;
}

function useChargesToCome(
  hotelId: string, stay: Stay, lines: BillLine[], balance: number | null, nights: number,
): ToCome | null {
  const rate = stay.offeredTariff;
  const shown = nights > 0 && !stay.isComplimentary && rate > 0
    && ["due-in", "in-house", "due-out"].includes(stay.status);
  const gst = useQuery({
    queryKey: ["tax-rate", hotelId, "room", rate],
    queryFn: () => getTaxRate(hotelId, "room", rate),
    enabled: shown,
  });
  if (!shown) return null;

  const paise = (n: number) => Math.round(n * 100);
  const pct = gst.data?.rate;
  const charges = paise(rate) * nights;
  const tax = pct == null ? null : Math.round(paise(rate) * pct / 100) * nights;
  return {
    nights, rate, pct,
    charges: charges / 100,
    tax: tax === null ? null : tax / 100,
    after: tax === null ? null : (paise(balance ?? 0) + charges + tax) / 100,
    received: (-lines.filter((l) => l.category === "payment").reduce((n, l) => n + paise(l.amount), 0) / 100) || 0,
  };
}

/** What a stay owes with its charges to come counted, or null when none are
    to come (D27-199). THE ONE FIGURE: the Bill tab's headline, its box and the
    stay panel's foot all read this, from the Bill tab's own two reads (one
    cache), so they cannot disagree. */
export function useStayDue(hotelId: string, stay: Stay): ToCome | null {
  const postings = useQuery({
    queryKey: ["folio-postings", hotelId, stay.id],
    queryFn: () => getFolioPostings(hotelId, stay.id),
  });
  const balance = useQuery({
    queryKey: ["folio-balance", hotelId, stay.id],
    queryFn: () => getFolioBalance(hotelId, stay.id),
  });
  const bill = useQuery({
    queryKey: ["stay-bill", hotelId, stay.id],
    queryFn: () => getStayBill(hotelId, stay.id),
  });
  return useChargesToCome(hotelId, stay, postings.data ?? [], balance.data ?? null,
    bill.data?.nightsToCome ?? 0);
}

function ChargesToCome({ toCome }: { toCome: ToCome | null }) {
  if (!toCome) return null;
  const { nights, rate, pct, charges, tax, after } = toCome;

  return (
    <section className="rounded-lg border border-dashed border-grey-300 p-3 space-y-1.5" data-charges-to-come>
      <p className="text-sm font-medium text-ink-900">
        Charges to come <span className="font-normal text-grey-500">· not posted yet</span>
      </p>
      <div className="flex justify-between gap-4 text-sm text-grey-700">
        <span>{nights} {nights === 1 ? "night" : "nights"} × {moneyPrecise(rate)}</span>
        <span className="tabular">{moneyPrecise(charges)}</span>
      </div>
      <div className="flex justify-between gap-4 text-sm text-grey-700">
        <span>GST{pct == null ? "" : ` ${pct}%`}</span>
        <span className="tabular">{tax === null ? DASH_MARK : moneyPrecise(tax)}</span>
      </div>
      <div className="flex justify-between gap-4 pt-1.5 border-t border-grey-200 text-base font-semibold text-ink-900">
        <span>Due once they are posted</span>
        <span className="tabular">{after === null ? DASH_MARK : moneyPrecise(after)}</span>
      </div>
      <p className="text-xs text-grey-500">
        The first night is posted at check-in, each later night by the night audit. The advance and anything paid are counted.
      </p>
    </section>
  );
}

/* THE BILL IN SECTIONS (the owner's D27-200): Room with GST, Restaurant with
   GST, Bar with VAT, then other charges - each with its lines, its subtotal
   and its tax - then the total, the payments received and what is due. The
   ledger is still append-only and every line is still here: a reversed line
   stays struck through with its reversal right under it, in its section.
   Where a line sits and what a section comes to is finance's one rule
   (sections.ts), the printed bill's too. A line shows its amount before tax,
   so a section's lines add up to its subtotal; the running balance under
   each line went, the subtotals, the total and the closing row replace it. */
function LedgerList({
  lines, toCome, closing: close, hotelId, stayId, folios, mayChange, mayEdit, onChanged,
}: {
  lines: BillLine[];
  toCome: ToCome | null;
  closing: { label: string; amount: number | null };
  hotelId: string;
  stayId: string;
  folios: StayFolio[];
  mayChange: boolean;
  mayEdit: boolean;
  onChanged: () => void;
}) {
  if (lines.length === 0 && !toCome) {
    return (
      <p className="text-sm text-grey-500 py-6 text-center">
        Nothing posted to this folio yet.
      </p>
    );
  }

  /* A reversal is listed right under the line it reverses. It is in the same
     section by itself: the database gives a reversal its line's tax scheme
     (125's trigger), and the reversal copies the category. */
  const ids = new Set(lines.map((l) => l.id));
  const ordered = [
    ...lines.filter((l) => !l.reversalOf)
      .flatMap((l) => [l, ...lines.filter((r) => r.reversalOf === l.id)]),
    ...lines.filter((r) => r.reversalOf && !ids.has(r.reversalOf)),
  ];
  const payments = ordered.filter((l) => l.category === "payment");
  const sections = billSections(ordered.filter((l) => l.category !== "payment"), toCome ? ["room"] : []);
  /* `|| 0`: a payment and its reversal come to minus zero, which prints "-₹0.00". */
  const received = (-payments.reduce((n, l) => n + Math.round(l.amount * 100), 0) / 100) || 0;

  const row = (p: BillLine) => {
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

        <p
          className={cn(
            "text-base tabular font-medium text-right shrink-0",
            isReversal ? "text-brand-rose"
              : p.amount < 0 ? "text-success" : "text-ink-900",
            p.reversed && "line-through",
          )}
        >
          {p.amount < 0 ? "−" : ""}{moneyPrecise(Math.abs(p.amount))}
        </p>

        {mayEdit && (
          <EditButton hotelId={hotelId} stayId={stayId} posting={p} onDone={onChanged} />
        )}
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
  };
  const heading = (title: string) => (
    <div className="bg-grey-50 border-b border-grey-200 px-3 py-2">
      <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500">{title}</p>
    </div>
  );
  const sum = (label: string, amount: string, strong = false) => (
    <div key={label} className={cn("flex justify-between gap-4",
      strong ? "text-base font-semibold text-ink-900" : "text-sm text-grey-700")}>
      <dt>{label}</dt>
      <dd className="tabular">{amount}</dd>
    </div>
  );

  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <section key={s.key} className="border border-grey-200 rounded-lg overflow-hidden" data-bill-section={s.key}>
          {heading(s.title)}
          {s.lines.length > 0 && <ul className="divide-y divide-grey-100">{s.lines.map(row)}</ul>}
          {s.key === "room" && toCome && (
            <div className="p-3 border-t border-grey-100"><ChargesToCome toCome={toCome} /></div>
          )}
          {/* Room with only charges to come has nothing posted to add up. */}
          {s.lines.length > 0 && (
            <dl className="border-t border-grey-200 px-3 py-2 space-y-1">
              {sum("Subtotal", moneyPrecise(s.subtotal))}
              {s.taxes.map((t) => sum(t.label, moneyPrecise(t.amount)))}
            </dl>
          )}
        </section>
      ))}

      {sections.length > 0 && (
        <dl className="px-3" data-bill-total>
          {sum("Total charges", moneyPrecise(sectionsTotal(sections)), true)}
        </dl>
      )}

      {payments.length > 0 && (
        <section className="border border-grey-200 rounded-lg overflow-hidden" data-bill-section="payments">
          {heading("Payments received")}
          <ul className="divide-y divide-grey-100">{payments.map(row)}</ul>
          <dl className="border-t border-grey-200 px-3 py-2">
            {sum("Received", moneyPrecise(received))}
          </dl>
        </section>
      )}

      <dl className="px-3" data-bill-closing>
        {sum(close.label, close.amount === null ? DASH_MARK : moneyPrecise(Math.abs(close.amount)), true)}
      </dl>
    </div>
  );
}

/* EDIT A CHARGE (the owner's D27-157, D27-162): its price, its words or both,
   with a reason, in one step - the server reverses the old line with the
   reason and posts the corrected one, so the bill keeps both. Off, with the
   reason, where the server would refuse: a closed day (Closed days corrects
   it), a tax invoice on the bill (a credit note does). A payment, a reversal
   or a line already reversed has nothing to edit, so no pencil. A room
   night's words count its nights, so only its price changes. */
function EditButton({
  hotelId, stayId, posting, onDone,
}: {
  hotelId: string; stayId: string; posting: BillLine; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState(posting.description);
  const [price, setPrice] = useState(String(posting.amount));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (posting.kind !== "charge" || posting.reversed || !(posting.amount > 0)
      || ["discount", "refund", "tax"].includes(posting.category)) return null;

  const room = posting.category === "room";
  const why = posting.dayClosed ? "This day is closed - correct it on Closed days."
    : posting.invoice ? `This bill has tax invoice ${posting.invoice}. Only a credit note corrects it now.`
    : null;
  const value = Number(price);
  const changed = words.trim() !== posting.description || value !== posting.amount;

  const save = async () => {
    setBusy(true);
    const res = await editCharge(hotelId, stayId, posting.id,
      { description: words.trim(), amount: value, reason: reason.trim() });
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success("Charge corrected", "The old line is reversed with the reason, and the corrected one posted.");
    setOpen(false); setReason("");
    onDone();
  };

  const button = (
    <button
      type="button"
      disabled={!!why}
      onClick={() => setOpen(true)}
      aria-label={`Edit ${posting.description}`}
      className={cn(
        "shrink-0 grid place-items-center size-9 pointer-coarse:size-11 rounded-full transition-colors duration-150",
        why ? "text-grey-300 cursor-not-allowed" : "text-grey-500 hover:text-ink-900 hover:bg-grey-50",
      )}
    >
      <Pencil className="size-4" />
    </button>
  );

  return (
    <>
      {why ? <Tooltip content={why}>{button}</Tooltip> : button}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Edit this charge"
          description={`${posting.description} · ${moneyPrecise(posting.amount + posting.tax)}`}
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
              <Button variant="primary" loading={busy}
                disabled={!reason.trim() || !(value > 0) || !words.trim() || !changed}
                onClick={() => void save()}>
                Correct the charge
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Words" {...(room ? { hint: "A room night's words count its nights, so only its price changes." } : {})}>
              {(f) => (
                <Input {...fieldProps(f)} value={words} disabled={room}
                  onChange={(e) => setWords(e.target.value)} />
              )}
            </Field>
            <Field label="Price before tax"
              hint={room ? "The tax follows the room's slab on the price a night." : "The tax stays at the rate it was charged."}>
              {(f) => (
                <Input {...fieldProps(f)} numeric inputMode="decimal" value={price}
                  onChange={(e) => setPrice(e.target.value)} />
              )}
            </Field>
            <Field label="Why" required hint="Kept on the reversed line. The guest's bill never shows it.">
              {(f) => (
                <Textarea {...fieldProps(f)} rows={2} value={reason}
                  onChange={(e) => setReason(e.target.value)} />
              )}
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* CHANGE THE RATE (the owner's D27-157, D27-162): a new rate a night, with a
   reason. Every night already charged is corrected to it - a closed day's
   through Closed days, where it shows with its old and new figures - and
   the night audit charges the nights to come at it. All or nothing: if one
   night cannot be corrected, the server says which and nothing changes. */
function ChangeRateButton({
  hotelId, stay, onDone,
}: {
  hotelId: string; stay: Stay; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Change rate</Button>
      <ChangeRateDialog hotelId={hotelId} stay={stay} open={open} onOpenChange={setOpen} onDone={onDone} />
    </>
  );
}

/** The same dialog, opened from the booking panel's menu before check-in too
    (D27-187): the agreed rate changes, and with nothing charged yet nothing
    is posted. */
export function ChangeRateDialog({
  hotelId, stay, open, onOpenChange: setOpen, onDone,
}: {
  hotelId: string; stay: Stay; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void;
}) {
  const [rate, setRate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const value = Number(rate);
  /* "Includes GST" (D27-199), as on the booking page: the typed figure is
     all-in and the server splits it - shown here before it is kept. */
  const [inclusive, setInclusive] = useState(false);
  const split = useQuery({
    queryKey: ["before-gst", hotelId, value],
    queryFn: () => getRateBeforeGst(hotelId, value),
    enabled: open && inclusive && value > 0,
  });
  const s = inclusive && value > 0 ? split.data : undefined;
  const refused = s && !s.ok ? s.reason : null;
  const kept = s?.ok ? s.pre : value;

  const save = async () => {
    setBusy(true);
    const res = await changeRate(hotelId, stay.id,
      { rate: value, reason: reason.trim(), ...(inclusive ? { includesGst: true } : {}) });
    setBusy(false);
    if (!res.ok) return toast.error("Rate not changed", res.reason);
    const n = res.data?.corrected ?? 0;
    const said = inclusive ? `${moneyPrecise(kept)} a night before GST` : `${money(value)} a night`;
    toast.success("Rate changed", n === 0
      ? `${said}, for every night not yet charged.`
      : `${said}; ${n} charged ${n === 1 ? "line" : "lines"} corrected.`);
    setOpen(false); setRate(""); setReason(""); setInclusive(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        title="Change the rate"
        description={`${stay.guest} · now ${stay.isComplimentary ? "complimentary" : `${money(stay.offeredTariff)} a night`}`}
        size="sm"
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
            <Button variant="primary" loading={busy}
              disabled={!(value > 0) || !reason.trim() || refused !== null || (inclusive && !s)}
              onClick={() => void save()}>
              Change the rate
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div data-rate-inclusive>
            <Field label="New rate a night" required
              hint={inclusive ? "With GST. It is split by the room's GST slab before it is kept."
                : "Before tax. The room's GST slab follows it."}>
              {(f) => (
                <Input {...fieldProps(f)} numeric inputMode="decimal" value={rate}
                  onChange={(e) => setRate(e.target.value)} />
              )}
            </Field>
            <Checkbox checked={inclusive} onCheckedChange={setInclusive} label="Includes GST" className="mt-2" />
            {s?.ok && (
              <p className="mt-1.5 text-sm text-grey-600" data-rate-split>
                {s.total < value
                  ? `${moneyPrecise(value)} can't split exactly: the bill will say ${moneyPrecise(s.total)} a night.`
                  : `${moneyPrecise(s.pre)} a night + ${moneyPrecise(s.total - s.pre)} GST (${s.rate}%).`}
              </p>
            )}
            {refused && <p className="mt-1.5 text-sm text-warning-dark" data-rate-split>{refused}</p>}
          </div>
          <p className="text-sm text-grey-700 leading-relaxed">
            Nights already charged are corrected to it, with this reason - a closed
            day's on Closed days. Nights still to come are charged at it.
          </p>
          <Field label="Why" required hint="Kept with every night it corrects.">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={2} value={reason}
                onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
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
  /* D27-125: a payment is reversed by the owner, an administrator, the GM or
     the accountant - `approve` on an invoice, the server's own question. */
  const role = useRole();
  const payment = posting.kind === "payment";
  const managerOnly = payment && !can(role, "approve", "invoice")
    ? "Reversing a payment is for the owner, an administrator, the general manager or the accountant."
    : null;
  const allowed = (permitted.data?.allowed ?? false) && !managerOnly;
  const why = managerOnly ?? permitted.data?.reason;

  /* D27-117: "Are you sure?", with a required reason (QA FI-5). It went at
     once on one click. */
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const reverse = async () => {
    setBusy(true);
    const res = await reverseCharge(hotelId, stayId, posting.id, reason.trim());
    setBusy(false);
    if (res.ok) {
      toast.success("Posting reversed", "The reversal is its own line - nothing was edited.");
      setOpen(false); setReason("");
      onDone();
    } else {
      toast.error("Could not reverse", res.reason);
    }
  };

  const button = (
    <button
      type="button"
      disabled={!allowed}
      onClick={() => setOpen(true)}
      aria-label={`Reverse ${posting.description}`}
      className={cn(
        "shrink-0 grid place-items-center size-9 pointer-coarse:size-11 rounded-full transition-colors duration-150",
        allowed
          ? "text-grey-500 hover:text-brand-rose hover:bg-brand-rose-50"
          : "text-grey-300 cursor-not-allowed",
      )}
    >
      <Undo2 className="size-4" />
    </button>
  );

  /* Disabled WITH a reason, never hidden. */
  return (
    <>
      {why ? <Tooltip content={why}>{button}</Tooltip> : button}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={payment ? "Reverse this payment?" : "Reverse this charge?"}
          description={`${posting.description} · ${moneyPrecise(Math.abs(posting.amount + posting.tax))}`}
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
              <Button variant="danger" loading={busy} disabled={!reason.trim()}
                onClick={() => void reverse()}>
                Reverse
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-grey-700 leading-relaxed">
              {payment
                ? "The receipt stays on the bill, struck through, and the money is owed again."
                : "The charge stays on the bill, struck through, and comes off the balance."}
              {" "}Nothing is deleted - the reversal is its own line.
            </p>
            <Field label="Why" required hint="Kept on the reversal's line. The guest's bill never shows it.">
              {(f) => (
                <Textarea {...fieldProps(f)} rows={2} value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Posted to the wrong room" />
              )}
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
  /* ONE PRESS, ONE CHARGE (28 September): the button waits while it is
     sent, and a repeat carries the same key until one has landed. */
  const [saving, setSaving] = useState(false);
  const [pressKey, setPressKey] = useState(() => crypto.randomUUID());

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
  /* The previous amount's rate is not this amount's (QA FI-11): ₹8,000 then
     ₹150 pasted kept 18% on screen while 5% was stored. While it asks,
     "…", and Post waits. */
  const rate = rateQuery.data && !rateQuery.isPlaceholderData ? rateQuery.data.rate : undefined;
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
            <div className="rounded-lg bg-grey-50 border border-grey-200 p-3 space-y-1">
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
              /* More than zero (QA FI-4, FI-20). */
              disabled={!description.trim() || !(value > 0)}
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const res = await postCharge(hotelId, stay.id, {
                    category, description, amount: value, taxable, businessDate,
                  }, pressKey);
                  if (res.ok) {
                    setPressKey(crypto.randomUUID());
                    /* What was STORED, not the preview (FI-11). */
                    toast.success("Charge posted", `${res.data
                      ? money(res.data.amount + res.data.tax) : money(value + (tax ?? 0))} on room ${stay.roomNumber}`);
                    setDescription(""); setAmount("");
                    setOpen(false);
                    onDone();
                  } else {
                    toast.error("Could not post", res.reason);
                  }
                } finally {
                  setSaving(false);
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
  hotelId, stay, balance, folios, active, businessDate, onDone,
}: {
  hotelId: string;
  stay: Stay;
  balance: number;
  /** The stay's bills, and the one whose tab is open (null: Everything). */
  folios: StayFolio[];
  active: string | null;
  businessDate: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  /* A SPLIT BILL IS SETTLED ONE BILL AT A TIME (QA FI-2, FI-3): the dialog
     asked for the whole stay and the payment landed on the guest's bill
     whichever tab was open. Now it works on the bill whose tab is open -
     or, on Everything, the first that owes - and says which. */
  const split = folios.length > 1;
  const [folioId, setFolioId] = useState<string | null>(null);
  const owedOn = (id: string | null) =>
    Math.max(split ? folios.find((f) => f.id === id)?.balance ?? 0 : balance, 0);
  const pick = () => (split ? active ?? folios.find((f) => f.balance > 0)?.id ?? folios[0]!.id : null);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [amount, setAmount] = useState("");
  const [pan, setPan] = useState("");
  const [form97, setForm97] = useState(false);
  const [asCredit, setAsCredit] = useState(false);
  /* ONE PRESS, ONE PAYMENT (28 September), as Post charge. */
  const [saving, setSaving] = useState(false);
  const [pressKey, setPressKey] = useState(() => crypto.randomUUID());

  const outstanding = owedOn(folioId);
  const value = Number(amount) || 0;
  /* D27-4: more than the bill is held as the guest's credit, once the desk
     ticks that it is. The server asks the same (needs "credit"). */
  const extra = Math.round((value - outstanding) * 100) / 100;
  /* D25-40 (Rule 159): more than ₹1,00,000 in cash at once needs the PAN or
     Form 97. The server decides, and refuses cash of ₹2,00,000 or more. */
  const asksPan = method === "Cash" && value > 100000;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { const id = pick(); setFolioId(id); setAmount(String(owedOn(id))); }
      }}
    >
      <DialogTrigger asChild>
        {/* THE BILL'S ONE MAIN ACTION is the next step: settle while money
            is owed, then check out (below) once it is not — never both
            orange at once. Not before arrival: then checking in, in the
            panel's header, is the act. */}
        <Button
          variant={balance > 0 && stay.status !== "due-in" ? "primary" : "secondary"}
          size="sm"
          disabled={split ? !folios.some((f) => f.balance > 0) : balance <= 0}
        >
          <Receipt className="size-4" />
          Settle
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Settle bill"
        description={`${money(outstanding)} outstanding · ${
          split ? billName(folios.find((f) => f.id === folioId)) : stay.guest}`}
      >
        <div className="space-y-4">
          {split && (
            <Field label="Which bill">
              {({ id }) => (
                <NativeSelect
                  id={id}
                  value={folioId ?? ""}
                  onChange={(e) => {
                    setFolioId(e.target.value);
                    setAmount(String(owedOn(e.target.value)));
                    setAsCredit(false);
                  }}
                >
                  {folios.map((f) => (
                    <option key={f.id} value={f.id}>{billName(f)} - {money(f.balance)}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
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
                onChange={(e) => { setAmount(e.target.value); setAsCredit(false); }}
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

          {extra > 0 && (
            <div className="rounded-lg bg-brand-yellow-50 border border-brand-yellow-100 p-3 space-y-2">
              <p className="text-sm text-brand-yellow-800" data-credit-warning>
                This is {moneyPrecise(extra)} more than the bill; it will be held as the guest's credit.
              </p>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={asCredit}
                  onChange={(e) => setAsCredit(e.target.checked)}
                  className="size-4 rounded-xs accent-brand-orange" />
                <span className="text-base text-ink-900">Hold it as the guest's credit</span>
              </label>
            </div>
          )}

          <div className="rounded-lg bg-grey-50 border border-grey-200 p-3 space-y-1">
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
              disabled={value <= 0 || (extra > 0 && !asCredit)}
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const res = await settle(hotelId, stay.id, {
                    method, amount: value, businessDate,
                    ...(asksPan ? (form97 ? { form97 } : { pan }) : {}),
                    ...(extra > 0 ? { heldAsCredit: true } : {}),
                    ...(split && folioId ? { folioId } : {}),
                  }, pressKey);
                  if (res.ok) {
                    setPressKey(crypto.randomUUID());
                    toast.success(`${money(value)} received`, method);
                    /* NOTHING LEFT TO TAKE AGAIN (speed finding 7): the
                       dialog animates out while the bill refreshes to ₹0,
                       and with the amount still typed it offered the same
                       money "as the guest's credit" - a tick and a press
                       from taking it twice. */
                    setAmount(""); setAsCredit(false);
                    setOpen(false);
                    onDone();
                  } else {
                    toast.error("Could not settle", res.reason);
                    /* The bill may have moved under the dialog (another
                       payment): read it again, so the warning shows. */
                    onDone();
                  }
                } finally {
                  setSaving(false);
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
  const group = useGroupSettings(hotelId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Printer className="size-4" />
          Interim bill
        </Button>
      </DialogTrigger>
      <DialogContent title="Interim bill" description="Print preview">
        {/* QA FI-8: a Print, as the invoice and the restaurant bill have. The
            print is its own page, so the screen behind stays off the paper. */}
        <div className="flex justify-end mb-3">
          <Button variant="primary" size="sm" disabled={!bill.data}
            onClick={() => window.open(`/h/${hotelId}/stays/${stayId}/bill`, "_blank", "noopener")}>
            <Printer className="size-4" />
            Print
          </Button>
        </div>
        {bill.data ? (
          <BillPrint bill={bill.data} title="Interim bill" group={group} />
        ) : bill.isError ? (
          <p className="text-sm text-brand-red-700">The bill could not be read. Try again.</p>
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
  allowed, reason, guest, room, onCheckOut,
}: {
  allowed: boolean;
  reason?: string;
  guest: string;
  room: string;
  onCheckOut: () => Promise<void>;
}) {
  /* D27-117 (QA FD-16): "Are you sure?" first - a check-out closes the bill
     and sends the room to housekeeping, and it went on one click. */
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const button = (
    <Button
      /* Primary only once it may happen — while it is blocked, Settle
         above is the step, and two orange buttons would say neither. */
      variant={allowed ? "primary" : "secondary"}
      className="w-full"
      disabled={!allowed}
      onClick={() => setOpen(true)}
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
        <p className="text-xs text-brand-red-700 text-center" data-checkout-reason>
          {reason}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Check ${guest} out?`}
          description={`Room ${room}`}
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" onClick={() => setOpen(false)}>Not yet</Button>
              <Button variant="primary" loading={busy} data-checkout-confirm
                onClick={async () => {
                  setBusy(true);
                  try { await onCheckOut(); } finally { setBusy(false); setOpen(false); }
                }}>
                Check out
              </Button>
            </div>
          }
        >
          <p className="text-sm text-grey-700 leading-relaxed">
            The bill closes and the room goes to housekeeping as dirty.
          </p>
        </DialogContent>
      </Dialog>
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
/** A bill's name at the desk: its company, or "Guest" - a guest's bill has
    no company and that is not a gap. */
const billName = (f: StayFolio | undefined) =>
  !f ? "-" : f.billTo === "company" ? f.company ?? "Company" : "Guest";

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
        "shrink-0 min-h-11 px-3.5 rounded-lg border text-left",
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
            "shrink-0 flex items-center justify-center size-9 pointer-coarse:size-11 rounded-full",
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
