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
import { getOrder, sendOrder, isBarSection, isBarDish, numberedAddonsQuery, tillMenuQuery, customInputs, type CustomAddon, type LineAddon, type MenuItem, type OrderLine } from "@/modules/pos/data/till";
import { FunctionPicker } from "@/modules/pos/components/FunctionPicker";
import { KotsSent } from "@/modules/pos/components/KotStation";
import { ReadFailed } from "@/components/ui";
import { useRole } from "@/lib/session";
import { oneLinePerDish } from "@/modules/pos/lib/oneLinePerDish";

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
  /* A dish already sent that Customise is open on (D27-291): its add-ons
     join this round as lines of their own. */
  const [addingTo, setAddingTo] = useState<OrderLine | null>(null);
  /* The dish just tapped, for the note beside the footer - "<dish> added"
     with its own Customise - so the button is found on a narrow screen too
     (the owner's D27-290). It STAYS until the next dish, until its line goes,
     or until the pad is sent or closed: it went after 8 seconds at first, and
     a waiter who looked up from the table found it gone (seen on the demo,
     9 October). */
  const [justAdded, setJustAdded] = useState<{ uid: string; name: string } | null>(null);
  useEffect(() => {
    if (!justAdded) return;
    /* On a narrow screen This round sits above the menu: its new line is
       brought into view (D27-290). */
    if (window.matchMedia?.("(max-width: 1023px)").matches) {
      document.querySelector(`[data-pad-line="${justAdded.uid}"]`)
        ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
  }, [justAdded]);
  useEffect(() => { if (!open) setJustAdded(null); }, [open]);
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
    /* Asked each time the pad opens: it lists the dishes already sent
       (D27-291), and one struck on the Till since must not be offered. */
    staleTime: 0,
  });
  /* The table's dishes the kitchen already has (the owner's D27-291): each
     takes add-ons, which join this round. */
  /* The same dish sent in two rounds is one line (D27-353). */
  const sentDishes = oneLinePerDish((existing.data?.lines ?? []).filter((l) => l.kotStatus !== "pending"))
    .filter((l) => !l.voided && l.parentLineId === null && !l.packing);
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

  /* Two tabs only when the menu has both sides: a hotel with no bar sees none.
     Nor a Bar person (D27-324): the server gives them only what prints at the
     bar, so the pad opens on all of it. */
  const barOnly = useRole() === "bar";
  const split = !barOnly && categories.some(isBarSection) && categories.some((c) => !isBarSection(c));
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
         Kebab (D27-289) or a typed add-on (D27-291): Customise is chosen on
         a line, not on a tap. Nor of an add-on for a dish already sent. */
      && !(l.numberedAddons?.length) && !(l.customAddons?.length) && !l.extraFor;
    setLines((prev) => {
      const same = prev.find(isSame);
      return same
        ? prev.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l))
        : [...prev, line];
    });
    setJustAdded({ uid: lines.find(isSame)?.uid ?? line.uid, name: item.name });
    setAsking(null);
  };

  /* ONE MORE OF A DISH ALREADY SENT (the owner's D27-349): the same dish
     with its choices - size, further choices, sides, note and its numbered
     add-ons - joins this round, and goes with Send on a new KOT. The sent
     one is untouched. On the pad, so it works with no connection too. */
  const again = (d: OrderLine) => {
    const item = categories.flatMap((c) => c.items).find((i) => i.id === d.itemId);
    if (!item) { toast.error("Not added", `${d.name} is not on the menu now.`); return; }
    const sides = (existing.data?.lines ?? [])
      .filter((s) => s.parentLineId === d.id && s.isAddon && !s.voided && s.addonId)
      .map((s) => s.addonId!);
    const variationId = d.variationId ?? undefined;
    const more = d.moreChoiceIds ?? [];
    const chosen = d.numberedAddons?.addons ?? [];
    if (chosen.length === 0) { put(item, 1, d.note ?? "", variationId, sides, more); return; }
    const { variationLabel, addonLabels } = chosenLabels(item, variationId, sides, more);
    const base = unitPriceOf(item, variationId, sides, more);
    const line: DraftLine = {
      uid: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      itemId: item.id, name: item.name, qty: 1, note: d.note ?? "",
      ...(variationId ? { variationId } : {}),
      ...(more.length ? { moreChoiceIds: more } : {}),
      ...(variationLabel ? { variationLabel } : {}),
      addonIds: sides, addonLabels,
      numberedAddons: chosen, baseUnitPrice: base, unitPrice: priceWithAddons(base, chosen),
    };
    /* The same dish with the same add-ons already on the round: one more of
       it, as the server joins them on Send. */
    const key = (l: DraftLine) => JSON.stringify([l.itemId, l.variationId ?? null, l.note.trim(),
      l.moreChoiceIds ?? [], [...l.addonIds].sort(), (l.numberedAddons ?? []).map((a) => [a.id, a.qty])]);
    setLines((prev) => {
      const twin = prev.find((l) => !l.customAddons?.length && !l.extraFor && key(l) === key(line));
      return twin ? prev.map((l) => (l === twin ? { ...l, qty: l.qty + 1 } : l)) : [...prev, line];
    });
    setJustAdded({ uid: line.uid, name: item.name });
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
    customs: CustomAddon[] = [],
  ) => {
    const withAddons = (l: DraftLine, typed: CustomAddon[]): DraftLine => {
      const base = l.baseUnitPrice ?? l.unitPrice;
      const { numberedAddons: _gone, baseUnitPrice: _was, customAddons: _typed, ...rest } = l;
      const kept = typed.length > 0 ? { customAddons: typed } : {};
      return chosen.length === 0
        ? { ...rest, ...kept, unitPrice: base }
        : { ...rest, ...kept, numberedAddons: chosen, baseUnitPrice: base,
            unitPrice: priceWithAddons(base, chosen) };
    };
    setLines((prev) => {
      /* JUST 1 of several (the owner's D27-290): one of them, split off as a
         line of its own with the add-ons; the rest stay as they were. The
         typed add-ons chosen now go with the one split off, as the Till's do
         (D27-291); those it had before stay where they were. */
      const next = prev.flatMap((l) => {
        if (l.uid !== uid) return [l];
        if (scope === "one" && l.qty > 1) {
          const had = l.customAddons ?? [];
          const kept = had.filter((c) => customs.includes(c));
          const { customAddons: _typed, ...rest } = l;
          return [{ ...rest, ...(kept.length ? { customAddons: kept } : {}), qty: l.qty - 1 },
                  withAddons({ ...l, uid: `${l.uid}-1-${Date.now()}`, qty: 1 },
                    customs.filter((c) => !had.includes(c)))];
        }
        return [withAddons(l, customs)];
      });
      /* Now the same as a line already on the pad? One line of both, as
         the server joins them on Send - the pad and the bill must not
         disagree about how many lines there are (the audit of 9 October).
         A line with typed add-ons is its own plate, never joined (D27-291). */
      const same = (l: DraftLine) => (l.customAddons?.length || l.extraFor) ? l.uid : JSON.stringify([
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

  /* Add-ons for a dish the kitchen already has (D27-291): each a pad line of
     its own, "+ Extra papad, for Veg Biryani", sent with this round. */
  const addTo = (dish: OrderLine, chosen: LineAddon[], customs: CustomAddon[]) => {
    const name = dish.numberedAddons?.dish ?? dish.name;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const extra = (i: number, line: Pick<DraftLine, "name" | "qty" | "unitPrice">, numberedId?: string): DraftLine => ({
      uid: `x-${dish.id}-${stamp}-${i}`, itemId: "", note: "", addonIds: [], addonLabels: [],
      ...line,
      extraFor: { lineId: dish.id, dish: name, ...(numberedId ? { numberedId } : {}) },
    });
    setLines((prev) => [
      ...prev,
      ...chosen.map((a, i) => extra(i, { name: a.name, qty: a.qty, unitPrice: a.price }, a.id)),
      ...customs.map((c, i) => extra(chosen.length + i, { name: c.name, qty: c.qty, unitPrice: c.price })),
    ]);
    setAddingTo(null);
  };

  /* ── Send ─────────────────────────────────────────────────────── */
  const send = async () => {
    if (lines.length === 0 || sending) return;
    setSending(true);
    const result = await sendOrder(hotelId, {
      ...(orderId ? { orderId } : { outlet, tableId }),
      lines: lines.map((l) => l.extraFor ? {
        /* An add-on for a dish already sent (D27-291), under that dish. */
        qty: l.qty,
        extraFor: l.extraFor.lineId,
        extras: l.extraFor.numberedId
          ? [{ numberedId: l.extraFor.numberedId, qty: l.qty }]
          : customInputs([{ name: l.name, price: l.unitPrice, qty: l.qty }]),
      } : {
        itemId: l.itemId,
        qty: l.qty,
        ...(l.note ? { note: l.note } : {}),
        ...(l.variationId ? { variationId: l.variationId } : {}),
        ...(l.moreChoiceIds?.length ? { moreChoiceIds: l.moreChoiceIds } : {}),
        ...(l.addonIds.length ? { addonIds: l.addonIds } : {}),
        ...(l.numberedAddons?.length
          ? { numberedAddons: l.numberedAddons.map((a) => ({ id: a.id, qty: a.qty })) }
          : {}),
        ...(l.customAddons?.length ? { extras: customInputs(l.customAddons) } : {}),
      }),
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

              {/* THE TABLE'S DISHES ALREADY SENT (the owner's D27-291): a
                  thali at the table, and the guest wants one thing more -
                  Customise on it, and the add-on joins this round. */}
              {sentDishes.length > 0 && (
                <div className="mb-4">
                  <p className="text-2xs uppercase tracking-wide text-grey-500 mb-1.5">
                    Already sent
                  </p>
                  <ul className="divide-y divide-grey-100 border-y border-grey-100">
                    {sentDishes.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 py-1.5">
                        <span className="flex-1 min-w-0 truncate text-sm text-ink-900">
                          {d.qty}× {d.name}
                        </span>
                        {/* One more of it, on this round (D27-349). */}
                        <button
                          type="button"
                          aria-label={`One more ${d.name}`}
                          onClick={() => again(d)}
                          className={STEP}
                        >
                          <Plus className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Customise ${d.name}`}
                          onClick={() => { setAddingTo(d); void numbered.refetch(); }}
                          className="press h-11 px-3.5 rounded-full border border-grey-300 bg-white text-sm font-medium text-ink-900 hover:border-grey-400 hover:bg-grey-50 cursor-pointer shrink-0"
                        >
                          Customise
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* THE TABLE'S KOTS, printed again at the computer that
                  prints each when a slip is lost (the owner's D27-324 (4),
                  D27-329 (2)). */}
              {orderId && (
                <KotsSent hotelId={hotelId} orderId={orderId} lines={existing.data?.lines ?? []} className="mb-4" />
              )}

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
                            {l.extraFor ? `+ ${l.name}` : nameWithAddons(l.name, l.numberedAddons ?? [])}
                          </span>
                          {l.extraFor && (
                            <span className="block text-2xs text-grey-600">
                              for {l.extraFor.dish}, already sent
                            </span>
                          )}
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
                          {l.unitPrice === 0 && l.extraFor ? "Free" : money(l.unitPrice * l.qty)}
                        </span>
                      </div>
                      {/* Its typed add-ons, each a line of its own (D27-291). */}
                      {(l.customAddons ?? []).map((c, i) => (
                        <div key={i} className="flex items-start gap-2 pl-3 mt-1">
                          <span className="min-w-0 flex-1 text-sm text-grey-700">
                            + {c.name} ×{c.qty}
                          </span>
                          <span className="tabular text-sm text-grey-700 shrink-0">
                            {c.price === 0 ? "Free" : money(c.price * c.qty)}
                          </span>
                        </div>
                      ))}

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
                        {/* The numbered Add-ons on this dish (D27-289), and typed
                            ones (D27-291). Not on an add-on line itself. */}
                        {!l.extraFor && (
                          <button
                            type="button"
                            aria-label={`Customise ${l.name}`}
                            onClick={() => { setCustomising(l); void numbered.refetch(); }}
                            className="press h-11 px-4 rounded-full border border-grey-300 bg-white text-sm font-medium text-ink-900 hover:border-grey-400 hover:bg-grey-50 cursor-pointer"
                          >
                            Customise
                          </button>
                        )}
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
        customs={customising?.customAddons ?? []}
        onDone={(chosen, scope, customs) => {
          if (customising) customise(customising.uid, chosen, scope, customs);
        }}
      />

      {/* On a dish the kitchen already has (D27-291). */}
      <CustomiseDialog
        key={`sent-${addingTo?.id ?? "none"}`}
        sent
        loading={numbered.isFetching}
        failed={numbered.isError}
        onRetry={() => void numbered.refetch()}
        open={addingTo !== null}
        onOpenChange={(o) => { if (!o) setAddingTo(null); }}
        dish={addingTo?.numberedAddons?.dish ?? addingTo?.name ?? ""}
        base={addingTo?.unitPrice ?? 0}
        addons={numbered.data ?? []}
        chosen={[]}
        onDone={(chosen, _scope, customs) => { if (addingTo) addTo(addingTo, chosen, customs); }}
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
