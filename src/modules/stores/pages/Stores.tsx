import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  Package, Plus, TrendingDown, TrendingUp, Trash2, Undo2, AlertTriangle,
  Upload, CornerUpLeft, ClipboardCheck, History, ArrowLeftRight, Bell,
  ClipboardList, Printer, CircleOff, FileBarChart,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, timeOnly, bottlesAndMl } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { useDocumentIdentity } from "@/lib/documentIdentity";
import {
  Page, PageHeader, Card, Button, Skeleton, EmptyState, ErrorState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  StatusPill, InfoButton, toast, Menu, MenuItem, MenuSeparator, Checkbox, Segmented,
} from "@/components/ui";
import {
  getStore, getStockHistory, addStockItem, recordStockMovement, moveStock,
  reverseStockMovement, importStockItems, setStockItem, saveStockCount,
  type StockItem, type StockKind, type StockMovement, type MovementKind, type StoreSummary,
  type CountLine,
} from "@/modules/stores/data/stores";
import { ImportDialog } from "@/components/flows/ImportDialog";
import { STOCK_SPEC } from "@/lib/importSpec";
import { StoreTiles } from "@/modules/stores/components/StoreTiles";
import { TILES, inTile, isTile, type Tile } from "@/modules/stores/lib/tiles";
import { STOCK_REPORT_LINKS, mayReadStockReports } from "@/modules/reports";

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
  breakage: "Broken",
};

/* What a button SAYS WILL HAPPEN — verb first (STO-8, the owner's words of
   16 September). It read "Received" on the button that did the receiving. */
const ACTION_LABEL: Record<StockKind, string> = {
  receipt: "Receive",
  issue: "Issue",
  wastage: "Record waste",
  adjustment: "Correct the count",
  return: "Return",
  breakage: "Record breakage",
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
  breakage: "breakage",
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
/* A drink in full bottles and the next one's ml (D27-354): "5 + 630 ml". */
const heldText = (n: number | null | undefined, sizeMl?: number | null) => {
  if (n === null || n === undefined) return "-";
  if (!sizeMl) return String(n);
  const whole = Math.floor(n + 1e-9);
  const ml = Math.round((n - whole) * sizeMl);
  return ml > 0 ? `${whole} + ${ml} ml` : String(whole);
};

const unreachable = (error: unknown) =>
  error instanceof ApiError && error.status === 0;

/* THE PLACE PICKED, AND THE TILE, LIVE IN THE ADDRESS (D27-238): the Shelf
   and the Days view are a pair, like Rooms and the Calendar, and switching
   keeps both. */
export function useStorePick() {
  const [params, setParams] = useSearchParams();
  const tileParam = params.get("tile");
  const set = (key: string, value: string | null) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value === null) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });
  return {
    storeId: params.get("store") ?? ALL_STORES,
    setStoreId: (id: string) => set("store", id === ALL_STORES ? null : id),
    tile: isTile(tileParam) ? tileParam : null,
    setTile: (t: Tile | null) => set("tile", t),
    search: params.toString(),
  };
}

/** The stores, then the places crockery is in use (D27-242), as one list a
    picker reads. A place in use is never the Main store. */
export function placesOf(data: {
  stores: StoreSummary[]; inUse: { id: string; name: string; isActive: boolean }[];
} | undefined): StoreSummary[] {
  return [
    ...(data?.stores ?? []),
    ...(data?.inUse ?? []).map((p) => ({ id: p.id, name: p.name, isActive: p.isActive, isMain: false })),
  ];
}

/** Every tile's count, for the place picked. */
export const tileCounts = (items: StockItem[], picked: StoreSummary | null, today: string) =>
  Object.fromEntries(TILES.map((t) => [t.key, items.filter((i) => inTile(t.key, i, picked, today)).length])) as Record<Tile, number>;

/** Shelf | Days, the pair's switch, and the Reports menu (D27-240) - for
    everyone who sees the Store. */
export function StoreViews({ code, view, search }: { code: string; view: "shelf" | "days"; search: string }) {
  const navigate = useNavigate();
  const role = useRole();
  const tail = search ? `?${search}` : "";
  return (
    <>
      <Segmented<"shelf" | "days">
        value={view}
        onChange={(v) => navigate(`/h/${code}/stores${v === "days" ? "/days" : ""}${tail}`)}
        options={[{ value: "shelf", label: "Shelf" }, { value: "days", label: "Days" }]}
      />
      {mayReadStockReports(role) && (
        <Menu label="Reports">
          {STOCK_REPORT_LINKS.map((r) => (
            <MenuItem key={r.path} icon={FileBarChart} onSelect={() => navigate(r.path)}>
              {r.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}

export default function StoresPage() {
  const { code = "" } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const role = useRole();
  const mayChange = can(role, "create", "stock");
  const mayCorrect = can(role, "edit", "stock");
  const { storeId, setStoreId, tile, setTile, search } = useStorePick();
  const [params, setParams] = useSearchParams();

  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ item: StockItem; kind: StockKind } | null>(null);
  const [transferring, setTransferring] = useState<StockItem | null>(null);
  const [history, setHistory] = useState<StockItem | null>(null);
  const [levelling, setLevelling] = useState<StockItem | null>(null);
  /* ?count=1 opens the count straight away (Inventory's "Count the bar",
     D27-354), on the store ?store= names. */
  const [counting, setCounting] = useState(() => params.get("count") === "1");
  const [importing, setImporting] = useState(false);

  const q = useQuery({
    queryKey: ["stores", code],
    queryFn: () => getStore(code),
    enabled: !!code,
  });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["stores", code] }); };

  const stores = q.data?.stores ?? [];
  const all = q.data?.items ?? [];
  /* Stores, then where crockery is in use (D27-242). */
  const places = placesOf(q.data);
  const inUseIds = new Set((q.data?.inUse ?? []).map((p) => p.id));
  const placesFor = (i: StockItem) => (i.crockery ? places : stores);
  /* The place picked at the top, or null for every place together. One that
     has left the list - switched off and emptied - falls back to all. */
  const picked = places.find((s) => s.id === storeId) ?? null;
  const today = q.data?.businessDate ?? "";
  /* A place in use holds crockery only; a tile narrows to what answers it. */
  const items = all
    .filter((i) => !picked || !inUseIds.has(picked.id) || i.crockery)
    .filter((i) => !tile || inTile(tile, i, picked, today));

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

    if (tile && items.length === 0 && all.length > 0) {
      return (
        <EmptyState compact icon={<Package />}
                    title={`Nothing is ${TILES.find((t) => t.key === tile)!.label.toLowerCase()}`}
                    description={picked ? `In ${picked.name}.` : "In any store."}
                    action={<Button variant="secondary" onClick={() => setTile(null)}>Show everything</Button>} />
      );
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
              stores={placesFor(i)}
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
      <CountSheet code={code} stores={places} inUseIds={inUseIds} items={all}
                  startStoreId={picked?.id ?? null}
                  reload={async () => (await q.refetch()).data?.items ?? items}
                  onDone={(saved) => {
                    setCounting(false);
                    if (params.has("count")) {
                      setParams((p) => { const next = new URLSearchParams(p); next.delete("count"); return next; }, { replace: true });
                    }
                    if (saved) refresh();
                  }} />
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
        actions={
          <div className="flex flex-wrap gap-2">
            <StoreViews code={code} view="shelf" search={search} />
            {mayChange && (
              <>
                {/* A store is a hundred lines long. The same argument the
                    menu import is built on. */}
                <Button variant="secondary"
                        onClick={() => setImporting(true)}>
                  <Upload className="size-4" /> Import
                </Button>
                {/* THE COUNT (D25-15..17): whoever corrects a count. */}
                {mayCorrect && all.length > 0 && (
                  <Button variant="secondary" disabled={q.data === undefined}
                          onClick={() => setCounting(true)}>
                    <ClipboardList className="size-4" /> Count a store
                  </Button>
                )}
                {/* The Store's one main action (STO-8). */}
                <Button variant="primary" onClick={() => setAdding(true)}>
                  <Plus className="size-4" /> Add an item
                </Button>
              </>
            )}
          </div>
        }
      />

      {!mayChange && (
        <p className="text-sm text-grey-600 mb-5">{LOOK_ONLY}</p>
      )}

      {/* WHICH STORE (the owner's layout, 17 September). "All stores" shows
          each item's total and what each store holds; one store shows only
          what is in it, and its dialogs start there. */}
      {stores.length > 0 && (
        <StorePicker places={places} inUseIds={inUseIds} value={picked?.id ?? ALL_STORES} onChange={setStoreId} />
      )}

      {/* THE TILES (D27-238). Below level replaces the yellow list (Q2): its
          cards say which store and what level. */}
      {q.data !== undefined && all.length > 0 && (
        <StoreTiles counts={tileCounts(all, picked, today)} picked={tile} onPick={setTile} />
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
                    stores={stores} inUse={moving.item.crockery ? places.filter((p) => inUseIds.has(p.id)) : []}
                    people={q.data?.people ?? []}
                    startStoreId={picked?.id ?? null}
                    outlets={q.data?.outlets ?? []} open
                    onOpenChange={(o) => { if (!o) setMoving(null); }}
                    onDone={() => { setMoving(null); refresh(); }} />
      )}
      {transferring && (
        <TransferDialog code={code} item={transferring}
                        stores={placesFor(transferring)} startFromId={picked?.id ?? null} open
                        onOpenChange={(o) => { if (!o) setTransferring(null); }}
                        onDone={() => { setTransferring(null); refresh(); }} />
      )}
      {history && (
        <HistoryDialog code={code} item={history} open mayUndo={mayCorrect}
                       onOpenChange={(o) => { if (!o) setHistory(null); }}
                       onChanged={refresh} />
      )}
      {levelling && (
        <LevelsDialog code={code} item={levelling} stores={placesFor(levelling)} open
                      onOpenChange={(o) => { if (!o) setLevelling(null); }}
                      onDone={() => { setLevelling(null); refresh(); }} />
      )}
    </Page>
  );
}

/* ── Which place, at the top ──────────────────────────────────────── */

/* WHICH STORE (the owner's layout, 17 September): "All stores" shows each
   item's total and what each holds; one shows only what is in it, and its
   dialogs start there. A place where crockery is in use is offered after the
   stores (D27-242). */
export function StorePicker({ places, inUseIds, value, onChange }: {
  places: StoreSummary[]; inUseIds: Set<string>; value: string; onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-5">
      <label htmlFor="store-picker" className="text-sm font-medium text-grey-700">
        Store
      </label>
      <NativeSelect id="store-picker" className="w-auto min-w-52" value={value}
                    onChange={(e) => onChange(e.target.value)}>
        <option value={ALL_STORES}>All stores</option>
        {places.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{inUseIds.has(s.id) ? " (in use)" : ""}{s.isActive ? "" : " (switched off)"}
          </option>
        ))}
      </NativeSelect>
    </div>
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
  /* "Last counted" (D27-242): in the picked place, or the latest anywhere. */
  const lastCounted = picked
    ? item.lastCounted[picked.id]
    : Object.values(item.lastCounted).sort().at(-1);
  /* Below level (D25-14), on the card now that the tile replaces the yellow
     list (Q2): which store, what it holds, and the level. */
  const belowIn = stores.filter((s) => item.lowIn.includes(s.id) && (!picked || s.id === picked.id));

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
              {lastCounted ? ` · counted ${dateShort(lastCounted)}` : ""}
            </p>
          </div>

          <div>
            <p className="text-sm text-grey-500">
              {item.cylinder ? (picked ? `Full in ${picked.name}` : "Full") : picked ? `In ${picked.name}` : "On hand"}
            </p>
            <p className={cn("text-xl leading-7 font-semibold tabular",
              onHand === null ? "text-grey-500" : "text-ink-900")}>
              {heldText(onHand, item.sizeMl)}{" "}
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
                    {item.crockery ? "Move into use, or to another store" : "Move to another store"}
                  </MenuItem>
                  {/* Crockery and cutlery break, with who (D27-242). */}
                  {item.crockery && (
                    <MenuItem icon={CircleOff} disabled={empty} reason={NOTHING_ON_HAND}
                              onSelect={() => onMove("breakage")}>
                      Broken
                    </MenuItem>
                  )}
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
        {((!picked && stores.length > 1) || item.cylinder || (mayChange && empty) || belowIn.length > 0) && (
          <div className="border-t border-grey-100 px-4 py-3 space-y-1">
            {belowIn.length > 0 && (
              <p className="text-sm text-brand-yellow-800 tabular" data-below-list="">
                {belowIn.map((s) => `${s.name}: ${item.byStore[s.id] === undefined
                  ? "none" : `${item.byStore[s.id]} ${item.unit}`}, level ${item.levels[s.id]}`).join(" · ")}
              </p>
            )}
            {/* WHAT EACH STORE HOLDS, on "All stores" — the owner's layout:
                "Main 30 · Kitchen 8 · Bar -". */}
            {!picked && stores.length > 1 && (
              <p className="text-sm text-grey-600 tabular" data-store-line="">
                {stores.map((s) => `${shortName(s.name)} ${heldText(item.byStore[s.id], item.sizeMl)}`).join(" · ")}
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
  const [crockery, setCrockery] = useState(false);
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
      ...(crockery ? { crockery: true } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    toast.success(`${name.trim()} added`,
      "Receiving a delivery is what gives it a quantity and a value.");
    setName(""); setUnit(""); setCategory(""); setReorder(""); setCrockery(false);
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
          {/* D27-242: crockery and cutlery is in use at an outlet until it
              breaks or comes back. */}
          <Checkbox label="Crockery or cutlery - in use at an outlet until it breaks"
                    checked={crockery} onCheckedChange={setCrockery} />
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

/** The GST rates since 22 September 2025, offered first; 12 and 28 are still
    typed for an older bill (D27-242 Q6). */
const GST_RATES = [0, 5, 18, 40];
/** The picker's answer for a breakage nobody owns up to; sent as null. */
const NOT_KNOWN = "not-known";

export function MoveDialog({ code, item, kind, stores, inUse = [], people = [], startStoreId, outlets, open, onOpenChange, onDone }: {
  code: string; item: StockItem; kind: StockKind;
  stores: StoreSummary[];
  /** Where a crockery item is in use: it breaks and is counted there too. */
  inUse?: StoreSummary[];
  /** Who may be named as having broken it. */
  people?: { id: string; name: string }[];
  startStoreId: string | null;
  outlets: { id: string; name: string }[];
  open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  /* A switched-off store takes nothing in; what is already in one may still
     go out, be wasted, returned or counted (the server holds the same rule).
     Crockery breaks, and is counted, where it is in use too (D27-242). */
  const offered = kind === "receipt" ? stores.filter((s) => s.isActive)
    : kind === "breakage" || kind === "adjustment" ? [...stores, ...inUse]
      : stores;
  const [storeId, setStoreId] = useState(() => startingStore(offered, startStoreId));
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  /* ST-1, X-1 (D27-120): 5 kg at 0 dragged the average down. 0 only ticked Free. */
  const [costFree, setCostFree] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [outletId, setOutletId] = useState("");
  /* D27-238: a delivery's GST (all three or none) and expiry; an issue's
     department; a breakage's who. */
  const [gstRate, setGstRate] = useState("");
  const [gstAmount, setGstAmount] = useState("");
  const [gstTyped, setGstTyped] = useState(false);
  const [claimable, setClaimable] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [department, setDepartment] = useState("");
  const [brokenBy, setBrokenBy] = useState("");
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

  /* THE AMOUNT IS FILLED FROM THE RATE (Q6): how many x cost x rate, until
     the person types their bill's own figure over it. */
  const rateN = gstRate.trim() === "" ? null : Number(gstRate);
  const costN = costFree ? 0 : cost.trim() === "" ? null : Number(cost);
  const filled = rateN !== null && quantity !== null && costN !== null
    && Number.isFinite(rateN) && Number.isFinite(costN)
    ? (Math.round(quantity * costN * rateN) / 100).toFixed(2) : "";
  const amount = gstTyped ? gstAmount : filled;
  const gstGiven = [gstRate, amount, claimable].filter((v) => v.trim() !== "").length;
  const gstOk = !isReceipt || gstGiven === 0
    || (gstGiven === 3 && rateN !== null && rateN >= 0 && rateN <= 100 && Number(amount) >= 0);
  const isBreakage = kind === "breakage";

  const ready = store !== null && quantity !== null && Number.isFinite(quantity) && quantity !== 0
    && (isCount ? (counted ?? -1) >= 0 : quantity > 0)
    && (!needsOutlet || outletId !== "") && emptiesOk && gstOk
    && (!isBreakage || brokenBy !== "");

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
      ...(isReceipt && costFree ? { unitCost: 0, unitCostFree: true }
        : isReceipt && cost.trim() !== "" ? { unitCost: Number(cost) } : {}),
      ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(needsOutlet ? { outletId: outletId === NOT_AN_OUTLET ? null : outletId } : {}),
      ...(asksEmpties && emptiesN !== null
        ? (isReceipt ? { emptiesTaken: emptiesN } : { emptiesBack: emptiesN }) : {}),
      ...(isReceipt && gstGiven === 3
        ? { gstRate: rateN!, gstAmount: Number(amount), gstClaimable: claimable === "yes" } : {}),
      ...(isReceipt && expiresOn ? { expiresOn } : {}),
      ...(kind === "issue" && department.trim() ? { department: department.trim() } : {}),
      ...(isBreakage ? { brokenBy: brokenBy === NOT_KNOWN ? null : brokenBy } : {}),
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
          <StoreField label={isBreakage ? "Where it broke" : "Which store"} value={storeId} onChange={setStoreId}
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

          {/* WHO BROKE IT, asked every time (D27-242 Q10): a person rostered
              here, or Not known - nothing is chosen for the person. */}
          {isBreakage && (
            <Field label="Who broke it" required>
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={brokenBy}
                              onChange={(e) => setBrokenBy(e.target.value)}>
                  <option value="">Choose…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value={NOT_KNOWN}>Not known</option>
                </NativeSelect>
              )}
            </Field>
          )}

          {/* WHICH DEPARTMENT, as typed (D27-242 Q8): optional. */}
          {kind === "issue" && (
            <Field label="Department" hint="Optional. Housekeeping, Banquets - as you call it.">
              {(f) => (
                <Input {...fieldProps(f)} value={department} maxLength={60}
                       onChange={(e) => setDepartment(e.target.value)} />
              )}
            </Field>
          )}

          {isReceipt && (
            <>
              <Field label={`What it cost, per ${item.unit}, before GST`}
                     hint="Leave blank if the bill has not arrived. A cost can only be added later by undoing this delivery and receiving it again - what it must not be is a guess.">
                {(f) => (
                  <Input {...fieldProps(f)} value={costFree ? "0" : cost} inputMode="decimal"
                         disabled={costFree}
                         onChange={(e) => setCost(e.target.value)} />
                )}
              </Field>
              <Checkbox label="Free - it cost nothing" checked={costFree} onCheckedChange={setCostFree} />
              {/* GST ON THE BILL (D27-238, Q6): the rate, the amount filled
                  from it and changeable to the bill's own, and whether it can
                  be claimed. All three, or none - none is not recorded. */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="GST rate, %" hint="0, 5, 18 or 40; 12 or 28 on an older bill.">
                  {(f) => (
                    <>
                      <Input {...fieldProps(f)} value={gstRate} inputMode="decimal" list="gst-rates"
                             onChange={(e) => setGstRate(e.target.value)} />
                      <datalist id="gst-rates">
                        {GST_RATES.map((r) => <option key={r} value={r} />)}
                      </datalist>
                    </>
                  )}
                </Field>
                <Field label="GST amount" hint="As the bill says.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={amount} inputMode="decimal"
                           onChange={(e) => { setGstTyped(true); setGstAmount(e.target.value); }} />
                  )}
                </Field>
              </div>
              <Field label="Can this GST be claimed?"
                     error={gstOk ? undefined : "GST is the rate, the amount and whether it can be claimed - all three, or none."}>
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={claimable}
                                onChange={(e) => setClaimable(e.target.value)}>
                    <option value="">Not recorded</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label="Use by" hint="Optional.">
                {(f) => (
                  <Input {...fieldProps(f)} type="date" value={expiresOn}
                         onChange={(e) => setExpiresOn(e.target.value)} />
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
                : isBreakage
                  ? "Dropped, chipped, cracked in the wash."
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
                    {/* D27-238: GST, use by, department, who broke it. */}
                    {(m.gst || m.expiresOn || m.department || m.kind === "breakage") && (
                      <p className="text-sm text-grey-600 mt-0.5 tabular">
                        {[
                          m.gst && `GST ${m.gst.rate}% ${money(m.gst.amount)}, ${m.gst.claimable ? "claimable" : "not claimable"}`,
                          m.expiresOn && `use by ${dateShort(m.expiresOn)}`,
                          m.department && `for ${m.department}`,
                          m.kind === "breakage" && `broken by ${m.brokenBy ?? "not known"}`,
                        ].filter(Boolean).join(" · ")}
                      </p>
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

interface SheetLine {
  key: string; itemId: string; empty: boolean; name: string; unit: string; book: number;
  /** A bottle's size (D27-354): counted as full bottles, and the ml of the open one. */
  sizeMl: number | null;
}

/* The sheet's lines for one store, with the book AS IT STANDS NOW: every item,
   and a second line for a cylinder item's empties (D25-18). */
const sheetFor = (items: StockItem[], storeId: string, crockeryOnly = false): SheetLine[] =>
  items.filter((i) => i.isActive && (!crockeryOnly || i.crockery)).flatMap((i) => [
    { key: i.id, itemId: i.id, empty: false, name: i.name, unit: i.unit, book: i.byStore[storeId] ?? 0,
      sizeMl: i.sizeMl ?? null },
    ...(i.cylinder
      ? [{ key: `${i.id}:empty`, itemId: i.id, empty: true, name: `${i.name} - empty`,
           unit: i.unit, book: i.emptiesByStore[storeId] ?? 0, sizeMl: null }]
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
function CountSheet({ code, stores, inUseIds, items, startStoreId, reload, onDone }: {
  code: string; stores: StoreSummary[]; inUseIds: Set<string>; items: StockItem[]; startStoreId: string | null;
  reload: () => Promise<StockItem[]>; onDone: (saved: boolean) => void;
}) {
  const { property } = useDocumentIdentity();
  const [storeId, setStoreId] = useState(() => startingStore(stores, startStoreId));
  /* A place in use is counted for its crockery and cutlery (D27-242). */
  const linesOf = (list: StockItem[], id: string) => sheetFor(list, id, inUseIds.has(id));
  const [lines, setLines] = useState(() => linesOf(items, storeId));
  const [counts, setCounts] = useState<Record<string, string>>({});
  /* The open bottle's ml, for a drink (D27-354). */
  const [mls, setMls] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const store = stores.find((s) => s.id === storeId) ?? null;

  /* What was counted, in the item's unit: a drink's full bottles and the open
     one's ml make one figure, to the thousandth of a bottle. */
  const counted = (l: SheetLine): number | null => {
    const t = (counts[l.key] ?? "").trim();
    const m = l.sizeMl ? (mls[l.key] ?? "").trim() : "";
    if (t === "" && m === "") return null;
    const full = t === "" ? 0 : Number(t);
    if (!l.sizeMl || m === "") return full;
    const ml = Number(m);
    if (!Number.isFinite(ml) || ml < 0 || ml >= l.sizeMl) return Number.NaN;
    return Math.round((full + ml / l.sizeMl) * 1000) / 1000;
  };
  const typed = lines.filter((l) => counted(l) !== null);
  const bad = typed.filter((l) => { const n = counted(l)!; return !Number.isFinite(n) || n < 0; });
  const ready = store !== null && typed.length > 0 && bad.length === 0;

  const pickStore = (id: string) => {
    setStoreId(id); setLines(linesOf(items, id)); setCounts({}); setMls({}); setReasons({});
  };

  const save = async () => {
    if (busy || !ready || !store) return;
    setBusy(true);
    const sent: CountLine[] = typed.map((l) => ({
      itemId: l.itemId, empty: l.empty, book: l.book, counted: counted(l)!,
      ...(reasons[l.key]?.trim() ? { reason: reasons[l.key]!.trim() } : {}),
    }));
    const res = await saveStockCount(code, { locationId: store.id, lines: sent });
    if (!res.ok) {
      /* The lines whose book moved take the new book and lose their count. */
      const fresh = new Map(linesOf(await reload(), store.id).map((l) => [l.key, l.book]));
      const moved = lines.filter((l) => fresh.has(l.key) && fresh.get(l.key) !== l.book).map((l) => l.key);
      if (moved.length > 0) {
        setLines(lines.map((l) => (moved.includes(l.key) ? { ...l, book: fresh.get(l.key)! } : l)));
        setCounts(Object.fromEntries(Object.entries(counts).filter(([k]) => !moved.includes(k))));
        setMls(Object.fromEntries(Object.entries(mls).filter(([k]) => !moved.includes(k))));
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
          const n = counted(l);
          const difference = n === null || !Number.isFinite(n) ? null : Math.round((n - l.book) * 1000) / 1000;
          /* A drink's figures in full bottles and ml (D27-354). */
          const shown = (q: number) => l.sizeMl ? bottlesAndMl(q, l.unit, l.sizeMl) : `${q} ${l.unit}`;
          return (
            <li key={l.key}
                className="px-4 py-3 min-h-14 break-inside-avoid
                           print:px-0 print:py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{l.name}</p>
                  <p className="text-xs text-grey-500">
                    {l.sizeMl ? `Full ${l.unit}s of ${l.sizeMl} ml, and the ml in the open one` : l.unit}
                  </p>
                </div>
                <Input className="w-28 shrink-0 print:hidden tabular" inputMode="decimal"
                       aria-label={`Counted, ${l.name}, in ${l.unit}`}
                       placeholder={l.sizeMl ? "Full" : undefined}
                       invalid={n !== null && (!Number.isFinite(n) || n < 0)}
                       value={counts[l.key] ?? ""}
                       onChange={(e) => setCounts({ ...counts, [l.key]: e.target.value })} />
                {l.sizeMl && (
                  <Input className="w-24 shrink-0 print:hidden tabular" inputMode="numeric"
                         aria-label={`Open ${l.unit}, ${l.name}, in ml`} placeholder="ml"
                         value={mls[l.key] ?? ""}
                         onChange={(e) => setMls({ ...mls, [l.key]: e.target.value })} />
                )}
                {/* The paper's empty box (two for a drink: full, and ml). */}
                <span aria-hidden className="hidden print:block w-28 h-8 shrink-0 border border-ink-900" />
                {l.sizeMl && <span aria-hidden className="hidden print:block w-24 h-8 shrink-0 border border-ink-900" />}
              </div>
              {/* THE BOOK SHOWS ONCE A COUNT IS TYPED (D25-16). */}
              {n !== null && (
                <div className="print:hidden mt-2 space-y-2">
                  <p className="text-sm text-grey-600 tabular" role="status">
                    {difference === null || difference + l.book < 0
                      ? (l.sizeMl ? `Not a count - full ones, and under ${l.sizeMl} ml in the open one.`
                        : "Not a count - type what is on the shelf, zero or more.")
                      : `Book ${shown(l.book)} · `
                        + (difference === 0 ? "matches"
                          : `${l.sizeMl ? shown(Math.abs(difference)) : Math.abs(difference)} ${difference > 0 ? "more" : "fewer"}`)}
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
