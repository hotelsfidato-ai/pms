import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import {
  UtensilsCrossed, X, BedDouble, Banknote, CreditCard, Smartphone,
  ArrowLeft, Printer, Lock, Search, Minus, Plus, MessageSquare, Flame,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { toast } from "@/components/ui";
import {
  getMenu, listOrders, getOrder, listChargeableRooms,
  openOrder, addLine, voidLine, setLineQty, sendToKitchen,
  settleOrder, abandonOrder,
  listPosOutlets, BUSINESS_DATE,
  type MenuItem,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE TERMINAL

   /till is the till on a desk, inside the console, with the sidebar and
   the property switcher and everything else a manager needs.

   This is the same till on a FIXED SCREEN in a restaurant. The group
   said the POS is a separate terminal, and a separate terminal is not a
   narrower browser window — it is a different set of assumptions:

     ONE OUTLET       chosen once and remembered. A waiter does not pick
                      which restaurant they are standing in.
     NO CHROME        no sidebar, no property switcher, no navigation. A
                      terminal has one job and every pixel spent on
                      somewhere-else is a pixel not spent on the menu.
     THUMB TARGETS    64px, not 44. A phone is held; a terminal is
                      jabbed at across a counter, often by somebody
                      carrying plates.
     TWO PANES        menu and bill, always both visible. A waiter must
                      never have to navigate to see what they have rung
                      up.

   It writes through exactly the same repository functions as /till.
   There is no second order path and no second set of rules — a terminal
   that could do something the till could not would be a second system.
   ══════════════════════════════════════════════════════════════════ */

const OUTLET_KEY = "fidato.terminal-outlet";

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

const METHODS = [
  { key: "cash" as const, label: "Cash", icon: Banknote },
  { key: "card" as const, label: "Card", icon: CreditCard },
  { key: "upi" as const, label: "UPI", icon: Smartphone },
];

export default function TerminalPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();

  /* The outlet is remembered on THIS DEVICE. A terminal bolted to a
     counter in the restaurant should not ask again every morning, and
     the answer is a property of the machine rather than of the person
     signed into it. */
  const [outlet, setOutlet] = useState<string | null>(() => {
    try { return localStorage.getItem(OUTLET_KEY); } catch { return null; }
  });
  const [orderId, setOrderId] = useState<string | null>(null);
  const [table, setTable] = useState("");
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(false);
  const [room, setRoom] = useState("");
  /* A sixteen-item demo menu fits on a screen. A real card does not, and
     scrolling for "Jeera Rice" while a table waits is how a waiter ends
     up writing on paper instead. */
  const [find, setFind] = useState("");
  /* THE BILL, ON A PHONE. Side by side needs about 1024px: below that a
     300px panel left roughly 75px for the menu, dish names cut off
     mid-word and no price visible at all. Two views, one at a time —
     the pattern every till on a phone uses, because there is no third
     option that is not a compromise on both. */
  const [billOpen, setBillOpen] = useState(false);
  const [choices, setChoices] = useState<
    { folioId: string; guest: string }[] | null
  >(null);

  const outlets = useQuery({
    queryKey: ["pos-outlets", hotelId],
    queryFn: () => listPosOutlets(hotelId),
  });
  const menu = useQuery({
    queryKey: ["till-menu", hotelId],
    queryFn: () => getMenu(hotelId),
  });
  const orders = useQuery({
    queryKey: ["till-orders", hotelId, BUSINESS_DATE],
    queryFn: () => listOrders(hotelId),
  });
  const current = useQuery({
    queryKey: ["till-order", hotelId, orderId],
    queryFn: () => (orderId ? getOrder(hotelId, orderId) : null),
    enabled: !!orderId,
  });
  const rooms = useQuery({
    queryKey: ["till-rooms", hotelId],
    queryFn: () => listChargeableRooms(hotelId),
    enabled: settling,
    /* WHO IS IN THE HOUSE CHANGES ALL EVENING. The global staleTime is
       Infinity, so this list was fetched once and cached for the life
       of the tab — a guest who checked in after the terminal opened
       could never be charged to their room, and the waiter would be
       told to reload a till.

       Zero here means every time the settle panel opens it asks
       again, which is exactly as often as the answer matters. */
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  /* A terminal is left running. Without this it shows this morning's
     board at ten at night. */
  useEffect(() => {
    const t = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["till-orders"] });
    }, 30_000);
    return () => clearInterval(t);
  }, [qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["till-orders"] });
    void qc.invalidateQueries({ queryKey: ["till-order"] });
    void qc.invalidateQueries({ queryKey: ["folio"] });
  };

  const chooseOutlet = (code: string) => {
    setOutlet(code);
    try { localStorage.setItem(OUTLET_KEY, code); } catch { /* private mode */ }
  };

  const start = async () => {
    if (!outlet) return;
    setBusy(true);
    const res = await openOrder(hotelId, outlet, table.trim() || undefined);
    setBusy(false);
    if (!res.ok) return toast.error("Could not open", res.reason);
    setOrderId(res.order.id);
    setTable("");
    refresh();
  };

  const add = async (item: MenuItem) => {
    if (!orderId) return;
    const res = await addLine(hotelId, orderId, item.id, 1);
    if (!res.ok) return toast.error("Not added", res.reason);
    refresh();
  };

  const setQty = async (lineId: string, qty: number) => {
    if (!orderId) return;
    const res = await setLineQty(hotelId, orderId, lineId, qty);
    if (!res.ok) return toast.error("Not changed", res.reason);
    refresh();
  };

  const note = async (item: MenuItem) => {
    if (!orderId) return;
    /* Modifiers. The column and the API have carried a note per line
       since 028 and nothing ever sent one, so "no chilli" reached the
       kitchen by shouting. */
    const text = window.prompt(`Anything to say about the ${item.name}?`);
    if (text === null) return;
    const res = await addLine(hotelId, orderId, item.id, 1, text.trim() || undefined);
    if (!res.ok) return toast.error("Not added", res.reason);
    refresh();
  };

  const strike = async (lineId: string) => {
    if (!orderId) return;
    const res = await voidLine(hotelId, orderId, lineId);
    if (!res.ok) return toast.error("Not struck", res.reason);
    refresh();
  };

  const kot = async () => {
    if (!orderId) return;
    setBusy(true);
    const res = await sendToKitchen(hotelId, orderId);
    setBusy(false);
    if (!res.ok) return toast.error("Not sent", res.reason);
    toast.success(
      `Order ${res.kotNo} is with the kitchen`,
      "They can start on it now.");
    /* The paper, for kitchens that run on it. The pass screen already
       has the same lines and is better — oldest first, colour by wait —
       so this opens alongside rather than instead. */
    if (res.kotNo) {
      window.open(
        `/h/${hotelId}/till/orders/${orderId}/kot/${res.kotNo}`, "_blank");
    }
    refresh();
  };

  const settle = async (
    method: "room" | "cash" | "card" | "upi", folioId?: string,
  ) => {
    if (!orderId) return;
    setBusy(true);
    const res = await settleOrder(hotelId, orderId, method,
      method === "room" ? room : undefined, folioId);
    setBusy(false);

    if (!res.ok) {
      if (res.choices) { setChoices(res.choices); return; }
      return toast.error("Not settled", res.reason);
    }
    toast.success("Settled", res.guest ? `Charged to ${res.guest}` : undefined);
    setOrderId(null); setSettling(false); setRoom(""); setChoices(null);
    refresh();
  };

  const abandon = async () => {
    if (!orderId) return;
    const reason = window.prompt("Why is this order being closed unpaid?");
    if (!reason?.trim()) return;
    const res = await abandonOrder(hotelId, orderId, reason.trim());
    if (!res.ok) return toast.error("Not closed", res.reason);
    setOrderId(null); setSettling(false);
    refresh();
  };

  const order = current.data ?? null;
  const open = (orders.data?.orders ?? []).filter((o) => o.status === "open");
  const active = (outlets.data ?? []).filter((o) => o.isActive);

  /* ── Choosing the outlet, once ──────────────────────────────── */
  if (!outlet) {
    return (
      <Shell>
        <div className="max-w-2xl mx-auto pt-16 px-6">
          <p className="text-2xs uppercase tracking-wide text-grey-400 mb-2">
            Terminal setup
          </p>
          <h1 className="text-2xl font-semibold text-ink-900 mb-2">
            Which outlet is this terminal in?
          </h1>
          <p className="text-base text-grey-600 mb-8 leading-relaxed">
            Asked once. This screen is meant to stay open on a fixed
            terminal, so the answer is remembered on this device rather
            than on the person signed into it.
          </p>

          {active.length === 0 ? (
            <div className="rounded-md border border-grey-200 bg-white p-6 text-center">
              <UtensilsCrossed className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">
                No outlet is configured
              </p>
              <p className="text-base text-grey-500 mt-1.5">
                A terminal has nothing to sell from until this property has
                an outlet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {active.map((o) => (
                <button
                  key={o.code}
                  type="button"
                  onClick={() => chooseOutlet(o.code)}
                  className="w-full text-left rounded-lg border border-grey-300 bg-white p-5 min-h-20 hover:border-brand-orange hover:bg-brand-orange-50 transition-colors duration-150"
                >
                  <p className="text-lg font-semibold text-ink-900">{o.name}</p>
                  <p className="text-base text-grey-500 tabular">{o.code}</p>
                </button>
              ))}
            </div>
          )}

          <Link
            to={`/h/${hotelId}/till`}
            className="inline-block mt-8 text-base text-brand hover:underline"
          >
            ← Back to the console
          </Link>
        </div>
      </Shell>
    );
  }

  const outletName =
    active.find((o) => o.code === outlet)?.name ?? outlet;

  /* ── The terminal ───────────────────────────────────────────── */
  return (
    <Shell>
      <header className="flex items-center gap-4 px-5 h-16 border-b border-grey-200 bg-white shrink-0">
        <UtensilsCrossed className="size-5 text-brand-orange shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-ink-900 truncate leading-tight">
            {outletName}
          </p>
          <p className="text-2xs text-grey-500 tabular">
            {open.length} open · {BUSINESS_DATE}
          </p>
        </div>
        <Link
          to={`/h/${hotelId}/till`}
          className="inline-flex items-center gap-2 h-12 px-4 rounded-md border border-grey-300 text-base text-grey-700 hover:border-grey-400"
        >
          <ArrowLeft className="size-4" />
          Console
        </Link>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* ── The menu ─────────────────────────────────────────── */}
        {/* A CONTAINER, because the grid inside must size itself to
            THIS PANEL and not to the window. `sm:grid-cols-2` is a
            viewport rule, and on a 768px tablet the panel is 388px wide
            while the viewport says 768 — so it drew two columns of
            185px and "Paneer Butter Masala" wrapped onto three lines,
            leaving a row half again as tall as its neighbours.

            The window is not the thing the cards live in. */}
        <div className="@container flex-1 min-w-0 overflow-y-auto p-4">
          {!orderId ? (
            <div className="max-w-md mx-auto pt-10">
              <p className="text-2xs uppercase tracking-wide text-grey-500 mb-2">
                Start an order
              </p>
              <input
                value={table}
                onChange={(e) => setTable(e.target.value)}
                placeholder="Table 4"
                className="w-full h-16 px-4 rounded-lg border border-grey-300 text-lg mb-3"
              />
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy}
                className="w-full h-16 rounded-lg bg-brand-orange text-white text-lg font-semibold disabled:opacity-50"
              >
                Open the order
              </button>

              {open.length > 0 && (
                <div className="mt-8">
                  <p className="text-2xs uppercase tracking-wide text-grey-500 mb-2">
                    Open orders
                  </p>
                  <div className="space-y-2">
                    {open.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setOrderId(o.id)}
                        className="w-full flex items-center gap-3 text-left rounded-lg border border-grey-200 bg-white p-4 min-h-16 hover:border-brand-orange"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-base text-ink-900 tabular">
                            {o.orderNo}
                          </span>
                          <span className="block text-2xs text-grey-500">
                            {o.table ?? "no table"} · {o.lines} item
                            {o.lines === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span className="tabular text-base text-ink-900">
                          {moneyPrecise(o.gross)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="relative">
                <Search className="size-4 text-grey-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder="Find a dish"
                  aria-label="Find a dish"
                  className="w-full h-14 pl-11 pr-4 rounded-lg border border-grey-300 text-base"
                />
              </div>
              {(menu.data ?? []).map((cat) => (
                <section key={cat.id} className={cn(
                  /* A heading over nothing is worse than no heading. */
                  cat.items.some((i) => i.name.toLowerCase()
                    .includes(find.trim().toLowerCase())) ? "" : "hidden",
                )}>
                  <h2 className="text-md font-semibold text-ink-900 mb-2.5">
                    {cat.name}
                  </h2>
                  {/* Columns by the PANEL's width, not the window's.
                      Roughly: one column under 384px, two to 672px,
                      three to 896px, four beyond — so a phone gets a
                      single readable column, a portrait tablet two, and
                      a 1366px till four instead of three cards nearly
                      200px wide holding two words and a price. */}
                  <div className="grid gap-2.5 @sm:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
                    {cat.items
                      .filter((i) => i.name.toLowerCase()
                        .includes(find.trim().toLowerCase()))
                      .map((item) => (
                      <div key={item.id} className="relative">
                      <button
                        type="button"
                        onClick={() => void add(item)}
                        disabled={!item.isActive || order?.status !== "open"}
                        className={cn(
                          /* `w-full`, and it is the whole bug this card had.
                             A <button> is shrink-to-fit, so `flex` sized it
                             to its content and every card collapsed to the
                             width of its longest word inside a grid cell
                             that was already the right width. The note
                             button below is positioned against the CELL, so
                             it detached and floated in the empty space —
                             two symptoms, one missing class.

                             64px tall, not 44. A terminal is jabbed at
                             across a counter by somebody holding plates. */
                          "w-full flex flex-col justify-between text-left",
                          "rounded-lg border p-4 min-h-20",
                          "transition-colors duration-150",
                          item.isActive
                            ? "border-grey-200 bg-white hover:border-brand-orange hover:bg-brand-orange-50 active:bg-brand-orange-100"
                            : "border-grey-200 bg-grey-50 text-grey-400 cursor-not-allowed",
                        )}
                      >
                        {/* `pr-10` keeps the name clear of the note button,
                            which sits over this corner. Without it a long
                            dish name runs under the icon and the last word
                            is unreadable. */}
                        <span className="text-base text-ink-900 leading-snug pr-10">
                          {item.name}
                        </span>
                        <span className="flex items-end justify-between gap-2 mt-3">
                          {/* The tax rate is for the person reconciling the
                              bill, not the waiter taking the order. Quiet,
                              and out of the way of the number that matters. */}
                          <span className="text-2xs text-grey-400 tabular leading-none pb-0.5">
                            {item.taxRate}%
                          </span>
                          <span className="text-lg tabular text-ink-900 leading-none">
                            {moneyPrecise(item.price)}
                          </span>
                        </span>
                      </button>
                      {/* Modifiers, as their own control. A long press is
                          invisible to somebody who has not been told about
                          it, and this is a screen new staff are put in
                          front of on their first shift.

                          44px, because a tablet is the common case here and
                          36 is under every touch guideline there is. */}
                      <button
                        type="button"
                        onClick={() => void note(item)}
                        disabled={!item.isActive || order?.status !== "open"}
                        aria-label={`Add ${item.name} with a note`}
                        title="Add with a note"
                        className={cn(
                          "absolute top-1 right-1 size-11 grid place-items-center",
                          "rounded-md text-grey-300 transition-colors duration-150",
                          "hover:text-brand-orange hover:bg-brand-orange-50",
                          "focus-visible:outline-2 focus-visible:outline-offset-2",
                          "focus-visible:outline-brand-orange-500",
                          "disabled:opacity-0 disabled:pointer-events-none",
                        )}
                      >
                        <MessageSquare className="size-4" />
                      </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {menu.data?.length === 0 && (
                <div className="text-center py-16">
                  <UtensilsCrossed className="size-8 text-grey-300 mx-auto mb-4" />
                  <p className="text-md font-semibold text-ink-900">
                    Nothing on the menu
                  </p>
                  <p className="text-base text-grey-500 mt-1.5">
                    The hotel enters its own dishes and prices.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── The bill ─────────────────────────────────────────────
            BESIDE the menu from lg up, OVER it below — 380px is right on
            a desk, narrows on a portrait tablet so the menu keeps two
            comfortable columns, and on a phone becomes a sheet the
            running-total bar opens. */}
        {billOpen && (
          <button
            type="button"
            aria-label="Close the bill"
            onClick={() => setBillOpen(false)}
            className="lg:hidden fixed inset-0 z-40 bg-ink-900/30"
          />
        )}
        <aside className={cn(
          "bg-white flex flex-col border-grey-200",
          "lg:relative lg:w-[320px] xl:w-[380px] lg:shrink-0 lg:border-l lg:translate-x-0",
          /* Below lg it is a sheet: off-screen until asked for. Kept
             MOUNTED rather than unmounted so the order, its scroll
             position and any half-typed room number survive being
             closed — a waiter who taps away mid-charge and comes back
             should not start again. */
          "fixed inset-y-0 right-0 z-50 w-[min(22rem,100vw)] border-l shadow-xl",
          "transition-transform duration-200 ease-out",
          billOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}>
          <div className="lg:hidden flex items-center justify-between border-b border-grey-200 px-4 h-14 shrink-0">
            <span className="text-base font-medium text-ink-900">The bill</span>
            <button
              type="button"
              onClick={() => setBillOpen(false)}
              className="size-11 grid place-items-center rounded-md text-grey-500 hover:bg-grey-100"
              aria-label="Back to the menu"
            >
              <X className="size-5" />
            </button>
          </div>
          {!order ? (
            <div className="flex-1 grid place-items-center p-6 text-center">
              <div>
                <UtensilsCrossed className="size-7 text-grey-300 mx-auto mb-3" />
                <p className="text-base text-grey-500">
                  No order open.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-grey-200 shrink-0">
                <p className="text-base font-semibold text-ink-900 tabular">
                  {order.orderNo}
                </p>
                <p className="text-2xs text-grey-500">
                  {order.table ?? "no table"} · {order.openedBy}
                </p>
              </div>

              <ul className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
                {order.lines.map((l) => (
                  <li key={l.id} className={cn(
                    "py-1", l.voided && "opacity-45",
                  )}>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "flex-1 min-w-0 text-base text-ink-900 truncate",
                        l.voided && "line-through",
                      )}>
                        {l.name}
                      </span>
                      <span className="tabular text-base text-ink-900">
                        {moneyPrecise(l.qty * l.unitPrice)}
                      </span>
                    </div>

                    {/* The note, under the dish it belongs to. It reaches
                        the kitchen copy, so it has to be visible to the
                        person who typed it. */}
                    {l.note && (
                      <p className="text-2xs text-brand-orange mt-0.5 pl-0.5">
                        {l.note}
                      </p>
                    )}
                    {/* Which dishes the kitchen already holds, so a second
                        KOT visibly sends only what is new. */}
                    {!l.voided && l.kotStatus !== "pending" && (
                      <p className="text-2xs text-grey-500 mt-0.5 pl-0.5">
                        {l.kotStatus === "sent" ? "with the kitchen"
                          : l.kotStatus === "preparing" ? "on the fire"
                          : l.kotStatus === "ready" ? "at the pass"
                          : "served"}
                      </p>
                    )}

                    {!l.voided && order.status === "open" ? (
                      /* A STEPPER, not a strike-and-retype. "Make that two
                         rather than three" used to mean cancelling the line
                         and adding it again, which left a struck row on the
                         kitchen copy for something the guest is still
                         getting. */
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          onClick={() => void setQty(l.id, l.qty - 1)}
                          aria-label={`One fewer ${l.name}`}
                          className="size-11 grid place-items-center rounded-md border border-grey-200 text-grey-600 hover:border-grey-400"
                        >
                          <Minus className="size-4" />
                        </button>
                        <span className="w-10 text-center tabular text-base text-ink-900">
                          {l.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => void setQty(l.id, l.qty + 1)}
                          aria-label={`One more ${l.name}`}
                          className="size-11 grid place-items-center rounded-md border border-grey-200 text-grey-600 hover:border-grey-400"
                        >
                          <Plus className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void strike(l.id)}
                          aria-label={`Strike ${l.name}`}
                          className="size-11 grid place-items-center rounded-md text-grey-400 hover:text-brand-red hover:bg-red-50 ml-auto"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-2xs text-grey-500 tabular mt-0.5">
                        {l.qty} × {moneyPrecise(l.unitPrice)}
                      </p>
                    )}
                  </li>
                ))}
                {order.lines.length === 0 && (
                  <li className="text-base text-grey-500 text-center py-8">
                    Tap a dish to add it.
                  </li>
                )}
              </ul>

              <div className="border-t border-grey-200 p-4 shrink-0 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-base text-grey-600">Total</span>
                  <span className="text-xl font-semibold tabular text-ink-900">
                    {moneyPrecise(order.gross)}
                  </span>
                </div>

                {order.status !== "open" ? (
                  <div className="space-y-2">
                    <p className="text-base text-grey-600">
                      {order.status === "settled"
                        ? `Paid by ${order.paymentMethod}.`
                        : `Closed unpaid — ${order.abandonedReason}`}
                    </p>
                    {order.status === "settled" && (
                      <button
                        type="button"
                        onClick={() => window.open(
                          `/h/${hotelId}/till/bill/${order.id}`, "_blank",
                        )}
                        className="w-full h-14 rounded-lg border border-grey-300 text-base font-medium inline-flex items-center justify-center gap-2"
                      >
                        <Printer className="size-4" />
                        Print the bill
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOrderId(null)}
                      className="w-full h-14 rounded-lg bg-ink-900 text-white text-base font-semibold"
                    >
                      Next order
                    </button>
                  </div>
                ) : choices ? (
                  <div className="space-y-2">
                    <p className="text-base font-medium text-ink-900">
                      Two guests in room {room}
                    </p>
                    <p className="text-2xs text-grey-600 leading-relaxed">
                      One is checking out, one has arrived. Who ate?
                    </p>
                    {choices.map((ch) => (
                      <button
                        key={ch.folioId}
                        type="button"
                        onClick={() => void settle("room", ch.folioId)}
                        className="w-full h-14 rounded-lg border border-grey-300 text-base text-left px-4"
                      >
                        {ch.guest}
                      </button>
                    ))}
                    <button type="button" onClick={() => setChoices(null)}
                      className="w-full h-12 text-base text-grey-600">
                      Cancel
                    </button>
                  </div>
                ) : settling ? (
                  <div className="space-y-2">
                    <input
                      list="terminal-rooms"
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      placeholder="Room number"
                      className="w-full h-14 px-4 rounded-lg border border-grey-300 text-base tabular"
                    />
                    <datalist id="terminal-rooms">
                      {(rooms.data ?? []).map((r) => (
                        <option key={r.folioId} value={r.room}>{r.guest}</option>
                      ))}
                    </datalist>
                    <button
                      type="button"
                      disabled={!room.trim() || busy}
                      onClick={() => void settle("room")}
                      className="w-full h-14 rounded-lg bg-brand-orange text-white text-base font-semibold disabled:opacity-50"
                    >
                      Charge to the room
                    </button>
                    <button type="button" onClick={() => setSettling(false)}
                      className="w-full h-12 text-base text-grey-600">
                      Back
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* KOT FIRST, and above the settle actions, because it
                        is the act that happens several times per table
                        while settling happens once. A till that offered
                        only "pay" taught waiters to bill early. */}
                    <button
                      type="button"
                      disabled={busy || !order.lines.some(
                        (l) => !l.voided && l.kotStatus === "pending")}
                      onClick={() => void kot()}
                      className="w-full h-16 rounded-lg bg-ink-900 text-white text-lg font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <Flame className="size-5" />
                      {order.lines.some(
                        (l) => !l.voided && l.kotStatus === "pending")
                        ? "Send to the kitchen"
                        : "Kitchen has it all"}
                    </button>
                    <button
                      type="button"
                      disabled={order.lines.filter((l) => !l.voided).length === 0}
                      onClick={() => setSettling(true)}
                      className="w-full h-16 rounded-lg bg-brand-orange text-white text-lg font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <BedDouble className="size-5" />
                      Charge to a room
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                      {METHODS.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          disabled={busy
                            || order.lines.filter((l) => !l.voided).length === 0}
                          onClick={() => void settle(m.key)}
                          className="h-16 rounded-lg border border-grey-300 text-base font-medium inline-flex flex-col items-center justify-center gap-1 disabled:opacity-40"
                        >
                          <m.icon className="size-5" />
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={() => void abandon()}
                      className="w-full h-12 text-base text-grey-600">
                      Close unpaid
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ── The running total, on a phone ─────────────────────────
          The one thing a waiter needs while tapping dishes and the one
          thing the sheet hides. It is a bar rather than a badge so the
          tap target is the whole width — this is used one-handed while
          carrying something. */}
      <button
        type="button"
        onClick={() => setBillOpen(true)}
        className={cn(
          "lg:hidden shrink-0 flex items-center justify-between gap-3",
          "border-t border-grey-200 bg-white px-4 h-16 text-left",
          "active:bg-grey-50 transition-colors duration-150",
        )}
      >
        <span className="min-w-0">
          <span className="block text-base font-medium text-ink-900">
            {order
              ? `${order.lines.filter((l) => !l.voided).length} on the bill`
              : "No order open"}
          </span>
          <span className="block text-2xs text-grey-500 truncate">
            {order ? `Tap to see it${order.table ? ` · ${order.table}` : ""}` : "Open one to start"}
          </span>
        </span>
        <span className="text-xl font-semibold tabular text-ink-900 shrink-0">
          {moneyPrecise(order?.gross ?? 0)}
        </span>
      </button>

      <footer className="h-9 shrink-0 border-t border-grey-200 bg-grey-50 flex items-center gap-2 px-4">
        <Lock className="size-3 text-grey-400" />
        <span className="text-2xs text-grey-500">
          This terminal is locked to {outletName}.
        </span>
        <button
          type="button"
          onClick={() => {
            try { localStorage.removeItem(OUTLET_KEY); } catch { /* ignore */ }
            setOutlet(null); setOrderId(null);
          }}
          className="text-2xs text-grey-500 underline ml-auto"
        >
          Change outlet
        </button>
      </footer>
    </Shell>
  );
}

/** Full screen, no console chrome. A terminal has one job. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-grey-50 flex flex-col">
      {children}
    </div>
  );
}
