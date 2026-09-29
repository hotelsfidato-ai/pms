import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft, Check, Plus, Trash2, Users, Clock, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateTime } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, Skeleton, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, Textarea,
  NativeSelect, StatusPill,
} from "@/components/ui";
import { getBanquetEvent, getBanquetSetup, confirmBanquetEvent, cancelBanquetEvent, amendBanquetEvent, addBanquetCourse, removeBanquetCourse, type BanquetEvent } from "@/modules/banquet/data/banquet";
import { Checkbox, ReadFailed, ReadStale, readError } from "@/components/ui";
import { queryKeys } from "@/data/repositories";
import { FunctionBill } from "@/modules/banquet/components/FunctionBill";

/* ══════════════════════════════════════════════════════════════════
   ONE FUNCTION

   THE MONEY PANEL IS THE POINT OF THIS SCREEN, and it refuses to show
   a number it cannot stand behind. If the hall is unpriced, or any
   course is, the total is a dash and a sentence says which — because a
   quotation short by two hundred plates looks finished and is wrong,
   and that is worse than no quotation at all.

   CONFIRMING IS THE ACT THAT TAKES THE HALL, so it is the one button
   with weight, and its refusal NAMES the function standing in the way
   rather than saying "unavailable". A GM on the telephone can act on
   "the Sharma sangeet, until 23:00".

   FOOD IS OPTIONAL. Zero courses is a complete booking — a hall let
   for a meeting feeds nobody — and the empty state says so instead of
   nagging.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "danger" }> = {
  enquiry:   { label: "Enquiry",   tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "success" },
  completed: { label: "Completed", tone: "info" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

/* Dates and times through `format.ts`, as every screen prints them (BQ-5):
   "14 Nov 2026, 6:00 PM". */
const when = dateTime;

/** A dash, never ₹0. Used everywhere a price might not exist yet. */
const rupees = (v: number | null) => (v === null ? "-" : money(v));

export default function BanquetEventPage() {
  const hotelId = useHotel();
  const params = useParams();
  const eventId = params["id"] ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [cancelling, setCancelling] = useState(false);
  const [addingFood, setAddingFood] = useState(false);
  const [pricing, setPricing] = useState(false);

  const q = useQuery({
    queryKey: queryKeys.banquetEvent(hotelId, eventId),
    queryFn: () => getBanquetEvent(hotelId, eventId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.banquetEvent(hotelId, eventId) });
    void qc.invalidateQueries({ queryKey: ["banquet-diary"] });
  };

  if (q.isLoading) {
    return (
      <Page>
        <PageHeader title="Function" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  /* The read did not succeed (BQ-3). A function that does not exist, or
     banquet switched off, is the server's own sentence; a fault or a lost
     connection says so, with Try again. The way back stays either way. */
  if (!q.data) {
    return (
      <Page>
        <PageHeader
          title="Function"
          actions={
            <Button variant="secondary"
                    onClick={() => navigate(`/h/${hotelId}/banquet`)}>
              <ArrowLeft className="size-4" /> Diary
            </Button>
          }
        />
        <ReadFailed error={readError(q)} what="this function"
                    onRetry={() => void q.refetch()} />
      </Page>
    );
  }

  const e: BanquetEvent = q.data;
  const s = STATUS[e.status] ?? STATUS["enquiry"]!;

  const confirm = async () => {
    const res = await confirmBanquetEvent(hotelId, e.id);
    if (!res.ok) {
      /* The database wrote this sentence and it names the clash. Passed
         through unchanged — replacing it with "unavailable" throws away
         the only actionable half. */
      return toast.error("The hall is not free", res.reason);
    }
    toast.success("Confirmed", "The hall is held, and a bill is open.");
    refresh();
  };

  return (
    <Page>
      <PageHeader
        title={e.title}
        description={`${e.reference} · ${e.venue.name}`}
        actions={
          <>
            <Button variant="secondary"
                    onClick={() => navigate(`/h/${hotelId}/banquet`)}>
              <ArrowLeft className="size-4" /> Diary
            </Button>
            {e.status === "enquiry" && (
              <Button variant="primary" onClick={() => void confirm()}>
                <Check className="size-4" /> Confirm and hold the hall
              </Button>
            )}
            {/* A billed function is not cancelled (D27-135). */}
            {e.status !== "cancelled" && e.status !== "completed" && (
              <Button variant="secondary"
                      onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}
          </>
        }
      />

      <ReadStale className="mb-5" error={readError(q)} loadedAt={q.dataUpdatedAt}
                 onRetry={() => void q.refetch()} />

      {/* Cards 12px apart (the Rhythm Rule); they touched before. */}
      <div className="space-y-3">
        {e.status === "cancelled" && e.cancelReason && (
          <Card>
            <CardBody className="flex items-start gap-3">
              <AlertTriangle className="size-4 mt-0.5 shrink-0 text-brand-red" />
              <p className="text-sm text-ink-900">
                <span className="font-medium">Cancelled.</span> {e.cancelReason}
              </p>
            </CardBody>
          </Card>
        )}

        {/* D27-124: while the banquet GST rule is unset the function can be
            set up, and its bill is refused until the GM sets it. */}
        {e.taxWarning && e.status !== "cancelled" && (
          <Card>
            <CardBody className="flex items-start gap-3">
              <AlertTriangle className="size-4 mt-0.5 shrink-0 text-warning-dark" />
              <p className="text-sm text-ink-900" data-tax-warning>{e.taxWarning}</p>
            </CardBody>
          </Card>
        )}

        {/* Each card as tall as what it holds (No Dead Space): the money
            card is not stretched to the details beside it. */}
        <div className="grid gap-3 lg:grid-cols-3 lg:items-start">
          {/* ── What and when ─────────────────────────────────────── */}
          <Card className="lg:col-span-2">
            <CardBody className="space-y-3">
              <p className="flex flex-wrap items-center gap-2">
                <StatusPill tone={s.tone}>{s.label}</StatusPill>
                {e.status === "enquiry" && (
                  <span className="text-sm text-grey-600">
                    This holds nothing. Confirming takes the hall.
                  </span>
                )}
              </p>

              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="From">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5 shrink-0 text-grey-400" />
                    {when(e.startsAt)}
                  </span>
                </Detail>
                <Detail label="Until">{when(e.endsAt)}</Detail>
                <Detail label="Host">{e.hostName}</Detail>
                <Detail label="Telephone">
                  <span className={cn("tabular", e.hostPhone === null && "text-grey-500")}>
                    {e.hostPhone ?? "-"}
                  </span>
                </Detail>
                <Detail label="Expected guests">
                  <span className={cn("inline-flex items-center gap-1.5 tabular",
                                      e.pax === null && "text-grey-500")}>
                    <Users className="size-3.5 shrink-0 text-grey-400" />
                    {e.pax ?? "-"}
                  </span>
                </Detail>
                <Detail label="Guaranteed">
                  <span className={cn("tabular", e.paxGuaranteed === null && "text-grey-500")}>
                    {e.paxGuaranteed ?? "-"}
                  </span>
                </Detail>
                <Detail label="Hall">
                  {e.venue.name}
                  {e.venue.seated !== null && (
                    <span className="font-normal text-grey-500"> · seats {e.venue.seated}</span>
                  )}
                </Detail>
                <Detail label="Registered by">
                  {e.registeredBy ?? "-"}
                  <span className="block text-xs font-normal text-grey-500 mt-0.5">{when(e.registeredAt)}</span>
                </Detail>
              </dl>

              {e.notes && (
                <p className="rounded-lg bg-grey-50 px-3.5 py-3 text-sm text-ink-900">{e.notes}</p>
              )}
            </CardBody>
          </Card>

          <div className="space-y-3">
          {/* ── The money ─────────────────────────────────────────────
              The Figure Rule's rows: label left, value right; the total on
              the ladder's figure step under a hairline. */}
          <Card>
            <CardHeader title="The money" />
            <CardBody className="space-y-3">
              <dl>
                <Line label="Hall" value={rupees(e.money.venue)} />
                {/* Nothing served is not ₹0 of food (QA BQ-5). */}
                <Line label="Catering" value={rupees(e.catering.length === 0 ? null : e.money.food)} />
                {/* Settled restaurant orders only; each one is listed below. */}
                <Line label="Restaurant orders" value={rupees(e.money.pos)} />
              </dl>

              <div className="border-t border-grey-100 pt-3">
                {/* NULL when anything is unpriced. The sentence beneath
                    says which, so the gap is fixable rather than hidden. */}
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-grey-600">Total</span>
                  <span className={cn("text-xl sm:text-2xl font-semibold tabular tracking-[-0.022em]",
                                      e.money.total === null ? "text-grey-500" : "text-ink-900")}>
                    {rupees(e.money.total)}
                  </span>
                </div>
                {e.money.unpriced && (
                  <p className="mt-1.5 text-sm text-warning-dark">
                    {e.money.unpriced}
                  </p>
                )}
              </div>

              {e.status !== "completed" && <Button variant="secondary" className="w-full"
                      onClick={() => setPricing(true)}>
                {e.agreedAmount === null ? "Set the hall price" : "Change the hall price"}
              </Button>}

            </CardBody>
          </Card>
          {/* BQ-1: the function's bill - advance, bill, settle, invoice. */}
          {e.folioId && <FunctionBill hotelId={hotelId} event={e} onDone={refresh} />}
          </div>
        </div>

        {/* ── Catering ──────────────────────────────────────────────
            A course is a list row, a hairline between (not a box in the
            card); its amount level at the right. */}
        <Card>
          <CardHeader
            title="Catering"
            className="items-center"
            actions={e.status !== "completed" && (
              <Button variant="secondary"
                      onClick={() => setAddingFood(true)}>
                <Plus className="size-4" /> Add a course
              </Button>
            )}
          />

          {e.catering.length === 0 ? (
            /* Not a nag. A hall let for a meeting feeds nobody, and
               that is a complete booking. */
            <p className="px-4 py-6 text-center text-sm text-grey-500">
              Nothing is being served. That is a complete booking - add a
              course only if food is part of it.
            </p>
          ) : (
            <ul className="divide-y divide-grey-100">
              {e.catering.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3 min-h-14">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{c.name}</p>
                    <p className="text-sm text-grey-500">
                      {c.pax} {c.pax === 1 ? "plate" : "plates"}
                      {" · "}
                      {c.ratePerHead === null
                        ? <span className="text-warning-dark">no rate agreed</span>
                        : `${money(c.ratePerHead)} each`}
                      {c.notes ? ` · ${c.notes}` : ""}
                    </p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-medium tabular",
                                      c.ratePerHead === null ? "text-grey-500" : "text-ink-900")}>
                    {c.ratePerHead === null ? "-" : money(c.pax * c.ratePerHead)}
                  </span>
                  {e.status !== "completed" && <Button
                    variant="secondary" size="icon" className="shrink-0"
                    aria-label={`Remove ${c.name}`}
                    onClick={async () => {
                      const res = await removeBanquetCourse(hotelId, e.id, c.id);
                      if (!res.ok) return toast.error("Not removed", res.reason);
                      refresh();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Restaurant orders ─────────────────────────────────────
            The orders the restaurant charged to this function (D17-21).
            An open one is listed, because it is real food, and said to be
            outside the total — the total counts a bill once it is settled,
            so it does not move while somebody is still ordering. */}
        <Card>
          <CardHeader title="Restaurant orders" />

          {e.restaurantOrders.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-grey-500">
              No restaurant orders are charged to this function.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-grey-100">
                {e.restaurantOrders.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-3 min-h-14">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink-900 tabular">{o.orderNo}</span>
                        <StatusPill tone={o.status === "settled" ? "success" : "neutral"}>
                          {o.status === "settled" ? "Settled" : "Open"}
                        </StatusPill>
                      </p>
                      <p className="mt-0.5 text-sm text-grey-500">
                        {o.outlet ?? "-"}
                        {o.table ? ` · Table ${o.table}` : ""}
                        {" · "}
                        {when(o.openedAt)}
                      </p>
                    </div>
                    <span className={cn("shrink-0 text-sm font-medium tabular",
                                        o.amount === null ? "text-grey-500" : "text-ink-900")}>
                      {rupees(o.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              {e.restaurantOrders.some((o) => o.status !== "settled") && (
                <p className="px-4 py-3 border-t border-grey-100 text-sm text-grey-600">
                  An open order is not in the total until it is settled.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {pricing && (
        <PriceDialog
          hotelId={hotelId} event={e}
          onClose={() => setPricing(false)}
          onDone={() => { setPricing(false); refresh(); }}
        />
      )}

      {addingFood && (
        <CourseDialog
          hotelId={hotelId} eventId={e.id} pax={e.pax}
          onClose={() => setAddingFood(false)}
          onDone={() => { setAddingFood(false); refresh(); }}
        />
      )}

      {cancelling && (
        <CancelDialog
          hotelId={hotelId} eventId={e.id}
          onClose={() => setCancelling(false)}
          onDone={() => { setCancelling(false); refresh(); }}
        />
      )}
    </Page>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-grey-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink-900">{children}</dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm leading-[22px]">
      <dt className="text-grey-500">{label}</dt>
      <dd className={cn("font-medium tabular", value === "-" ? "text-grey-500" : "text-grey-700")}>
        {value}
      </dd>
    </div>
  );
}

function PriceDialog({
  hotelId, event, onClose, onDone,
}: {
  hotelId: string; event: BanquetEvent;
  onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState(
    event.agreedAmount === null ? "" : String(event.agreedAmount));
  /* D27-120: 0 is kept only when ticked Free. */
  const [free, setFree] = useState(event.agreedAmount === 0);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await amendBanquetEvent(hotelId, event.id, {
      /* An empty box CLEARS the price — a quote withdrawn is a real act,
         and it must not be confused with "leave it alone". */
      agreedAmount: amount.trim() === "" ? null : Number(amount), free,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success("Saved");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="The hall"
        description="What was agreed for this function. Nothing is filled in for you."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div>
          <Field
            label="Agreed amount"
            hint={
              event.venue.defaultRate != null
                ? `This hall's usual is ${money(event.venue.defaultRate)}.`
                : "Clear it to make the function unpriced again."
            }
          >
            {(f) => (
              <div className="flex gap-2">
                <Input {...fieldProps(f)} value={amount} inputMode="decimal"
                       placeholder="-" disabled={free}
                       onChange={(ev) => setAmount(ev.target.value)} />
                <Checkbox label="Free" checked={free}
                          onCheckedChange={(on) => { setFree(on); setAmount(on ? "0" : ""); }} />
                {event.venue.defaultRate != null && !free && (
                  <Button type="button" variant="secondary" className="shrink-0"
                          onClick={() => setAmount(String(event.venue.defaultRate))}>
                    Use usual
                  </Button>
                )}
              </div>
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CourseDialog({
  hotelId, eventId, pax, onClose, onDone,
}: {
  hotelId: string; eventId: string; pax: number | null;
  onClose: () => void; onDone: () => void;
}) {
  const setup = useQuery({
    queryKey: queryKeys.banquetSetup(hotelId),
    queryFn: () => getBanquetSetup(hotelId),
  });

  const [packageId, setPackageId] = useState("");
  const [name, setName] = useState("");
  const [heads, setHeads] = useState(pax === null ? "" : String(pax));
  const [rate, setRate] = useState("");
  const [free, setFree] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const packages = (setup.data?.packages ?? []).filter((p) => p.isActive);

  /* Choosing a package fills the name and OFFERS its rate. It does not
     bind: the rate that gets billed is snapshotted from this box, so
     repricing the package later cannot reprice this wedding. */
  const choose = (id: string) => {
    setPackageId(id);
    const p = packages.find((x) => x.id === id);
    if (!p) return;
    setName(p.name);
    if (p.ratePerHead != null) { setRate(String(p.ratePerHead)); setFree(p.ratePerHead === 0); }
  };

  const submit = async () => {
    setBusy(true);
    const res = await addBanquetCourse(hotelId, eventId, {
      packageId: packageId || undefined,
      name, pax: Number(heads),
      ratePerHead: rate.trim() === "" ? null : Number(rate), free,
      notes: notes || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    onDone();
  };

  const ready = name.trim() && Number(heads) > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Add a course"
        description={"From a package, or off-menu. A rate can wait - the "
                     + "total says so until it arrives."}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {packages.length > 0 && (
            <Field label="Package">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={packageId}
                              onChange={(e) => choose(e.target.value)}>
                  <option value="">Off-menu</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.ratePerHead != null ? ` · ${money(p.ratePerHead)} a head` : ""}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}

          <Field label="What is being served?" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} placeholder="Dinner buffet"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plates" required
                   hint="A per-head rate with no head count is not a price."
                   error={heads.trim() !== "" && !(Number(heads) > 0) ? "At least one plate." : undefined}>
              {(f) => (
                <Input {...fieldProps(f)} value={heads} inputMode="numeric"
                       onChange={(e) => setHeads(e.target.value)} />
              )}
            </Field>
            <Field label="Rate a head"
                   hint="Leave blank if it is not agreed yet.">
              {(f) => (
                <div className="flex items-center gap-3">
                  <Input {...fieldProps(f)} value={rate} inputMode="decimal"
                         placeholder="-" disabled={free}
                         onChange={(e) => setRate(e.target.value)} />
                  <Checkbox label="Free" checked={free}
                          onCheckedChange={(on) => { setFree(on); setRate(on ? "0" : ""); }} />
                </div>
              )}
            </Field>
          </div>

          <Field label="Notes">
            {(f) => (
              <Textarea {...fieldProps(f)} value={notes} rows={2}
                        onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </div>

      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  hotelId, eventId, onClose, onDone,
}: {
  hotelId: string; eventId: string;
  onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await cancelBanquetEvent(hotelId, eventId, reason);
    setBusy(false);
    if (!res.ok) return toast.error("Not cancelled", res.reason);
    toast.success("Cancelled", "The hall is free again.");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Cancel this function"
        description={"The hall goes back on the diary. The cancellation stays "
                     + "on the record."}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Keep it</Button>
            </DialogClose>
            <Button variant="danger" disabled={!reason.trim() || busy}
                    onClick={() => void submit()}>
              {busy ? "Cancelling…" : "Cancel the function"}
            </Button>
          </>
        }
      >
        <div>
          <Field label="Why?" required
                 hint="This is the line somebody asks about a month later.">
            {(f) => (
              <Textarea {...fieldProps(f)} value={reason} rows={3}
                        onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
