import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Minus, Trash2, WifiOff, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { unitPriceOf, chosenLabels } from "@/modules/pos/lib/pricing";
import {
  draftKey, loadDraft, saveDraft, clearDraft, draftsUsable,
  draftTotal, draftCount, type Draft, type DraftLine,
} from "@/lib/draft";
import {
  Button, Dialog, DialogContent, Input, StatusPill, toast,
} from "@/components/ui";
import { DishDialog } from "@/modules/pos/flows/DishDialog";
import { getMenu, getOrder, sendOrder, type MenuItem } from "@/modules/pos/data/till";
import { FunctionPicker } from "@/modules/pos/components/FunctionPicker";
import { ReadFailed } from "@/components/ui";
import { openSlip, type BlockedSlip } from "@/modules/pos/components/SlipNotice";

/* ══════════════════════════════════════════════════════════════════
   THE ORDER PAD

   A waiter standing at table 7 taps it on the floor plan and this opens
   OVER the floor. It does not navigate. Before this, tapping a table
   made a network call and then left for the till screen — so a waiter
   on the floor walked back to a terminal to do the thing they were
   already standing in front of.

   ⚠ NOTHING HERE TOUCHES THE NETWORK UNTIL "SEND".

   That is the whole design. Six dishes used to be six journeys to
   Mumbai; a hill-station link makes each of those a second or worse,
   and a waiter cannot stand at a table tapping once per second. Now the
   round is built in memory, written to the device as it grows, and sent
   as ONE request that either takes every dish or none.

   The menu comes from the query cache, which `App.tsx` persists for a
   week — so this opens on a floor with no signal at all.

   THREE OUTCOMES ON SEND, and the third is the one that matters:
   sent · refused · HELD. A held order is in the outbox and the kitchen
   does not have it. It has no docket number, because no server has seen
   it, and this screen must never imply otherwise.
   ══════════════════════════════════════════════════════════════════ */

export function OrderPad({
  hotelId, outlet, tableId, tableLabel, orderId, open, onOpenChange, onSent,
  onSlipBlocked,
}: {
  hotelId: string;
  outlet: string;
  tableId: string;
  tableLabel: string;
  /** Set when the table already has an open bill, so this round joins
      it rather than starting a second order on the same table. */
  orderId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
  /** The kitchen slip the browser would not open (POS-10). The pad has
      closed by the time anybody could act on it, so the screen under it
      keeps the notice. */
  onSlipBlocked?: (slip: BlockedSlip) => void;
}) {
  const qc = useQueryClient();
  const key = draftKey(hotelId, outlet, tableId);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [asking, setAsking] = useState<MenuItem | null>(null);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canKeep, setCanKeep] = useState(true);

  const menu = useQuery({
    queryKey: ["till-menu", hotelId],
    queryFn: () => getMenu(hotelId),
    enabled: Boolean(hotelId),
  });

  /* ── Which banquet function (D17-21) ──────────────────────────
     A second round on an open bill shows the function it is already on;
     `undefined` is "not touched here", and only a change is sent. Not
     kept with the draft: the draft's shape is the core's (`@/lib/draft`),
     and a function is chosen at the moment of sending. */
  const existing = useQuery({
    queryKey: ["till-order", hotelId, orderId],
    queryFn: () => getOrder(hotelId, orderId!),
    enabled: open && Boolean(orderId),
  });
  const [eventChoice, setEventChoice] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (!open) setEventChoice(undefined); }, [open]);
  const eventId = eventChoice !== undefined
    ? eventChoice : (existing.data?.eventId ?? null);

  /* ── Reopening ────────────────────────────────────────────────
     Whatever was on this table when the app was last closed. Loaded
     once per opening, and `loaded` gates the save below so an empty
     initial render cannot wipe a draft before it has been read. */
  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    let alive = true;
    void (async () => {
      const [existing, usable] = await Promise.all([
        loadDraft(key), draftsUsable(),
      ]);
      if (!alive) return;
      setLines(existing?.lines ?? []);
      /* The function chosen before the pad was closed (the master, 17 Sep). */
      if (existing && existing.eventId !== undefined) setEventChoice(existing.eventId);
      setCanKeep(usable);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [open, key]);

  /* ── Written down as it grows ─────────────────────────────────
     Not on Send. A phone that locks between the third dish and the
     sixth is the ordinary case, not the edge one. */
  useEffect(() => {
    if (!open || !loaded) return;
    const draft: Draft = {
      key, hotelId, outlet, tableId, tableLabel,
      ...(orderId ? { orderId } : {}),
      ...(eventChoice !== undefined ? { eventId: eventChoice } : {}),
      lines,
      updatedAt: new Date().toISOString(),
    };
    if (lines.length === 0) void clearDraft(key);
    else void saveDraft(draft);
  }, [lines, loaded, open, key, hotelId, outlet, tableId, tableLabel, orderId, eventChoice]);

  const categories = menu.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({
        ...c,
        items: c.items.filter((i) =>
          i.name.toLowerCase().includes(q)
          || (i.shortCode ?? "").toLowerCase().includes(q)),
      }))
      .filter((c) => c.items.length > 0);
  }, [categories, search]);

  const total = draftTotal(lines);
  const count = draftCount(lines);

  /* ── Adding a dish ────────────────────────────────────────────
     A plain dish goes straight on. One with variations or sides opens
     the dialog first — the same dialog the till uses, unchanged,
     because it never touched the network to begin with. */
  const tap = (item: MenuItem) => {
    if (item.variations.length > 0 || item.addonGroups.length > 0) {
      setAsking(item);
      return;
    }
    put(item, 1, "", undefined, undefined);
  };

  const put = (
    item: MenuItem, qty: number, note: string,
    variationId?: string, addonIds?: string[],
  ) => {
    const { variationLabel, addonLabels } =
      chosenLabels(item, variationId, addonIds);
    const line: DraftLine = {
      uid: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      itemId: item.id,
      name: item.name,
      qty,
      note,
      ...(variationId ? { variationId } : {}),
      ...(variationLabel ? { variationLabel } : {}),
      addonIds: addonIds ?? [],
      addonLabels,
      unitPrice: unitPriceOf(item, variationId, addonIds),
    };
    setLines((prev) => [...prev, line]);
    setAsking(null);
  };

  const bump = (uid: string, by: number) => {
    setLines((prev) => prev.flatMap((l) => {
      if (l.uid !== uid) return [l];
      const next = l.qty + by;
      /* Counting down to none removes it, the same as the bin. Nothing
         has been sent, so there is nothing to strike through — an
         unsent line is not a voided one and must not look like one. */
      return next <= 0 ? [] : [{ ...l, qty: next }];
    }));
  };

  const drop = (uid: string) =>
    setLines((prev) => prev.filter((l) => l.uid !== uid));

  /* ── Send ─────────────────────────────────────────────────────── */
  const send = async () => {
    if (lines.length === 0 || sending) return;
    setSending(true);
    const result = await sendOrder(hotelId, {
      ...(orderId ? { orderId } : { outlet, tableId }),
      lines: lines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        ...(l.note ? { note: l.note } : {}),
        ...(l.variationId ? { variationId: l.variationId } : {}),
        ...(l.addonIds.length ? { addonIds: l.addonIds } : {}),
      })),
      send: true,
      ...(eventChoice !== undefined ? { eventId: eventChoice } : {}),
    });
    setSending(false);

    if (!result.ok) {
      /* ⚠ THE DRAFT STAYS. The server refused one dish — off the menu,
         a variation not chosen, the outlet closed. The waiter changes
         that dish and sends again; they do not retake the round in
         front of the guest. */
      /* The table names itself, because a waiter carrying three tables
         needs to know WHICH was refused. The server's reason already
         opens with "Nothing was sent." — repeating it in the title read
         as "Nothing was sent — Nothing was sent. Dish 2 could not be
         added…", which is what it looked like in a browser. */
      toast.error(tableLabel, result.reason);
      return;
    }

    if (result.held) {
      /* ⚠ NOT "sent to the kitchen". No server has seen this, there is
         no docket number, and nothing is being cooked. The outbox has
         it and will send it when the line is back. Saying otherwise is
         the sharpest available version of this feature's worst
         failure. */
      await clearDraft(key);
      setLines([]);
      toast.info(
        `${tableLabel} is held`,
        "The kitchen does not have it yet. It goes as soon as the "
        + "connection is back.",
      );
      onOpenChange(false);
      onSent();
      return;
    }

    /* ⚠ THE DRAFT GOES FIRST, THEN THE SLIP (POS-11). Opening the slip
       first left a SENT round saved on the device as unsent wherever the
       new tab replaced this page — a browser set to open new windows in
       the same tab, a kiosk's web view — and the table then read "not
       sent" with the dishes still on its pad, one Send away from cooking
       and billing them twice. Seen in the preview pane, 17 September.
       Deleting a draft takes milliseconds of the browser's few seconds. */
    await clearDraft(key);
    setLines([]);

    /* The paper, the same as the Terminal (POS-5; the owner's D17-18,
       17 September: "Tables opens the kitchen slip on every send"). Only
       when the kitchen has a docket number — a round that went on the
       bill alone has no slip, and a held round is answered above. */
    if (result.kotNo !== null) {
      const url =
        `/h/${hotelId}/till/orders/${result.order.id}/kot/${result.kotNo}`;
      /* POS-10: refused on a slow line. Tables says so and offers it. */
      if (!openSlip(url)) {
        onSlipBlocked?.({ url, what: `Order ${result.kotNo} for ${tableLabel}` });
      }
    }

    qc.setQueryData(["till-order", hotelId, result.order.id], result.order);
    void qc.invalidateQueries({ queryKey: ["till-orders"] });
    void qc.invalidateQueries({ queryKey: ["floor"] });
    toast.success(
      `${tableLabel} sent`,
      result.kotNo !== null
        ? `Kitchen docket ${result.kotNo}.`
        : "On the bill. Nothing went to the kitchen.",
    );
    onOpenChange(false);
    onSent();
  };

  const noMenu = menu.isSuccess && categories.length === 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          size="xl"
          className="max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)]"
          title={tableLabel}
          description={
            orderId
              ? "Another round on this table's bill."
              : "A new order. Nothing is sent until you press Send."
          }
          footer={
            <div className="flex items-center gap-3 w-full">
              <div className="min-w-0">
                {/* ⚠ THE PAD'S OWN ARITHMETIC, and labelled as such.
                    The owner asked for this so a waiter can answer
                    "how much is that?" at the table. It is what the
                    DISHES come to — tax, discounts and rounding are the
                    server's and appear on the bill, not here. */}
                <span className="block tabular text-lg font-semibold text-ink-900 leading-tight">
                  {lines.length === 0 ? "—" : money(total)}
                </span>
                <span className="block text-2xs text-grey-500">
                  {lines.length === 0
                    ? "nothing on the pad"
                    : `${count} ${count === 1 ? "dish" : "dishes"} · before tax`}
                </span>
              </div>
              <div className="flex-1" />
              <Button variant="secondary" size="lg"
                onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant="primary"
                size="lg"
                loading={sending}
                disabled={lines.length === 0}
                onClick={() => void send()}
              >
                Send
              </Button>
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            {/* ── The menu ───────────────────────────────────── */}
            <div className="min-w-0 order-2 lg:order-1">
              <div className="relative mb-3">
                <Search className="size-4 text-grey-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search the menu"
                  className="pl-9"
                />
              </div>

              {noMenu && (
                <p className="text-sm text-grey-600 leading-relaxed">
                  There is no menu yet. Nothing can be sold until the hotel
                  enters what it sells — the prices are yours, this system
                  ships none.
                </p>
              )}

              {menu.isPending && (
                <p className="text-sm text-grey-500">Loading the menu…</p>
              )}

              {/* POS-4: a menu that failed to load drew nothing at all —
                  no dishes, no "no menu", no reason. */}
              {menu.data === undefined && menu.error && (
                <ReadFailed
                  compact
                  error={menu.error}
                  what="the menu"
                  onRetry={() => void menu.refetch()}
                />
              )}

              {!noMenu && filtered.length === 0 && search.trim() && (
                <p className="text-sm text-grey-600">
                  Nothing on the menu matches “{search.trim()}”.
                </p>
              )}

              <div className="space-y-4">
                {filtered.map((cat) => (
                  <section key={cat.id}>
                    <h3 className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
                      {cat.name}
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {cat.items.map((item) => {
                        const off = !item.isActive;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={off}
                            onClick={() => tap(item)}
                            className={cn(
                              "flex items-center justify-between gap-3 text-left",
                              "rounded-md border p-3 min-h-14",
                              "transition-colors duration-200",
                              off
                                ? "border-grey-200 bg-grey-50 text-grey-500 cursor-not-allowed"
                                : "border-grey-200 bg-white cursor-pointer hover:border-brand-orange hover:bg-brand-orange-50",
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block text-base text-ink-900 truncate">
                                {item.name}
                              </span>
                              {off && (
                                <span className="block text-2xs text-grey-500">
                                  off the menu today
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 tabular text-base text-ink-900">
                              {/* A dish sold by variation has no price of
                                  its own. A dash, never a zero. */}
                              {item.variations.length > 0
                                ? "—"
                                : money(item.price)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            {/* ── The round ──────────────────────────────────── */}
            <div className="min-w-0 order-1 lg:order-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-2xs font-semibold uppercase tracking-wide text-grey-500">
                  This round
                </h3>
                {!canKeep && (
                  <StatusPill tone="warning">not saved</StatusPill>
                )}
              </div>

              {!canKeep && (
                <p className="text-2xs text-grey-600 mb-2.5 leading-relaxed">
                  This browser will not let the order be written down. It
                  works, but closing the app loses it.
                </p>
              )}

              <FunctionPicker
                className="mb-3"
                hotelId={hotelId}
                value={eventId}
                currentTitle={existing.data?.eventTitle ?? null}
                disabled={sending}
                onChange={setEventChoice}
              />

              {lines.length === 0 ? (
                <p className="text-sm text-grey-600 leading-relaxed py-3">
                  Tap a dish to start. Nothing reaches the kitchen until you
                  press Send.
                </p>
              ) : (
                <ul className="divide-y divide-grey-100 border-y border-grey-100">
                  {lines.map((l) => (
                    <li key={l.uid} className="py-2.5">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="block text-base text-ink-900">
                            {l.name}
                          </span>
                          {(l.variationLabel || l.addonLabels.length > 0) && (
                            <span className="block text-2xs text-grey-600">
                              {[l.variationLabel, ...l.addonLabels]
                                .filter(Boolean).join(" · ")}
                            </span>
                          )}
                          {l.note && (
                            <span className="block text-2xs text-brand-orange-700">
                              {l.note}
                            </span>
                          )}
                        </div>
                        <span className="tabular text-base text-ink-900 shrink-0">
                          {money(l.unitPrice * l.qty)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <button
                          type="button"
                          aria-label={`One less ${l.name}`}
                          onClick={() => bump(l.uid, -1)}
                          className="size-11 grid place-items-center rounded-md border border-grey-300 text-grey-600 hover:text-ink-900 cursor-pointer transition-colors duration-200"
                        >
                          <Minus className="size-4" />
                        </button>
                        <span className="tabular text-base font-medium text-ink-900 w-8 text-center">
                          {l.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`One more ${l.name}`}
                          onClick={() => bump(l.uid, 1)}
                          className="size-11 grid place-items-center rounded-md border border-grey-300 text-grey-600 hover:text-ink-900 cursor-pointer transition-colors duration-200"
                        >
                          <Plus className="size-4" />
                        </button>
                        <div className="flex-1" />
                        <button
                          type="button"
                          aria-label={`Take ${l.name} off the pad`}
                          onClick={() => drop(l.uid)}
                          className="size-11 grid place-items-center rounded-md border border-grey-300 text-grey-500 hover:text-brand-red hover:border-brand-red cursor-pointer transition-colors duration-200"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {lines.length > 0 && (
                <p className="flex items-start gap-1.5 text-2xs text-grey-500 mt-3 leading-relaxed">
                  <WifiOff className="size-3.5 shrink-0 mt-px" />
                  <span>
                    Held on this device. Nothing has been sent — the kitchen
                    sees it when you press Send.
                  </span>
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* The till's own dish dialog, unchanged. It never touched the
          network, so the pad reuses it as it stands — variations, sides,
          minimum and maximum selections, quantity and the kitchen note
          are all already written and already tested. */}
      <DishDialog
        item={asking}
        open={asking !== null}
        onOpenChange={(o) => { if (!o) setAsking(null); }}
        onAdd={(id, qty, note, variationId, addonIds) => {
          const item = categories
            .flatMap((c) => c.items).find((i) => i.id === id);
          if (item) put(item, qty, note, variationId, addonIds);
        }}
      />
    </>
  );
}
