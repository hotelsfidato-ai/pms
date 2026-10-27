import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { FileDown, Truck, Send, Ban, IndianRupee } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateTime, dateShort } from "@/lib/format";
import { ApiError } from "@/lib/api";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, ErrorState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  StatusPill, IconChip, Checkbox, toast,
} from "@/components/ui";
import {
  getPurchasing, getPurchaseRequest, priceLine, sendOrder, cancelRequest,
  recordDelivery, downloadOrder, getPurchaseApproval, decidePurchase,
  type PurchaseLine, type PurchaseApproval,
} from "@/modules/purchasing/data/purchasing";
import { STATE_WORDS } from "@/modules/purchasing/pages/Purchasing";

/* ══════════════════════════════════════════════════════════════════
   ONE PURCHASE — what was asked for, what it costs, and what came

   Four acts live here and each has one condition:

     price a line      while the order has not gone out. What a supplier
                       was told they would be paid does not change after.
     send the order     once the GM has approved it AND every line has an
                        agreed price. Both refused by the database.
     record the delivery  once the order has been sent. What came may
                        differ from what was ordered and BOTH STAY.
     cancel             any time before it has been delivered, with a
                        reason - a cancellation nobody explained is a row
                        the person who asked cannot act on.

   THE GM DOES NOT APPROVE HERE. The approval sits in the one approvals
   inbox the GM already uses, and this screen says so and points at it
   rather than growing a second Approve button beside it.
   ══════════════════════════════════════════════════════════════════ */

const TONE = {
  waiting: "warning", refused: "danger", sent_back: "warning", ready: "info",
  ordered: "info", received: "success", cancelled: "danger",
} as const;

const rupees = (v: string | null) => (v === null ? "-" : money(Number(v)));
const figure = (v: string | null) => (v === null ? "-" : String(Number(v)));

const unreachable = (e: unknown) => e instanceof ApiError && e.status === 0;

export default function PurchaseRequestPage() {
  const { code = "", id = "" } = useParams<{ code: string; id: string }>();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const q = useQuery({
    queryKey: ["purchasing", "request", code, id],
    queryFn: () => getPurchaseRequest(code, id),
    enabled: !!code && !!id,
  });
  /* The same read the list makes, for the supplier list and whether this
     person may act. React Query hands back the cached copy when the list
     was just open. */
  const list = useQuery({
    queryKey: ["purchasing", code],
    queryFn: () => getPurchasing(code),
    enabled: !!code,
  });

  /* The approval row from the CORE queue — `mayDecide` is its answer, not
     a copy of its rule here (see the seam's note). */
  const approval = useQuery({
    queryKey: ["purchasing", "approval", code, id],
    queryFn: () => getPurchaseApproval(code, id),
    enabled: !!code && !!id,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["purchasing", "request", code, id] });
    void qc.invalidateQueries({ queryKey: ["purchasing", "approval", code, id] });
    void qc.invalidateQueries({ queryKey: ["purchasing", code] });
  };

  const r = q.data?.request;
  const lines = q.data?.lines ?? [];
  const credit = q.data?.credit ?? null;
  const mayAct = list.data?.me.mayRaise === true;

  const body = (() => {
    if (q.data === undefined) {
      if (q.isError) {
        return (
          <ErrorState
            title="This order did not load"
            error={q.error}
            description={unreachable(q.error)
              ? "Could not reach the server. Check the connection, then try again."
              : undefined}
            onRetry={() => void q.refetch()}
          />
        );
      }
      return <Skeleton className="h-64" />;
    }
    if (!r) return null;
    /* An order still on its way to a supplier: an unpriced line is work. */
    const toPrice = r.state === "waiting" || r.state === "ready";

    return (
      <div className="space-y-3">
        <Card>
          <CardBody className="grid gap-x-6 gap-y-3 grid-cols-2 lg:grid-cols-4">
            <Fact label="What it is for" value={r.reason} />
            <Fact label="Deliver to" value={r.store.name} />
            <Fact label="Supplier" value={r.supplier?.name ?? "-"} />
            <Fact label="Total" value={rupees(r.total)} />
            <Fact label="Asked by" value={r.requestedBy ?? "-"} />
            <Fact label="Asked" value={dateTime(r.requestedAt)} />
            <Fact label="Decided by" value={r.decidedBy ?? "-"} />
            <Fact label="Ordered" value={r.orderedAt ? dateTime(r.orderedAt) : "-"} />
          </CardBody>
        </Card>

        {/* WHERE THE APPROVAL IS, in words, with the way to it. Not a
            second Approve button: one inbox, one engine. */}
        {r.state === "waiting" && (
          <Card>
            <CardBody className="text-sm text-grey-600">
              <p className="text-md font-semibold text-ink-900 mb-1">
                Waiting for the general manager
              </p>
              <p>
                It is decided through the one approvals engine every approval in
                this system goes through. Nobody approves a purchase they asked
                for themselves.
              </p>
              <Decide code={code} approval={approval.data ?? null} onDone={refresh} />
            </CardBody>
          </Card>
        )}
        {(r.state === "refused" || r.state === "sent_back") && (
          <Card>
            <CardBody className="text-sm text-grey-600">
              <p className="text-md font-semibold text-ink-900 mb-1">
                {r.state === "refused" ? "Refused" : "Sent back for something to be cleared up"}
                {r.decidedBy ? ` by ${r.decidedBy}` : ""}
              </p>
              <p>{r.decisionNote ?? "-"}</p>
              <p className="mt-1">
                A decision stays on the record. To go ahead after this, raise a
                new request.
              </p>
            </CardBody>
          </Card>
        )}
        {r.state === "cancelled" && (
          <Card>
            <CardBody className="text-sm text-grey-600">
              <p className="text-md font-semibold text-ink-900 mb-1">Cancelled</p>
              <p>{r.cancelledReason ?? "-"}</p>
            </CardBody>
          </Card>
        )}
        {r.state === "received" && (
          <Card>
            <CardBody className="text-sm text-grey-600">
              <p className="text-md font-semibold text-ink-900 mb-1">
                Delivered{r.receivedBy ? ` - received by ${r.receivedBy}` : ""}
                {r.receivedAt ? ` on ${dateTime(r.receivedAt)}` : ""}
              </p>
              <p>{r.deliveryNote ?? "Nothing was noted about the delivery."}</p>
              {credit && (
                <p className="mt-1" data-credit>
                  On credit: bill {credit.billNo} of {dateShort(credit.billDate)}, {rupees(credit.amount)},
                  {" "}due {dateShort(credit.dueOn)}
                  {credit.paidOn ? ` - paid on ${dateShort(credit.paidOn)}.` : " - not paid yet."}
                </p>
              )}
            </CardBody>
          </Card>
        )}

        {/* The table scrolls inside its card on a phone: six columns and a
            price box do not fit 390px, and the page never scrolls sideways
            (the Breathing Room Rule). The head is DESIGN.md's table head. */}
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-grey-50 border-b border-grey-200 text-2xs font-semibold uppercase tracking-[0.025em] text-grey-500 whitespace-nowrap">
              <tr>
                <th className="h-10 px-4 text-left">Item</th>
                <th className="h-10 px-4 text-right">Ordered</th>
                <th className="h-10 px-4 text-right">Agreed price</th>
                <th className="h-10 px-4 text-right">Amount</th>
                <th className="h-10 px-4 text-right">Came</th>
                <th className="h-10 px-4 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {lines.map((l) => (
                <LineRow
                  key={l.id}
                  code={code}
                  requestId={id}
                  line={l}
                  mayPrice={mayAct && r.state !== "ordered" && r.state !== "received"
                    && r.state !== "cancelled"}
                  onSaved={refresh}
                />
              ))}
            </tbody>
          </table>
        </Card>

        {/* THE WARM TILE WHILE THERE IS SOMETHING TO DO (D27-82): the order
            waits for a price before it can go. Refused or sent back, nothing
            more happens to it, so the plain card as before. */}
        {r.unpriced > 0 && r.state !== "cancelled" && r.state !== "received" && (
          <div className={cn(
            "flex items-start gap-3 rounded-lg px-4 py-3.5 text-sm",
            toPrice
              ? "bg-brand-yellow-50 ring-1 ring-inset ring-brand-yellow-100 text-ink-900"
              : "bg-white border border-grey-200 text-grey-600",
          )}>
            {toPrice && <IconChip tone="yellow"><IndianRupee /></IconChip>}
            <p className="min-w-0">
              {r.unpriced === 1
                ? "One line has no agreed price. "
                : `${r.unpriced} lines have no agreed price. `}
              It reads "-", never 0, and this order cannot be sent to a supplier
              until every line has one - a blank on an order is a price the
              supplier sets.
            </p>
          </div>
        )}
      </div>
    );
  })();

  return (
    <Page>
      <PageHeader
        title={r?.reference ?? "Purchase order"}
        description={r ? r.reason : undefined}
        badge={r ? <StatusPill tone={TONE[r.state]}>{STATE_WORDS[r.state]}</StatusPill> : undefined}
        breadcrumbs={[
          { label: "Purchasing", to: `/h/${code}/purchasing` },
          { label: r?.reference ?? "Order" },
        ]}
        actions={r && (
          <div className="flex flex-wrap items-center gap-2">
            {/* THE ORDER ON PAPER (D18-3). Offered once it has been sent,
                because that is the document that went to the supplier; and
                before it, so somebody can read it over first. */}
            {(r.state === "ready" || r.state === "ordered" || r.state === "received") && (
              <Button
                variant="secondary"
                leadingIcon={<FileDown />}
                onClick={() => void download(code, id)}
              >
                Download the order
              </Button>
            )}
            {/* ⚠ THE BUTTON AND THE SERVER MUST AGREE. Offered only once
                every line has an agreed price: `app.mark_purchase_ordered`
                refuses an unpriced order, so a Send button beside an
                unpriced line is a control that answers with a refusal.
                The card below the lines says what is missing. */}
            {mayAct && r.state === "ready" && r.unpriced === 0 && (
              <Button variant="primary" leadingIcon={<Send />} onClick={() => setSending(true)}>
                Send the order
              </Button>
            )}
            {mayAct && r.state === "ordered" && (
              <Button variant="primary" leadingIcon={<Truck />} onClick={() => setDelivering(true)}>
                Record the delivery
              </Button>
            )}
            {mayAct && r.state !== "received" && r.state !== "cancelled" && (
              <Button variant="danger" leadingIcon={<Ban />} onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}
          </div>
        )}
      />

      {body}

      {sending && r && (
        <SendDialog
          code={code} requestId={id}
          suppliers={list.data?.suppliers ?? []}
          onClose={() => setSending(false)}
          onSent={refresh}
        />
      )}
      {delivering && r && (
        <DeliveryDialog
          code={code} requestId={id} store={r.store.name} lines={lines}
          onClose={() => setDelivering(false)}
          onDone={refresh}
        />
      )}
      {cancelling && r && (
        <CancelDialog
          code={code} requestId={id} reference={r.reference}
          onClose={() => setCancelling(false)}
          onDone={refresh}
        />
      )}
    </Page>
  );
}

async function download(code: string, id: string) {
  try {
    const name = await downloadOrder(code, id);
    toast.success(`${name} saved. Print it, or attach it to a message for the supplier.`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "The order could not be made.");
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-grey-500">{label}</p>
      <p className={cn("text-sm font-medium mt-0.5", value === "-" ? "text-grey-500" : "text-ink-900")}>{value}</p>
    </div>
  );
}

/* ── One line, and its agreed price ─────────────────────────────────
   Typed here rather than in a dialog: pricing six lines is six numbers,
   and six dialogs to type them is the shape nobody finishes. Blank puts
   it back to "not agreed", which is a dash and an order that waits.
   ═══════════════════════════════════════════════════════════════════ */
function LineRow({
  code, requestId, line, mayPrice, onSaved,
}: {
  code: string; requestId: string; line: PurchaseLine;
  mayPrice: boolean; onSaved: () => void;
}) {
  const [price, setPrice] = useState(line.unitPrice ?? "");
  const [saving, setSaving] = useState(false);

  const amount =
    line.unitPrice === null ? null
      : Math.round(Number(line.quantity) * Number(line.unitPrice) * 100) / 100;

  const save = async () => {
    const trimmed = price.trim();
    if (trimmed !== "" && (!Number.isFinite(Number(trimmed)) || Number(trimmed) < 0)) {
      toast.error("A price is zero or more, or nothing at all.");
      return;
    }
    if (trimmed === (line.unitPrice ?? "")) return;
    setSaving(true);
    const out = await priceLine(
      code, requestId, line.id, trimmed === "" ? null : Number(trimmed));
    setSaving(false);
    if (!out.ok) { toast.error(out.reason); return; }
    onSaved();
  };

  /* ST-2, X-1 (D27-120): a ₹0 line only when ticked Free. */
  const free = line.unitPrice !== null && Number(line.unitPrice) === 0;
  const tickFree = async (v: boolean) => {
    setSaving(true);
    const out = await priceLine(code, requestId, line.id, v ? 0 : null, v);
    setSaving(false);
    if (!out.ok) { toast.error(out.reason); return; }
    setPrice(v ? "0" : "");
    onSaved();
  };

  return (
    <tr>
      <td className="px-4 py-3">
        <span className="font-medium text-ink-900">{line.item}</span>
        <span className="text-grey-500"> · {line.unit}</span>
        {line.note && <p className="text-sm text-grey-600">{line.note}</p>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{figure(line.quantity)}</td>
      <td className={cn("px-4 py-3 text-right tabular-nums", !mayPrice && line.unitPrice === null && "text-grey-500")}>
        {mayPrice ? (
          <span className="inline-flex items-center gap-2">
            <Input
              aria-label={`Agreed price for ${line.item}`}
              inputMode="decimal"
              className="w-[110px] text-right"
              value={price}
              disabled={saving || free}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={() => void save()}
              placeholder="-"
            />
            <Checkbox label="Free" checked={free} disabled={saving}
              onCheckedChange={(v) => void tickFree(v)} />
          </span>
        ) : (
          rupees(line.unitPrice)
        )}
      </td>
      <td className={cn("px-4 py-3 text-right tabular-nums", amount === null && "text-grey-500")}>
        {amount === null ? "-" : money(amount)}
      </td>
      <td className={cn("px-4 py-3 text-right tabular-nums", line.receivedQuantity === null && "text-grey-500")}>{figure(line.receivedQuantity)}</td>
      <td className={cn("px-4 py-3 text-right tabular-nums", line.receivedUnitCost === null && "text-grey-500")}>{rupees(line.receivedUnitCost)}</td>
    </tr>
  );
}

function SendDialog({
  code, requestId, suppliers, onClose, onSent,
}: {
  code: string; requestId: string; suppliers: { id: string; name: string }[];
  onClose: () => void; onSent: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!supplierId) { setProblem("Who is this ordered from?"); return; }
    setSaving(true);
    const out = await sendOrder(code, requestId, supplierId);
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }
    onSent();
    onClose();
    toast.success(
      `${out.request.reference} is ordered. Download it and print it, or attach `
      + "it to a message - nothing is sent automatically.");
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Send the order"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={suppliers.length === 0}
              onClick={() => void submit()}
            >
              Send the order
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {suppliers.length === 0 ? (
            <p className="text-sm text-grey-600">
              This property has no supplier entered yet. Add one in Places and
              suppliers first - an order has to say who it is to.
            </p>
          ) : (
            <Field label="Order it from">
              {(p) => (
                <NativeSelect
                  {...fieldProps(p)}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
          <p className="text-sm text-grey-600">
            This records the order and produces it as a PDF in the group's
            layout. It is sent BY HAND - printed, or attached to a message by
            whoever orders.
          </p>
          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── The delivery ──────────────────────────────────────────────────
   WHAT CAME, not what was ordered. The fields start from the ordered
   quantity because that is usually what turned up - but they are typed
   over freely, and what was ordered is never written over.
   ═══════════════════════════════════════════════════════════════════ */
function DeliveryDialog({
  code, requestId, store, lines, onClose, onDone,
}: {
  code: string; requestId: string; store: string; lines: PurchaseLine[];
  onClose: () => void; onDone: () => void;
}) {
  const [came, setCame] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.id, String(Number(l.quantity))])));
  const [cost, setCost] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.id, l.unitPrice ?? ""])));
  const [note, setNote] = useState("");
  /* The bill's GST per line (D27-238, Q6): the rate, the amount filled from
     it until typed over, and whether it can be claimed; and the use-by. */
  const [rate, setRate] = useState<Record<string, string>>({});
  const [typedAmount, setTypedAmount] = useState<Record<string, string>>({});
  const [claimable, setClaimable] = useState<Record<string, string>>({});
  const [useBy, setUseBy] = useState<Record<string, string>>({});
  /* On credit (D27-370): the supplier's bill, as printed, and when it is due. */
  const [onCredit, setOnCredit] = useState(false);
  const [bill, setBill] = useState({ billNo: "", billDate: new Date().toLocaleDateString("en-CA"), amount: "", dueOn: "" });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const amountOf = (id: string) => {
    if (typedAmount[id] !== undefined) return typedAmount[id]!;
    const r = Number(rate[id]); const q = Number(came[id]); const c = Number(cost[id]);
    return (rate[id] ?? "").trim() === "" || (cost[id] ?? "").trim() === ""
      || ![r, q, c].every(Number.isFinite) ? "" : (Math.round(q * c * r) / 100).toFixed(2);
  };
  const gstOf = (id: string) => {
    const given = [rate[id] ?? "", amountOf(id), claimable[id] ?? ""].filter((v) => v.trim() !== "").length;
    return given === 3
      ? { gstRate: Number(rate[id]), gstAmount: Number(amountOf(id)), gstClaimable: claimable[id] === "yes" }
      : given === 0 ? {} : null;
  };

  const submit = async () => {
    setProblem(null);
    for (const l of lines) {
      const q = Number(came[l.id]);
      if (came[l.id]?.trim() === "" || !Number.isFinite(q) || q < 0) {
        setProblem(
          `How much of the ${l.item} came? Nothing at all is 0, and it stays on `
          + "the record beside what was ordered.");
        return;
      }
      const c = cost[l.id]?.trim() ?? "";
      if (c !== "" && (!Number.isFinite(Number(c)) || Number(c) < 0)) {
        setProblem(`The cost of the ${l.item} is zero or more, or nothing at all.`);
        return;
      }
      if (gstOf(l.id) === null) {
        setProblem(`GST on the ${l.item} is the rate, the amount and whether it can be claimed - all three, or none.`);
        return;
      }
    }

    if (onCredit) {
      if (!bill.billNo.trim()) return setProblem("Type the supplier's bill number, as printed on it.");
      if (!bill.billDate) return setProblem("Pick the date on the supplier's bill.");
      if (!(Number(bill.amount) > 0)) return setProblem("Type the bill's amount, as printed on it: more than zero.");
      if (!bill.dueOn) return setProblem("Pick the date the bill is due.");
    }

    setSaving(true);
    const out = await recordDelivery(code, requestId, {
      note: note.trim() || undefined,
      ...(onCredit ? { credit: { ...bill, amount: Number(bill.amount) } } : {}),
      lines: lines.map((l) => ({
        lineId: l.id,
        receivedQuantity: Number(came[l.id]),
        receivedUnitCost: (cost[l.id]?.trim() ?? "") === "" ? null : Number(cost[l.id]),
        ...gstOf(l.id),
        ...(useBy[l.id] ? { expiresOn: useBy[l.id] } : {}),
      })),
    });
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }
    onDone();
    onClose();
    toast.success(
      out.received.length === 0
        ? `Recorded. Nothing came, and that is on the order.`
        : `${out.received.length === 1 ? "One item" : `${out.received.length} items`} `
          + `received into ${store}.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Record the delivery"
        className="max-w-4xl"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Record the delivery
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-600">
            What actually came, and what it actually cost before GST, with the
            bill's GST. It may differ from what was ordered - both stay on the
            record. The stock lands in{" "}
            <span className="font-medium text-ink-900">{store}</span>.
          </p>

          {/* Scrolls inside itself on a phone: two boxes a line do not fit
              the dialog at 390px, and nothing scrolls sideways but this. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-grey-200 text-2xs font-semibold uppercase tracking-[0.025em] text-grey-500 whitespace-nowrap">
                <tr>
                  <th className="h-10 text-left">Item</th>
                  <th className="h-10 text-right">Ordered</th>
                  <th className="h-10 text-right">Came</th>
                  <th className="h-10 text-right">Cost each</th>
                  <th className="h-10 text-right">GST %</th>
                  <th className="h-10 text-right">GST amount</th>
                  <th className="h-10 text-left pl-2">Claimable</th>
                  <th className="h-10 text-left pl-2">Use by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grey-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2">{l.item} · {l.unit}</td>
                    <td className="py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                    <td className="py-2 pl-2">
                      <Input
                        aria-label={`How much of the ${l.item} came`}
                        inputMode="decimal"
                        className="w-[100px] text-right"
                        value={came[l.id] ?? ""}
                        onChange={(e) => setCame((all) => ({ ...all, [l.id]: e.target.value }))}
                      />
                    </td>
                    <td className="py-2 pl-2">
                      <Input
                        aria-label={`What the ${l.item} cost each`}
                        inputMode="decimal"
                        className="w-[110px] text-right"
                        value={cost[l.id] ?? ""}
                        onChange={(e) => setCost((all) => ({ ...all, [l.id]: e.target.value }))}
                        placeholder="-"
                      />
                    </td>
                    <td className="py-2 pl-2">
                      <Input
                        aria-label={`GST rate on the ${l.item}, per cent`}
                        inputMode="decimal" list="delivery-gst-rates"
                        className="w-[72px] text-right"
                        value={rate[l.id] ?? ""}
                        onChange={(e) => setRate((all) => ({ ...all, [l.id]: e.target.value }))}
                        placeholder="-"
                      />
                    </td>
                    <td className="py-2 pl-2">
                      <Input
                        aria-label={`GST amount on the ${l.item}`}
                        inputMode="decimal"
                        className="w-[100px] text-right"
                        value={amountOf(l.id)}
                        onChange={(e) => setTypedAmount((all) => ({ ...all, [l.id]: e.target.value }))}
                        placeholder="-"
                      />
                    </td>
                    <td className="py-2 pl-2">
                      <NativeSelect
                        aria-label={`Can the GST on the ${l.item} be claimed`}
                        className="w-[96px]"
                        value={claimable[l.id] ?? ""}
                        onChange={(e) => setClaimable((all) => ({ ...all, [l.id]: e.target.value }))}
                      >
                        <option value="">-</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </NativeSelect>
                    </td>
                    <td className="py-2 pl-2">
                      <Input
                        aria-label={`Use by, the ${l.item}`}
                        type="date"
                        className="w-[150px]"
                        value={useBy[l.id] ?? ""}
                        onChange={(e) => setUseBy((all) => ({ ...all, [l.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* The GST rates since 22 September 2025; 12 and 28 still typed
                for an older bill. */}
            <datalist id="delivery-gst-rates">
              {[0, 5, 18, 40].map((r) => <option key={r} value={r} />)}
            </datalist>
          </div>

          <Field
            label="Anything to note"
            hint="A short delivery, a damaged case, a different brand. Optional."
          >
            {(p) => (
              <Input
                {...fieldProps(p)}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>

          <Checkbox checked={onCredit} onCheckedChange={setOnCredit}
            label="On credit - the supplier's bill is paid later" />
          {onCredit && (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Bill number">
                {(p) => <Input {...fieldProps(p)} value={bill.billNo}
                  onChange={(e) => setBill((b) => ({ ...b, billNo: e.target.value }))} />}
              </Field>
              <Field label="Bill date">
                {(p) => <Input {...fieldProps(p)} type="date" value={bill.billDate}
                  onChange={(e) => setBill((b) => ({ ...b, billDate: e.target.value }))} />}
              </Field>
              <Field label="Amount, as printed, ₹">
                {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={bill.amount}
                  onChange={(e) => setBill((b) => ({ ...b, amount: e.target.value }))} />}
              </Field>
              <Field label="Due on">
                {(p) => <Input {...fieldProps(p)} type="date" value={bill.dueOn}
                  onChange={(e) => setBill((b) => ({ ...b, dueOn: e.target.value }))} />}
              </Field>
            </div>
          )}

          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  code, requestId, reference, onClose, onDone,
}: {
  code: string; requestId: string; reference: string;
  onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!reason.trim()) {
      setProblem("Say why. Whoever asked for it has to know what to do next.");
      return;
    }
    setSaving(true);
    const out = await cancelRequest(code, requestId, reason.trim());
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }
    onDone();
    onClose();
    toast.success(`${reference} is cancelled.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title={`Cancel ${reference}?`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Keep it</Button>
            <Button variant="danger" loading={saving} onClick={() => void submit()}>
              Cancel the order
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-600">
            It stays on the record, cancelled, with the reason. Nothing is
            removed.
          </p>
          <Field label="Why">
            {(p) => (
              <Input
                {...fieldProps(p)}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Bought locally instead"
              />
            )}
          </Field>
          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Deciding it ───────────────────────────────────────────────────
   THE SAME SHAPE EQUIPMENT USES (src/modules/equipment/flows/Decide.tsx),
   and for the same reason: there is no shared approvals SCREEN in this
   system - only the engine and its routes - so each service decides its
   own requests where the thing is. If a shared inbox is ever built, both
   drop these buttons and point at it.

   The buttons are offered only where the CORE's queue says `mayDecide`;
   anywhere else its own sentence is shown (Rule 6). The decision goes to
   the core endpoint, which refuses anybody who may not decide and refuses
   the person who asked - so the screen and the server cannot disagree.
   ═══════════════════════════════════════════════════════════════════ */
function Decide({
  code, approval, onDone,
}: { code: string; approval: PurchaseApproval | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState<"rejected" | "clarify" | null>(null);
  const [note, setNote] = useState("");

  if (!approval || approval.status !== "pending") return null;
  if (!approval.mayDecide) {
    return approval.blockedBecause
      ? <p className="mt-1.5 text-grey-600">{approval.blockedBecause}</p>
      : null;
  }

  const decide = async (decision: "approved" | "rejected" | "clarify") => {
    if (busy) return;
    setBusy(true);
    const out = await decidePurchase(code, approval.id, decision,
      decision === "approved" ? undefined : note.trim());
    setBusy(false);
    if (!out.ok) { toast.error(out.reason); return; }
    setRefusing(null);
    setNote("");
    onDone();
    toast.success(
      decision === "approved" ? "Approved. It can be ordered now."
        : decision === "rejected" ? "Refused, with your reason on the record."
        : "Sent back for something to be cleared up.");
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary" disabled={busy}
          onClick={() => void decide("approved")}
        >
          Approve this purchase
        </Button>
        <Button
          variant="secondary" disabled={busy}
          onClick={() => setRefusing("rejected")}
        >
          Refuse
        </Button>
        <Button
          variant="secondary" disabled={busy}
          onClick={() => setRefusing("clarify")}
        >
          Send back
        </Button>
      </div>

      {refusing && (
        <Dialog open onOpenChange={(open) => { if (!open) setRefusing(null); }}>
          <DialogContent
            title={refusing === "rejected" ? "Refuse this purchase" : "Send it back"}
            footer={
              <>
                <Button variant="secondary" onClick={() => setRefusing(null)}>Cancel</Button>
                <Button
                  variant={refusing === "rejected" ? "danger" : "primary"}
                  loading={busy}
                  onClick={() => void decide(refusing)}
                >
                  {refusing === "rejected" ? "Refuse it" : "Send it back"}
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <p className="text-sm text-grey-600">
                {refusing === "rejected"
                  ? "Say why. The person who asked has to know what to do next - buy it elsewhere, buy it cheaper, or not buy it."
                  : "Say what you need cleared up."}
              </p>
              <Field label={refusing === "rejected" ? "Why" : "What you need"}>
                {(p) => (
                  <Input
                    {...fieldProps(p)}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={refusing === "rejected"
                      ? "Buy from the usual supplier" : "Which brand is this?"}
                  />
                )}
              </Field>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
