import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import {
  UtensilsCrossed, X, BedDouble, Banknote, CreditCard, Smartphone,
  ArrowLeft, Printer, Lock,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { toast } from "@/components/ui";
import {
  getMenu, listOrders, getOrder, listChargeableRooms,
  openOrder, addLine, voidLine, settleOrder, abandonOrder,
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

  const strike = async (lineId: string) => {
    if (!orderId) return;
    const res = await voidLine(hotelId, orderId, lineId);
    if (!res.ok) return toast.error("Not struck", res.reason);
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
        <div className="flex-1 min-w-0 overflow-y-auto p-4">
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
              {(menu.data ?? []).map((cat) => (
                <section key={cat.id}>
                  <h2 className="text-md font-semibold text-ink-900 mb-2.5">
                    {cat.name}
                  </h2>
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {cat.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void add(item)}
                        disabled={!item.isActive || order?.status !== "open"}
                        className={cn(
                          /* 64px, not 44. A terminal is jabbed at across
                             a counter by somebody holding plates. */
                          "flex flex-col justify-between text-left rounded-lg border p-4 min-h-20",
                          "transition-colors duration-150",
                          item.isActive
                            ? "border-grey-200 bg-white hover:border-brand-orange hover:bg-brand-orange-50 active:bg-brand-orange-100"
                            : "border-grey-200 bg-grey-50 text-grey-400 cursor-not-allowed",
                        )}
                      >
                        <span className="text-base text-ink-900 leading-snug">
                          {item.name}
                        </span>
                        <span className="flex items-baseline justify-between mt-2">
                          <span className="text-2xs text-grey-500 tabular">
                            {item.taxRate}%
                          </span>
                          <span className="text-lg tabular text-ink-900">
                            {moneyPrecise(item.price)}
                          </span>
                        </span>
                      </button>
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

        {/* ── The bill, always visible ─────────────────────────── */}
        <aside className="w-[380px] shrink-0 border-l border-grey-200 bg-white flex flex-col">
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
                    "flex items-center gap-2", l.voided && "opacity-45",
                  )}>
                    <span className="tabular text-base text-grey-500 w-8 shrink-0">
                      {l.qty}×
                    </span>
                    <span className={cn(
                      "flex-1 min-w-0 text-base text-ink-900 truncate",
                      l.voided && "line-through",
                    )}>
                      {l.name}
                    </span>
                    <span className="tabular text-base text-ink-900">
                      {moneyPrecise(l.qty * l.unitPrice)}
                    </span>
                    {!l.voided && order.status === "open" && (
                      <button
                        type="button"
                        onClick={() => void strike(l.id)}
                        aria-label={`Strike ${l.name}`}
                        className="size-12 grid place-items-center rounded-md text-grey-400 hover:text-brand-red hover:bg-red-50 shrink-0"
                      >
                        <X className="size-5" />
                      </button>
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
