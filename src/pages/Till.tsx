import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  UtensilsCrossed, Plus, X, Receipt, BedDouble, Banknote,
  CreditCard, Smartphone, Printer,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, StatusPill, Button, toast,
} from "@/components/ui";
import {
  getMenu, listOrders, getOrder, listChargeableRooms,
  openOrder, addLine, voidLine, settleOrder, abandonOrder,
  BUSINESS_DATE,
  type Order, type MenuItem, type OrderSummary,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE TILL

   /pos is the PMS looking at what an OUTSIDE till sent. This is the
   PMS's own — a waiter opens an order, adds to it, settles it.

   Built for a tablet held in one hand on a restaurant floor, so it
   follows housekeeping rather than the reports: 44px targets, one
   column on a phone, two side by side when there is room.

   WHAT IS DELIBERATELY MISSING

   No edit on a settled bill. A paid order is history — the database
   refuses to change it and so does this screen. A correction is a
   credit on the folio, which is the same answer the invoice gives.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

const METHODS = [
  { key: "room" as const, label: "Charge to room", icon: BedDouble },
  { key: "cash" as const, label: "Cash", icon: Banknote },
  { key: "card" as const, label: "Card", icon: CreditCard },
  { key: "upi" as const, label: "UPI", icon: Smartphone },
];

export default function TillPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();

  const [openId, setOpenId] = useState<string | null>(null);
  const [table, setTable] = useState("");
  const [busy, setBusy] = useState(false);

  const orders = useQuery({
    queryKey: ["till-orders", hotelId, BUSINESS_DATE],
    queryFn: () => listOrders(hotelId),
  });
  const menu = useQuery({
    queryKey: ["till-menu", hotelId],
    queryFn: () => getMenu(hotelId),
  });
  const current = useQuery({
    queryKey: ["till-order", hotelId, openId],
    queryFn: () => (openId ? getOrder(hotelId, openId) : null),
    enabled: !!openId,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["till-orders"] });
    void qc.invalidateQueries({ queryKey: ["till-order"] });
    /* A room charge lands on a folio, so the folio screens are stale
       the moment this succeeds. */
    void qc.invalidateQueries({ queryKey: ["folio"] });
  };

  const start = async () => {
    setBusy(true);
    const res = await openOrder(hotelId, "REST", table.trim() || undefined);
    setBusy(false);
    if (!res.ok) return toast.error("Could not open an order", res.reason);
    setOpenId(res.order.id);
    setTable("");
    refresh();
  };

  const add = async (item: MenuItem) => {
    if (!openId) return;
    const res = await addLine(hotelId, openId, item.id, 1);
    if (!res.ok) return toast.error("Not added", res.reason);
    refresh();
  };

  const strike = async (lineId: string) => {
    if (!openId) return;
    const res = await voidLine(hotelId, openId, lineId);
    if (!res.ok) return toast.error("Could not strike that line", res.reason);
    refresh();
  };

  const order = current.data ?? null;
  const openOrders = (orders.data?.orders ?? []).filter(
    (o) => o.status === "open",
  );
  const done = (orders.data?.orders ?? []).filter((o) => o.status !== "open");

  return (
    <Page>
      <PageHeader
        title="Till"
        description="Open an order, add to it, settle it. Charges reach a guest folio the same way an outside point of sale would."
        badge={
          orders.data ? (
            <StatusPill tone={openOrders.length ? "warning" : "neutral"}>
              {openOrders.length} open
            </StatusPill>
          ) : undefined
        }
      />

      {menu.data?.length === 0 && (
        <Card className="mb-5">
          <CardBody>
            <p className="text-base font-medium text-ink-900">
              There is no menu yet
            </p>
            <p className="text-sm text-grey-600 mt-1 leading-relaxed">
              Nothing can be sold until the hotel enters what it sells. The
              prices are yours — this system ships none.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        {/* ── The menu ─────────────────────────────────────────── */}
        <div>
          {!openId ? (
            <Card>
              <CardBody>
                <p className="text-base font-medium text-ink-900 mb-1">
                  Start an order
                </p>
                <p className="text-sm text-grey-600 mb-3 leading-relaxed">
                  A table number, or where the food is going. It prints on the
                  kitchen copy.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={table}
                    onChange={(e) => setTable(e.target.value)}
                    placeholder="Table 4"
                    className="flex-1 min-w-40 h-11 px-3 rounded-md border border-grey-300 text-base"
                  />
                  <Button onClick={start} loading={busy} size="lg">
                    <Plus className="size-4" />
                    Open
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-5">
              {menu.data?.map((cat) => (
                <section key={cat.id}>
                  <h2 className="text-md font-semibold text-ink-900 mb-2.5">
                    {cat.name}
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {cat.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void add(item)}
                        disabled={!item.isActive || order?.status !== "open"}
                        className={cn(
                          "flex items-center justify-between gap-3 text-left",
                          "rounded-md border p-3 min-h-14 transition-colors duration-150",
                          item.isActive
                            ? "border-grey-200 bg-white hover:border-brand-orange hover:bg-brand-orange-50"
                            : "border-grey-200 bg-grey-50 text-grey-400 cursor-not-allowed",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block text-base text-ink-900 truncate">
                            {item.name}
                          </span>
                          {!item.isActive && (
                            <span className="block text-2xs text-grey-500">
                              off the menu today
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-base tabular text-ink-900">
                            {money(item.price)}
                          </span>
                          {/* Shown because a bill mixing 5% and 18% is
                              the normal case, and the guest will see
                              two lines on their folio because of it. */}
                          <span className="block text-2xs text-grey-500 tabular">
                            {item.taxRate}%
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* ── The bill ─────────────────────────────────────────── */}
        <div className="space-y-4">
          {order && (
            <OrderPanel
              order={order}
              hotelId={hotelId}
              busy={busy}
              setBusy={setBusy}
              onStrike={strike}
              onDone={() => { setOpenId(null); refresh(); }}
            />
          )}

          {openOrders.length > 0 && (
            <Card>
              <div className="px-4 pt-3.5 pb-1">
                <p className="text-2xs uppercase tracking-wide text-grey-500">
                  Open orders
                </p>
              </div>
              <ul className="divide-y divide-grey-100">
                {openOrders.map((o) => (
                  <OrderRow key={o.id} order={o}
                    active={o.id === openId}
                    onOpen={() => setOpenId(o.id)} />
                ))}
              </ul>
            </Card>
          )}

          {done.length > 0 && (
            <Card>
              <div className="px-4 pt-3.5 pb-1">
                <p className="text-2xs uppercase tracking-wide text-grey-500">
                  Settled today
                </p>
              </div>
              <ul className="divide-y divide-grey-100">
                {done.slice(0, 12).map((o) => (
                  <OrderRow key={o.id} order={o}
                    active={o.id === openId}
                    onOpen={() => setOpenId(o.id)} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}

function OrderRow({ order, active, onOpen }: {
  order: OrderSummary; active: boolean; onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left min-h-14",
          "transition-colors duration-150",
          active ? "bg-brand-orange-50" : "hover:bg-grey-50",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-base text-ink-900 tabular truncate">
            {order.orderNo}
            {order.table && (
              <span className="text-grey-500"> · {order.table}</span>
            )}
          </p>
          <p className="text-2xs text-grey-500">
            {order.lines} item{order.lines === 1 ? "" : "s"} · {order.openedAt}
            {order.paymentMethod && ` · ${order.paymentMethod}`}
          </p>
        </div>
        <span className="tabular text-base text-ink-900 shrink-0">
          {money(order.gross)}
        </span>
      </button>
    </li>
  );
}

function OrderPanel({
  order, hotelId, busy, setBusy, onStrike, onDone,
}: {
  order: Order;
  hotelId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onStrike: (lineId: string) => void;
  onDone: () => void;
}) {
  const [choices, setChoices] = useState<
    { folioId: string; guest: string }[] | null
  >(null);
  const [room, setRoom] = useState("");

  const rooms = useQuery({
    queryKey: ["till-rooms", hotelId],
    queryFn: () => listChargeableRooms(hotelId),
  });

  const settle = async (
    method: "room" | "cash" | "card" | "upi", folioId?: string,
  ) => {
    setBusy(true);
    const res = await settleOrder(hotelId, order.id, method,
      method === "room" ? room : undefined, folioId);
    setBusy(false);

    if (!res.ok) {
      /* A room with two open folios is a QUESTION, not a failure. The
         waiter is standing there and can answer it — so the choices
         come back and the panel asks. */
      if (res.choices) {
        setChoices(res.choices);
        return;
      }
      return toast.error("Not settled", res.reason);
    }
    setChoices(null);
    toast.success(
      "Settled",
      res.guest ? `${money(order.gross)} to ${res.guest}` : money(order.gross),
    );
    onDone();
  };

  const abandon = async () => {
    const reason = window.prompt(
      "Why is this order being closed unpaid?\n\n" +
        "It stays on the record with this reason — a walkout and a " +
        "duplicate are different things at the end of a shift.",
    );
    if (!reason?.trim()) return;
    setBusy(true);
    const res = await abandonOrder(hotelId, order.id, reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not closed", res.reason);
    onDone();
  };

  const live = order.lines.filter((l) => !l.voided);
  const settled = order.status !== "open";

  return (
    <Card>
      <div className="px-4 pt-3.5 pb-2 flex items-center gap-2">
        <Receipt className="size-3.5 text-grey-400" />
        <p className="text-2xs uppercase tracking-wide text-grey-500 flex-1">
          {order.orderNo}
          {order.table && ` · ${order.table}`}
        </p>
        <StatusPill
          tone={
            order.status === "open" ? "warning"
              : order.status === "settled" ? "success" : "neutral"
          }
        >
          {order.status}
        </StatusPill>
      </div>

      <CardBody>
        {live.length === 0 ? (
          <div className="text-center py-6">
            <UtensilsCrossed className="size-5 text-grey-300 mx-auto mb-2" />
            <p className="text-sm text-grey-500">
              Nothing on this bill yet.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5 mb-3">
            {order.lines.map((line) => (
              <li
                key={line.id}
                className={cn(
                  "flex items-center gap-2",
                  line.voided && "opacity-45",
                )}
              >
                <span className="tabular text-sm text-grey-500 w-7 shrink-0">
                  {line.qty}×
                </span>
                <span
                  className={cn(
                    "flex-1 min-w-0 text-base text-ink-900 truncate",
                    line.voided && "line-through",
                  )}
                >
                  {line.name}
                </span>
                <span className="tabular text-base text-ink-900 shrink-0">
                  {money(line.qty * line.unitPrice)}
                </span>
                {!settled && !line.voided && (
                  <button
                    type="button"
                    onClick={() => onStrike(line.id)}
                    aria-label={`Strike ${line.name}`}
                    className="size-11 grid place-items-center rounded-md text-grey-400 hover:text-brand-red hover:bg-red-50 shrink-0"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-grey-200 pt-2.5 space-y-1">
          <Row label="Net" value={money(order.net)} />
          <Row label="Tax" value={money(order.tax)} />
          <Row label="Total" value={money(order.gross)} strong />
        </div>

        {settled ? (
          <div className="mt-3.5 space-y-2">
            <p className="text-sm text-grey-600">
              {order.status === "settled"
                ? `Paid by ${order.paymentMethod}${order.settledBy ? `, taken by ${order.settledBy}` : ""}.`
                : `Closed unpaid — ${order.abandonedReason}`}
            </p>
            {order.status === "settled" && (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => window.open(
                  `/h/${hotelId}/till/bill/${order.id}`, "_blank",
                )}
              >
                <Printer className="size-4" />
                Print the bill
              </Button>
            )}
          </div>
        ) : choices ? (
          <div className="mt-3.5">
            {/* The refusal, asked as a question. Charging whichever
                guest the database returned first would be right most
                days and silently wrong on a changeover. */}
            <p className="text-sm text-ink-900 font-medium">
              Two guests are in room {room}
            </p>
            <p className="text-sm text-grey-600 mt-0.5 mb-2 leading-relaxed">
              One is checking out and one has arrived. Who ate?
            </p>
            <div className="space-y-2">
              {choices.map((ch) => (
                <Button
                  key={ch.folioId}
                  variant="secondary"
                  size="lg"
                  className="w-full justify-start"
                  loading={busy}
                  onClick={() => void settle("room", ch.folioId)}
                >
                  {ch.guest}
                </Button>
              ))}
              <Button variant="ghost" size="lg" className="w-full"
                onClick={() => setChoices(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3.5 space-y-2">
            <div className="flex gap-2">
              <input
                list="chargeable-rooms"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Room"
                className="w-24 h-11 px-3 rounded-md border border-grey-300 text-base tabular"
              />
              <datalist id="chargeable-rooms">
                {(rooms.data ?? []).map((r) => (
                  <option key={r.folioId} value={r.room}>
                    {r.guest}
                  </option>
                ))}
              </datalist>
              <Button
                size="lg"
                className="flex-1"
                loading={busy}
                disabled={!room.trim() || live.length === 0}
                onClick={() => void settle("room")}
              >
                <BedDouble className="size-4" />
                Charge to room
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {METHODS.filter((m) => m.key !== "room").map((m) => (
                <Button
                  key={m.key}
                  variant="secondary"
                  size="lg"
                  loading={busy}
                  disabled={live.length === 0}
                  onClick={() => void settle(m.key)}
                >
                  <m.icon className="size-4" />
                  {m.label}
                </Button>
              ))}
            </div>

            <Button variant="ghost" size="lg" className="w-full"
              onClick={() => void abandon()} loading={busy}>
              Close unpaid
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Row({ label, value, strong }: {
  label: string; value: string; strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn(
        "text-sm",
        strong ? "font-semibold text-ink-900" : "text-grey-600",
      )}>
        {label}
      </span>
      <span className={cn(
        "tabular",
        strong ? "text-md font-semibold text-ink-900" : "text-base text-grey-700",
      )}>
        {value}
      </span>
    </div>
  );
}
