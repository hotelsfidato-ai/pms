import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  Package, Plus, TrendingDown, TrendingUp, Trash2, Undo2, AlertTriangle,
  Upload, CornerUpLeft, ClipboardCheck, History, ArrowLeftRight, Bell,
  ClipboardList, Printer,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, timeOnly } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { useDocumentIdentity } from "@/lib/documentIdentity";
import {
  Page, PageHeader, Card, Button, Skeleton, EmptyState, ErrorState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  StatusPill, IconChip, InfoButton, toast, Menu, MenuItem, MenuSeparator,
} from "@/components/ui";
import {
  getStore, getStockHistory, addStockItem, recordStockMovement, moveStock,
  reverseStockMovement, importStockItems, setStockItem, saveStockCount,
  type StockItem, type StockKind, type StockMovement, type MovementKind, type StoreSummary,
  type CountLine,
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
   The same rule as every price in this system. Since 17 September the
   dash a person reads is the short "-" (D17-49); the long one is gone
   from every screen (D17-48, D17-60).

   NOTHING IS EDITED. A delivery entered against the wrong item is
   undone by a row that points at it, and both stay on the history.
   Somebody has to be able to ask why the rice says forty kilos and get
   an answer that goes back to a delivery note.

   PER STORE since 17 September (migration 112, the owner's answers): one
   list with a store picked at the top; every act happens in a named store;
   moving stock between stores is one act, and so is undoing it.
   ══════════════════════════════════════════════════════════════════ */

/* What a row in the history SAYS HAPPENED — past tense. */
const KIND_LABEL: Record<MovementKind, string> = {
  receipt: "Received",
  issue: "Issued",
  wastage: "Wasted",
  adjustment: "Adjusted",
  return: "Returned",
  transfer: "Moved",
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
const NOUN: Record<MovementKind, string> = {
  receipt: "delivery",
  issue: "issue",
  wastage: "waste",
  adjustment: "count correction",
  return: "return",
  transfer: "move",
};
const withArticle = (noun: string) => `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;

/* EMPTY CYLINDERS in the history (D25-18): back from the kitchen on an issue,
   to the supplier on a delivery, or counted. */
const EMPTY_LABEL: Partial<Record<MovementKind, string>> = {
  receipt: "Empties back from the kitchen",
  return: "Empties to the supplier",
  adjustment: "Empties counted",
};
const nounOf = (m: StockMovement) => (m.empty ? "record of empties" : NOUN[m.kind]);

/* LOOK, OR CHANGE (STO-1). The owner's table: `create` receives, issues,
   wastes, returns, moves and adds; `edit` corrects a count and undoes. A person
   who may only look — housekeeping, the chef, the accountant, a viewer — gets
   ONE sentence and no change buttons, not four greyed buttons on every item: the
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

/* The picker's "every store together". */
const ALL_STORES = "__all-stores";

/* "Main store" reads "Main" in an item's line of stores, as the owner's
   layout drew it: "Main 30 · Kitchen 8 · Bar -". */
const shortName = (name: string) => name.replace(/\s+store$/i, "") || name;

/* A figure a person reads, where nothing is held: "-" (D17-49). */
const heldText = (n: number | null | undefined) => (n === null || n === undefined ? "-" : String(n));

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
  const [transferring, setTransferring] = useState<StockItem | null>(null);
  const [history, setHistory] = useState<StockItem | null>(null);
  const [levelling, setLevelling] = useState<StockItem | null>(null);
  const [counting, setCounting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [storeId, setStoreId] = useState(ALL_STORES);

  const q = useQuery({
    queryKey: ["stores", code],
    queryFn: () => getStore(code),
    enabled: !!code,
  });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["stores", code] }); };

  const stores = q.data?.stores ?? [];
  const items = q.data?.items ?? [];
  /* The store picked at the top, or null for every store together. A store
     that has left the list — switched off and emptied — falls back to all. */
  const picked = stores.find((s) => s.id === storeId) ?? null;

  /* What the screen shows for an item: the whole hotel, or the picked store.
     Null where the picked store holds none of it — a dash. */
  const shownOnHand = (i: StockItem): number | null =>
    picked ? (i.byStore[picked.id] ?? null) : i.onHand;
  const shownValue = (i: StockItem): number | null => {
    if (!picked) return i.value;
    const here = shownOnHand(i);
    return here === null || i.unitCost === null
      ? null : Math.round(here * i.unitCost * 100) / 100;
  };

  /* THE BELOW-LEVEL LIST (D25-14): each item at or below its level, in which
     store - the picked one only, when one is picked. It only shows; buying is
     Purchasing's screen. */
  const below = items.flatMap((i) => i.lowIn
    .filter((s) => !picked || s === picked.id)
    .flatMap((s) => {
      const store = stores.find((x) => x.id === s);
      return store ? [{ item: i, store }] : [];
    }));
  const belowItems = new Set(below.map((b) => b.item.id)).size;
  /* Only what has a value. An item nobody has received contributes
     nothing to a total rather than zero — and if EVERYTHING is unpriced
     the total is a dash, not ₹0. */
  const priced = items.filter((i) => shownValue(i) !== null);
  const total = priced.reduce((n, i) => n + (shownValue(i) ?? 0), 0);

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
            + "a delivery is what gives it a quantity and a value - an item on "
            + "its own has neither, and shows a dash rather than a zero."
          }
          action={mayChange
            ? <Button variant="primary" onClick={() => setAdding(true)}>Add the first</Button>
            : undefined}
        />
      );
    }

    /* Groups 24px apart, a heading 12px over its cards, cards 12px apart
       (the fidato-design Rhythm Rule). */
    return [...byCategory.entries()].map(([category, group]) => (
      <section key={category} className="mb-6 last:mb-0">
        {/* A flat count pill, as Rooms' group headings have (D27-82). */}
        <h2 className="flex items-center gap-2 mb-3 text-md font-semibold text-ink-900">
          {category}
          <span className="h-5 px-2 rounded-full bg-grey-100 text-grey-600 text-xs font-semibold leading-5 tabular">
            {group.length}
          </span>
        </h2>
        <ul className="space-y-3">
          {group.map((i) => (
            <ItemRow
              key={i.id}
              item={i}
              stores={stores}
              picked={picked}
              onHand={shownOnHand(i)}
              value={shownValue(i)}
              mayChange={mayChange}
              mayCorrect={mayCorrect}
              onMove={(kind) => setMoving({ item: i, kind })}
              onTransfer={() => setTransferring(i)}
              onHistory={() => setHistory(i)}
              onLevels={() => setLevelling(i)}
            />
          ))}
        </ul>
      </section>
    ));
  })();

  /* The count replaces the list, so the sheet prints on its own. */
  if (counting && q.data !== undefined) {
    return (
      <CountSheet code={code} stores={stores} items={items}
                  startStoreId={picked?.id ?? null}
                  reload={async () => (await q.refetch()).data?.items ?? items}
                  onDone={(saved) => { setCounting(false); if (saved) refresh(); }} />
    );
  }

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Store"
        description={
          items.length === 0
            ? "What the property keeps - rice, gas, linen, soap."
            : `${items.length} item${items.length === 1 ? "" : "s"}`
              + (priced.length > 0
                  ? ` · ${money(total)} ${picked ? `in ${picked.name}` : "on the shelf"}`
                    + (priced.length < items.length
                        ? `, ${items.length - priced.length} not yet valued`
                        : "")
                  : " · nothing received yet, so nothing has a value")
        }
        actions={mayChange && (
          <div className="flex flex-wrap gap-2">
            {/* A store is a hundred lines long. The same argument the
                menu import is built on. */}
            <Button variant="secondary"
                    onClick={() => setImporting(true)}>
              <Upload className="size-4" /> Import
            </Button>
            {/* THE COUNT (D25-15..17): whoever corrects a count. */}
            {mayCorrect && items.length > 0 && (
              <Button variant="secondary" disabled={q.data === undefined}
                      onClick={() => setCounting(true)}>
                <ClipboardList className="size-4" /> Count a store
              </Button>
            )}
            {/* The Store's one main action (STO-8). */}
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add an item
            </Button>
          </div>
        )}
      />

      {!mayChange && (
        <p className="text-sm text-grey-600 mb-5">{LOOK_ONLY}</p>
      )}

      {/* WHICH STORE (the owner's layout, 17 September). "All stores" shows
          each item's total and what each store holds; one store shows only
          what is in it, and its dialogs start there. */}
      {stores.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-5">
          <label htmlFor="store-picker" className="text-sm font-medium text-grey-700">
            Store
          </label>
          <NativeSelect id="store-picker" className="w-auto min-w-52"
                        value={picked?.id ?? ALL_STORES}
                        onChange={(e) => setStoreId(e.target.value)}>
            <option value={ALL_STORES}>All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.isActive ? s.name : `${s.name} (switched off)`}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      {q.data !== undefined && q.isError && (
        <div role="status"
             className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-5 rounded-lg
                        bg-brand-yellow-50 ring-1 ring-inset ring-brand-yellow-100 px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-brand-yellow-800" />
          <p className="text-sm text-ink-900 min-w-0">
            Not up to date: {unreachable(q.error) ? "no connection" : "the store did not refresh"}.
            {q.dataUpdatedAt > 0 && ` Showing what loaded at ${timeOnly(new Date(q.dataUpdatedAt))}.`}
          </p>
          {/* A text link is orange (the Tappable Rule). */}
          <button type="button" onClick={() => void q.refetch()}
                  className="text-sm font-medium text-brand-orange-700 hover:underline
                             underline-offset-4 cursor-pointer">
            Try again
          </button>
        </div>
      )}

      {/* Something to do (buy it), so the warm tile: the yellow wash, its
          chip, and the list under the heading. */}
      {below.length > 0 && (
        <div className="flex items-start gap-3 mb-5 rounded-lg bg-brand-yellow-50
                        ring-1 ring-inset ring-brand-yellow-100 px-4 py-3.5">
          <IconChip tone="yellow"><AlertTriangle /></IconChip>
          <div className="text-sm text-ink-900 leading-relaxed min-w-0">
            <p className="font-medium">
              {/* Items, not lines: one item can be low in two stores. */}
              {belowItems === 1 ? "One item is" : `${belowItems} items are`} at
              or below the level set for {picked ? picked.name : "a store"}
            </p>
            <ul data-below-list="" className="mt-1 text-grey-600">
              {below.map(({ item, store }) => (
                <li key={`${item.id}:${store.id}`} className="tabular">
                  {item.name} - {store.name}:{" "}
                  {item.byStore[store.id] === undefined ? "none" : `${item.byStore[store.id]} ${item.unit}`},
                  level {item.levels[store.id]}
                </li>
              ))}
            </ul>
          </div>
        </div>
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
        <AddItemDialog code={code} open mayLevel={mayCorrect}
                       onOpenChange={(o) => { if (!o) setAdding(false); }}
                       onAdded={() => { setAdding(false); refresh(); }} />
      )}
      {moving && (
        <MoveDialog code={code} item={moving.item} kind={moving.kind}
                    stores={stores} startStoreId={picked?.id ?? null}
                    outlets={q.data?.outlets ?? []} open
                    onOpenChange={(o) => { if (!o) setMoving(null); }}
                    onDone={() => { setMoving(null); refresh(); }} />
      )}
      {transferring && (
        <TransferDialog code={code} item={transferring}
                        stores={stores} startFromId={picked?.id ?? null} open
                        onOpenChange={(o) => { if (!o) setTransferring(null); }}
                        onDone={() => { setTransferring(null); refresh(); }} />
      )}
      {history && (
        <HistoryDialog code={code} item={history} open mayUndo={mayCorrect}
                       onOpenChange={(o) => { if (!o) setHistory(null); }}
                       onChanged={refresh} />
      )}
      {levelling && (
        <LevelsDialog code={code} item={levelling} stores={stores} open
                      onOpenChange={(o) => { if (!o) setLevelling(null); }}
                      onDone={() => { setLevelling(null); refresh(); }} />
      )}
    </Page>
  );
}

/* ── One thing on the shelf ───────────────────────────────────────── */

function ItemRow({
  item, stores, picked, onHand, value, mayChange, mayCorrect, onMove, onTransfer, onHistory, onLevels,
}: {
  item: StockItem;
  stores: StoreSummary[];
  picked: StoreSummary | null;
  onHand: number | null;
  value: number | null;
  mayChange: boolean;
  mayCorrect: boolean;
  onMove: (kind: StockKind) => void;
  onTransfer: () => void;
  onHistory: () => void;
  onLevels: () => void;
}) {
  const empty = onHand === null || onHand <= 0;
  const neverMoved = item.movements === 0;
  const openStores = stores.filter((s) => s.isActive);
  const low = picked ? item.lowIn.includes(picked.id) : item.low;
  /* LEVELS PER STORE (D25-12): only the ones set; a store with none is not
     named, and none set at all says so. */
  const levelText = picked
    ? (item.levels[picked.id] === undefined
        ? `No level in ${picked.name}`
        : `Warn at ${item.levels[picked.id]} ${item.unit}`)
    : (Object.keys(item.levels).length === 0
        ? "No level set"
        : "Warn at " + stores.filter((s) => item.levels[s.id] !== undefined)
            .map((s) => `${shortName(s.name)} ${item.levels[s.id]}`).join(" · "));
  const emptiesShown = picked ? (item.emptiesByStore[picked.id] ?? null) : item.empties;

  return (
    <li>
      <Card className={cn(low && "border-brand-yellow")}>
        {/* ON A PHONE THE NAME HAS ITS OWN LINE (STO-3). It shared a row with
            On hand and Worth and got what was left — 69 to 86 pixels, so
            "LPG cylinder 19 kg commercial" took four lines and its card 480.
            TOP-ALIGNED, so every figure sits on one line under its one-line
            label whatever the note under Worth adds (the Level Rule). */}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-3.5">
          <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-md font-semibold text-ink-900">{item.name}</p>
              {low && <StatusPill tone="warning">Low</StatusPill>}
            </div>
            <p className="text-sm text-grey-500 mt-0.5">
              {levelText}
              {item.lastMovement
                ? ` · last moved ${dateShort(item.lastMovement)}`
                : " · never moved"}
            </p>
          </div>

          <div>
            <p className="text-sm text-grey-500">
              {item.cylinder ? (picked ? `Full in ${picked.name}` : "Full") : picked ? `In ${picked.name}` : "On hand"}
            </p>
            <p className={cn("text-xl leading-7 font-semibold tabular",
              onHand === null ? "text-grey-500" : "text-ink-900")}>
              {heldText(onHand)}{" "}
              {onHand !== null && <span className="text-sm font-normal text-grey-500">{item.unit}</span>}
            </p>
          </div>

          {/* FULL AND EMPTY (D25-18). */}
          {item.cylinder && (
            <div>
              <p className="text-sm text-grey-500">Empty</p>
              <p className={cn("text-xl leading-7 font-semibold tabular",
                emptiesShown === null ? "text-grey-500" : "text-ink-900")}>
                {heldText(emptiesShown)}{" "}
                {emptiesShown !== null && <span className="text-sm font-normal text-grey-500">{item.unit}</span>}
              </p>
            </div>
          )}

          <div>
            <p className="text-sm text-grey-500">Worth</p>
            {/* A DASH. Nothing has been received, so nothing has been
                paid, and zero would say it is worthless. */}
            <p className={cn("text-xl leading-7 font-semibold tabular",
              value === null ? "text-grey-500" : "text-ink-900")}>
              {value === null ? "-" : money(value)}
            </p>
            {item.unitCost !== null && (
              <p className="text-xs text-grey-500 tabular">
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
              wrapped under the other two. The arrows show from `sm` up; the
              words are what is read.

              44px, not the capsule's 36: they sit beside the menu's trigger,
              which is 44 (the kit's Menu), and a row of buttons shares a
              height. */}
          <div className="flex flex-wrap gap-2 basis-full xl:basis-auto xl:self-center">
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
                  <MenuItem icon={ArrowLeftRight}
                            disabled={empty || openStores.length < 2}
                            reason={empty ? NOTHING_ON_HAND : "There is only one store."}
                            onSelect={onTransfer}>
                    Move to another store
                  </MenuItem>
                  {mayCorrect && (
                    <MenuItem icon={ClipboardCheck} onSelect={() => onMove("adjustment")}>
                      Correct the count
                    </MenuItem>
                  )}
                  {mayCorrect && (
                    <MenuItem icon={Bell} onSelect={onLevels}>
                      {item.cylinder ? "Set levels and deposit" : "Set levels"}
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
              <Button variant="secondary"
                      disabled={neverMoved}
                      onClick={onHistory}>
                History
              </Button>
            )}
          </div>
        </div>

        {/* THE ITEM'S ROWS, under one hairline (the Figure Rule): what each
            store holds, the deposit, and why Issue is grey. */}
        {((!picked && stores.length > 1) || item.cylinder || (mayChange && empty)) && (
          <div className="border-t border-grey-100 px-4 py-3 space-y-1">
            {/* WHAT EACH STORE HOLDS, on "All stores" — the owner's layout:
                "Main 30 · Kitchen 8 · Bar -". */}
            {!picked && stores.length > 1 && (
              <p className="text-sm text-grey-600 tabular" data-store-line="">
                {stores.map((s) => `${shortName(s.name)} ${heldText(item.byStore[s.id])}`).join(" · ")}
              </p>
            )}

            {/* THE DEPOSIT THE SUPPLIER HOLDS (D25-19, D17-4): typed on the item,
                a dash until it is. At the kitchen is on deposit less full and
                empty in the stores - and when that is below nothing the figures
                disagree, which is said rather than printed as a minus. */}
            {item.cylinder && (
              <p className="text-sm text-grey-600 tabular" data-deposit-line="">
                On deposit {heldText(item.cylindersOnDeposit)}
                {" · "}{item.depositPerCylinder === null ? "-" : money(item.depositPerCylinder)} each
                {" · "}{item.depositHeld === null ? "-" : money(item.depositHeld)} held
                {" · "}{item.inUse !== null && item.inUse < 0
                  ? "more in the stores than on deposit - check the count or the deposit"
                  : `${heldText(item.inUse)} in use at the kitchen`}
              </p>
            )}

            {mayChange && empty && (
              <p className="text-sm text-grey-600">
                {picked
                  ? `Nothing in ${picked.name} to issue - receive a delivery first.`
                  : "Nothing on hand to issue - receive a delivery first."}
              </p>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

/* ── Adding something to keep ─────────────────────────────────────── */

function AddItemDialog({ code, open, mayLevel, onOpenChange, onAdded }: {
  code: string; open: boolean;
  /** Setting a level is `edit` (D25-13); the kitchen manager adds without one. */
  mayLevel: boolean;
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
            <Button variant="secondary"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary"
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
                 hint="Pick one before adding - Everything else is a choice too.">
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
          {mayLevel && (
            <Field label="Warn me below, in the Main store"
                   hint="Leave blank for no warning. Blank is not zero - zero would mean warn me when it has run out, which is much too late. Other stores' levels are set from the item's More menu.">
              {(f) => (
                <Input {...fieldProps(f)} value={reorder} inputMode="decimal"
                       placeholder="20"
                       onChange={(e) => setReorder(e.target.value)} />
              )}
            </Field>
          )}
          <p className="text-sm text-grey-600 rounded-lg border border-grey-200
                        bg-grey-50 px-3.5 py-3 leading-relaxed">
            No price here. A <em>delivery</em> has a price - the same rice
            costs differently in June and October - so the cost is recorded
            when it arrives, and what the shelf is worth is the average of
            what was actually paid.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Which store, in a dialog ─────────────────────────────────────── */

/* The store a dialog starts on (the owner, 17 September): the one picked at
   the top, else the Main store — one tap to change it. */
function startingStore(offered: StoreSummary[], startId: string | null): string {
  if (startId && offered.some((s) => s.id === startId)) return startId;
  return offered.find((s) => s.isMain)?.id ?? offered[0]?.id ?? "";
}

function StoreField({ label, value, onChange, stores, item, hint }: {
  label: string; value: string; onChange: (id: string) => void;
  stores: StoreSummary[]; item: StockItem; hint?: string;
}) {
  return (
    <Field label={label} required hint={hint}>
      {(f) => (
        <NativeSelect {...fieldProps(f)} value={value}
                      onChange={(e) => onChange(e.target.value)}>
          {value === "" && <option value="" disabled>Choose a store</option>}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({heldText(item.byStore[s.id])}{item.byStore[s.id] !== undefined ? ` ${item.unit}` : ""})
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

/* ── Something came in, went out, or the shelf disagreed ──────────── */

/** The picker's answer for an issue that went to no outlet; sent as null. */
const NOT_AN_OUTLET = "none";

function MoveDialog({ code, item, kind, stores, startStoreId, outlets, open, onOpenChange, onDone }: {
  code: string; item: StockItem; kind: StockKind;
  stores: StoreSummary[]; startStoreId: string | null;
  outlets: { id: string; name: string }[];
  open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  /* A switched-off store takes nothing in; what is already in one may still
     go out, be wasted, returned or counted (the server holds the same rule). */
  const offered = kind === "receipt" ? stores.filter((s) => s.isActive) : stores;
  const [storeId, setStoreId] = useState(() => startingStore(offered, startStoreId));
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [outletId, setOutletId] = useState("");
  const [busy, setBusy] = useState(false);

  const store = offered.find((s) => s.id === storeId) ?? null;
  const here = store ? (item.byStore[store.id] ?? 0) : 0;

  const isReceipt = kind === "receipt";
  const isReturn = kind === "return";
  const isCount = kind === "adjustment";

  /* CORRECT THE COUNT asks what the SHELF holds, not by how much the book is
     wrong: a person counts what is in front of them. The difference is what
     gets recorded — signed, the one kind that may go either way. In ONE
     store: the count is of one store's shelf. */
  const counted = qty.trim() === "" ? null : Number(qty);
  const difference = counted === null || !Number.isFinite(counted)
    ? null : Math.round((counted - here) * 1000) / 1000;
  const matches = isCount && difference === 0;

  /* WHERE AN ISSUE WENT IS ALWAYS SAID (D22-20; the owner, 24 September:
     "must choose each time"). An outlet, or "Not an outlet" for
     housekeeping or a floor - nothing is chosen for the person. */
  const needsOutlet = kind === "issue" && outlets.length > 0;

  /* THE SWAP (D25-18): a cylinder issued asks how many empties came back; a
     delivery, how many empties the supplier took. Typed every time - nothing
     is filled in for the person, and 0 is an answer. */
  const asksEmpties = item.cylinder && (kind === "issue" || isReceipt);
  const [empties, setEmpties] = useState("");
  const emptiesN = empties.trim() === "" ? null : Number(empties);
  const emptiesHere = store ? (item.emptiesByStore[store.id] ?? 0) : 0;
  const emptiesOk = !asksEmpties
    || (emptiesN !== null && Number.isFinite(emptiesN) && emptiesN >= 0);

  const quantity = isCount ? difference : (qty.trim() === "" ? null : Number(qty));
  const ready = store !== null && quantity !== null && Number.isFinite(quantity) && quantity !== 0
    && (isCount ? (counted ?? -1) >= 0 : quantity > 0)
    && (!needsOutlet || outletId !== "") && emptiesOk;

  const submit = async () => {
    if (busy || !ready || quantity === null || !store) return;
    setBusy(true);
    const res = await recordStockMovement(code, {
      itemId: item.id,
      kind,
      locationId: store.id,
      /* POSITIVE, except a correction. The kind decides the direction and
         the server applies the sign — a screen that has to remember to send
         -5 for an issue will one day send 5 and quietly double the stock. */
      quantity,
      ...(isReceipt && cost.trim() !== "" ? { unitCost: Number(cost) } : {}),
      ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(needsOutlet ? { outletId: outletId === NOT_AN_OUTLET ? null : outletId } : {}),
      ...(asksEmpties && emptiesN !== null
        ? (isReceipt ? { emptiesTaken: emptiesN } : { emptiesBack: emptiesN }) : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not recorded", res.reason);

    toast.success(
      isCount
        ? `Count corrected - ${item.name}`
        : `${KIND_LABEL[kind]} ${qty} ${item.unit} of ${item.name}`,
      item.cylinder && res.emptiesHere !== null
        ? `${res.onHandHere} full and ${res.emptiesHere} empty in ${res.store}.`
        : `${res.onHandHere} ${res.unit} in ${res.store}.`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${ACTION_LABEL[kind]} - ${item.name}`}
        description={!store
          ? "Choose a store"
          : item.byStore[store.id] === undefined
            /* None held there: said in words, not "0" beside a store the list
               shows as "-". */
            ? `None in ${store.name}`
            : `${here} ${item.unit} in ${store.name}`}
        footer={
          <>
            <Button variant="secondary"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Recording…" : ACTION_LABEL[kind]}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <StoreField label="Which store" value={storeId} onChange={setStoreId}
                      stores={offered} item={item} />

          <Field label={isCount ? `What the shelf holds now, in ${item.unit}` : `How many ${item.unit}`}
                 required
                 hint={isCount && store
                   ? `The book says ${here} ${item.unit} in ${store.name}. Count what is there; the difference is recorded.`
                   : undefined}>
            {(f) => (
              <Input {...fieldProps(f)} value={qty} inputMode="decimal"
                     onChange={(e) => setQty(e.target.value)} />
            )}
          </Field>

          {/* WHICH OUTLET IT WENT TO (D22-20): the hotel's own outlets. Not
              every issue goes to one - housekeeping has none (069). */}
          {needsOutlet && (
            <Field label="Which outlet" required
                   hint="Not an outlet, for housekeeping or a floor.">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={outletId}
                              onChange={(e) => setOutletId(e.target.value)}>
                  <option value="">Choose…</option>
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  <option value={NOT_AN_OUTLET}>Not an outlet</option>
                </NativeSelect>
              )}
            </Field>
          )}

          {asksEmpties && (
            <Field label={isReceipt ? "Empties the supplier took back" : "Empties back from the kitchen"}
                   required
                   hint={isReceipt && store
                     ? `${emptiesHere} empty in ${store.name}. 0 if none went back.`
                     : "0 if none came back."}>
              {(f) => (
                <Input {...fieldProps(f)} value={empties} inputMode="numeric"
                       onChange={(e) => setEmpties(e.target.value)} />
              )}
            </Field>
          )}

          {isCount && difference !== null && (
            <p className="text-sm text-grey-600" role="status">
              {matches
                ? "The shelf already matches the book - there is nothing to record."
                : `That is ${Math.abs(difference)} ${item.unit} ${difference > 0 ? "more" : "fewer"} than the book says.`}
            </p>
          )}

          {isReceipt && (
            <>
              <Field label={`What it cost, per ${item.unit}`}
                     hint="Leave blank if the bill has not arrived. A cost can only be added later by undoing this delivery and receiving it again - what it must not be is a guess.">
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

/* ── From one store to another ────────────────────────────────────── */

/* ONE ACT (the owner, 17 September): the server writes both halves, and an
   undo takes both back. From a store that holds some of it, starting on the
   picked store or the Main store; to a store switched on, chosen each time. */
function TransferDialog({ code, item, stores, startFromId, open, onOpenChange, onDone }: {
  code: string; item: StockItem; stores: StoreSummary[]; startFromId: string | null;
  open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const holding = stores.filter((s) => (item.byStore[s.id] ?? 0) > 0);
  const [fromId, setFromId] = useState(() => startingStore(holding, startFromId));
  const [toId, setToId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const from = holding.find((s) => s.id === fromId) ?? null;
  const destinations = stores.filter((s) => s.isActive && s.id !== fromId);
  const to = destinations.find((s) => s.id === toId) ?? null;
  const have = from ? (item.byStore[from.id] ?? 0) : 0;
  const quantity = qty.trim() === "" ? null : Number(qty);
  const ready = from !== null && to !== null && quantity !== null
    && Number.isFinite(quantity) && quantity > 0;

  const submit = async () => {
    if (busy || !ready || !from || !to || quantity === null) return;
    setBusy(true);
    const res = await moveStock(code, {
      itemId: item.id, fromId: from.id, toId: to.id, quantity,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not moved", res.reason);
    toast.success(`Moved ${qty} ${item.unit} of ${item.name}`,
      `${res.from.onHand} ${res.unit} left in ${res.from.name}, ${res.to.onHand} ${res.unit} in ${res.to.name}.`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Move to another store - ${item.name}`}
        description={from ? `${have} ${item.unit} in ${from.name}` : "Choose a store"}
        footer={
          <>
            <Button variant="secondary"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Moving…" : "Move"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <StoreField label="From" value={fromId}
                      onChange={(id) => { setFromId(id); if (id === toId) setToId(""); }}
                      stores={holding} item={item} />
          <StoreField label="To" value={toId} onChange={setToId}
                      stores={destinations} item={item} />
          <Field label={`How many ${item.unit}`} required>
            {(f) => (
              <Input {...fieldProps(f)} value={qty} inputMode="decimal"
                     onChange={(e) => setQty(e.target.value)} />
            )}
          </Field>
          <Field label="Why" hint="What it is for.">
            {(f) => (
              <Input {...fieldProps(f)} value={note}
                     onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
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
      "Both rows stay on the history - the store's past is what somebody "
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
          <Button variant="secondary"
                  onClick={() => onOpenChange(false)}>Close</Button>
        }
      >
        {!mayUndo && (
          <p className="text-sm text-grey-600 mb-3">{UNDO_NOT_YOURS}</p>
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
          <ul className="space-y-2">
            {rows.map((m) => {
              /* A MOVE, or the undo of one, is one line with both stores; its
                 quantity is what moved, with no sign — nothing came in or went
                 out of the hotel. */
              const aMove = m.kind === "transfer" || m.reversesKind === "transfer";
              return (
                <li key={m.id}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3.5 py-3",
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
                          ? `Undo of ${m.empty ? "a record of empties" : withArticle(NOUN[m.reversesKind])}`
                          : m.kind === "transfer"
                            ? `Moved from ${m.fromStore} to ${m.toStore}`
                            : (m.empty && EMPTY_LABEL[m.kind]) || KIND_LABEL[m.kind]}
                      </span>
                      <span className={cn("tabular font-medium",
                        !aMove && m.quantity > 0 ? "text-success" : "text-ink-900")}>
                        {aMove
                          ? Math.abs(m.quantity)
                          : `${m.quantity > 0 ? "+" : ""}${m.quantity}`} {item.unit}
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
                      {m.kind === "transfer"
                        ? ""
                        : m.fromStore && m.toStore
                          ? ` · ${m.fromStore} to ${m.toStore}`
                          : ` · ${m.store}`}
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
                      aria-label={`Undo this ${nounOf(m)}`}
                      onClick={() => setConfirming(m)}
                      className="size-9 pointer-coarse:size-11 grid place-items-center rounded-full press
                                 text-grey-500 hover:text-brand-red-700
                                 hover:bg-brand-red-50 cursor-pointer shrink-0"
                    >
                      <Undo2 className="size-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {confirming && (
          <Dialog open onOpenChange={(o) => { if (!o) setConfirming(null); }}>
            <DialogContent
              title={`Undo this ${nounOf(confirming)} of ${Math.abs(confirming.quantity)} ${item.unit}?`}
              footer={
                <>
                  <Button variant="secondary"
                          onClick={() => setConfirming(null)}>Cancel</Button>
                  <Button variant="danger" disabled={busy}
                          onClick={() => void undo(confirming)}>
                    {busy ? "Undoing…" : `Undo ${nounOf(confirming)}`}
                  </Button>
                </>
              }
            >
              <p className="text-base text-grey-600 leading-relaxed">
                {confirming.kind === "transfer"
                  ? `It goes back from ${confirming.toStore} to ${confirming.fromStore}. It cannot be taken back - to put it right afterwards, move it again.`
                  : "It cannot be taken back - to put it right afterwards, record it again."}
              </p>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── An item's levels, and a cylinder's deposit ───────────────────── */

/* LEVELS PER STORE (D25-12, D25-13): one box per store, blank for no level -
   blank is not zero. For a cylinder item the deposit too (D25-19): how many
   are on deposit and what each one's deposit is, blank until known. Only what
   changed is sent. The `edit` grant; the menu offers it to nobody else. */
function LevelsDialog({ code, item, stores, open, onOpenChange, onDone }: {
  code: string; item: StockItem; stores: StoreSummary[]; open: boolean;
  onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const asText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  const [levels, setLevels] = useState<Record<string, string>>(
    () => Object.fromEntries(stores.map((s) => [s.id, asText(item.levels[s.id])])));
  const [onDeposit, setOnDeposit] = useState(asText(item.cylindersOnDeposit));
  const [each, setEach] = useState(asText(item.depositPerCylinder));
  const [busy, setBusy] = useState(false);

  const parse = (t: string) => (t.trim() === "" ? null : Number(t));
  const sane = (t: string) => { const n = parse(t); return n === null || (Number.isFinite(n) && n >= 0); };
  const changedLevels = Object.fromEntries(stores
    .filter((s) => parse(levels[s.id] ?? "") !== (item.levels[s.id] ?? null))
    .map((s) => [s.id, parse(levels[s.id] ?? "")]));
  const depositChanged = item.cylinder
    && (parse(onDeposit) !== item.cylindersOnDeposit || parse(each) !== item.depositPerCylinder);
  const wholeDeposit = parse(onDeposit) === null || Number.isInteger(parse(onDeposit));
  const valid = Object.values(levels).every(sane) && sane(onDeposit) && sane(each) && wholeDeposit;
  const ready = valid && (Object.keys(changedLevels).length > 0 || depositChanged);

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    const res = await setStockItem(code, item.id, {
      ...(Object.keys(changedLevels).length > 0 ? { levels: changedLevels } : {}),
      ...(depositChanged
        ? { cylindersOnDeposit: parse(onDeposit), depositPerCylinder: parse(each) } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(`Saved - ${item.name}`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${item.cylinder ? "Levels and deposit" : "Levels"} - ${item.name}`}
        description={`Warn when a store holds this many ${item.unit} or fewer. Blank is no warning, not zero.`}
        footer={
          <>
            <Button variant="secondary"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {stores.map((s) => (
            <Field key={s.id} label={`${s.name}, in ${item.unit}`}
                   error={sane(levels[s.id] ?? "") ? undefined : "Zero or more, or blank."}>
              {(f) => (
                <Input {...fieldProps(f)} value={levels[s.id] ?? ""} inputMode="decimal"
                       onChange={(e) => setLevels({ ...levels, [s.id]: e.target.value })} />
              )}
            </Field>
          ))}
          {item.cylinder && (
            <>
              <Field label="Cylinders on deposit with the supplier"
                     hint="Full, empty and at the kitchen together. Blank until known."
                     error={sane(onDeposit) && wholeDeposit ? undefined : "A whole number, or blank."}>
                {(f) => (
                  <Input {...fieldProps(f)} value={onDeposit} inputMode="numeric"
                         onChange={(e) => setOnDeposit(e.target.value)} />
                )}
              </Field>
              <Field label="Deposit per cylinder" hint="As on the supplier's deposit receipt. Blank until known."
                     error={sane(each) ? undefined : "Zero or more, or blank."}>
                {(f) => (
                  <Input {...fieldProps(f)} value={each} inputMode="decimal"
                         onChange={(e) => setEach(e.target.value)} />
                )}
              </Field>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── A store, counted ─────────────────────────────────────────────── */

interface SheetLine { key: string; itemId: string; empty: boolean; name: string; unit: string; book: number }

/* The sheet's lines for one store, with the book AS IT STANDS NOW: every item,
   and a second line for a cylinder item's empties (D25-18). */
const sheetFor = (items: StockItem[], storeId: string): SheetLine[] =>
  items.filter((i) => i.isActive).flatMap((i) => [
    { key: i.id, itemId: i.id, empty: false, name: i.name, unit: i.unit, book: i.byStore[storeId] ?? 0 },
    ...(i.cylinder
      ? [{ key: `${i.id}:empty`, itemId: i.id, empty: true, name: `${i.name} - empty`,
           unit: i.unit, book: i.emptiesByStore[storeId] ?? 0 }]
      : []),
  ]);

/* THE COUNT SHEET (D25-15, D25-16, D25-17).
   PAPER: item, unit and an empty box - the counter writes what is really on
   the shelf, not what the book expects.
   SCREEN: a count typed on a line shows that line's book figure and the
   difference; a line left blank is not counted and never taken as zero.
   SAVE: one correction per difference, against whoever saves, with "Count of
   <store>" and any reason on the line. NO LOCK: the book is taken when the
   sheet opens; if a line's book has moved by the save, the server refuses the
   whole save and names it, and this sheet takes the new book for those lines
   and clears their counts, so only they are counted again. */
function CountSheet({ code, stores, items, startStoreId, reload, onDone }: {
  code: string; stores: StoreSummary[]; items: StockItem[]; startStoreId: string | null;
  reload: () => Promise<StockItem[]>; onDone: (saved: boolean) => void;
}) {
  const { property } = useDocumentIdentity();
  const [storeId, setStoreId] = useState(() => startingStore(stores, startStoreId));
  const [lines, setLines] = useState(() => sheetFor(items, storeId));
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const store = stores.find((s) => s.id === storeId) ?? null;

  const counted = (key: string): number | null => {
    const t = (counts[key] ?? "").trim();
    return t === "" ? null : Number(t);
  };
  const typed = lines.filter((l) => counted(l.key) !== null);
  const bad = typed.filter((l) => { const n = counted(l.key)!; return !Number.isFinite(n) || n < 0; });
  const ready = store !== null && typed.length > 0 && bad.length === 0;

  const pickStore = (id: string) => {
    setStoreId(id); setLines(sheetFor(items, id)); setCounts({}); setReasons({});
  };

  const save = async () => {
    if (busy || !ready || !store) return;
    setBusy(true);
    const sent: CountLine[] = typed.map((l) => ({
      itemId: l.itemId, empty: l.empty, book: l.book, counted: counted(l.key)!,
      ...(reasons[l.key]?.trim() ? { reason: reasons[l.key]!.trim() } : {}),
    }));
    const res = await saveStockCount(code, { locationId: store.id, lines: sent });
    if (!res.ok) {
      /* The lines whose book moved take the new book and lose their count. */
      const fresh = new Map(sheetFor(await reload(), store.id).map((l) => [l.key, l.book]));
      const moved = lines.filter((l) => fresh.has(l.key) && fresh.get(l.key) !== l.book).map((l) => l.key);
      if (moved.length > 0) {
        setLines(lines.map((l) => (moved.includes(l.key) ? { ...l, book: fresh.get(l.key)! } : l)));
        setCounts(Object.fromEntries(Object.entries(counts).filter(([k]) => !moved.includes(k))));
      }
      setBusy(false);
      return toast.error("Not saved", res.reason);
    }
    setBusy(false);
    toast.success(`Count saved - ${store.name}`,
      `${res.recorded} ${res.recorded === 1 ? "difference" : "differences"} recorded`
      + `, ${res.matched} matched the book.`);
    onDone(true);
  };

  return (
    <Page className="max-w-3xl">
      <div className="print:hidden mb-5 space-y-3">
        <PageHeader
          title="Store"
          description="Count a store. Print the sheet, count the shelves, then type the counts in straight away."
          /* The sheet's long note, one tap away, same words (D27-82). */
          badge={
            <InfoButton>
              {`A line left blank is not counted. Each difference is saved as a correction with your name and "Count of ${store?.name ?? "the store"}".`}
            </InfoButton>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer className="size-4" /> Print the sheet
              </Button>
              <Button variant="secondary" onClick={() => onDone(false)}>Cancel</Button>
              <Button variant="primary" disabled={!ready || busy}
                      onClick={() => void save()}>
                {busy ? "Saving…" : "Save the count"}
              </Button>
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor="count-store" className="text-sm font-medium text-grey-700">Store</label>
          <NativeSelect id="count-store" className="w-auto min-w-52" value={storeId}
                        onChange={(e) => pickStore(e.target.value)}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </div>
      </div>

      <h2 className="hidden print:block mb-3 text-lg font-semibold text-ink-900">
        {property ? `${property} - ` : ""}Count of {store?.name}
      </h2>

      <ul className="bg-white rounded-lg border border-grey-200 divide-y divide-grey-100 print:border-0 print:rounded-none print:divide-grey-200" data-count-sheet="">
        {lines.map((l) => {
          const n = counted(l.key);
          const difference = n === null || !Number.isFinite(n) ? null : Math.round((n - l.book) * 1000) / 1000;
          return (
            <li key={l.key}
                className="px-4 py-3 min-h-14 break-inside-avoid
                           print:px-0 print:py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{l.name}</p>
                  <p className="text-xs text-grey-500">{l.unit}</p>
                </div>
                <Input className="w-28 shrink-0 print:hidden tabular" inputMode="decimal"
                       aria-label={`Counted, ${l.name}, in ${l.unit}`}
                       invalid={n !== null && (!Number.isFinite(n) || n < 0)}
                       value={counts[l.key] ?? ""}
                       onChange={(e) => setCounts({ ...counts, [l.key]: e.target.value })} />
                {/* The paper's empty box. */}
                <span aria-hidden className="hidden print:block w-28 h-8 shrink-0 border border-ink-900" />
              </div>
              {/* THE BOOK SHOWS ONCE A COUNT IS TYPED (D25-16). */}
              {n !== null && (
                <div className="print:hidden mt-2 space-y-2">
                  <p className="text-sm text-grey-600 tabular" role="status">
                    {difference === null || difference + l.book < 0
                      ? "Not a count - type what is on the shelf, zero or more."
                      : `Book ${l.book} ${l.unit} · `
                        + (difference === 0 ? "matches"
                          : `${Math.abs(difference)} ${difference > 0 ? "more" : "fewer"}`)}
                  </p>
                  {difference !== null && difference !== 0 && difference + l.book >= 0 && (
                    <Input aria-label={`Why, ${l.name}`} placeholder="Why, if known"
                           value={reasons[l.key] ?? ""}
                           onChange={(e) => setReasons({ ...reasons, [l.key]: e.target.value })} />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
