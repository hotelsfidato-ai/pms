import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ChevronDown, ChevronLeft, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Button, Skeleton, ErrorState, EmptyState, Segmented, Dialog, DialogContent,
} from "@/components/ui";
import {
  getStore, getStoreDays, type DayRow, type StockItem, type StockKind,
} from "@/modules/stores/data/stores";
import { StoreTiles } from "@/modules/stores/components/StoreTiles";
import { inTile } from "@/modules/stores/lib/tiles";
import {
  MoveDialog, StorePicker, StoreViews, placesOf, tileCounts, useStorePick,
} from "@/modules/stores/pages/Stores";

/* ══════════════════════════════════════════════════════════════════
   THE STORE'S DAYS (D27-238; the owner's answers D27-242)

   Items down the side, fourteen business days across, the Calendar's look:
   today navy, weekends grey, groups by category with their count. A cell is
   what moved that day, in the item's unit: +in on top, -out under it, blank
   when nothing moved (Q1). Under it all, per day: received, issued and wasted
   in rupees, and the rooms occupied. Receive or Issue from today's column.

   By outlet: what was issued to each against what it sold, before GST, and
   the food cost % (Q5: costs before GST over sales before GST). Sales are
   revenue, shown only to a role that may read reports (Q4) - a dash for
   everyone else.

   Every figure comes from the server; this only adds up what it sent.
   A total with an unvalued part in it is a dash, never the part.
   ══════════════════════════════════════════════════════════════════ */

const ALL = "__all-stores";

/* The grid: the first column pinned, fourteen days of at least 60px. */
const GRID = "grid grid-cols-[var(--first)_repeat(14,minmax(60px,1fr))]";
const FRAME = "[--first:208px] max-sm:[--first:120px] min-w-[calc(var(--first)+840px)]";
const FIRST = "sticky left-0 z-20 border-r border-grey-200";

/** A quantity a person reads: no trailing zeros. */
const qty = (n: number) => String(Math.round(n * 1000) / 1000);
/** Rupees in a cell: short, as the Calendar's rates. */
const short = (n: number) => (n >= 100_000 ? `${(n / 100_000).toFixed(1)}L`
  : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** The value of some rows: null for none, or when any of them has none. */
function valueOf(rows: DayRow[]): number | null {
  if (rows.length === 0 || rows.some((r) => r.value === null)) return null;
  return rows.reduce((t, r) => t + r.value!, 0);
}

const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
const shift = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

export default function StoreDaysPage() {
  const { code = "" } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const role = useRole();
  const mayChange = can(role, "create", "stock");
  const { storeId, setStoreId, tile, setTile, search } = useStorePick();
  const [end, setEnd] = useState<string | null>(null);
  const [group, setGroup] = useState<"category" | "outlet">("category");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [choosing, setChoosing] = useState<StockItem | null>(null);
  const [moving, setMoving] = useState<{ item: StockItem; kind: StockKind } | null>(null);
  /* TODAY IS THE LAST COLUMN, and the one that matters: the grid opens
     scrolled to it, as the Calendar opens on the business date. */
  const scroller = useRef<HTMLDivElement>(null);

  /* The Shelf's own read, so the two share it. */
  const store = useQuery({ queryKey: ["stores", code], queryFn: () => getStore(code), enabled: !!code });
  const q = useQuery({
    queryKey: ["store-days", code, end],
    queryFn: () => getStoreDays(code, end ?? undefined),
    enabled: !!code,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["stores", code] });
    void qc.invalidateQueries({ queryKey: ["store-days", code] });
  };

  const places = placesOf(store.data);
  const inUseIds = new Set((store.data?.inUse ?? []).map((p) => p.id));
  const picked = places.find((p) => p.id === storeId) ?? null;
  const today = store.data?.businessDate ?? q.data?.today ?? "";
  const all = store.data?.items ?? [];
  const items = all
    .filter((i) => !picked || !inUseIds.has(picked.id) || i.crockery)
    .filter((i) => !tile || inTile(tile, i, picked, today));
  const shownIds = new Set(items.map((i) => i.id));

  /* The rows that count here: the picked place's, or every place's - where a
     move between them is inside the hotel and is left out. */
  const rows = (q.data?.rows ?? []).filter((r) => shownIds.has(r.itemId)
    && (picked ? r.placeId === picked.id : r.kind !== "transfer"));
  const cell = (itemId: string, date: string) => {
    const mine = rows.filter((r) => r.itemId === itemId && r.date === date);
    const inQty = mine.filter((r) => r.quantity > 0).reduce((t, r) => t + r.quantity, 0);
    const outQty = mine.filter((r) => r.quantity < 0).reduce((t, r) => t + r.quantity, 0);
    return { inQty, outQty };
  };
  const ofKind = (kind: string, date: string) => rows.filter((r) => r.kind === kind && r.date === date);

  const days = q.data?.days ?? [];
  const lastDay = days.at(-1);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [lastDay, group, store.data === undefined]);
  const sales = q.data?.sales ?? null;
  const basis = q.data?.foodCostBasis ?? null;

  const byCategory = new Map<string, StockItem[]>();
  for (const i of items) {
    const key = i.category ?? "Everything else";
    byCategory.set(key, [...(byCategory.get(key) ?? []), i]);
  }
  const outlets = [...(store.data?.outlets ?? []), { id: null as string | null, name: "Not an outlet" }];

  const header = (
    <PageHeader
      title="Store"
      description={days.length > 0 ? `${dateLong(days[0]!)} to ${dateLong(days.at(-1)!)}` : "Fourteen days"}
      actions={
        <div className="flex flex-wrap gap-2">
          <StoreViews code={code} view="days" search={search} />
          <Segmented<"category" | "outlet">
            value={group}
            onChange={setGroup}
            options={[{ value: "category", label: "Category" }, { value: "outlet", label: "Outlet" }]}
          />
        </div>
      }
    />
  );

  if (store.data === undefined || q.data === undefined) {
    const failed = store.isError ? store : q.isError ? q : null;
    return (
      <Page>
        {header}
        {failed
          ? <ErrorState title="The store did not load" error={failed.error} onRetry={() => void failed.refetch()} />
          : <Skeleton className="h-64" />}
      </Page>
    );
  }

  return (
    <Page>
      {header}
      <StorePicker places={places} inUseIds={inUseIds} value={picked?.id ?? ALL} onChange={setStoreId} />
      {all.length > 0 && <StoreTiles counts={tileCounts(all, picked, today)} picked={tile} onPick={setTile} />}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button variant="secondary" size="sm" aria-label="Fourteen days earlier"
                onClick={() => setEnd(shift(q.data.days.at(-1)!, -14))}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="secondary" size="sm" aria-label="Fourteen days later"
                disabled={end === null}
                onClick={() => { const next = shift(q.data.days.at(-1)!, 14); setEnd(next >= q.data.today ? null : next); }}>
          <ChevronRight className="size-4" />
        </Button>
        {end !== null && <Button variant="ghost" size="sm" onClick={() => setEnd(null)}>Today</Button>}
        {group === "outlet" && (
          <p className="text-sm text-grey-600 sm:ml-auto">
            {sales === null
              ? "Issued to each outlet. What it sold is for those who read reports."
              : "Issued over sold, both before GST, and the food cost %."}
          </p>
        )}
      </div>

      {items.length === 0 && group === "category" ? (
        <EmptyState compact title="Nothing to show" description={tile ? "Nothing answers that tile here." : "Nothing in this store."} />
      ) : (
        <div ref={scroller}
             className="max-h-[calc(100dvh-220px)] overflow-auto overscroll-x-contain scrollbar-quiet rounded-lg ring-1 ring-grey-200 bg-white"
             data-store-days="">
          <div className={FRAME}>
            {/* The days */}
            <div className={cn(GRID, "sticky top-0 z-30 bg-white border-b border-grey-200")}>
              <div className={cn(FIRST, "z-10 bg-white flex items-center px-3.5 h-[50px] text-xs font-semibold uppercase tracking-[0.025em] text-grey-500")}>
                {group === "outlet" ? "Outlet" : "Item"}
              </div>
              {days.map((d) => (
                <div key={d} data-day={d}
                     className={cn("grid place-content-center text-center h-[50px] border-r border-grey-100 last:border-r-0",
                       weekend(d) && "bg-grey-50", d === today && "bg-ink-900 text-white")}>
                  <div className={cn("text-xs font-semibold uppercase tracking-[0.025em]",
                    d === today ? "text-white/70" : "text-grey-500")}>
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}
                  </div>
                  <div className={cn("text-md font-semibold tabular", d === today ? "text-white" : "text-ink-900")}>
                    {d.slice(-2)}
                  </div>
                </div>
              ))}
            </div>

            {group === "category"
              ? [...byCategory.entries()].map(([category, list]) => {
                  const shut = collapsed[category] ?? false;
                  return (
                    <div key={category}>
                      <div className={cn(GRID, "bg-grey-50 border-b border-grey-200")}>
                        <button type="button" aria-expanded={!shut}
                                onClick={() => setCollapsed({ ...collapsed, [category]: !shut })}
                                className={cn(FIRST, "z-20 bg-grey-50 flex items-center gap-1.5 px-3 h-10 text-left hover:bg-grey-100")}>
                          {/* On a phone the name gets the room, as on the Calendar. */}
                          {shut ? <ChevronRight className="size-3.5 text-grey-500 shrink-0 max-sm:hidden" />
                            : <ChevronDown className="size-3.5 text-grey-500 shrink-0 max-sm:hidden" />}
                          <span className="text-sm max-sm:text-xs font-semibold text-ink-900 truncate">{category}</span>
                          <span className="ml-auto h-5 px-[7px] rounded-full bg-white ring-1 ring-inset ring-grey-200 text-xs font-semibold leading-5 text-grey-600 tabular max-sm:hidden">
                            {list.length}
                          </span>
                        </button>
                        {days.map((d) => (
                          <div key={d} className={cn("border-r border-grey-200 last:border-r-0", weekend(d) && "bg-grey-100/60")} />
                        ))}
                      </div>
                      {!shut && list.map((i) => (
                        <div key={i.id} data-item-row={i.name} className={cn(GRID, "border-b border-grey-100")}>
                          <div className={cn(FIRST, "bg-white flex flex-col justify-center px-3.5 max-sm:px-2.5 min-h-12")}>
                            <span className="text-sm font-medium text-ink-900 truncate">{i.name}</span>
                            <span className="text-xs text-grey-500">{i.unit}</span>
                          </div>
                          {days.map((d) => {
                            const { inQty, outQty } = cell(i.id, d);
                            const body = (
                              <>
                                {inQty !== 0 && <span className="block text-sm font-semibold text-success-600 tabular">+{qty(inQty)}</span>}
                                {outQty !== 0 && <span className="block text-sm font-semibold text-ink-900 tabular">{qty(outQty)}</span>}
                              </>
                            );
                            const look = cn("grid place-content-center text-center min-h-12 border-r border-grey-100 last:border-r-0",
                              weekend(d) && "bg-grey-50", d === today && "bg-ink-900/[0.035]");
                            /* RECEIVE OR ISSUE FROM TODAY'S COLUMN (D27-238). */
                            return d === today && mayChange && end === null ? (
                              <button key={d} type="button" className={cn(look, "cursor-pointer hover:bg-brand-orange-50")}
                                      aria-label={`Receive or issue ${i.name} today`}
                                      onClick={() => setChoosing(i)}>
                                {body}
                              </button>
                            ) : <div key={d} className={look}>{body}</div>;
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })
              : outlets.map((o) => (
                  <div key={o.id ?? "none"} data-outlet-row={o.name} className={cn(GRID, "border-b border-grey-100")}>
                    <div className={cn(FIRST, "bg-white flex items-center px-3.5 max-sm:px-2.5 min-h-16 text-sm font-medium text-ink-900")}>
                      {o.name}
                    </div>
                    {days.map((d) => {
                      const issued = valueOf(ofKind("issue", d).filter((r) => r.outletId === o.id));
                      const sold = o.id === null || sales === null ? null : sales[o.id]?.[d] ?? null;
                      const pct = basis === "before_gst" && issued !== null && sold !== null && sold > 0
                        ? issued / sold * 100 : null;
                      return (
                        <div key={d} className={cn("grid place-content-center text-center min-h-16 border-r border-grey-100 last:border-r-0 tabular",
                          weekend(d) && "bg-grey-50", d === today && "bg-ink-900/[0.035]")}>
                          <span className="text-sm font-semibold text-ink-900">{issued === null ? "-" : short(issued)}</span>
                          {o.id !== null && <span className="text-xs text-grey-600">{sold === null ? "-" : short(sold)}</span>}
                          {o.id !== null && <span className="text-xs font-medium text-grey-700">{pct === null ? "-" : `${pct.toFixed(1)}%`}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}

            {/* Pinned under it all: the day in rupees, and the house. */}
            <div className="sticky bottom-0 z-30 bg-white border-t border-grey-300" data-days-footer="">
              {[
                { label: "Received ₹", of: (d: string) => valueOf(ofKind("receipt", d)) },
                { label: "Issued ₹", of: (d: string) => valueOf(ofKind("issue", d)) },
                { label: "Wasted ₹", of: (d: string) => valueOf(ofKind("wastage", d)) },
                { label: "Occupied rooms", of: (d: string) => q.data.occupied[d] ?? null, plain: true },
              ].map((f) => (
                <div key={f.label} className={GRID}>
                  <div className={cn(FIRST, "z-10 bg-white flex items-center px-3.5 max-sm:px-2.5 h-8 text-xs font-semibold text-ink-900")}>
                    {f.label}
                  </div>
                  {days.map((d) => {
                    const v = f.of(d);
                    return (
                      <div key={d} className={cn("grid place-content-center h-8 text-xs tabular border-r border-grey-100 last:border-r-0",
                        v === null ? "text-grey-400" : "text-ink-900", d === today && "bg-ink-900/[0.035]")}>
                        {v === null ? "-" : f.plain ? v : short(v)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Today's cell: which act. */}
      {choosing && (
        <Dialog open onOpenChange={(o) => { if (!o) setChoosing(null); }}>
          <DialogContent title={choosing.name} description={`Today, ${dateLong(today)}`}
                         footer={<Button variant="secondary" onClick={() => setChoosing(null)}>Cancel</Button>}>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" size="lg" onClick={() => { setMoving({ item: choosing, kind: "receipt" }); setChoosing(null); }}>
                <TrendingUp className="size-4" /> Receive
              </Button>
              <Button variant="secondary" size="lg" disabled={choosing.onHand <= 0}
                      onClick={() => { setMoving({ item: choosing, kind: "issue" }); setChoosing(null); }}>
                <TrendingDown className="size-4" /> Issue
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {moving && (
        <MoveDialog code={code} item={moving.item} kind={moving.kind}
                    stores={store.data.stores} startStoreId={picked?.id ?? null}
                    outlets={store.data.outlets} open
                    onOpenChange={(o) => { if (!o) setMoving(null); }}
                    onDone={() => { setMoving(null); refresh(); }} />
      )}
    </Page>
  );
}
