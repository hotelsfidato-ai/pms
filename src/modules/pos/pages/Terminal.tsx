import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import {
  UtensilsCrossed, X, BedDouble, Banknote, CreditCard, Smartphone,
  ArrowLeft, Printer, Lock, Search, Minus, Plus, MessageSquare, Flame,
  CalendarHeart, ChevronRight, SlidersHorizontal, Gift,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong, moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { toast, Button, StatusPill } from "@/components/ui";
import { listOrders, getOrder, listChargeableRooms, openOrder, addLine, voidLine, setLineQty, takeDishes, sendToKitchen, settleOrder, abandonOrder, giveNoCharge, setOrderHeader, isBarDish, numberedAddonsQuery, tillMenuQuery, setNumberedAddons, addExtras, customInputs, type CustomAddon, type MenuItem, type OrderLine, type LineAddon, type CashId } from "@/modules/pos/data/till";
import { CashIdFields } from "@/modules/pos/components/CashIdFields";
import { FunctionPicker } from "@/modules/pos/components/FunctionPicker";
import { listPosOutlets } from "@/modules/pos/data/posBridge";
import { BUSINESS_DATE } from "@/data/repositories";
import { NewParcel } from "@/modules/pos/components/NewParcel";
import { ReadFailed, ReadStale } from "@/components/ui";
import { KotStatus, KotsSent } from "@/modules/pos/components/KotStation";
import { DishDialog } from "@/modules/pos/flows/DishDialog";
import { CustomiseDialog } from "@/modules/pos/flows/CustomiseDialog";
import { useBillPrint } from "@/modules/pos/flows/printBill";
import { addonBreakdown } from "@/modules/pos/lib/pricing";
import { oneLinePerDish } from "@/modules/pos/lib/oneLinePerDish";
import { GuestOrders } from "@/modules/pos/components/GuestOrders";
import { AskDialog, SENT_STRIKE, roomAsk, type Ask } from "@/modules/pos/components/AskDialog";
import { useDocumentTitle } from "@/lib/documentTitle";
import { TestHotelStripe } from "@/components/app/TestHotel";

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

/* The kit's looks at the terminal's sizes (every control 44px or more;
   the raw buttons stay, for their thumb heights). Capsules, as every
   button in the app (the owner, 27 September). */
const FIELD = "w-full rounded-lg border border-grey-300 bg-white hover:border-grey-400 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20";
const OUTLINE = "press rounded-full border border-grey-300 bg-white text-ink-900 hover:bg-grey-50 hover:border-grey-400";
const GHOST = "press rounded-full text-base font-medium text-grey-600 hover:bg-grey-100 hover:text-ink-900";
const STEP = "press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-grey-600 hover:text-ink-900 hover:border-grey-400 cursor-pointer";

export default function TerminalPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  /* The menu's word, in the heading and the tab (QA X-4, POS-10): the tab
     kept the last page's title, and the heading was the question. */
  useDocumentTitle("Terminal");

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
  const [asking, setAsking] = useState<MenuItem | null>(null);
  const [settling, setSettling] = useState(false);
  const [room, setRoom] = useState("");
  const [cashId, setCashId] = useState<CashId>({});
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

  const outlets = useQuery({
    queryKey: ["pos-outlets", hotelId],
    queryFn: () => listPosOutlets(hotelId),
  });
  const menu = useQuery(tillMenuQuery(hotelId));
  /* The numbered Add-ons (D27-289) for Customise. */
  const numbered = useQuery(numberedAddonsQuery(hotelId));
  /* To the bill printer, or here when none is chosen (D27-292). */
  const bill = useBillPrint(hotelId);
  const [customising, setCustomising] = useState<OrderLine | null>(null);
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

  /* A dish with something to ASK opens the dish dialog, as on the Till
     and Tables (the owner, 21 September). The Terminal had none, so a
     dish sold by variation could not be rung here at all - the server
     refused it with "Choose one" and there was nothing to choose with. */
  const asks = (item: MenuItem) =>
    item.variations.length > 0 || item.addonGroups.length > 0;

  const add = async (item: MenuItem) => {
    if (!orderId) return;
    if (asks(item)) { setAsking(item); return; }
    const res = await addLine(hotelId, orderId, item.id, 1);
    if (!res.ok) return toast.error("Not added", res.reason);
    refresh();
  };

  const addChosen = async (
    itemId: string, qty: number, text: string,
    variationId?: string, addonIds?: string[], moreChoiceIds?: string[],
  ) => {
    if (!orderId) return;
    setBusy(true);
    const res = await addLine(hotelId, orderId, itemId, qty,
      text.trim() || undefined, variationId, addonIds, moreChoiceIds);
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    setAsking(null);
    refresh();
  };

  /* Customise (D27-289): the numbered add-ons on a dish the kitchen does not
     have yet, folded in; typed ones as lines of their own (D27-291). On a
     dish the kitchen HAS, every add-on is a line of its own under it, for
     the next Send (D27-291). */
  const customise = async (chosen: LineAddon[], scope: "all" | "one", customs: CustomAddon[]) => {
    if (!orderId || !customising) return;
    setBusy(true);
    let res: Awaited<ReturnType<typeof setNumberedAddons>>;
    try {
      res = customising.kotStatus !== "pending"
        ? await addExtras(hotelId, orderId, customising.id, [
          ...chosen.map((a) => ({ numberedId: a.id, qty: a.qty })), ...customInputs(customs)])
        : await setNumberedAddons(hotelId, orderId, customising.id,
          chosen.map((a) => ({ id: a.id, qty: a.qty })), scope === "one" ? 1 : undefined,
          customInputs(customs));
    } catch {
      return toast.error("Not changed", "Try Customise again when the connection is back.");
    } finally {
      setBusy(false);
    }
    if (!res.ok) return toast.error("Not changed", res.reason);
    setCustomising(null);
    refresh();
  };

  /* Every question this screen asks, in a dialog: window.prompt() is
     refused by the app's window and by kiosk shells (QA POS-2). */
  const [ask, setAsk] = useState<Ask | null>(null);

  const setQty = async (lineId: string, qty: number, reason?: string) => {
    if (!orderId) return;
    const res = await setLineQty(hotelId, orderId, lineId, qty, reason);
    if (!res.ok) return toast.error("Not changed", res.reason);
    refresh();
  };

  const note = (item: MenuItem) => {
    if (!orderId) return;
    /* The dish dialog has its own note field. */
    if (asks(item)) { setAsking(item); return; }
    /* Modifiers. The column and the API have carried a note per line
       since 028 and nothing ever sent one, so "no chilli" reached the
       kitchen by shouting. */
    setAsk({
      title: `A note for the ${item.name}`,
      field: { label: "Anything to say about it?", required: false, hint: "No chilli, well done - it prints on the kitchen docket." },
      confirm: "Add it",
      onConfirm: async (text) => {
        const res = await addLine(hotelId, orderId, item.id, 1, text || undefined);
        if (!res.ok) return void toast.error("Not added", res.reason);
        refresh();
      },
    });
  };

  /* The waiter carried it from the pass: served (D27-222). */
  const take = async (lineId: string) => {
    if (!orderId) return;
    const res = await takeDishes(hotelId, orderId, [lineId]);
    if (!res.ok) return toast.error("Not taken", res.reason);
    refresh();
  };

  const strike = async (lineId: string, reason?: string) => {
    if (!orderId) return;
    const res = await voidLine(hotelId, orderId, lineId, reason);
    if (!res.ok) return toast.error("Not struck", res.reason);
    refresh();
  };

  /* Once the kitchen has a dish, fewer of it or none is a manager's, with a
     reason (D27-119). Before, it is the waiter's as ever. */
  const takeOff = (l: { id: string; name: string; qty: number; kotStatus: string }, qty: number) => {
    const go = (why?: string) => (qty === 0 ? strike(l.id, why) : setQty(l.id, qty, why));
    if (l.kotStatus === "pending") return void go();
    setAsk({
      title: qty === 0 ? `Take off ${l.name}?` : `${l.qty - qty} fewer ${l.name}?`,
      body: SENT_STRIKE,
      field: { label: "Why is it coming off?", required: true },
      confirm: "Take it off", onConfirm: (why) => go(why),
    });
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
    /* The paper is the KOT station's (D27-159): this device opens none. */
    refresh();
  };

  const settle = async (
    method: "room" | "cash" | "card" | "upi" | "function", folioId?: string,
  ) => {
    if (!orderId) return;
    setBusy(true);
    const res = await settleOrder(hotelId, orderId, method,
      method === "room" ? room : undefined, folioId, cashId);
    setBusy(false);

    if (!res.ok) {
      /* A room charge's refusal, or its "which bill?", is read in the box
         that asked (roomAsk). */
      if (method !== "room") toast.error("Not settled", res.reason);
      return res;
    }
    toast.success("Settled",
      res.guest ? `Charged to ${res.guest}`
        : method === "function" ? `On ${res.order.eventTitle ?? "the function"}'s bill`
          : undefined);
    setOrderId(null); setSettling(false); setRoom(""); setCashId({});
    refresh();
    return res;
  };

  /* D17-21: the banquet function this order is on, or off it. */
  const attach = async (eventId: string | null) => {
    if (!orderId) return;
    setBusy(true);
    const res = await setOrderHeader(hotelId, orderId, { eventId });
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(eventId
      ? `On ${res.order.eventTitle ?? "the function"}'s bill`
      : "Off the function");
    refresh();
  };

  const abandon = () => {
    if (!orderId) return;
    setAsk({
      title: "Close this bill unpaid?",
      body: "It stays on the record with this reason."
        + ((current.data?.lines ?? []).some((l) => !l.voided && l.kotStatus !== "pending")
          ? ` ${SENT_STRIKE}` : ""),
      field: { label: "Why is it being closed unpaid?", required: true },
      confirm: "Close unpaid",
      onConfirm: async (reason) => {
        const res = await abandonOrder(hotelId, orderId, reason);
        if (!res.ok) return void toast.error("Not closed", res.reason);
        setOrderId(null); setSettling(false);
        refresh();
      },
    });
  };

  /* NC, NO CHARGE (the owner's D27-351): the owner, an administrator or the
     GM, as the server asks, with a reason; it prints at once. */
  const mayNc = can(useRole(), "approve", "reservation");
  const giveNc = () => {
    if (!orderId) return;
    setAsk({
      title: "Give this bill no charge (NC)?",
      body: "The bill prints the dishes with no prices, marked NC, with this reason and your "
        + "name as the approval. It is no sale and carries no value, and it cannot be undone.",
      field: { label: "Why is it no charge?", required: true },
      confirm: "Give NC",
      onConfirm: async (reason) => {
        const res = await giveNoCharge(hotelId, orderId, reason);
        if (!res.ok) return { refused: res.reason };
        toast.success("The bill is NC");
        setSettling(false);
        refresh();
        void bill.print(orderId);
        return undefined;
      },
    });
  };

  /* D27-117, D27-162: charging to a room asks first, naming whose bill it
     lands on - and which, when the room has two (POS-8). */
  const askRoom = () => setAsk(roomAsk(room.trim(), moneyPrecise(current.data?.gross ?? 0),
    (rooms.data ?? []).filter((r) => r.room === room.trim()),
    (folioId) => settle("room", folioId)));

  const order = current.data ?? null;
  const open = (orders.data?.orders ?? []).filter((o) => o.status === "open");
  const active = (outlets.data ?? []).filter((o) => o.isActive);

  /* POS-4. A terminal is left running and the shell's offline bar sits
     underneath it, so it says for itself when what it shows is no longer
     current. One line, whichever read failed first. */
  const stale = [orders, menu, current].find(
    (q) => q.error && q.data !== undefined);
  const retryAll = () => {
    void orders.refetch();
    void menu.refetch();
    if (orderId) void current.refetch();
  };

  /* ── Choosing the outlet, once ──────────────────────────────── */
  if (!outlet) {
    return (
      <Shell>
        <div className="max-w-2xl mx-auto pt-16 px-6">
          <p className="text-2xs uppercase tracking-wide text-grey-500 mb-2">
            Terminal setup
          </p>
          <h1 className="page-title text-ink-900 mb-2">
            Terminal
          </h1>
          <p className="text-base text-grey-600 mb-8 leading-relaxed">
            Which outlet is this terminal in? Asked once. This screen is meant to stay open on a fixed
            terminal, so the answer is remembered on this device rather
            than on the person signed into it.
          </p>

          {/* "No outlet is configured" used to show while the list was
              still loading, and for good when it failed. */}
          {outlets.data === undefined ? (
            <div className="rounded-lg border border-grey-200 bg-white">
              {outlets.error ? (
                <ReadFailed
                  compact
                  error={outlets.error}
                  what="the outlets"
                  onRetry={() => void outlets.refetch()}
                />
              ) : (
                <p className="p-6 text-center text-base text-grey-500">
                  Loading the outlets…
                </p>
              )}
            </div>
          ) : active.length === 0 ? (
            <div className="rounded-lg border border-grey-200 bg-white p-6 text-center">
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
                  className="press-tile w-full flex items-center gap-3 text-left rounded-lg border border-grey-200 bg-white p-5 min-h-20 hover:border-grey-400 cursor-pointer"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold text-ink-900">{o.name}</span>
                    <span className="block text-base text-grey-500 tabular">{o.code}</span>
                  </span>
                  {/* It chooses the outlet and opens the till: the arrow. */}
                  <ChevronRight className="size-5 text-grey-400 shrink-0" aria-hidden />
                </button>
              ))}
            </div>
          )}

          <Link
            to={`/pos/${hotelId}/till`}
            className="inline-flex items-center mt-8 min-h-11 text-base font-medium text-brand-orange-700 hover:underline underline-offset-4"
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
      <AskDialog ask={ask} onClose={() => setAsk(null)} />
      <header className="flex items-center gap-4 px-5 h-16 border-b border-grey-200 bg-white shrink-0">
        <UtensilsCrossed className="size-5 text-brand-orange shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-ink-900 truncate leading-tight">
            {outletName}
          </p>
          <p className="text-2xs text-grey-500 tabular">
            {open.length} open · {dateLong(BUSINESS_DATE)}
          </p>
        </div>
        <Link
          to={`/pos/${hotelId}/till`}
          className="press inline-flex items-center gap-2 h-12 px-4 rounded-full border border-grey-300 bg-white text-base font-medium text-ink-900 hover:bg-grey-50 hover:border-grey-400"
        >
          <ArrowLeft className="size-4" />
          Console
        </Link>
      </header>

      {stale && (
        <ReadStale
          className="mx-4 mt-3 shrink-0"
          error={stale.error}
          loadedAt={stale.dataUpdatedAt}
          onRetry={retryAll}
        />
      )}

      <KotStatus hotelId={hotelId} className="mx-4 mt-3 shrink-0" />

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
              {/* Guests' room-service orders first: they are waiting on
                  somebody (D27-224). Accepted, the order opens here. */}
              <GuestOrders hotelId={hotelId} onAccepted={(id) => { setOrderId(id); refresh(); }} />
              <p className="text-2xs uppercase tracking-wide text-grey-500 mb-2">
                Start an order
              </p>
              <input
                value={table}
                onChange={(e) => setTable(e.target.value)}
                placeholder="Table 4"
                className={cn(FIELD, "h-16 px-4 text-lg mb-3")}
              />
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy}
                className="press w-full h-16 rounded-full bg-brand-orange-600 hover:bg-brand-orange-700 text-white text-lg font-semibold disabled:opacity-50"
              >
                Open the order
              </button>
              {/* A parcel (D27-359): named by its customer, no table. */}
              {outlet && (
                <div className="mt-3">
                  <NewParcel hotelId={hotelId} outlet={outlet} large
                    onOpened={(o) => { setOrderId(o.id); refresh(); }} />
                </div>
              )}

              {orders.data === undefined && orders.error && (
                <div className="mt-8 rounded-lg border border-grey-200 bg-white">
                  <ReadFailed
                    compact
                    error={orders.error}
                    what="the open orders"
                    onRetry={() => void orders.refetch()}
                  />
                </div>
              )}

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
                        className="press-tile w-full flex items-center gap-3 text-left rounded-lg border border-grey-200 bg-white p-4 min-h-16 hover:border-grey-400 cursor-pointer"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-base font-medium text-ink-900 tabular">
                            {o.orderNo}
                          </span>
                          <span className="block text-2xs text-grey-500">
                            {o.table ?? "no table"} · {o.lines} item
                            {o.lines === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span className="tabular text-base font-medium text-ink-900">
                          {moneyPrecise(o.gross)}
                        </span>
                        {/* It opens the order: the Tappable Rule's arrow. */}
                        <ChevronRight className="size-5 text-grey-400 shrink-0" aria-hidden />
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
                  className={cn(FIELD, "h-14 pl-11 pr-4 text-base")}
                />
              </div>
              {(menu.data ?? []).map((cat) => (
                <section key={cat.id} className={cn(
                  /* A heading over nothing is worse than no heading. */
                  cat.items.some((i) => i.name.toLowerCase()
                    .includes(find.trim().toLowerCase())) ? "" : "hidden",
                )}>
                  <h2 className="text-md font-semibold text-ink-900 mb-3">
                    {cat.name}
                  </h2>
                  {/* Columns by the PANEL's width, not the window's.
                      Roughly: one column under 384px, two to 672px,
                      three to 896px, four beyond — so a phone gets a
                      single readable column, a portrait tablet two, and
                      a 1366px till four instead of three cards nearly
                      200px wide holding two words and a price. */}
                  <div className="grid gap-2 @sm:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
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
                          item.isActive
                            ? "press-tile border-grey-200 bg-white hover:border-grey-400 active:bg-grey-50 cursor-pointer disabled:cursor-not-allowed"
                            : "border-grey-200 bg-grey-50 text-grey-500 cursor-not-allowed",
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
                          <span className="text-2xs text-grey-500 tabular leading-none pb-0.5">
                            {/* A dash when none is set, never 0% (POS-15). */}
                            {item.taxRate === null ? "-" : `${item.taxRate}%`}
                          </span>
                          <span className="text-lg tabular text-ink-900 leading-none">
                            {/* Sold by variation: no price of its own. A
                                dash, as on Tables' pad - the dish's own
                                column is a number on no menu. */}
                            {item.variations.length > 0
                              ? "-" : moneyPrecise(item.price)}
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
                        onClick={() => note(item)}
                        disabled={!item.isActive || order?.status !== "open"}
                        aria-label={`Add ${item.name} with a note`}
                        title="Add with a note"
                        className={cn(
                          /* grey-500, not grey-300: an icon a waiter must
                             find on a first shift (the Tappable Rule). */
                          "press absolute top-1 right-1 size-11 grid place-items-center",
                          "rounded-full text-grey-500 cursor-pointer",
                          "hover:text-ink-900 hover:bg-grey-100",
                          "focus-visible:outline-2 focus-visible:outline-offset-2",
                          "focus-visible:outline-brand-orange",
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
              {menu.data === undefined && menu.error && (
                <ReadFailed
                  error={menu.error}
                  what="the menu"
                  onRetry={() => void menu.refetch()}
                />
              )}
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
          /* Wider on a big screen (the owner's D27-349). */
          "lg:relative lg:w-[380px] xl:w-[480px] lg:shrink-0 lg:border-l lg:translate-x-0",
          /* Below lg it is a sheet: off-screen until asked for. Kept
             MOUNTED rather than unmounted so the order, its scroll
             position and any half-typed room number survive being
             closed — a waiter who taps away mid-charge and comes back
             should not start again. */
          /* A shadow only while it floats as a sheet; docked beside the
             menu it is a surface, drawn by its hairline. */
          "fixed inset-y-0 right-0 z-50 w-[min(22rem,100vw)] border-l shadow-overlay lg:shadow-none",
          "transition-transform duration-200 ease-out",
          billOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}>
          <div className="lg:hidden flex items-center justify-between border-b border-grey-200 px-4 h-14 shrink-0">
            <span className="text-base font-medium text-ink-900">The bill</span>
            <button
              type="button"
              onClick={() => setBillOpen(false)}
              className="press size-11 grid place-items-center rounded-full text-grey-500 hover:text-ink-900 hover:bg-grey-100"
              aria-label="Back to the menu"
            >
              <X className="size-5" />
            </button>
          </div>
          {!order && orderId && current.error ? (
            /* An order that did not load is not "no order open" — the
               waiter has one, and the bill for it is what failed. */
            <div className="flex-1 grid place-items-center p-2">
              <ReadFailed
                compact
                error={current.error}
                what="this order"
                onRetry={() => void current.refetch()}
              />
            </div>
          ) : !order ? (
            <div className="flex-1 grid place-items-center p-6 text-center">
              <div>
                <UtensilsCrossed className="size-7 text-grey-300 mx-auto mb-3" />
                <p className="text-base text-grey-500">
                  {orderId ? "Loading the order…" : "No order open."}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3.5 border-b border-grey-200 shrink-0">
                <p className="text-md font-semibold text-ink-900 tabular">
                  {order.orderNo}
                </p>
                <p className="text-2xs text-grey-500">
                  {order.table ?? "no table"} · {order.openedBy ?? "-"}
                </p>
                {order.status === "open" && (
                  <FunctionPicker
                    className="mt-2"
                    hotelId={hotelId}
                    value={order.eventId}
                    currentTitle={order.eventTitle}
                    disabled={busy}
                    onChange={(id) => void attach(id)}
                  />
                )}
              </div>

              <ul className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
                {/* The same dish of two rounds is one line (D27-353); its buttons
                    act on the newest round's own line (`own`), whose id it carries. */}
                {oneLinePerDish(order.lines).map((l) => (
                  <li key={l.id} className={cn(
                    "py-1", l.voided && "opacity-45",
                    /* A side sits under its dish and follows its quantity
                       (D27-192, Q8), as on the Till; an add-on line too
                       (D27-291), with its own. */
                    l.parentLineId !== null && "pl-5",
                  )}>
                    <div className="flex items-center gap-2">
                      {/* The whole name, on two lines if need be (D27-349). */}
                      <span className={cn(
                        "flex-1 min-w-0 text-base text-ink-900 break-words",
                        l.voided && "line-through",
                      )}>
                        {l.extra ? `+ ${l.name}` : l.name}
                      </span>
                      <span className="tabular text-base text-ink-900">
                        {moneyPrecise(l.qty * l.unitPrice)}
                      </span>
                    </div>
                    {/* The owner's breakdown (D27-289), under the one line. */}
                    {l.numberedAddons && (
                      <p className="text-2xs text-grey-600 tabular mt-0.5 pl-0.5 truncate">
                        {addonBreakdown(l.numberedAddons)}
                      </p>
                    )}

                    {/* The note, under the dish it belongs to. It reaches
                        the kitchen copy, so it has to be visible to the
                        person who typed it. */}
                    {l.note && (
                      <p className="text-2xs text-brand-orange-700 mt-0.5 pl-0.5">
                        {l.note}
                      </p>
                    )}
                    {/* Which dishes the kitchen already holds, so a second
                        KOT visibly sends only what is new. A Ready dish is
                        the waiter's to fetch: Taken when it goes out
                        (D27-221, D27-222). */}
                    {!l.voided && l.kotStatus === "ready" ? (
                      <div className="flex items-center gap-2 mt-1">
                        <StatusPill tone="success">Ready</StatusPill>
                        <button
                          type="button"
                          onClick={() => void take(l.id)}
                          aria-label={`Taken: ${l.name}`}
                          className="press h-11 px-4 rounded-full border border-grey-300 bg-white text-base font-medium text-ink-900 hover:border-grey-400 hover:bg-grey-50 cursor-pointer"
                        >
                          Taken
                        </button>
                      </div>
                    ) : !l.voided && !l.packing && l.kotStatus !== "pending" && (
                      <p className="text-2xs text-grey-500 mt-0.5 pl-0.5">
                        {l.kotStatus === "sent" ? "with the kitchen"
                          : l.kotStatus === "preparing" ? "on the fire"
                          : "served"}
                      </p>
                    )}

                    {!l.voided && order.status === "open" && l.parentLineId === null && !l.packing ? (
                      /* A STEPPER, not a strike-and-retype. "Make that two
                         rather than three" used to mean cancelling the line
                         and adding it again, which left a struck row on the
                         kitchen copy for something the guest is still
                         getting. */
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          onClick={() => { const own = order.lines.find((x) => x.id === l.id) ?? l; takeOff(own, own.qty - 1); }}
                          aria-label={`One fewer ${l.name}`}
                          className={STEP}
                        >
                          <Minus className="size-4" />
                        </button>
                        <span className="w-10 text-center tabular text-base text-ink-900">
                          {l.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => void setQty(l.id, (order.lines.find((x) => x.id === l.id) ?? l).qty + 1)}
                          aria-label={`One more ${l.name}`}
                          className={STEP}
                        >
                          <Plus className="size-4" />
                        </button>
                        {/* Customise on any dish (D27-289); once the kitchen
                            has it, add-ons are lines of their own (D27-291). */}
                        <button
                          type="button"
                          onClick={() => { setCustomising(order.lines.find((x) => x.id === l.id) ?? l); void numbered.refetch(); }}
                          aria-label={`Customise ${l.name}`}
                          title="Customise"
                          className="press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-ink-900 hover:border-grey-400 hover:bg-grey-50 shrink-0 cursor-pointer"
                        >
                          <SlidersHorizontal className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => takeOff(l, 0)}
                          aria-label={`Strike ${l.name}`}
                          className="press size-11 grid place-items-center rounded-full text-grey-500 hover:text-brand-red-700 hover:bg-brand-red-50 ml-auto cursor-pointer"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-2xs text-grey-500 tabular">
                          {l.qty} × {l.extra && l.unitPrice === 0 ? "Free" : moneyPrecise(l.unitPrice)}
                        </p>
                        {/* An add-on line comes off by itself (D27-291). */}
                        {l.extra && !l.voided && order.status === "open" && (
                          <button
                            type="button"
                            onClick={() => takeOff(l, 0)}
                            aria-label={`Strike ${l.name}`}
                            className="press size-11 grid place-items-center rounded-full text-grey-500 hover:text-brand-red-700 hover:bg-brand-red-50 ml-auto cursor-pointer"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {/* An open order's KOTs, reprinted at their station (D27-329 (5)). */}
                {order.status === "open" && order.lines.some((l) => l.kotNo != null) && (
                  <li className="pt-3">
                    <KotsSent hotelId={hotelId} orderId={order.id} lines={order.lines} />
                  </li>
                )}
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
                    {order.status === "no_charge" ? "NC" : moneyPrecise(order.gross)}
                  </span>
                </div>

                {order.status !== "open" ? (
                  <div className="space-y-2">
                    <p className="text-base text-grey-600">
                      {order.status === "no_charge"
                        ? `NC · No charge - ${order.ncReason ?? "-"}. Approved by ${order.ncBy ?? "-"}.`
                        : order.status === "void"
                        ? `VOID - ${order.voidReason ?? "-"}.`
                        : order.status === "settled"
                        ? order.paymentMethod === "function"
                          ? `On ${order.eventTitle ?? "the function"}'s bill.`
                          : `Paid by ${order.paymentMethod}.`
                        : `Closed unpaid - ${order.abandonedReason}`}
                    </p>
                    {(order.status === "settled" || order.status === "void" || order.status === "no_charge") && (
                      <button
                        type="button"
                        onClick={() => void bill.print(order.id)}
                        className={cn(OUTLINE, "w-full h-14 text-base font-medium inline-flex items-center justify-center gap-2")}
                      >
                        <Printer className="size-4" />
                        Print the bill
                      </button>
                    )}
                    {bill.dialog}
                    <button
                      type="button"
                      onClick={() => setOrderId(null)}
                      className="press w-full h-14 rounded-full bg-ink-900 hover:bg-ink-800 text-white text-base font-semibold"
                    >
                      Next order
                    </button>
                  </div>
                ) : settling ? (
                  <div className="space-y-2">
                    <input
                      list="terminal-rooms"
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      placeholder="Room number"
                      className={cn(FIELD, "h-14 px-4 text-base tabular")}
                    />
                    <datalist id="terminal-rooms">
                      {(rooms.data ?? []).map((r) => (
                        <option key={r.folioId} value={r.room}>{r.guest}</option>
                      ))}
                    </datalist>
                    <button
                      type="button"
                      disabled={!room.trim() || busy}
                      onClick={askRoom}
                      className="press w-full h-14 rounded-full bg-brand-orange-600 hover:bg-brand-orange-700 text-white text-base font-semibold disabled:opacity-50"
                    >
                      Charge to the room
                    </button>
                    <button type="button" onClick={() => setSettling(false)}
                      className={cn(GHOST, "w-full h-12")}>
                      Back
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* KOT FIRST, and above the settle actions, because it
                        is the act that happens several times per table
                        while settling happens once. A till that offered
                        only "pay" taught waiters to bill early. */}
                    {/* THE ONE ORANGE ACTION on the bill (the owner, 27
                        September): the kit's primary, at the terminal's
                        64px. Every settle way below is outlined. */}
                    <Button
                      variant="primary"
                      disabled={busy || !order.lines.some(
                        (l) => !l.voided && l.kotStatus === "pending")}
                      onClick={() => void kot()}
                      className="w-full h-16 text-lg font-semibold"
                    >
                      <Flame className="size-5" />
                      {order.lines.some(
                        (l) => !l.voided && l.kotStatus === "pending")
                        ? "Send to the kitchen"
                        : "Kitchen has it all"}
                    </Button>
                    {/* ON A FUNCTION'S BILL (D17-21): paid there and
                        nowhere else, so that is the one way offered — the
                        others stay in sight, switched off, with the reason
                        (Rule 6), rather than vanishing. */}
                    {order.eventId && (
                      <>
                        <button
                          type="button"
                          disabled={busy
                            || order.lines.filter((l) => !l.voided).length === 0}
                          onClick={() => void settle("function")}
                          className={cn(OUTLINE, "w-full h-16 text-lg font-semibold inline-flex items-center justify-center gap-2 px-5 disabled:opacity-40")}
                        >
                          <CalendarHeart className="size-5 shrink-0" />
                          <span className="truncate">
                            Charge to {order.eventTitle ?? "the function"}
                          </span>
                        </button>
                        <p className="text-2xs text-grey-600 leading-relaxed">
                          This order is on {order.eventTitle ?? "a function"}'s
                          bill, so the host pays for it there. To take cash,
                          a card, UPI or a room, choose "Not for a function"
                          above first.
                        </p>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={Boolean(order.eventId)
                        || order.lines.filter((l) => !l.voided).length === 0}
                      onClick={() => setSettling(true)}
                      /* Outlined, like Cash, Card and UPI (the owner, 27
                         September): a way to settle, not the next act. */
                      className={cn(OUTLINE, "w-full h-16 text-lg font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40")}
                    >
                      <BedDouble className="size-5" />
                      Charge to a room
                    </button>
                    {order.payable > 100000 && <CashIdFields value={cashId} onChange={setCashId} />}
                    <div className="grid grid-cols-3 gap-2">
                      {METHODS.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          disabled={busy || Boolean(order.eventId)
                            || order.lines.filter((l) => !l.voided).length === 0}
                          onClick={() => void settle(m.key)}
                          /* Icon over label: the house's stacked button
                             (Housekeeping's marks), 10px corners. */
                          className="press h-16 rounded-[10px] border border-grey-300 bg-white hover:bg-grey-50 hover:border-grey-400 text-base font-medium inline-flex flex-col items-center justify-center gap-1 disabled:opacity-40"
                        >
                          <m.icon className="size-5" />
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {/* D27-351: the owner, an administrator or the GM only. */}
                    {mayNc && (
                      <button type="button" onClick={giveNc}
                        disabled={busy || Boolean(order.eventId)
                          || order.lines.filter((l) => !l.voided).length === 0}
                        className={cn(OUTLINE, "w-full h-12 text-base font-medium inline-flex items-center justify-center gap-2 disabled:opacity-40")}>
                        <Gift className="size-4" />
                        No charge (NC)
                      </button>
                    )}
                    <button type="button" onClick={abandon}
                      className={cn(GHOST, "w-full h-12")}>
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
          className="text-2xs font-medium text-brand-orange-700 hover:underline underline-offset-4 ml-auto cursor-pointer"
        >
          Change outlet
        </button>
      </footer>
      <CustomiseDialog
        key={customising?.id ?? "none"}
        qty={customising?.qty ?? 1}
        loading={numbered.isFetching}
        failed={numbered.isError}
        onRetry={() => void numbered.refetch()}
        open={customising !== null}
        onOpenChange={(o) => { if (!o) setCustomising(null); }}
        dish={customising?.numberedAddons?.dish ?? customising?.name ?? ""}
        base={customising ? customising.numberedAddons?.base ?? customising.unitPrice : 0}
        addons={numbered.data ?? []}
        chosen={customising?.numberedAddons?.addons ?? []}
        sent={Boolean(customising && customising.kotStatus !== "pending")}
        busy={busy}
        onDone={(chosen, scope, customs) => void customise(chosen, scope, customs)}
      />

      <DishDialog
        item={asking}
        bar={isBarDish(menu.data, asking?.id)}
        open={asking !== null}
        onOpenChange={(o) => { if (!o) setAsking(null); }}
        onAdd={(id, qty, text, variationId, addonIds, moreChoiceIds) =>
          void addChosen(id, qty, text, variationId, addonIds, moreChoiceIds)}
        busy={busy}
      />
    </Shell>
  );
}

/** Full screen, no console chrome. A terminal has one job. In a test hotel
    the orange stripe is above it (D27-296 (9)): this covers the shell's. */
function Shell({ children }: { children: React.ReactNode }) {
  const hotelId = useHotel();
  return (
    <div className="fixed inset-0 z-50 bg-grey-50 flex flex-col">
      <TestHotelStripe code={hotelId} />
      {children}
    </div>
  );
}
