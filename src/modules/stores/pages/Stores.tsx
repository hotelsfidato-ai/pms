import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  Package, Plus, TrendingDown, TrendingUp, Trash2, Undo2, AlertTriangle,
  Upload, CornerUpLeft, ClipboardCheck, History,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, timeOnly } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, ErrorState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  StatusPill, toast, Menu, MenuItem, MenuSeparator,
} from "@/components/ui";
import {
  getStore, getStockHistory, addStockItem, recordStockMovement,
  reverseStockMovement, importStockItems,
  type StockItem, type StockKind, type StockMovement,
} from "@/modules/stores/data/stores";
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

/* What a row in the history SAYS HAPPENED — past tense. */
const KIND_LABEL: Record<StockKind, string> = {
  receipt: "Received",
  issue: "Issued",
  wastage: "Wasted",
  adjustment: "Adjusted",
  return: "Returned",
};

/* What a button SAYS WILL HAPPEN — verb first (STO-8, the owner's words of
   16 September). It read "Received" on the button that did the receiving. */
const ACTION_LABEL: Record<StockKind, string> = {
  receipt: "Receive",
  issue: "Issue",
  wastage: "Record waste",
  adjustment: "Correct the count",
  return: "Return",
};

/* What an undo undid, as a noun: "Undo this delivery of 60 piece?" and, in
   the history, "Undo of a delivery" (STO-6). */
const NOUN: Record<StockKind, string> = {
  receipt: "delivery",
  issue: "issue",
  wastage: "waste",
  adjustment: "count correction",
  return: "return",
};
const withArticle = (noun: string) => `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;

/* LOOK, OR CHANGE (STO-1). The owner's table: `create` receives, issues,
   wastes, returns and adds; `edit` corrects a count and undoes. A person who
   may only look — housekeeping, the chef, the accountant, a viewer — gets ONE
   sentence and no change buttons, not four greyed buttons on every item: the
   owner's choice of 16 September, an exception to "greyed with its reason".
   The server refuses the same people whatever the screen draws. The role is
   the Inventory Manager (key `stores`) since 16 September. */
const LOOK_ONLY =
  "You can see the store. Receiving, issuing and adding items is for the "
  + "Inventory Manager, hotel manager or GM.";
const UNDO_NOT_YOURS =
  "Undoing a movement is for the Inventory Manager, hotel manager or GM.";

const NOTHING_ON_HAND = "Nothing on hand.";

/* "Everything else" is a CHOICE, not the absence of one (STO-10): the list
   starts with nothing picked, so linen is never filed under Kitchen because
   nobody noticed the default. */
const NO_CATEGORY = "__everything-else";

const unreachable = (error: unknown) =>
  error instanceof ApiError && error.status === 0;

export default function StoresPage() {
  const { code = "" } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const role = useRole();
  const mayChange = can(role, "create", "stock");
  const mayCorrect = can(role, "edit", "stock");

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

  /* ── Four states, not one (STO-2) ─────────────────────────────────
     The read used to swallow its failure, so an unreadable store drew
     "Nothing in the store yet — Add the first". Now, as on Rooms and the
     till: offline with nothing saved says so and loads by itself; a failed
     read with nothing to show says it did not load, with Try again; a
     failed REFRESH keeps the last good list and says it is not current. */
  const body = (() => {
    if (q.data === undefined) {
      if (q.isPaused) {
        return (
          <ErrorState
            title="No connection"
            description="This device is offline, so the store cannot load. It loads by itself as soon as the connection is back."
          />
        );
      }
      if (q.isError) {
        return (
          <ErrorState
            title="The store did not load"
            error={q.error}
            description={unreachable(q.error)
              ? "Could not reach the server, and there is no store from earlier to show in its place. Check the connection, then try again."
              : undefined}
            onRetry={() => void q.refetch()}
          />
        );
      }
      return <Skeleton className="h-64" />;
    }

    if (items.length === 0) {
      return (
        <EmptyState
          icon={<Package />}
          title="Nothing in the store yet"
          description={
            "Add what the property keeps and what it is counted in. Receiving "
            + "a delivery is what gives it a quantity and a value — an item on "
            + "its own has neither, and shows a dash rather than a zero."
          }
          action={mayChange
            ? <Button variant="primary" onClick={() => setAdding(true)}>Add the first</Button>
            : undefined}
        />
      );
    }

    return [...byCategory.entries()].map(([category, group]) => (
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
              mayCorrect={mayCorrect}
              onMove={(kind) => setMoving({ item: i, kind })}
              onHistory={() => setHistory(i)}
            />
          ))}
        </ul>
      </section>
    ));
  })();

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
            {/* The Store's one main action (STO-8). */}
            <Button variant="primary" className="h-11" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add an item
            </Button>
          </div>
        )}
      />

      {!mayChange && (
        <p className="text-sm text-grey-600">{LOOK_ONLY}</p>
      )}

      {q.data !== undefined && q.isError && (
        <div role="status"
             className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border
                        border-amber-300 bg-amber-50 px-3.5 py-2">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          <p className="text-sm text-ink-900 min-w-0">
            Not up to date: {unreachable(q.error) ? "no connection" : "the store did not refresh"}.
            {q.dataUpdatedAt > 0 && ` Showing what loaded at ${timeOnly(new Date(q.dataUpdatedAt))}.`}
          </p>
          <button type="button" onClick={() => void q.refetch()}
                  className="text-sm font-medium text-ink-900 underline underline-offset-2
                             hover:no-underline cursor-pointer">
            Try again
          </button>
        </div>
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

      {body}

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
        <HistoryDialog code={code} item={history} open mayUndo={mayCorrect}
                       onOpenChange={(o) => { if (!o) setHistory(null); }}
                       onChanged={refresh} />
      )}
    </Page>
  );
}

/* ── One thing on the shelf ───────────────────────────────────────── */

function ItemRow({ item, mayChange, mayCorrect, onMove, onHistory }: {
  item: StockItem;
  mayChange: boolean;
  mayCorrect: boolean;
  onMove: (kind: StockKind) => void;
  onHistory: () => void;
}) {
  const empty = item.onHand <= 0;
  const neverMoved = item.movements === 0;

  return (
    <li>
      <Card className={cn(item.low && "border-amber-300")}>
        {/* ON A PHONE THE NAME HAS ITS OWN LINE (STO-3). It shared a row with
            On hand and Worth and got what was left — 69 to 86 pixels, so
            "LPG cylinder 19 kg commercial" took four lines and its card 480. */}
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
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

          {/* RECEIVE · ISSUE · MORE (STO-5 and STO-7, the owner's layout).
              The rare acts go in the menu, each with a word — the bin had
              none — and a greyed one says why. A look-only person gets
              History alone.

              ONE ROW ON A PHONE. With their arrows the three need 305px and
              the card gives 294 at 375 wide — less on a 360px phone — so More
              wrapped under the other two. The
              arrows show from `sm` up; the words are what is read. */}
          <div className="flex flex-wrap gap-2 basis-full xl:basis-auto">
            {mayChange ? (
              <>
                <Button variant="secondary" className="h-11"
                        onClick={() => onMove("receipt")}>
                  <TrendingUp className="size-4 hidden sm:block" /> Receive
                </Button>
                <Button variant="secondary" className="h-11"
                        disabled={empty}
                        onClick={() => onMove("issue")}>
                  <TrendingDown className="size-4 hidden sm:block" /> Issue
                </Button>
                <Menu label="More">
                  <MenuItem icon={Trash2} disabled={empty} reason={NOTHING_ON_HAND}
                            onSelect={() => onMove("wastage")}>
                    Waste
                  </MenuItem>
                  <MenuItem icon={CornerUpLeft} disabled={empty} reason={NOTHING_ON_HAND}
                            onSelect={() => onMove("return")}>
                    Return to supplier
                  </MenuItem>
                  {mayCorrect && (
                    <MenuItem icon={ClipboardCheck} onSelect={() => onMove("adjustment")}>
                      Correct the count
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  <MenuItem icon={History} disabled={neverMoved}
                            reason="Nothing has moved yet." onSelect={onHistory}>
                    History
                  </MenuItem>
                </Menu>
              </>
            ) : (
              <Button variant="secondary" className="h-11"
                      disabled={neverMoved}
                      onClick={onHistory}>
                History
              </Button>
            )}
          </div>

          {mayChange && empty && (
            <p className="basis-full text-sm text-grey-600">
              Nothing on hand to issue — receive a delivery first.
            </p>
          )}
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
  const [category, setCategory] = useState("");
  const [reorder, setReorder] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = !!name.trim() && !!unit.trim() && category !== "";

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    const res = await addStockItem(code, {
      name: name.trim(),
      unit: unit.trim(),
      category: category === NO_CATEGORY ? undefined : category,
      reorderLevel: reorder.trim() === "" ? null : Number(reorder),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    toast.success(`${name.trim()} added`,
      "Receiving a delivery is what gives it a quantity and a value.");
    setName(""); setUnit(""); setCategory(""); setReorder("");
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
                    disabled={!ready || busy}
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
          <Field label="Where it belongs" required
                 hint="Pick one before adding — Everything else is a choice too.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={category}
                            onChange={(e) => setCategory(e.target.value)}>
                <option value="" disabled>Choose where it belongs</option>
                <option>Kitchen</option>
                <option>Bar</option>
                <option>Housekeeping</option>
                <option>Maintenance</option>
                <option value={NO_CATEGORY}>Everything else</option>
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

/* ── Something came in, went out, or the shelf disagreed ──────────── */

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
  const isReturn = kind === "return";
  const isCount = kind === "adjustment";

  /* CORRECT THE COUNT asks what the SHELF holds, not by how much the book is
     wrong: a person counts what is in front of them. The difference is what
     gets recorded — signed, the one kind that may go either way. */
  const counted = qty.trim() === "" ? null : Number(qty);
  const difference = counted === null || !Number.isFinite(counted)
    ? null : Math.round((counted - item.onHand) * 1000) / 1000;
  const matches = isCount && difference === 0;

  const quantity = isCount ? difference : (qty.trim() === "" ? null : Number(qty));
  const ready = quantity !== null && Number.isFinite(quantity) && quantity !== 0
    && (isCount ? (counted ?? -1) >= 0 : quantity > 0);

  const submit = async () => {
    if (busy || !ready || quantity === null) return;
    setBusy(true);
    const res = await recordStockMovement(code, {
      itemId: item.id,
      kind,
      /* POSITIVE, except a correction. The kind decides the direction and
         the server applies the sign — a screen that has to remember to send
         -5 for an issue will one day send 5 and quietly double the stock. */
      quantity,
      ...(isReceipt && cost.trim() !== "" ? { unitCost: Number(cost) } : {}),
      ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not recorded", res.reason);

    toast.success(
      isCount
        ? `Count corrected — ${item.name}`
        : `${KIND_LABEL[kind]} ${qty} ${item.unit} of ${item.name}`,
      `${res.onHand} ${res.unit} on hand.`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${ACTION_LABEL[kind]} — ${item.name}`}
        description={`${item.onHand} ${item.unit} on hand`}
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="h-11" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Recording…" : ACTION_LABEL[kind]}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={isCount ? `What the shelf holds now, in ${item.unit}` : `How many ${item.unit}`}
                 required
                 hint={isCount
                   ? `The book says ${item.onHand} ${item.unit}. Count what is there; the difference is recorded.`
                   : undefined}>
            {(f) => (
              <Input {...fieldProps(f)} value={qty} inputMode="decimal"
                     onChange={(e) => setQty(e.target.value)} />
            )}
          </Field>

          {isCount && difference !== null && (
            <p className="text-sm text-grey-600" role="status">
              {matches
                ? "The shelf already matches the book — there is nothing to record."
                : `That is ${Math.abs(difference)} ${item.unit} ${difference > 0 ? "more" : "fewer"} than the book says.`}
            </p>
          )}

          {isReceipt && (
            <>
              <Field label={`What it cost, per ${item.unit}`}
                     hint="Leave blank if the bill has not arrived. A cost can only be added later by undoing this delivery and receiving it again — what it must not be is a guess.">
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
          )}

          {isReturn && (
            <Field label="Who it goes back to">
              {(f) => (
                <Input {...fieldProps(f)} value={supplier}
                       placeholder="Kirana Bros"
                       onChange={(e) => setSupplier(e.target.value)} />
              )}
            </Field>
          )}

          {!isReceipt && (
            <Field label="Why" hint={
              kind === "wastage"
                ? "Spoiled, broken, past its date. Somebody will ask at the end of the month."
                : isReturn
                  ? "Damaged, the wrong thing, more than was ordered."
                  : isCount
                    ? "What the count found, and who counted."
                    : "Where it went."
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
  const [confirming, setConfirming] = useState<StockMovement | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["stock-history", code, item.id],
    queryFn: () => getStockHistory(code, item.id),
    enabled: open,
  });

  const undo = async (m: StockMovement) => {
    setBusy(true);
    const res = await reverseStockMovement(code, m.id);
    setBusy(false);
    setConfirming(null);
    if (!res.ok) return toast.error("Not undone", res.reason);
    toast.success("Undone",
      "Both rows stay on the history — the store's past is what somebody "
      + "reads when the count is wrong.");
    void qc.invalidateQueries({ queryKey: ["stock-history", code, item.id] });
    onChanged();
  };

  const rows = q.data ?? [];

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
        {q.data === undefined && q.isError ? (
          <ErrorState
            className="py-8"
            title="The history did not load"
            error={q.error}
            description={unreachable(q.error)
              ? "Could not reach the server. Check the connection, then try again."
              : undefined}
            onRetry={() => void q.refetch()}
          />
        ) : q.data === undefined ? (
          <Skeleton className="h-40" />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<History />}
                      title="Nothing has moved yet"
                      description="A delivery, an issue or a count will show here." />
        ) : (
          <ul className="space-y-1.5">
            {rows.map((m) => (
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
                      {m.isReversal && m.reversesKind
                        ? `Undo of ${withArticle(NOUN[m.reversesKind])}`
                        : KIND_LABEL[m.kind]}
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

                {/* Undoing is only offered on a row that is neither an undo
                    nor already undone, to somebody who may undo — and it
                    ASKS FIRST (STO-6): one tap wrote a reversal that cannot
                    itself be reversed. */}
                {mayUndo && !m.reversed && !m.isReversal && (
                  <button
                    type="button"
                    aria-label={`Undo this ${NOUN[m.kind]}`}
                    onClick={() => setConfirming(m)}
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

        {confirming && (
          <Dialog open onOpenChange={(o) => { if (!o) setConfirming(null); }}>
            <DialogContent
              title={`Undo this ${NOUN[confirming.kind]} of ${Math.abs(confirming.quantity)} ${item.unit}?`}
              footer={
                <>
                  <Button variant="secondary" className="h-11"
                          onClick={() => setConfirming(null)}>Cancel</Button>
                  <Button variant="danger" className="h-11" disabled={busy}
                          onClick={() => void undo(confirming)}>
                    {busy ? "Undoing…" : `Undo ${NOUN[confirming.kind]}`}
                  </Button>
                </>
              }
            >
              <p className="text-base text-grey-600 leading-relaxed">
                It cannot be taken back — to put it right afterwards, record it again.
              </p>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
