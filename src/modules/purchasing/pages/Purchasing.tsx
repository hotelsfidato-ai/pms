import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { Plus, ShieldCheck, ShoppingCart, Trash2 } from "lucide-react";
import { money, dateShort } from "@/lib/format";
import { ApiError } from "@/lib/api";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, ErrorState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, DataTable,
  StatusPill, toast, type Column, type Tone,
} from "@/components/ui";
import {
  getPurchasing, raiseRequest,
  type PurchaseRequest, type PurchaseState, type PurchasingList,
} from "@/modules/purchasing/data/purchasing";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING

   Somebody asks for what is needed, the general manager approves it, an
   order goes to a supplier on paper, and what arrives lands in a store.

   NOTHING HERE IS NEW MACHINERY. The approval is the ONE inbox the GM
   already uses for stock corrections, equipment and cash expenses; the
   stock is the Store's own ledger. This screen joins them.

   WHO MAY ASK IS A SETTING, per property (D18-2) - not this file's
   decision and not a deploy. A person who may not ask is told so, and
   told who can change it.

   NO PRICE IS INVENTED. A line nobody has agreed a price for reads "-",
   never 0, the order's total is "-" rather than a part of itself, and
   the order cannot be sent until every line has one - refused by the
   database, not only by this screen.

   SENT BY HAND (D18-3). The order is a PDF in the group's layout, made
   on the server. Somebody prints it or attaches it to a message.
   Nothing here sends anything and nothing waits on n8n.
   ══════════════════════════════════════════════════════════════════ */

/** What a person reads for each state, and its tone. ONE definition of
    the state itself lives on the server; these are only its words. */
export const STATE_WORDS: Record<PurchaseState, string> = {
  waiting: "Waiting for approval",
  refused: "Refused",
  sent_back: "Sent back",
  ready: "Ready to order",
  ordered: "Ordered",
  received: "Delivered",
  cancelled: "Cancelled",
};

const STATE_TONE: Record<PurchaseState, Tone> = {
  waiting: "warning",
  refused: "danger",
  sent_back: "warning",
  ready: "info",
  ordered: "info",
  received: "success",
  cancelled: "danger",
};

/** A figure nobody has set reads "-" (D17-49). Money arrives as a string
    so nothing is lost on the way; it becomes a number only to be shown. */
const rupees = (value: string | null) =>
  value === null ? "-" : money(Number(value));

const unreachable = (error: unknown) =>
  error instanceof ApiError && error.status === 0;

export default function PurchasingPage() {
  const { code = "" } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);

  const q = useQuery({
    queryKey: ["purchasing", code],
    queryFn: () => getPurchasing(code),
    enabled: !!code,
  });

  const data = q.data;
  const requests = data?.requests ?? [];

  const columns: Column<PurchaseRequest>[] = [
    {
      key: "reference",
      header: "Order",
      cell: (r) => <span className="font-medium text-ink-900">{r.reference}</span>,
    },
    {
      key: "state",
      header: "State",
      cell: (r) => <StatusPill tone={STATE_TONE[r.state]}>{STATE_WORDS[r.state]}</StatusPill>,
    },
    {
      key: "reason",
      header: "What for",
      cell: (r) => <span className="text-ink-700">{r.reason}</span>,
      hideBelow: "lg",
    },
    {
      key: "store",
      header: "Deliver to",
      cell: (r) => r.store.name,
      hideBelow: "md",
    },
    {
      key: "supplier",
      header: "Supplier",
      /* Chosen when the order goes out, so a request that has not been
         sent has none - a dash, not a guess. */
      cell: (r) => r.supplier?.name ?? "-",
      hideBelow: "md",
    },
    {
      key: "lines",
      header: "Items",
      cell: (r) => String(r.lines),
      numeric: true,
      hideBelow: "sm",
    },
    {
      key: "total",
      header: "Total",
      cell: (r) => (
        <span className={r.total === null ? "text-ink-600" : undefined}>
          {rupees(r.total)}
        </span>
      ),
      numeric: true,
    },
    {
      key: "requestedBy",
      header: "Asked by",
      cell: (r) => r.requestedBy ?? "-",
      hideBelow: "lg",
    },
    {
      key: "requestedAt",
      header: "Asked",
      cell: (r) => dateShort(r.requestedAt),
      hideBelow: "sm",
    },
  ];

  const body = (() => {
    if (data === undefined) {
      /* FOUR STATES, NOT ONE. A read that cannot reach the server must
         not draw "nothing has been asked for yet" - the fault STO-2 and
         POS-4 were both filed for. */
      if (q.isPaused) {
        return (
          <ErrorState
            title="No connection"
            description="This device is offline, so purchasing cannot load. It loads by itself as soon as the connection is back."
          />
        );
      }
      if (q.isError) {
        return (
          <ErrorState
            title="Purchasing did not load"
            error={q.error}
            description={unreachable(q.error)
              ? "Could not reach the server, and there is nothing from earlier to show in its place. Check the connection, then try again."
              : undefined}
            onRetry={() => void q.refetch()}
          />
        );
      }
      return <Skeleton className="h-64" />;
    }

    if (requests.length === 0) {
      return (
        <EmptyState
          icon={<ShoppingCart />}
          title="Nothing has been asked for yet"
          description={
            "A purchase starts here: what is needed, how much of it, which "
            + "store it is for, and why. The general manager approves it, the "
            + "order goes to a supplier on paper, and what arrives lands in "
            + "that store."
          }
          action={data.me.mayRaise
            ? <Button variant="primary" onClick={() => setAsking(true)}>Ask to buy something</Button>
            : undefined}
        />
      );
    }

    return (
      <DataTable
        columns={columns}
        rows={requests}
        rowKey={(r) => r.id}
        onRowClick={(r) => void navigate(`/h/${code}/purchasing/${r.id}`)}
      />
    );
  })();

  return (
    <Page>
      <PageHeader
        title="Purchasing"
        description={
          "Ask for what is needed, get it approved, order it, and receive it "
          + "into a store."
        }
        actions={
          <div className="flex items-center gap-2">
            {data?.me.maySetRequesters && (
              <Button asChild variant="secondary" leadingIcon={<ShieldCheck />}>
                <Link to={`/h/${code}/purchasing/who-may-ask`}>Who may ask</Link>
              </Button>
            )}
            {data?.me.mayRaise && (
              <Button variant="primary" leadingIcon={<Plus />} onClick={() => setAsking(true)}>
                Ask to buy
              </Button>
            )}
          </div>
        }
      />

      {/* RULE 6: SOMEBODY REFUSED IS TOLD, AND TOLD WHOM TO ASK. Not a
          greyed button with no explanation, and not a hidden one. */}
      {data && !data.me.mayRaise && (
        <Card className="mb-4">
          <CardBody className="text-sm text-ink-700">
            Your role cannot raise a purchase request at this property. Who may
            is a setting the owner or an administrator changes at any time - ask
            one of them, or the Inventory Manager or general manager to raise it
            for you.
          </CardBody>
        </Card>
      )}

      {/* Supplier and store lists come from Places and suppliers. Without a
          store nothing can be delivered anywhere, so it is said here rather
          than discovered inside the dialog. */}
      {data && data.stores.length === 0 && (
        <Card className="mb-4">
          <CardBody className="text-sm text-ink-700">
            This property has no store switched on, so there is nowhere for a
            delivery to land. Add or switch one on in Places and suppliers
            first.
          </CardBody>
        </Card>
      )}

      {body}

      {asking && data && (
        <AskDialog
          code={code}
          data={data}
          onClose={() => setAsking(false)}
        />
      )}
    </Page>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ASKING FOR SOMETHING

   What, how much, which store, and why. A price may be typed if one has
   already been agreed, and left blank if it has not - blank means "-"
   and an order that cannot be sent yet, which is the honest state.
   ══════════════════════════════════════════════════════════════════ */

interface Draft { itemId: string; quantity: string; unitPrice: string }

const EMPTY: Draft = { itemId: "", quantity: "", unitPrice: "" };

function AskDialog({
  code, data, onClose,
}: {
  code: string; data: PurchasingList; onClose: () => void;
}) {
  const qc = useQueryClient();
  const main = data.stores.find((s) => s.isMain) ?? data.stores[0];
  const [storeId, setStoreId] = useState(main?.id ?? "");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Draft[]>([{ ...EMPTY }]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const set = (i: number, patch: Partial<Draft>) =>
    setLines((all) => all.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  const filled = lines.filter((l) => l.itemId !== "" && l.quantity.trim() !== "");
  const duplicated =
    new Set(filled.map((l) => l.itemId)).size !== filled.length;

  const submit = async () => {
    setProblem(null);
    if (!storeId) { setProblem("Which store is this for?"); return; }
    if (!reason.trim()) {
      setProblem("Say what this is for. Whoever approves it has to know what they are approving.");
      return;
    }
    if (filled.length === 0) { setProblem("What is being asked for?"); return; }
    if (duplicated) {
      setProblem("The same item is on this request twice. Put it on one line.");
      return;
    }

    setSaving(true);
    const out = await raiseRequest(code, {
      storeId,
      reason: reason.trim(),
      lines: filled.map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        /* BLANK IS NOT ZERO. Nobody has agreed a price, so none is sent
           and the line reads "-" until somebody does. */
        unitPrice: l.unitPrice.trim() === "" ? null : Number(l.unitPrice),
      })),
    });
    setSaving(false);

    if (!out.ok) { setProblem(out.reason); return; }
    void qc.invalidateQueries({ queryKey: ["purchasing", code] });
    /* The dialog closes and the list changes — the end of the act, not
       the request going out (MEMORY 291). */
    onClose();
    toast.success(
      out.request.state === "waiting"
        ? `${out.request.reference} is with the general manager to approve.`
        : `${out.request.reference} is ready to order.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent title="Ask to buy something" className="max-w-2xl">
        <div className="space-y-4">
          <Field label="Which store is it for">
            {(p) => (
              <NativeSelect
                {...fieldProps(p)}
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
              >
                {data.stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <Field
            label="What is it for"
            hint="The general manager reads this before approving. A request with no reason is one nobody can act on."
          >
            {(p) => (
              <Input
                {...fieldProps(p)}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="The rice is down to two days"
              />
            )}
          </Field>

          <div className="space-y-2">
            <p className="text-sm font-medium text-ink-900">What is needed</p>
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <NativeSelect
                    aria-label={`Item on line ${i + 1}`}
                    value={l.itemId}
                    onChange={(e) => set(i, { itemId: e.target.value })}
                  >
                    <option value="">Pick an item</option>
                    {data.items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} ({it.unit})
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="w-[110px]">
                  <Input
                    aria-label={`How much on line ${i + 1}`}
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => set(i, { quantity: e.target.value })}
                    placeholder="How much"
                  />
                </div>
                <div className="w-[130px]">
                  <Input
                    aria-label={`Agreed price on line ${i + 1}`}
                    inputMode="decimal"
                    value={l.unitPrice}
                    onChange={(e) => set(i, { unitPrice: e.target.value })}
                    placeholder="Price, if agreed"
                  />
                </div>
                {lines.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Take line ${i + 1} off`}
                    onClick={() => setLines((all) => all.filter((_, n) => n !== i))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="secondary" onClick={() => setLines((all) => [...all, { ...EMPTY }])}>
              Add another item
            </Button>
            <p className="text-sm text-ink-600">
              Leave the price blank where nothing has been agreed. It reads "-",
              never 0, and the order cannot be sent until every line has one.
            </p>
          </div>

          {problem && (
            <p role="alert" className="text-sm text-brand-red">{problem}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Send for approval
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
