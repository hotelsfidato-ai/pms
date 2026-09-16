import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  Package, Plus, TrendingDown, TrendingUp, Trash2, Undo2, AlertTriangle,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  StatusPill, toast,
} from "@/components/ui";
import { getStore, getStockHistory, addStockItem, recordStockMovement, reverseStockMovement, importStockItems, type StockItem, type StockKind } from "@/modules/stores/data/stores";
import { ImportDialog } from "@/components/flows/ImportDialog";
import { STOCK_SPEC } from "@/lib/importSpec";

/* ══════════════════════════════════════════════════════════════════
   THE STORE

   Rice, gas, linen and soap. What is here, what came in, what went to
   the kitchen, and what was thrown away.

   EVERY NUMBER ON THIS SCREEN IS DERIVED. There is no stock column to
   read: on hand is the sum of the movements and the value is the
   weighted average of what was actually paid. A figure that can
   disagree with its own history is worse than no figure, because
   somebody believes it.

   A DASH FOR AN ITEM NOBODY HAS BOUGHT. Its value is not zero — zero
   claims it is worthless, and nothing has been paid for it yet at all.
   The same rule as every price in this system.

   NOTHING IS EDITED. A delivery entered against the wrong item is
   undone by a row that points at it, and both stay on the history.
   Somebody has to be able to ask why the rice says forty kilos and get
   an answer that goes back to a delivery note.
   ══════════════════════════════════════════════════════════════════ */

const KIND_LABEL: Record<StockKind, string> = {
  receipt: "Received",
  issue: "Issued",
  wastage: "Wasted",
  adjustment: "Adjusted",
  return: "Returned",
};

/* LOOK, OR CHANGE (STO-1). The owner's table: `create` receives, issues,
   wastes and adds; `edit` undoes. A person who may only look — housekeeping,
   the chef, the accountant, a viewer — gets ONE sentence and no change
   buttons, not four greyed buttons on every item: the owner's choice of 16
   September, an exception to "greyed with its reason". The server refuses
   the same people whatever the screen draws. */
const LOOK_ONLY =
  "You can see the store. Receiving, issuing and adding items is for the "
  + "store manager, hotel manager or GM.";
const UNDO_NOT_YOURS =
  "Undoing a movement is for the store manager, hotel manager or GM.";

export default function StoresPage() {
  const { code = "" } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const role = useRole();
  const mayChange = can(role, "create", "stock");
  const mayUndo = can(role, "edit", "stock");

  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ item: StockItem; kind: StockKind } | null>(null);
  const [history, setHistory] = useState<StockItem | null>(null);
  const [importing, setImporting] = useState(false);

  const q = useQuery({
    queryKey: ["stores", code],
    queryFn: () => getStore(code),
    enabled: !!code,
  });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["stores", code] }); };

  const items = q.data ?? [];
  const low = items.filter((i) => i.low);
  /* Only what has a value. An item nobody has received contributes
     nothing to a total rather than zero — and if EVERYTHING is unpriced
     the total is a dash, not ₹0. */
  const priced = items.filter((i) => i.value !== null);
  const total = priced.reduce((n, i) => n + (i.value ?? 0), 0);

  const byCategory = new Map<string, StockItem[]>();
  for (const i of items) {
    const key = i.category ?? "Everything else";
    byCategory.set(key, [...(byCategory.get(key) ?? []), i]);
  }

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Store"
        description={
          items.length === 0
            ? "What the property keeps — rice, gas, linen, soap."
            : `${items.length} item${items.length === 1 ? "" : "s"}`
              + (priced.length > 0
                  ? ` · ${money(total)} on the shelf`
                    + (priced.length < items.length
                        ? `, ${items.length - priced.length} not yet valued`
                        : "")
                  : " · nothing received yet, so nothing has a value")
        }
        actions={mayChange && (
          <div className="flex flex-wrap gap-2">
            {/* A store is a hundred lines long. The same argument the
                menu import is built on. */}
            <Button variant="secondary" className="h-11"
                    onClick={() => setImporting(true)}>
              <Upload className="size-4" /> Import
            </Button>
            <Button className="h-11" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add an item
            </Button>
          </div>
        )}
      />

      {!mayChange && (
        <p className="text-sm text-grey-600">{LOOK_ONLY}</p>
      )}

      {low.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardBody className="flex items-start gap-2.5">
            <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-ink-900 leading-relaxed">
              <span className="font-medium">
                {low.length === 1 ? "One item is" : `${low.length} items are`} at
                or below the level somebody asked to be warned at
              </span>
              {" — "}
              {low.map((i) => `${i.name} (${i.onHand} ${i.unit})`).join(", ")}.
            </p>
          </CardBody>
        </Card>
      )}

      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="Nothing in the store yet"
          description={
            "Add what the property keeps and what it is counted in. Receiving "
            + "a delivery is what gives it a quantity and a value — an item on "
            + "its own has neither, and shows a dash rather than a zero."
          }
          action={mayChange
            ? <Button onClick={() => setAdding(true)}>Add the first</Button>
            : undefined}
        />
      ) : (
        [...byCategory.entries()].map(([category, group]) => (
          <section key={category}>
            <h2 className="text-md font-semibold text-ink-900 mb-2.5">
              {category}
            </h2>
            <ul className="space-y-2">
              {group.map((i) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  mayChange={mayChange}
                  onMove={(kind) => setMoving({ item: i, kind })}
                  onHistory={() => setHistory(i)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {importing && (
        <ImportDialog
          spec={STOCK_SPEC}
          load={(rows, dry) => importStockItems(code, rows, dry)}
          open
          onOpenChange={(o) => { if (!o) setImporting(false); }}
          onImported={refresh}
        />
      )}
      {adding && (
        <AddItemDialog code={code} open
                       onOpenChange={(o) => { if (!o) setAdding(false); }}
                       onAdded={() => { setAdding(false); refresh(); }} />
      )}
      {moving && (
        <MoveDialog code={code} item={moving.item} kind={moving.kind} open
                    onOpenChange={(o) => { if (!o) setMoving(null); }}
                    onDone={() => { setMoving(null); refresh(); }} />
      )}
      {history && (
        <HistoryDialog code={code} item={history} open mayUndo={mayUndo}
                       onOpenChange={(o) => { if (!o) setHistory(null); }}
                       onChanged={refresh} />
      )}
    </Page>
  );
}

/* ── One thing on the shelf ───────────────────────────────────────── */

function ItemRow({ item, mayChange, onMove, onHistory }: {
  item: StockItem;
  mayChange: boolean;
  onMove: (kind: StockKind) => void;
  onHistory: () => void;
}) {
  return (
    <li>
      <Card className={cn(item.low && "border-amber-300")}>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-base font-medium text-ink-900">{item.name}</p>
              {item.low && <StatusPill tone="warning">Low</StatusPill>}
            </div>
            <p className="text-sm text-grey-500">
              {item.reorderLevel === null
                ? "No reorder level set"
                : `Warn at ${item.reorderLevel} ${item.unit}`}
              {item.lastMovement
                ? ` · last moved ${dateShort(item.lastMovement)}`
                : " · never moved"}
            </p>
          </div>

          <div>
            <p className="text-sm text-grey-500">On hand</p>
            <p className="text-lg font-semibold tabular text-ink-900">
              {item.onHand} <span className="text-sm font-normal text-grey-500">{item.unit}</span>
            </p>
          </div>

          <div>
            <p className="text-sm text-grey-500">Worth</p>
            {/* A DASH. Nothing has been received, so nothing has been
                paid, and zero would say it is worthless. */}
            <p className={cn("text-lg font-semibold tabular",
              item.value === null ? "text-grey-500" : "text-ink-900")}>
              {item.value === null ? "—" : money(item.value)}
            </p>
            {item.unitCost !== null && (
              <p className="text-sm text-grey-500 tabular">
                {money(item.unitCost)}/{item.unit} average
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {mayChange && (<>
              <Button variant="secondary" className="h-11"
                      onClick={() => onMove("receipt")}>
                <TrendingUp className="size-4" /> Receive
              </Button>
              <Button variant="secondary" className="h-11"
                      disabled={item.onHand <= 0}
                      onClick={() => onMove("issue")}>
                <TrendingDown className="size-4" /> Issue
              </Button>
              <Button variant="secondary" className="h-11"
                      disabled={item.onHand <= 0}
                      onClick={() => onMove("wastage")}>
                <Trash2 className="size-4" />
              </Button>
            </>)}
            <Button variant="secondary" className="h-11"
                    disabled={item.movements === 0}
                    onClick={onHistory}>
              History
            </Button>
          </div>
        </CardBody>
      </Card>
    </li>
  );
}

/* ── Adding something to keep ─────────────────────────────────────── */

function AddItemDialog({ code, open, onOpenChange, onAdded }: {
  code: string; open: boolean;
  onOpenChange: (o: boolean) => void; onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("Kitchen");
  const [reorder, setReorder] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !name.trim() || !unit.trim()) return;
    setBusy(true);
    const res = await addStockItem(code, {
      name: name.trim(),
      unit: unit.trim(),
      category: category.trim() || undefined,
      reorderLevel: reorder.trim() === "" ? null : Number(reorder),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    toast.success(`${name.trim()} added`,
      "Receiving a delivery is what gives it a quantity and a value.");
    setName(""); setUnit(""); setReorder("");
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add an item"
        description="Something the property keeps and counts."
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="h-11"
                    disabled={!name.trim() || !unit.trim() || busy}
                    onClick={() => void submit()}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="What is it" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} placeholder="Basmati rice"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Counted in" required
                 hint="Kilos, litres, pieces, cylinders. Without a unit a number in this list means nothing.">
            {(f) => (
              <Input {...fieldProps(f)} value={unit} placeholder="kg"
                     onChange={(e) => setUnit(e.target.value)} />
            )}
          </Field>
          <Field label="Where it belongs">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={category}
                            onChange={(e) => setCategory(e.target.value)}>
                <option>Kitchen</option>
                <option>Bar</option>
                <option>Housekeeping</option>
                <option>Maintenance</option>
                <option value="">Everything else</option>
              </NativeSelect>
            )}
          </Field>
          <Field label="Warn me below"
                 hint="Leave blank for no warning. Blank is not zero — zero would mean warn me when it has run out, which is much too late.">
            {(f) => (
              <Input {...fieldProps(f)} value={reorder} inputMode="decimal"
                     placeholder="20"
                     onChange={(e) => setReorder(e.target.value)} />
            )}
          </Field>
          <p className="text-sm text-grey-600 rounded-md border border-grey-200
                        bg-grey-50 p-3 leading-relaxed">
            No price here. A <em>delivery</em> has a price — the same rice
            costs differently in June and October — so the cost is recorded
            when it arrives, and what the shelf is worth is the average of
            what was actually paid.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Something came in, or went out ───────────────────────────────── */

function MoveDialog({ code, item, kind, open, onOpenChange, onDone }: {
  code: string; item: StockItem; kind: StockKind;
  open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const isReceipt = kind === "receipt";

  const submit = async () => {
    if (busy || !qty.trim()) return;
    setBusy(true);
    const res = await recordStockMovement(code, {
      itemId: item.id,
      kind,
      /* ALWAYS POSITIVE. The kind decides the direction and the server
         applies the sign — a screen that has to remember to send -5 for
         an issue will one day send 5 and quietly double the stock. */
      quantity: Number(qty),
      ...(isReceipt && cost.trim() !== "" ? { unitCost: Number(cost) } : {}),
      ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not recorded", res.reason);

    toast.success(
      `${KIND_LABEL[kind]} ${qty} ${item.unit} of ${item.name}`,
      `${res.onHand} ${res.unit} on hand.`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${KIND_LABEL[kind]} — ${item.name}`}
        description={`${item.onHand} ${item.unit} on hand`}
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="h-11" disabled={!qty.trim() || busy}
                    onClick={() => void submit()}>
              {busy ? "Recording…" : KIND_LABEL[kind]}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={`How many ${item.unit}`} required>
            {(f) => (
              <Input {...fieldProps(f)} value={qty} inputMode="decimal"
                     onChange={(e) => setQty(e.target.value)} />
            )}
          </Field>

          {isReceipt ? (
            <>
              <Field label={`What it cost, per ${item.unit}`}
                     hint="Leave blank if the bill has not arrived. It can be recorded later as an adjustment; what it must not be is a guess.">
                {(f) => (
                  <Input {...fieldProps(f)} value={cost} inputMode="decimal"
                         onChange={(e) => setCost(e.target.value)} />
                )}
              </Field>
              <Field label="Who from">
                {(f) => (
                  <Input {...fieldProps(f)} value={supplier}
                         placeholder="Kirana Bros"
                         onChange={(e) => setSupplier(e.target.value)} />
                )}
              </Field>
              <Field label="Delivery note or bill number"
                     hint="What somebody holds in their hand when they ask why the count is what it is.">
                {(f) => (
                  <Input {...fieldProps(f)} value={reference}
                         onChange={(e) => setReference(e.target.value)} />
                )}
              </Field>
            </>
          ) : (
            <Field label="Why" hint={
              kind === "wastage"
                ? "Spoiled, broken, past its date. Somebody will ask at the end of the month."
                : "Where it went, or why the shelf disagreed with the book."
            }>
              {(f) => (
                <Input {...fieldProps(f)} value={note}
                       onChange={(e) => setNote(e.target.value)} />
              )}
            </Field>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Why the count is what it is ──────────────────────────────────── */

function HistoryDialog({ code, item, open, mayUndo, onOpenChange, onChanged }: {
  code: string; item: StockItem; open: boolean; mayUndo: boolean;
  onOpenChange: (o: boolean) => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["stock-history", code, item.id],
    queryFn: () => getStockHistory(code, item.id),
    enabled: open,
  });

  const undo = async (id: string) => {
    const res = await reverseStockMovement(code, id);
    if (!res.ok) return toast.error("Not undone", res.reason);
    toast.success("Undone",
      "Both rows stay on the history — the store's past is what somebody "
      + "reads when the count is wrong.");
    void qc.invalidateQueries({ queryKey: ["stock-history", code, item.id] });
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={item.name}
        description={`${item.onHand} ${item.unit} on hand · every movement`}
        footer={
          <Button variant="secondary" className="h-11"
                  onClick={() => onOpenChange(false)}>Close</Button>
        }
      >
        {!mayUndo && (
          <p className="text-sm text-grey-600 mb-2">{UNDO_NOT_YOURS}</p>
        )}
        {q.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="space-y-1.5">
            {(q.data ?? []).map((m) => (
              <li key={m.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md border p-3",
                    /* A row that was UNDONE and a row that DID the
                       undoing are different facts, and the history is
                       unreadable if either looks like an ordinary
                       movement. */
                    m.reversed
                      ? "border-grey-200 bg-grey-50 opacity-60"
                      : m.isReversal
                        ? "border-grey-300 bg-white border-dashed"
                        : "border-grey-200 bg-white",
                  )}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-base text-ink-900">
                      {KIND_LABEL[m.kind]}
                    </span>
                    <span className={cn("tabular font-medium",
                      m.quantity > 0 ? "text-success" : "text-ink-900")}>
                      {m.quantity > 0 ? "+" : ""}{m.quantity} {item.unit}
                    </span>
                    {m.unitCost !== null && (
                      <span className="text-sm tabular text-grey-500">
                        at {money(m.unitCost)}/{item.unit}
                      </span>
                    )}
                    {m.reversed && <StatusPill tone="neutral">Undone</StatusPill>}
                    {m.isReversal && <StatusPill tone="neutral">An undo</StatusPill>}
                  </div>
                  <p className="text-sm text-grey-500 mt-0.5">
                    {dateShort(m.date)}
                    {m.who ? ` · ${m.who}` : ""}
                    {m.supplier ? ` · ${m.supplier}` : ""}
                    {m.reference ? ` · ${m.reference}` : ""}
                    {m.outlet ? ` · to ${m.outlet}` : ""}
                  </p>
                  {m.note && (
                    <p className="text-sm text-grey-600 mt-0.5">{m.note}</p>
                  )}
                </div>

                {/* Undoing is only offered on a row that is neither an
                    undo nor already undone. The server refuses both
                    anyway, in words. */}
                {mayUndo && !m.reversed && !m.isReversal && (
                  <button
                    type="button"
                    aria-label={`Undo this ${KIND_LABEL[m.kind].toLowerCase()}`}
                    onClick={() => void undo(m.id)}
                    className="size-11 grid place-items-center rounded-md
                               text-grey-500 hover:text-brand-red
                               hover:bg-red-50 cursor-pointer shrink-0"
                  >
                    <Undo2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
