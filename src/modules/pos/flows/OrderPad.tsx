import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Minus, Trash2, WifiOff, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { unitPriceOf, chosenLabels, priceWithAddons, nameWithAddons } from "@/modules/pos/lib/pricing";
import {
  draftKey, loadDraft, saveDraft, clearDraft, draftsUsable,
  draftTotal, draftCount, type Draft, type DraftLine,
} from "@/lib/draft";
import {
  Button, Dialog, DialogContent, Input, Segmented, StatusPill, toast,
} from "@/components/ui";
import { DishDialog } from "@/modules/pos/flows/DishDialog";
import { CustomiseDialog } from "@/modules/pos/flows/CustomiseDialog";
import { getOrder, sendOrder, isBarSection, isBarDish, numberedAddonsQuery, tillMenuQuery, type MenuItem } from "@/modules/pos/data/till";
import { FunctionPicker } from "@/modules/pos/components/FunctionPicker";
import { ReadFailed } from "@/components/ui";

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

/** A line's one-less / one-more: a 44px capsule (the fidato-design look). */
const STEP = "press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-grey-600 hover:text-ink-900 hover:border-grey-400 cursor-pointer";

export function OrderPad({
  hotelId, outlet, tableId, tableLabel, orderId, open, onOpenChange, onSent,
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
}) {
  const qc = useQueryClient();
  const key = draftKey(hotelId, outlet, tableId);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [asking, setAsking] = useState<MenuItem | null>(null);
  /* The pad line Customise is open on (D27-289). */
  const [customising, setCustomising] = useState<DraftLine | null>(null);
  /* The dish just tapped, for the note beside the footer - "<dish> added"
     with its own Customise - so the button is found on a narrow screen too
     (the owner's D27-290). Cleared after a while, on Send and on Close. */
  const [justAdded, setJustAdded] = useState<{ uid: string; name: string } | null>(null);
  useEffect(() => {
    if (!justAdded) return;
    /* On a narrow screen This round sits above the menu: its new line is
       brought into view (D27-290). */
    if (window.matchMedia?.("(max-width: 1023px)").matches) {
      document.querySelector(`[data-pad-line="${justAdded.uid}"]`)
        ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
    const t = window.setTimeout(() => setJustAdded(null), 8000);
    return () => window.clearTimeout(t);
  }, [justAdded]);
  const [search, setSearch] = useState("");
  /* D27-267: the menu in two - Restaurant and Bar - and one section at a
     time when its button is tapped (tapped again, all of them). */
  const [side, setSide] = useState<"restaurant" | "bar">("restaurant");
  const [section, setSection] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canKeep, setCanKeep] = useState(true);

  const menu = useQuery(tillMenuQuery(hotelId));
  /* The numbered Add-ons (D27-289), kept with the menu for a floor with no
     signal (App.tsx PERSISTED). */
  const numbered = useQuery(numberedAddonsQuery(hotelId));

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

  /* Two tabs only when the menu has both sides: a hotel with no bar sees none. */
  const split = categories.some(isBarSection) && categories.some((c) => !isBarSection(c));
  const onSide = useMemo(() => split
    ? categories.filter((c) => isBarSection(c) === (side === "bar")) : categories,
  [categories, split, side]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return section ? onSide.filter((c) => c.id === section) : onSide;
    /* A search looks across the whole menu, whichever tab is open. */
    return categories
      .map((c) => ({
        ...c,
        items: c.items.filter((i) =>
          i.name.toLowerCase().includes(q)
          || (i.shortCode ?? "").toLowerCase().includes(q)),
      }))
      .filter((c) => c.items.length > 0);
  }, [categories, onSide, search, section]);

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
    variationId?: string, addonIds?: string[], moreChoiceIds?: string[],
  ) => {
    const { variationLabel, addonLabels } =
      chosenLabels(item, variationId, addonIds, moreChoiceIds);
    const line: DraftLine = {
      uid: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      itemId: item.id,
      name: item.name,
      qty,
      note,
      ...(variationId ? { variationId } : {}),
      ...(moreChoiceIds?.length ? { moreChoiceIds } : {}),
      ...(variationLabel ? { variationLabel } : {}),
      addonIds: addonIds ?? [],
      addonLabels,
      unitPrice: unitPriceOf(item, variationId, addonIds, moreChoiceIds),
    };
    /* The same dish again is one more of it (D27-189): the same choices -
       variation, note and sides - as the server matches them on Send.
       Everything on the pad is unsent, so it always joins. */
    const sides = [...line.addonIds].sort().join();
    const isSame = (l: DraftLine) => l.itemId === item.id
      && l.variationId === line.variationId && l.note.trim() === note.trim()
      && (l.moreChoiceIds ?? []).join() === (line.moreChoiceIds ?? []).join()
      && [...l.addonIds].sort().join() === sides
      /* A plain tap is one more of the plain dish, never of the one with
         Kebab (D27-289): Customise is chosen on a line, not on a tap. */
      && !(l.numberedAddons?.length);
    setLines((prev) => {
      const same = prev.find(isSame);
      return same
        ? prev.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l))
        : [...prev, line];
    });
    setJustAdded({ uid: lines.find(isSame)?.uid ?? line.uid, name: item.name });
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

  /* Customise (D27-289): the numbered add-ons on THIS pad line, priced on
     what one of it cost before them. Nothing is sent until Send. */
  const customise = (
    uid: string, chosen: NonNullable<DraftLine["numberedAddons"]>, scope: "all" | "one" = "all",
  ) => {
    const withAddons = (l: DraftLine): DraftLine => {
      const base = l.baseUnitPrice ?? l.unitPrice;
      const { numberedAddons: _gone, baseUnitPrice: _was, ...rest } = l;
      return chosen.length === 0
        ? { ...rest, unitPrice: base }
        : { ...rest, numberedAddons: chosen, baseUnitPrice: base,
            unitPrice: priceWithAddons(base, chosen) };
    };
    setLines((prev) => {
      /* JUST 1 of several (the owner's D27-290): one of them, split off as a
         line of its own with the add-ons; the rest stay as they were. */
      const next = prev.flatMap((l) => {
        if (l.uid !== uid) return [l];
        if (scope === "one" && l.qty > 1) {
          return [{ ...l, qty: l.qty - 1 },
                  withAddons({ ...l, uid: `${l.uid}-1-${Date.now()}`, qty: 1 })];
        }
        return [withAddons(l)];
      });
      /* Now the same as a line already on the pad? One line of both, as
         the server joins them on Send - the pad and the bill must not
         disagree about how many lines there are (the audit of 9 October). */
      const same = (l: DraftLine) => JSON.stringify([
        l.itemId, l.variationId ?? null, l.note.trim(), l.moreChoiceIds ?? [],
        [...l.addonIds].sort(), (l.numberedAddons ?? []).map((a) => [a.id, a.qty]),
      ]);
      /* The changed line - the split-off one, on Just 1 - joins its twin. */
      const changed = scope === "one"
        ? next.find((l) => l.uid.startsWith(`${uid}-1-`)) ?? next.find((l) => l.uid === uid)
        : next.find((l) => l.uid === uid);
      const twin = changed && next.find((l) => l.uid !== changed.uid && same(l) === same(changed));
      return changed && twin
        ? next.filter((l) => l.uid !== changed.uid).map((l) => (l === twin ? { ...l, qty: l.qty + changed.qty } : l))
        : next;
    });
    setCustomising(null);
  };

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
        ...(l.moreChoiceIds?.length ? { moreChoiceIds: l.moreChoiceIds } : {}),
        ...(l.addonIds.length ? { addonIds: l.addonIds } : {}),
        ...(l.numberedAddons?.length
          ? { numberedAddons: l.numberedAddons.map((a) => ({ id: a.id, qty: a.qty })) }
          : {}),
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

    /* The sent round leaves the device. The paper is the KOT station's
       (D27-159): this device opens no slip - D17-18's slip on every send
       was retired by D27-161. */
    await clearDraft(key);
    setLines([]);

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
            <div className="w-full space-y-2">
            {justAdded && lines.some((l) => l.uid === justAdded.uid) && (
              <div className="flex items-center gap-3 rounded-md bg-success-50 px-3 py-1.5" role="status">
                <span className="flex-1 min-w-0 truncate text-sm text-ink-900">
                  {justAdded.name} added
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const l = lines.find((x) => x.uid === justAdded.uid);
                    if (l) { setCustomising(l); void numbered.refetch(); }
                    setJustAdded(null);
                  }}
                  className="press h-11 px-4 rounded-full border border-grey-300 bg-white text-sm font-medium text-ink-900 hover:border-grey-400 cursor-pointer"
                >
                  Customise
                </button>
              </div>
            )}
            <div className="flex items-center gap-3 w-full">
              <div className="min-w-0">
                {/* ⚠ THE PAD'S OWN ARITHMETIC, and labelled as such.
                    The owner asked for this so a waiter can answer
                    "how much is that?" at the table. It is what the
                    DISHES come to — tax, discounts and rounding are the
                    server's and appear on the bill, not here. */}
                <span className="block tabular text-lg font-semibold text-ink-900 leading-tight">
                  {lines.length === 0 ? "-" : money(total)}
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

              {!search.trim() && (split || onSide.length > 1) && (
                <div className="mb-4 space-y-3">
                  {split && (
                    <Segmented
                      value={side}
                      onChange={(v) => { setSide(v); setSection(null); }}
                      options={[{ value: "restaurant", label: "Restaurant" }, { value: "bar", label: "Bar" }]}
                    />
                  )}
                  {onSide.length > 1 && (
                    <div className="flex gap-2 flex-wrap">
                      {[{ id: null, name: "All" }, ...onSide].map((c) => (
                        <button
                          key={c.id ?? "all"}
                          type="button"
                          aria-pressed={section === c.id}
                          onClick={() => setSection(section === c.id ? null : c.id)}
                          className={cn(
                            "press min-h-11 px-3.5 rounded-full border text-base font-medium cursor-pointer",
                            section === c.id
                              ? "border-brand-orange bg-brand-orange-50 text-brand-orange-700"
                              : "border-grey-300 bg-white text-grey-700 hover:border-grey-400 hover:bg-grey-50",
                          )}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {noMenu && (
                <p className="text-sm text-grey-600 leading-relaxed">
                  There is no menu yet. Nothing can be sold until the hotel
                  enters what it sells - the prices are yours, this system
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

              <div className="space-y-5">
                {filtered.map((cat) => (
                  <section key={cat.id}>
                    <h3 className="text-md font-semibold text-ink-900 mb-3">
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
                              "rounded-lg ring-1 ring-inset px-3.5 py-3 min-h-14",
                              off
                                ? "ring-grey-200 bg-grey-50 text-grey-500 cursor-not-allowed"
                                : "ring-grey-200 bg-white cursor-pointer press-tile hover:ring-grey-400 hover:bg-grey-50",
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
                                ? "-"
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
            {/* D27-267: the round stays in view while the menu scrolls, and
                scrolls on its own once it is longer than the screen. */}
            <div className="min-w-0 order-1 lg:order-2 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto scrollbar-quiet">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-md font-semibold text-ink-900">
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
                    <li key={l.uid} data-pad-line={l.uid} className="py-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="block text-base text-ink-900">
                            {nameWithAddons(l.name, l.numberedAddons ?? [])}
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

                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          type="button"
                          aria-label={`One less ${l.name}`}
                          onClick={() => bump(l.uid, -1)}
                          className={STEP}
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
                          className={STEP}
                        >
                          <Plus className="size-4" />
                        </button>
                        {/* The numbered Add-ons on this dish (D27-289). */}
                        <button
                          type="button"
                          aria-label={`Customise ${l.name}`}
                          onClick={() => { setCustomising(l); void numbered.refetch(); }}
                          className="press h-11 px-4 rounded-full border border-grey-300 bg-white text-sm font-medium text-ink-900 hover:border-grey-400 hover:bg-grey-50 cursor-pointer"
                        >
                          Customise
                        </button>
                        <div className="flex-1" />
                        <button
                          type="button"
                          aria-label={`Take ${l.name} off the pad`}
                          onClick={() => drop(l.uid)}
                          className="press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-grey-500 hover:text-brand-red-700 hover:border-brand-red-100 hover:bg-brand-red-50 cursor-pointer"
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
                    Held on this device. Nothing has been sent - the kitchen
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
      <CustomiseDialog
        key={customising?.uid ?? "none"}
        qty={customising?.qty ?? 1}
        loading={numbered.isFetching}
        failed={numbered.isError}
        onRetry={() => void numbered.refetch()}
        open={customising !== null}
        onOpenChange={(o) => { if (!o) setCustomising(null); }}
        dish={customising?.name ?? ""}
        base={customising ? customising.baseUnitPrice ?? customising.unitPrice : 0}
        addons={numbered.data ?? []}
        chosen={customising?.numberedAddons ?? []}
        onDone={(chosen, scope) => { if (customising) customise(customising.uid, chosen, scope); }}
      />

      <DishDialog
        item={asking}
        bar={isBarDish(categories, asking?.id)}
        open={asking !== null}
        onOpenChange={(o) => { if (!o) setAsking(null); }}
        onAdd={(id, qty, note, variationId, addonIds, moreChoiceIds) => {
          const item = categories
            .flatMap((c) => c.items).find((i) => i.id === id);
          if (item) put(item, qty, note, variationId, addonIds, moreChoiceIds);
        }}
      />
    </>
  );
}
