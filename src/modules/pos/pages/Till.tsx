import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import {
  UtensilsCrossed, Plus, X, Receipt, BedDouble, Banknote,
  CreditCard, Smartphone, Printer, Percent, Split, CalendarHeart,
} from "lucide-react";
import { DishDialog } from "@/modules/pos/flows/DishDialog";
import { FunctionPicker } from "@/modules/pos/components/FunctionPicker";
import { OrderHeaderPanel } from "@/modules/pos/flows/OrderHeaderPanel";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useLiveOrders } from "@/lib/useLiveOrders";
import {
  Page, PageHeader, Card, CardBody, StatusPill, Button, toast,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import { getMenu, listOrders, getOrder, listChargeableRooms, openOrder, addLine, voidLine, settleOrder, abandonOrder, applyDiscount, clearDiscount, setRoundOff, settleSplit, listPromotions, applyPromotion, setOrderHeader, type Order, type MenuItem, type OrderSummary, type TenderInput } from "@/modules/pos/data/till";
import { BUSINESS_DATE } from "@/data/repositories";
import { ReadFailed, ReadStale } from "@/components/ui";

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
  /* The same live channel the pass uses. A kitchen moving a dish to
     ready, or another till taking a table, lands here rather than on
     the next poll -- both screens are the same service. */
  useLiveOrders(hotelId);

  const qc = useQueryClient();

  /* The floor sends the order it just opened. Tapping a free table means
     "I am taking an order", not "show me the list again" — and landing on
     the list is how a waiter ends up opening a second order on the same
     table because the first one looked like it had not worked. */
  const [searchParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(
    searchParams.get("order"));
  const [table, setTable] = useState("");
  const [busy, setBusy] = useState(false);
  /* The dish whose variation or sides are being chosen, or null. */
  const [asking, setAsking] = useState<MenuItem | null>(null);

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

  /* ⚠ ADDING A DISH USED TO COST THREE ROUND TRIPS AND A WAITER COULD
     NOT TAP TWICE IN A SECOND.

     The old path was: POST the line, then invalidate, then refetch the
     order, then refetch the list -- three journeys to Mumbai before
     anything appeared on screen. On a laptop with the database beside
     it that is invisible. On a real server it is about a second per
     dish, every dish, all service.

     THE SERVER ALREADY SENT THE ANSWER. Every till mutation returns the
     whole updated order (`readOrder` in till.ts), which is exactly the
     shape this screen's query holds. So the refetch was asking for
     something the browser had just been handed.

     One journey now. And this is not an optimistic guess -- it is the
     SERVER'S order, with its own totals, tax and line ids. Nothing is
     shown that the database has not already agreed to, which is the
     rule this whole system is built on.

     The list and the folio are still invalidated, because those are
     different questions this reply does not answer. They refetch in the
     background and block nothing. */
  const applyOrder = (order: Order) => {
    qc.setQueryData(["till-order", hotelId, order.id], order);
    void qc.invalidateQueries({ queryKey: ["till-orders"] });
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

  /* A dish with something to ASK opens the dialog. A plain item goes
     straight onto the bill — a dialog that always appears is a tap a
     waiter pays for on every single item, all shift. */
  const add = async (item: MenuItem) => {
    if (!openId) return;
    if (item.variations.length > 0 || item.addonGroups.length > 0) {
      setAsking(item);
      return;
    }
    const res = await addLine(hotelId, openId, item.id, 1);
    if (!res.ok) return toast.error("Not added", res.reason);
    applyOrder(res.order);
  };

  const addChosen = async (
    itemId: string, qty: number, note: string,
    variationId?: string, addonIds?: string[],
  ) => {
    if (!openId) return;
    setBusy(true);
    const res = await addLine(hotelId, openId, itemId, qty,
      note.trim() || undefined, variationId, addonIds);
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    setAsking(null);
    applyOrder(res.order);
  };

  const strike = async (lineId: string) => {
    if (!openId) return;
    const res = await voidLine(hotelId, openId, lineId);
    if (!res.ok) return toast.error("Could not strike that line", res.reason);
    applyOrder(res.order);
  };

  const order = current.data ?? null;
  const openOrders = (orders.data?.orders ?? []).filter(
    (o) => o.status === "open",
  );
  const done = (orders.data?.orders ?? []).filter((o) => o.status !== "open");

  /* POS-4. One line for the whole screen when a refresh failed but
     something is still shown — three strips for one dropped line would
     be the loudest thing on a till that still works. */
  const stale = [orders, menu, current].find(
    (q) => q.error && q.data !== undefined);
  const retryAll = () => {
    void orders.refetch();
    void menu.refetch();
    if (openId) void current.refetch();
  };

  return (
    <Page>
      <PageHeader
        title="Till"
        description="Open an order, add to it, settle it. Charges reach a guest's bill the same way an outside point of sale would."
        badge={
          orders.data ? (
            <StatusPill tone={openOrders.length ? "warning" : "neutral"}>
              {openOrders.length} open
            </StatusPill>
          ) : undefined
        }
      />

      <StartHere className="mb-5" />

      {stale && (
        <ReadStale
          className="mb-5"
          error={stale.error}
          loadedAt={stale.dataUpdatedAt}
          onRetry={retryAll}
        />
      )}

      {/* A menu that did not load is not "no menu yet" — that sentence
          tells a waiter the hotel has not entered its dishes. */}
      {menu.data === undefined && menu.error && (
        <Card className="mb-5">
          <ReadFailed
            compact
            error={menu.error}
            what="the menu"
            onRetry={() => void menu.refetch()}
          />
        </Card>
      )}

      {menu.data?.length === 0 && (
        <Card className="mb-5">
          <CardBody>
            <p className="text-base font-medium text-ink-900">
              There is no menu yet
            </p>
            <p className="text-sm text-grey-600 mt-1 leading-relaxed">
              Nothing can be sold until the hotel enters what it sells. The
              prices are yours - this system ships none.
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
                  <Button variant="primary" onClick={start} loading={busy} size="lg">
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
                            : "border-grey-200 bg-grey-50 text-grey-500 cursor-not-allowed",
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
                            {/* Sold by variation: a dash, never the dish's
                                own column (the owner, 21 September). */}
                            {item.variations.length > 0 ? "-" : money(item.price)}
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
          {openId && current.data === undefined && current.error && (
            <Card>
              <ReadFailed
                compact
                error={current.error}
                what="this order"
                onRetry={() => void current.refetch()}
              />
            </Card>
          )}

          {orders.data === undefined && orders.error && (
            <Card>
              <ReadFailed
                compact
                error={orders.error}
                what="today's orders"
                onRetry={() => void orders.refetch()}
              />
            </Card>
          )}

          {order && (
            <OrderPanel
              order={order}
              hotelId={hotelId}
              busy={busy}
              setBusy={setBusy}
              onStrike={strike}
              /* Settling or abandoning FINISHES a bill, so the panel
                 closes. Discounting it does not — the biller is still
                 standing at the same order and about to take payment. */
              onDone={() => { setOpenId(null); refresh(); }}
              onChanged={refresh}
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
      <DishDialog
        item={asking}
        open={asking !== null}
        onOpenChange={(o) => { if (!o) setAsking(null); }}
        onAdd={(id, qty, note, variationId, addonIds) =>
          void addChosen(id, qty, note, variationId, addonIds)}
        busy={busy}
      />
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

/* ══════════════════════════════════════════════════════════════════
   THE DISCOUNT DIALOG

   A discount is allowed and it must say WHY. The reason is not a
   nicety — an amount with nobody's explanation attached is an
   unauditable hole in revenue, and a till that offers the amount
   without the reason is worse than one that offers neither.

   Percentage and fixed both, because the BILL prints what was chosen.
   "10% off" and "₹115.70 off" are the same money and a different
   statement to a guest querying it next month.

   ⚠ TWO ROUTES, AND THE PROMOTIONS COME FIRST. The owner's rule, given
   on 9 September: a biller has a free hand up to 10% and anything
   larger is a named promotion applied by code.

   The promotions sit at the top because they are the answer to the
   question that brings most people to this dialog — a large
   concession. Put the free-hand box first and a biller types 50,
   reads a refusal, and only then goes looking.

   THE CAP IS THE SERVER'S NUMBER. It arrives with the promotions and
   is shown in rupees against THIS bill, because "up to 10%" is a
   percentage a biller has to do arithmetic on while a guest waits.
   ══════════════════════════════════════════════════════════════════ */
function DiscountDialog({
  order, hotelId, open, onOpenChange, onDone,
}: {
  order: Order;
  hotelId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<"percent" | "fixed">(
    order.discountType ?? "percent");
  const [value, setValue] = useState(
    order.discountValue === null ? "" : String(order.discountValue));
  const [reason, setReason] = useState(order.discountReason ?? "");
  const [busy, setBusy] = useState(false);

  /* Only while the dialog is open. A till left on a counter all evening
     should not be polling for a list that changes about once a month. */
  const promos = useQuery({
    queryKey: ["promotions", hotelId],
    queryFn: () => listPromotions(hotelId),
    enabled: open,
  });
  const cap = promos.data?.freehandCapPercent ?? null;
  const live = (promos.data?.promotions ?? []).filter((p) => p.isActive);

  const amount = Number(value);
  const preview = !Number.isFinite(amount) || amount <= 0
    ? null
    : type === "percent"
      ? Math.round(order.net * amount) / 100
      : amount;

  const tooMuch = preview !== null
    && (type === "percent" ? amount > 100 : preview > order.net);

  /* ⚠ THE CEILING IS IN MONEY, and so is the check on the server. A
     percentage check would leave the whole cap open to the fixed
     button — ₹5,000 off a ₹6,000 bill is 83% however it was typed. */
  const ceiling = cap === null ? null : (order.net * cap) / 100;
  const overCap = preview !== null && ceiling !== null
    && preview > ceiling + 0.005;

  const usePromotion = async (code: string) => {
    setBusy(true);
    const res = await applyPromotion(hotelId, order.id, code);
    setBusy(false);
    if (!res.ok) return toast.error("Not applied", res.reason);
    onOpenChange(false);
    onDone();
  };

  const apply = async () => {
    setBusy(true);
    const res = await applyDiscount(hotelId, order.id, type, amount,
      reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not discounted", res.reason);
    onOpenChange(false);
    onDone();
  };

  const remove = async () => {
    setBusy(true);
    const res = await clearDiscount(hotelId, order.id);
    setBusy(false);
    if (!res.ok) return toast.error("Not removed", res.reason);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Discount this bill"
        description="Off the net, so the tax falls with it."
        size="sm"
        footer={
          <div className="flex gap-2 w-full">
            {order.discount > 0 && (
              <Button variant="ghost" size="lg" loading={busy}
                onClick={() => void remove()}>
                Remove
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="secondary" size="lg"
              onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary"
              size="lg"
              loading={busy}
              /* Greyed out over the cap as well, and the reason is
                 shown beside the field. The server refuses it too —
                 Rule 6 needs both ends, because a till that has not
                 reloaded still posts. */
              disabled={!reason.trim() || preview === null || tooMuch
                        || overCap}
              onClick={() => void apply()}
            >
              Apply
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {live.length > 0 && (
            <div className="space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500">
                Promotions
              </p>
              <div className="grid grid-cols-2 gap-2">
                {live.map((p) => (
                  <Button key={p.id} variant="secondary" size="lg"
                          loading={busy} className="justify-start"
                          onClick={() => void usePromotion(p.code)}>
                    <span className="truncate">
                      {p.name}
                      <span className="ml-1.5 text-grey-500 tabular">
                        {p.kind === "percent"
                          ? `${p.value}%` : money(p.value)}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
              <p className="text-sm text-grey-500">
                Applied by name, so the bill and the month-end report say
                the same thing.
              </p>
            </div>
          )}

          {live.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-grey-200" />
              <span className="text-2xs uppercase tracking-wide text-grey-500">
                or by hand
              </span>
              <span className="h-px flex-1 bg-grey-200" />
            </div>
          )}

          <div className="flex gap-2">
            {(["percent", "fixed"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  "flex-1 h-11 rounded-md border text-base font-medium cursor-pointer",
                  "transition-colors duration-200",
                  type === t
                    ? "border-brand-orange bg-orange-50 text-brand-orange-700"
                    : "border-grey-300 text-grey-600 hover:bg-grey-50",
                )}
              >
                {t === "percent" ? "Percentage" : "Fixed amount"}
              </button>
            ))}
          </div>

          <Field label={type === "percent" ? "Percent off" : "Amount off"} required>
            {(f) => (
              <Input
                {...fieldProps(f)}
                type="number"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === "percent" ? "10" : "100.00"}
                autoFocus
              />
            )}
          </Field>

          {/* Shown before it is applied, because a biller pressing 10 for
              "ten percent" and getting ₹10 off is the mistake this
              prevents. */}
          {preview !== null && !tooMuch && (
            <p className="text-sm text-grey-600">
              Takes <span className="tabular font-medium text-ink-900">
                {money(preview)}
              </span> off {money(order.net)}.
            </p>
          )}
          {tooMuch && (
            <p className="text-sm text-brand-red">
              That is more than the bill. A discount cannot make it negative.
            </p>
          )}
          {/* ⚠ THE CAP IN RUPEES, NOT ONLY AS A PERCENTAGE. "Up to 10%"
              is arithmetic a biller has to do while a guest waits, and
              this bill's ceiling is the number they actually need. */}
          {overCap && !tooMuch && (
            <p className="text-sm text-brand-red">
              A biller may take off up to {cap}% - {money(ceiling!)} on this
              bill. {live.length > 0
                ? "Anything larger goes on as one of the promotions above."
                : "Anything larger needs a named promotion, set up on the "
                  + "menu screen."}
            </p>
          )}
          {!overCap && !tooMuch && preview === null && ceiling !== null && (
            <p className="text-sm text-grey-500">
              Up to {cap}% by hand - {money(ceiling)} on this bill.
            </p>
          )}

          <Field
            label="Why"
            required
            hint="A staff meal, a complaint, a manager's call. It stays on the record."
          >
            {(f) => (
              <Input
                {...fieldProps(f)}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Manager comp"
              />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PART — several payments against one bill

   They must add up to the payable exactly. Short is a drawer that will
   not reconcile at day end; over is change that was never given.

   Room is not offered here. A bill going to a folio has to go there in
   full: paying PART of it to a room would mean apportioning that part
   across tax rates again, and there is no defensible way to choose
   which rate a partial payment settles.
   ══════════════════════════════════════════════════════════════════ */
function SplitPanel({
  order, hotelId, busy, setBusy, onCancel, onDone,
}: {
  order: Order;
  hotelId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<TenderInput[]>([
    { method: "cash", amount: 0 },
  ]);

  const taken = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const left = Math.round((order.payable - taken) * 100) / 100;
  const balanced = Math.abs(left) < 0.005;

  const cash = rows.find((r) => r.method === "cash");
  const change = cash?.tendered !== undefined && cash.tendered !== null
    ? Math.round((Number(cash.tendered) - Number(cash.amount)) * 100) / 100
    : null;

  const set = (i: number, patch: Partial<TenderInput>) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const settle = async () => {
    setBusy(true);
    const res = await settleSplit(hotelId, order.id,
      rows.filter((r) => Number(r.amount) > 0));
    setBusy(false);
    if (!res.ok) return toast.error("Not settled", res.reason);
    toast.success("Settled", `${money(order.payable)} across ${rows.length}`);
    onDone();
  };

  return (
    <div className="mt-3.5 space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <NativeSelect
            value={r.method}
            onChange={(e) => set(i, {
              method: e.target.value as TenderInput["method"],
              /* Only cash is handed over — carrying a tendered figure
                 onto a card would be a change calculation nobody made. */
              ...(e.target.value === "cash" ? {} : { tendered: undefined }),
            })}
            className="w-28"
          >
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="upi">UPI</option>
          </NativeSelect>
          <Input
            type="number"
            inputMode="decimal"
            value={r.amount || ""}
            onChange={(e) => set(i, { amount: Number(e.target.value) })}
            placeholder="Amount"
            className="flex-1 tabular"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}
              aria-label="Remove this payment"
              className="size-11 grid place-items-center rounded-md text-grey-400 hover:text-brand-red hover:bg-red-50 shrink-0 cursor-pointer"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}

      {cash && (
        <div className="flex gap-2 items-center">
          <span className="text-sm text-grey-600 w-28 shrink-0">Cash given</span>
          <Input
            type="number"
            inputMode="decimal"
            value={cash.tendered ?? ""}
            onChange={(e) => set(rows.indexOf(cash), {
              tendered: e.target.value === "" ? undefined : Number(e.target.value),
            })}
            placeholder="500"
            className="flex-1 tabular"
          />
        </div>
      )}

      <Button
        variant="ghost"
        size="lg"
        className="w-full"
        onClick={() => setRows((rs) => [...rs,
          { method: "card", amount: Math.max(left, 0) }])}
      >
        <Plus className="size-4" />
        Another payment
      </Button>

      <div className="border-t border-grey-200 pt-2.5 space-y-1">
        <Row label="Bill" value={money(order.payable)} />
        <Row label="Taken" value={money(taken)} />
        {!balanced && (
          <Row
            label={left > 0 ? "Still to take" : "Over by"}
            value={money(Math.abs(left))}
            strong
          />
        )}
        {change !== null && change > 0 && (
          <Row label="Change due" value={money(change)} strong />
        )}
      </div>

      <Button variant="primary"
        size="lg"
        className="w-full"
        loading={busy}
        disabled={!balanced}
        onClick={() => void settle()}
      >
        <Receipt className="size-4" />
        {balanced ? "Settle" : `${money(Math.abs(left))} ${left > 0 ? "short" : "over"}`}
      </Button>
      <Button variant="ghost" size="lg" className="w-full" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function OrderPanel({
  order, hotelId, busy, setBusy, onStrike, onDone, onChanged,
}: {
  order: Order;
  hotelId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onStrike: (lineId: string) => void;
  /** The bill is finished — settled or closed unpaid. */
  onDone: () => void;
  /** The bill changed but is still open. */
  onChanged: () => void;
}) {
  const [choices, setChoices] = useState<
    { folioId: string; guest: string }[] | null
  >(null);
  const [room, setRoom] = useState("");
  const [discounting, setDiscounting] = useState(false);
  const [splitting, setSplitting] = useState(false);

  const rooms = useQuery({
    queryKey: ["till-rooms", hotelId],
    queryFn: () => listChargeableRooms(hotelId),
  });

  const settle = async (
    method: "room" | "cash" | "card" | "upi" | "function", folioId?: string,
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
      res.guest ? `${money(order.gross)} to ${res.guest}`
        : method === "function"
          ? `${money(order.gross)} on ${order.eventTitle ?? "the function"}'s bill`
          : money(order.gross),
    );
    onDone();
  };

  /* D17-21: the banquet function this order is on, or off it. */
  const attach = async (eventId: string | null) => {
    setBusy(true);
    const res = await setOrderHeader(hotelId, order.id, { eventId });
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(eventId
      ? `On ${res.order.eventTitle ?? "the function"}'s bill`
      : "Off the function");
    onChanged();
  };

  /* ON A FUNCTION'S BILL, paid there and nowhere else (the owner,
     17 September). The other ways stay in sight, switched off, and say
     why (Rule 6). */
  const onFunction = order.eventId !== null;

  const roundOff = async () => {
    setBusy(true);
    const res = await setRoundOff(hotelId, order.id, order.roundOff === 0);
    setBusy(false);
    if (!res.ok) return toast.error("Not rounded", res.reason);
    onChanged();
  };

  const abandon = async () => {
    const reason = window.prompt(
      "Why is this order being closed unpaid?\n\n" +
        "It stays on the record with this reason - a walkout and a " +
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
        {/* Above the lines, because it describes the ORDER and the lines
            describe the food. A waiter setting covers is answering a
            question about the table, not about a dish. */}
        <OrderHeaderPanel
          order={order}
          hotelId={hotelId}
          onChanged={onChanged}
        />
        {!settled && (
          <FunctionPicker
            className="px-4 pb-3"
            hotelId={hotelId}
            value={order.eventId}
            currentTitle={order.eventTitle}
            disabled={busy}
            onChange={(id) => void attach(id)}
          />
        )}

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
                  /* A side is indented under its dish, exactly as the
                     printed kitchen docket has it. Flat, the bill reads
                     "Bhaaji Pau / Sides: Onions" as two dishes. */
                  line.isAddon && "pl-5",
                )}
              >
                <span className={cn(
                  "tabular text-sm shrink-0",
                  line.isAddon ? "w-6 text-grey-500" : "w-7 text-grey-500",
                )}>
                  {line.qty}×
                </span>
                <span
                  className={cn(
                    "flex-1 min-w-0 truncate",
                    line.isAddon
                      ? "text-sm text-grey-600"
                      : "text-base text-ink-900",
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
          {order.discount > 0 && (
            <>
              {/* The rate, not just the money. A guest querying the bill
                  next month needs the statement that was actually made. */}
              <Row
                label={order.discountType === "percent"
                  ? `Discount ${order.discountValue}%`
                  : "Discount"}
                value={`-${money(order.discount)}`}
              />
              <Row label="Taxable" value={money(order.taxable)} />
            </>
          )}
          <Row label="Tax" value={money(order.tax)} />
          {order.roundOff !== 0 && (
            <Row
              label="Round off"
              value={`${order.roundOff > 0 ? "+" : ""}${money(order.roundOff)}`}
            />
          )}
          <Row label="Total" value={money(order.payable)} strong />
        </div>

        {order.discountReason && (
          <p className="text-sm text-grey-600 mt-1.5">
            Discounted - {order.discountReason}
          </p>
        )}

        {settled ? (
          <div className="mt-3.5 space-y-2">
            <p className="text-sm text-grey-600">
              {order.status === "settled"
                ? order.paymentMethod === "function"
                  ? `On ${order.eventTitle ?? "the function"}'s bill${order.settledBy ? `, settled by ${order.settledBy}` : ""}.`
                  : `Paid by ${order.paymentMethod}${order.settledBy ? `, taken by ${order.settledBy}` : ""}.`
                : `Closed unpaid - ${order.abandonedReason}`}
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
        ) : splitting ? (
          <SplitPanel
            order={order} hotelId={hotelId} busy={busy} setBusy={setBusy}
            onCancel={() => setSplitting(false)}
            onDone={onDone}
          />
        ) : (
          <div className="mt-3.5 space-y-2">
            {/* Before the payment buttons, because the bill has to be
                right before it is taken. */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="lg"
                disabled={live.length === 0}
                onClick={() => setDiscounting(true)}
              >
                <Percent className="size-4" />
                {order.discount > 0 ? "Change discount" : "Discount"}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                loading={busy}
                disabled={live.length === 0}
                onClick={() => void roundOff()}
              >
                {order.roundOff !== 0 ? "Undo round off" : "Round off"}
              </Button>
            </div>

            {onFunction && (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={busy}
                  disabled={live.length === 0}
                  onClick={() => void settle("function")}
                >
                  <CalendarHeart className="size-4 shrink-0" />
                  <span className="truncate">
                    Charge to {order.eventTitle ?? "the function"}
                  </span>
                </Button>
                <p className="text-sm text-grey-600 leading-relaxed">
                  This order is on {order.eventTitle ?? "a function"}'s bill, so
                  the host pays for it there. To take a room, cash, a card or
                  UPI, choose "Not for a function" above first.
                </p>
              </>
            )}

            <div className="flex gap-2">
              <input
                list="chargeable-rooms"
                value={room}
                disabled={onFunction}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Room"
                className="w-24 h-11 px-3 rounded-md border border-grey-300 text-base tabular disabled:bg-grey-50"
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
                disabled={onFunction || !room.trim() || live.length === 0}
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
                  disabled={onFunction || live.length === 0}
                  onClick={() => void settle(m.key)}
                >
                  <m.icon className="size-4" />
                  {m.label}
                </Button>
              ))}
            </div>

            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={onFunction || live.length === 0}
              onClick={() => setSplitting(true)}
            >
              <Split className="size-4" />
              Part - pay two ways
            </Button>

            <Button variant="ghost" size="lg" className="w-full"
              onClick={() => void abandon()} loading={busy}>
              Close unpaid
            </Button>
          </div>
        )}
      </CardBody>

      <DiscountDialog
        order={order}
        hotelId={hotelId}
        open={discounting}
        onOpenChange={setDiscounting}
        onDone={onChanged}
      />
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
