import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import {
  UtensilsCrossed, Plus, Minus, X, Receipt, BedDouble, Banknote, ChevronRight,
  CreditCard, Smartphone, Printer, Percent, Split, CalendarHeart, Flame, Ban, SlidersHorizontal, Gift,
} from "lucide-react";
import { TableShift } from "@/modules/pos/components/TableShift";
import { DishDialog } from "@/modules/pos/flows/DishDialog";
import { CustomiseDialog } from "@/modules/pos/flows/CustomiseDialog";
import { useBillPrint } from "@/modules/pos/flows/printBill";
import { addonBreakdown } from "@/modules/pos/lib/pricing";
import { oneLinePerDish } from "@/modules/pos/lib/oneLinePerDish";
import { FunctionPicker } from "@/modules/pos/components/FunctionPicker";
import { OrderHeaderPanel } from "@/modules/pos/flows/OrderHeaderPanel";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, dateShort } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { useLiveOrders } from "@/lib/useLiveOrders";
import {
  Page, PageHeader, Card, CardHeader, CardBody, StatusPill, Button, toast,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, IconChip,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import { listOrders, listEarlierBills, getOrder, listChargeableRooms, openOrder, addLine, voidLine, setLineQty, settleOrder, sendToKitchen, abandonOrder, voidPaidBill, giveNoCharge, sendToGm, changePaymentMode, STRIKES_SENT, applyDiscount, clearDiscount, setRoundOff, settleSplit, listPromotions, applyPromotion, setServiceCharge, setOrderHeader, getOwnerAllowance, getAllowancePlan, settleToAllowance, allowanceWords, isBarDish, numberedAddonsQuery, tillMenuQuery, setNumberedAddons, addExtras, customInputs, type CustomAddon, type Order, type OrderLine, type LineAddon, type MenuItem, type OrderSummary, type TenderInput, type CashId } from "@/modules/pos/data/till";
import { CashIdFields } from "@/modules/pos/components/CashIdFields";
import { KotStatus, KotsSent } from "@/modules/pos/components/KotStation";
import { BUSINESS_DATE } from "@/data/repositories";
import { NewParcel } from "@/modules/pos/components/NewParcel";
import { ReadFailed, ReadStale } from "@/components/ui";
import { AskDialog, SENT_STRIKE, roomAsk, type Ask, type Reply } from "@/modules/pos/components/AskDialog";

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
  const menu = useQuery(tillMenuQuery(hotelId));
  /* The numbered Add-ons (D27-289) for Customise. */
  const numbered = useQuery(numberedAddonsQuery(hotelId));
  const [customising, setCustomising] = useState<OrderLine | null>(null);
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
    variationId?: string, addonIds?: string[], moreChoiceIds?: string[],
  ) => {
    if (!openId) return;
    setBusy(true);
    const res = await addLine(hotelId, openId, itemId, qty,
      note.trim() || undefined, variationId, addonIds, moreChoiceIds);
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    setAsking(null);
    applyOrder(res.order);
  };

  /* Customise (D27-289): the numbered add-ons on a dish the kitchen does not
     have yet, folded in; typed ones as lines of their own (D27-291). On a
     dish the kitchen HAS, every add-on is a line of its own under it, for
     the next Send (D27-291). */
  const customise = async (chosen: LineAddon[], scope: "all" | "one", customs: CustomAddon[]) => {
    if (!openId || !customising) return;
    setBusy(true);
    let res: Awaited<ReturnType<typeof setNumberedAddons>>;
    try {
      res = customising.kotStatus !== "pending"
        ? await addExtras(hotelId, openId, customising.id, [
          ...chosen.map((a) => ({ numberedId: a.id, qty: a.qty })), ...customInputs(customs)])
        : await setNumberedAddons(hotelId, openId, customising.id,
          chosen.map((a) => ({ id: a.id, qty: a.qty })), scope === "one" ? 1 : undefined,
          customInputs(customs));
    } catch {
      return toast.error("Not changed", "Try Customise again when the connection is back.");
    } finally {
      setBusy(false);
    }
    if (!res.ok) return toast.error("Not changed", res.reason);
    setCustomising(null);
    applyOrder(res.order);
  };

  const [ask, setAsk] = useState<Ask | null>(null);
  const role = useRole();
  const strike = async (lineId: string, reason?: string) => {
    if (!openId) return;
    const res = await voidLine(hotelId, openId, lineId, reason);
    if (!res.ok) return toast.error("Could not strike that line", res.reason);
    applyOrder(res.order);
  };
  /* Once the kitchen has it, a manager's, with a reason (D27-119); anyone
     else SENDS it to the GM, who approves it from their own screen (D27-363). */
  const mayStrikeSent = STRIKES_SENT.includes(role);
  const askStrike = (lineId: string) => {
    const line = current.data?.lines.find((l) => l.id === lineId);
    if (!line || line.kotStatus === "pending") return void strike(lineId);
    if (!mayStrikeSent) return setAsk({
      title: `Send to the GM: take off ${line.name}?`,
      body: "The kitchen already has it, so the GM decides. They see it on their own screen; it comes off when they approve.",
      field: { label: "Why is it coming off?", required: true },
      confirm: "Send to the GM",
      onConfirm: async (why): Promise<Reply | undefined> => {
        if (!openId) return undefined;
        const res = await sendToGm(hotelId, openId, { kind: "strike_line", lineId, reason: why });
        if (!res.ok) return { refused: res.reason };
        toast.success("Sent to the GM", `${line.name} comes off when they approve.`);
        void current.refetch();
        return undefined;
      },
    });
    setAsk({
      title: `Take off ${line.name}?`, body: SENT_STRIKE,
      field: { label: "Why is it coming off?", required: true },
      confirm: "Take it off", onConfirm: (why) => strike(lineId, why),
    });
  };

  /* One fewer (D27-189): the last one is a strike; once the kitchen has
     it, a manager's, with a reason (D27-119), as on the Terminal. */
  /* One more (the owner's D27-349): not yet sent, the count goes up; with
     the kitchen, the server puts one more of the same dish, same choices, on
     a new line for the next Send - the Terminal's + does the same. */
  const more = async (lineId: string) => {
    const line = current.data?.lines.find((l) => l.id === lineId);
    if (!line || !openId) return;
    const res = await setLineQty(hotelId, openId, lineId, line.qty + 1);
    if (!res.ok) return toast.error("Not added", res.reason);
    applyOrder(res.order);
  };

  const fewer = (lineId: string) => {
    const line = current.data?.lines.find((l) => l.id === lineId);
    if (!line || !openId) return;
    if (line.qty <= 1) return askStrike(lineId);
    const go = async (reason?: string) => {
      const res = await setLineQty(hotelId, openId, lineId, line.qty - 1, reason);
      if (!res.ok) return toast.error("Not changed", res.reason);
      applyOrder(res.order);
    };
    if (line.kotStatus === "pending") return void go();
    setAsk({
      title: `1 fewer ${line.name}?`, body: SENT_STRIKE,
      field: { label: "Why is it coming off?", required: true },
      confirm: "Take it off", onConfirm: (why) => go(why),
    });
  };

  const order = current.data ?? null;
  const openOrders = (orders.data?.orders ?? []).filter(
    (o) => o.status === "open",
  );
  /* A joined bill (D27-370) was not settled: its dishes are on the bill it
     joined, so it is not listed with the day's bills. */
  const done = (orders.data?.orders ?? []).filter((o) => o.status !== "open" && o.status !== "joined");

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
      <AskDialog ask={ask} onClose={() => setAsk(null)} />
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
      <KotStatus hotelId={hotelId} className="mb-5" />

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
            <p className="text-md font-semibold text-ink-900">
              There is no menu yet
            </p>
            <p className="text-sm text-grey-600 mt-1 leading-relaxed">
              Nothing can be sold until the hotel enters what it sells. The
              prices are yours - this system ships none.
            </p>
          </CardBody>
        </Card>
      )}

      {/* The order wider on a big screen (the owner's D27-349): a dish's name
          and its buttons both fit. */}
      <div className="grid gap-5 lg:grid-cols-[1fr_420px] xl:grid-cols-[1fr_480px]">
        {/* ── The menu ─────────────────────────────────────────── */}
        <div>
          {!openId ? (
            <Card>
              <CardBody>
                <p className="text-md font-semibold text-ink-900 mb-1">
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
                  {/* A parcel (D27-359): named by its customer, no table. */}
                  <NewParcel hotelId={hotelId} outlet="REST"
                    onOpened={(o) => { setOpenId(o.id); refresh(); }} />
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-6">
              {menu.data?.map((cat) => (
                <section key={cat.id}>
                  <h2 className="text-md font-semibold text-ink-900 mb-3">
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
                          "rounded-lg ring-1 ring-inset ring-grey-200 px-3.5 py-3 min-h-14",
                          item.isActive
                            ? "bg-white press-tile hover:ring-grey-400 hover:bg-grey-50 disabled:cursor-not-allowed"
                            : "bg-grey-50 text-grey-500 cursor-not-allowed",
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
                            {/* A dash when none is set, never 0% (POS-15). */}
                            {item.taxRate === null ? "-" : `${item.taxRate}%`}
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
        <div className="space-y-3">
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
              onStrike={askStrike}
              onFewer={fewer}
              onMore={(id) => void more(id)}
              onCustomise={(line) => { setCustomising(line); void numbered.refetch(); }}
              /* Settling or abandoning FINISHES a bill, so the panel
                 closes. Discounting it does not — the biller is still
                 standing at the same order and about to take payment. */
              onDone={() => { setOpenId(null); refresh(); }}
              onChanged={refresh}
            />
          )}

          {openOrders.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Open orders" />
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
            <Card className="overflow-hidden">
              <CardHeader title="Settled today" />
              <ul className="divide-y divide-grey-100">
                {done.slice(0, 12).map((o) => (
                  <OrderRow key={o.id} order={o}
                    active={o.id === openId}
                    onOpen={() => setOpenId(o.id)} />
                ))}
              </ul>
            </Card>
          )}

          <EarlierBills hotelId={hotelId} today={orders.data?.businessDate ?? null}
            openId={openId} onOpen={setOpenId} />
        </div>
      </div>
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
        onAdd={(id, qty, note, variationId, addonIds, moreChoiceIds) =>
          void addChosen(id, qty, note, variationId, addonIds, moreChoiceIds)}
        busy={busy}
      />
    </Page>
  );
}

/* ══════════════════════════════════════════════════════════════════
   AN EARLIER DAY'S BILL (the team's feedback of 18 October, item 7a; the
   owner, 20 October): pick the day, or type the bill's number, and open it;
   its Print the bill prints BILL · DUPLICATE (D27-292), at the bill printer
   or here. Nothing else changes on a finished bill from here.
   ══════════════════════════════════════════════════════════════════ */
function EarlierBills({ hotelId, today, openId, onOpen }: {
  hotelId: string; today: string | null; openId: string | null; onOpen: (id: string) => void;
}) {
  const [date, setDate] = useState("");
  const [no, setNo] = useState("");
  const asked = date !== "" || no.trim().length >= 2;
  const bills = useQuery({
    queryKey: ["till-earlier-bills", hotelId, date, no.trim()],
    queryFn: () => listEarlierBills(hotelId, { date, no }),
    enabled: asked,
  });
  return (
    <Card className="overflow-hidden" data-earlier-bills>
      <CardHeader title="An earlier day's bill" />
      <CardBody className="space-y-3">
        <p className="text-sm text-grey-600">
          To print a paid bill again: pick its day, or type its number. It prints as BILL · DUPLICATE.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Day">
            {(f) => (
              <Input {...fieldProps(f)} type="date" value={date} max={today ?? undefined}
                onChange={(e) => setDate(e.target.value)} />
            )}
          </Field>
          <Field label="Bill number">
            {(f) => (
              <Input {...fieldProps(f)} value={no} placeholder="R-0012" maxLength={40}
                onChange={(e) => setNo(e.target.value)} />
            )}
          </Field>
        </div>
        {asked && bills.isError && (
          <p className="text-sm text-brand-red-700">The bills could not be read. Try again.</p>
        )}
        {asked && bills.data && bills.data.length === 0 && (
          <p className="text-sm text-grey-600" data-earlier-none>No paid bill {date ? `on ${dateShort(date)}` : ""}{date && no.trim() ? " " : ""}{no.trim() ? `with "${no.trim()}" in its number` : ""}.</p>
        )}
      </CardBody>
      {bills.data && bills.data.length > 0 && (
        <ul className="divide-y divide-grey-100 border-t border-grey-100">
          {bills.data.map((o) => (
            <OrderRow key={o.id} order={o} withDate active={o.id === openId} onOpen={() => onOpen(o.id)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function OrderRow({ order, active, onOpen, withDate = false }: {
  order: OrderSummary; active: boolean; onOpen: () => void;
  /** An earlier day's bill says its day (20 Oct). */
  withDate?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left min-h-14 cursor-pointer",
          "transition-colors duration-150",
          active ? "bg-brand-orange-50" : "hover:bg-grey-50",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-ink-900 tabular truncate">
            {order.orderNo}
            {order.table && (
              <span className="font-normal text-grey-500"> · {order.table}</span>
            )}
          </p>
          <p className="text-2xs text-grey-500">
            {withDate && `${dateShort(order.businessDate)} · `}
            {order.lines} item{order.lines === 1 ? "" : "s"} · {order.openedAt}
            {order.paymentMethod && ` · ${order.paymentMethod}`}
            {order.status === "void" && " · VOID"}
          </p>
        </div>
        {/* A voided bill keeps its number and its total, struck (D27-324);
            a bill given free says NC with its value, never a sale (D27-394). */}
        <span className={cn("tabular text-base font-medium shrink-0",
          order.status === "void" ? "text-grey-500 line-through" : "text-ink-900")}>
          {order.status === "no_charge" ? `NC ${money(order.net)}` : money(order.gross)}
        </span>
        {/* It opens the order: the Tappable Rule's arrow. */}
        <ChevronRight className="size-4 text-grey-400 shrink-0" aria-hidden />
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

   TWO ROUTES, AND THE PROMOTIONS COME FIRST: the ones the restaurant
   gives again and again, by name, so the bill and the month-end report
   say the same thing. By hand there is no limit since D27-395 (the owner,
   5 November; it was 10%): any percentage or amount, with a reason, never
   more than the bill.
   ══════════════════════════════════════════════════════════════════ */
const METHOD_WORD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI" };

/* A PAID BILL'S PAYMENT MODE, CHANGED (the owner's D27-363): the GM, the
   owner or an Admin, before the night audit, with a reason. Each part of a
   split bill on its own, the amounts as they were; cash, card or UPI only. */
function ModeChange({ order, hotelId, onDone }: { order: Order; hotelId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const simple = order.tenders.filter((t) => t.method in METHOD_WORD);
  const [methods, setMethods] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (simple.length === 0) return null;
  const changes = simple.filter((t) => (methods[t.id] ?? t.method) !== t.method)
    .map((t) => ({ tenderId: t.id, method: methods[t.id]! }));
  const save = async () => {
    setBusy(true);
    const res = await changePaymentMode(hotelId, order.id, changes, reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success("Payment mode changed", "The day end lists it.");
    setOpen(false); setMethods({}); setReason("");
    onDone();
  };
  return (
    <>
      <Button variant="secondary" size="lg" className="w-full" onClick={() => setOpen(true)}>
        Change how it was paid
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Change how bill ${order.orderNo} was paid`}
          description="Before the night audit only. The amounts stay; each change is kept with your reason, and the day end lists it."
          size="sm"
          footer={<>
            <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={changes.length === 0 || !reason.trim()}
              onClick={() => void save()}>Change it</Button>
          </>}>
          <div className="space-y-3">
            {simple.map((t) => (
              <div key={t.id} className="flex items-center gap-3">
                <span className="flex-1 tabular text-base text-ink-900">{moneyPrecise(t.amount)}</span>
                <NativeSelect aria-label={`Paid by, ${moneyPrecise(t.amount)}`} className="w-36"
                  value={methods[t.id] ?? t.method} onChange={(e) => setMethods((m) => ({ ...m, [t.id]: e.target.value }))}>
                  {Object.entries(METHOD_WORD).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </NativeSelect>
              </div>
            ))}
            <Field label="Why" required>
              {(f) => <Input {...fieldProps(f)} value={reason} placeholder="Paid by card, keyed as cash"
                onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── THE OWNER'S ALLOWANCE (the owner's D27-355, D27-365, D27-366) ──
   The GM, the owner or an Admin settles the owner's bill to it: the server
   works out what is free (what is left of this month) and the % off above it;
   the rest is paid here by cash, card or UPI. */
function AllowanceDialog({ order, hotelId, onClose, onDone }: {
  order: Order; hotelId: string; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const plan = useQuery({
    queryKey: ["allowance-plan", hotelId, order.id, order.gross],
    queryFn: () => getAllowancePlan(hotelId, order.id),
  });
  const p = plan.data;
  const pay = async (method: "cash" | "card" | "upi") => {
    setBusy(true);
    const res = await settleToAllowance(hotelId, order.id, { method });
    setBusy(false);
    if (!res.ok) return toast.error("Not settled", res.reason);
    toast.success("On the owner's allowance", allowanceWords(res.order.tenders) ?? money(res.order.payable));
    onClose();
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Bill ${order.orderNo} on the owner's allowance`} size="sm"
        description="What is left of this month's allowance pays first; the rest gets the % off and is paid now.">
        {!p ? <p className="text-sm text-grey-600">Working it out...</p>
          : !p.ok ? <p className="text-sm text-brand-red-700">{p.reason}</p>
          : (
            <div className="space-y-3">
              <ul className="text-base text-ink-900 space-y-1 tabular">
                <li className="flex justify-between"><span>This month's allowance</span><span>{moneyPrecise(p.monthly)}</span></li>
                <li className="flex justify-between"><span>Left this month</span><span>{moneyPrecise(p.left)}</span></li>
                <li className="flex justify-between"><span>This bill</span><span>{moneyPrecise(p.before)}</span></li>
                <li className="flex justify-between font-medium"><span>Free</span><span>{moneyPrecise(Math.min(p.free, p.after))}</span></li>
                {p.rest > 0 && (
                  <li className="flex justify-between font-medium">
                    <span>To pay, after {p.offPct}% off above it</span><span>{moneyPrecise(p.rest)}</span>
                  </li>
                )}
              </ul>
              {p.rest > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {(["cash", "card", "upi"] as const).map((m) => (
                    <Button key={m} variant="secondary" size="lg" loading={busy} onClick={() => void pay(m)}>
                      {m === "upi" ? "UPI" : m === "cash" ? "Cash" : "Card"}
                    </Button>
                  ))}
                </div>
              ) : (
                <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={() => void pay("cash")}>
                  Settle it free
                </Button>
              )}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

function DiscountDialog({
  order, hotelId, open, onOpenChange, onDone, send = false,
}: {
  order: Order;
  hotelId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  /** A waiter's or cashier's: sent to the GM, who approves it (D27-363). */
  send?: boolean;
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
    enabled: open && !send,
  });
  /* A coupon is typed from the guest's code, never a button (265). */
  const live = (promos.data?.promotions ?? []).filter((p) => p.isActive && !p.coupon);
  const [coupon, setCoupon] = useState("");

  const amount = Number(value);
  const preview = !Number.isFinite(amount) || amount <= 0
    ? null
    : type === "percent"
      ? Math.round(order.net * amount) / 100
      : amount;

  const tooMuch = preview !== null
    && (type === "percent" ? amount > 100 : preview > order.net);


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
    const res = send
      ? await sendToGm(hotelId, order.id, { kind: "discount", type, value: amount, reason: reason.trim() })
      : await applyDiscount(hotelId, order.id, type, amount, reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error(send ? "Not sent" : "Not discounted", res.reason);
    if (send) toast.success("Sent to the GM", "The discount goes on when they approve.");
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
        title={send ? "Ask the GM for a discount" : "Discount this bill"}
        description={send ? "The GM decides, on their own screen. Off the net, so the tax falls with it."
          : "Off the net, so the tax falls with it."}
        size="sm"
        footer={
          <div className="flex gap-2 w-full">
            {order.discount > 0 && !send && (
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
              /* Greyed out over the bill as well, and the reason is
                 shown beside the field. The server refuses it too —
                 Rule 6 needs both ends, because a till that has not
                 reloaded still posts. */
              disabled={!reason.trim() || preview === null || tooMuch}
              onClick={() => void apply()}
            >
              {send ? "Send to the GM" : "Apply"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* A COUPON (265): the code the guest brings; its dates, uses and
              least bill are the server's to check, in a sentence. */}
          {!send && (
            <div className="space-y-1.5">
              <div className="flex items-end gap-2">
                <Field label="Coupon code" className="flex-1">
                  {(f) => (
                    <Input {...fieldProps(f)} value={coupon} maxLength={12} autoCapitalize="characters"
                           onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="DIWALI10" />
                  )}
                </Field>
                <Button variant="secondary" size="lg" loading={busy} disabled={!coupon.trim()}
                        onClick={() => void usePromotion(coupon.trim())}>
                  Apply coupon
                </Button>
              </div>
              <p className="text-sm text-grey-500">
                The code the guest brings. Its dates, its uses and its least bill are checked.
              </p>
            </div>
          )}
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
                  "press flex-1 h-11 rounded-full border text-base font-medium cursor-pointer",
                  type === t
                    ? "border-brand-orange bg-brand-orange-50 text-brand-orange-700"
                    : "border-grey-300 bg-white text-grey-600 hover:border-grey-400 hover:bg-grey-50",
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
            <p className="text-sm text-brand-red-700">
              That is more than the bill. A discount cannot make it negative.
            </p>
          )}
          {!tooMuch && preview === null && (
            <p className="text-sm text-grey-500">
              Any percentage or amount, up to the bill's {money(order.net)}.
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
  const [cashId, setCashId] = useState<CashId>({});

  /* Paid wholly in cash, the bill is whole rupees (NA-2): the server
     rounds it the same way at the settle. */
  const bill = rows.every((r) => r.method === "cash")
    ? Math.round(order.payable) : order.payable;
  const taken = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const left = Math.round((bill - taken) * 100) / 100;
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
      rows.filter((r) => Number(r.amount) > 0), cashId);
    setBusy(false);
    if (!res.ok) return toast.error("Not settled", res.reason);
    toast.success("Settled", `${money(res.order.payable)} across ${rows.length}`);
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
              className="press size-11 grid place-items-center rounded-full text-grey-500 hover:text-brand-red-700 hover:bg-brand-red-50 shrink-0 cursor-pointer"
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

      {order.payable > 100000 && <CashIdFields value={cashId} onChange={setCashId} />}

      <div className="border-t border-grey-200 pt-2.5 space-y-1">
        <Row label="Bill" value={money(bill)} />
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
  order, hotelId, busy, setBusy, onStrike, onFewer, onMore, onCustomise, onDone, onChanged,
}: {
  order: Order;
  hotelId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onStrike: (lineId: string) => void;
  onFewer: (lineId: string) => void;
  /** One more of the dish (D27-349). */
  onMore: (lineId: string) => void;
  /** Customise a dish: its add-ons (D27-289), or after Send lines of their own (D27-291). */
  onCustomise: (line: OrderLine) => void;
  /** The bill is finished — settled or closed unpaid. */
  onDone: () => void;
  /** The bill changed but is still open. */
  onChanged: () => void;
}) {
  const [room, setRoom] = useState("");
  /* A tip for the staff, taken with a cash, card or UPI payment (264). */
  const [tip, setTip] = useState("");
  const [discounting, setDiscounting] = useState(false);
  /* The owner's allowance: offered once it is set (D27-366). */
  const [onAllowance, setOnAllowance] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [cashId, setCashId] = useState<CashId>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  /* To the bill printer, or here when none is chosen (D27-292). */
  const bill = useBillPrint(hotelId);

  const rooms = useQuery({
    queryKey: ["till-rooms", hotelId],
    queryFn: () => listChargeableRooms(hotelId),
  });

  /* D27-117, D27-162: charging a restaurant bill to a room asks first,
     naming whose bill it lands on - and which, when the room has two. */
  const askRoom = () => setAsk(roomAsk(room.trim(), money(order.gross),
    (rooms.data ?? []).filter((r) => r.room === room.trim()),
    (folioId) => settle("room", folioId)));

  const settle = async (
    method: "room" | "cash" | "card" | "upi" | "function", folioId?: string,
  ) => {
    setBusy(true);
    const res = await settleOrder(hotelId, order.id, method,
      method === "room" ? room : undefined, folioId, cashId,
      method === "room" || method === "function" ? null : Number(tip) || null);
    setBusy(false);

    if (!res.ok) {
      /* A room charge's refusal, or its "which bill?", is read in the box
         that asked (roomAsk). */
      if (method !== "room") toast.error("Not settled", res.reason);
      return res;
    }
    setTip("");
    toast.success(
      "Settled",
      res.guest ? `${money(order.gross)} to ${res.guest}`
        : method === "function"
          ? `${money(order.gross)} on ${order.eventTitle ?? "the function"}'s bill`
          : money(res.order.payable),
    );
    onDone();
    return res;
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

  /* THE VOLUNTARY SERVICE CHARGE (264; CCPA, 4 July 2022): never by
     default - offered only where the GM set a rate, and put on only once
     the cashier says the guest agreed. Off again with one tap. */
  const serviceOn = order.serviceChargePct != null;
  const serviceCharge = () => serviceOn ? void doService(false) : setAsk({
    title: `Add a voluntary service charge of ${order.serviceChargeOffered}%?`,
    body: "Only if the guest agrees to pay it. By law it is never added by default, and the bill "
      + "says it is voluntary. GST is charged on it with the food.",
    confirm: "The guest agreed",
    onConfirm: async (): Promise<Reply | undefined> => {
      const res = await setServiceCharge(hotelId, order.id, true);
      if (!res.ok) return { refused: res.reason };
      onChanged();
      return undefined;
    },
  });
  const doService = async (on: boolean) => {
    setBusy(true);
    const res = await setServiceCharge(hotelId, order.id, on);
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    onChanged();
  };

  /* A dialog, not window.prompt(), which the app's window refuses (POS-2). */
  const abandon = () => setAsk({
    title: "Close this bill unpaid?",
    body: "It stays on the record with this reason - a walkout and a duplicate "
      + "are different things at the end of a shift."
      + (order.lines.some((l) => !l.voided && l.kotStatus !== "pending")
        ? ` ${SENT_STRIKE}` : ""),
    field: { label: "Why is it being closed unpaid?", required: true },
    confirm: "Close unpaid",
    onConfirm: async (reason) => {
      setBusy(true);
      const res = await abandonOrder(hotelId, order.id, reason);
      setBusy(false);
      if (!res.ok) return void toast.error("Not closed", res.reason);
      onDone();
    },
  });

  /* NC, NO CHARGE (the owner's D27-351): the owner, an administrator or the
     GM - the same three as a void, as the server asks - gives an open bill
     free, with a reason; their name on it is the approval. It prints at
     once: the dishes and their prices, marked NC with nothing to pay (D27-394). */
  /* A waiter's or cashier's is sent to the GM, who approves it on their own
     screen and that gives it (D27-363). */
  const send = async (body: Parameters<typeof sendToGm>[2], done: string): Promise<Reply | undefined> => {
    setBusy(true);
    const res = await sendToGm(hotelId, order.id, body);
    setBusy(false);
    if (!res.ok) return { refused: res.reason };
    toast.success("Sent to the GM", done);
    onChanged();
    return undefined;
  };
  const giveNc = () => mayVoid ? giveNcNow() : setAsk({
    title: `Send to the GM: no charge for bill ${order.orderNo}?`,
    body: "The GM decides. When they approve, the bill is NC: it prints the dishes and their prices, with nothing to pay.",
    field: { label: "Why is it no charge?", required: true },
    confirm: "Send to the GM",
    onConfirm: (reason) => send({ kind: "no_charge", reason }, `Bill ${order.orderNo} is NC when they approve.`),
  });
  const giveNcNow = () => setAsk({
    title: `No charge for bill ${order.orderNo}?`,
    body: "The bill prints the dishes and their prices, marked NC with nothing to pay, with this "
      + "reason and your name as the approval. It is no sale: its value is shown as NC, never in "
      + "sales or tax, and it cannot be undone.",
    field: { label: "Why is it no charge?", required: true },
    confirm: "Give NC",
    onConfirm: async (reason): Promise<Reply | undefined> => {
      setBusy(true);
      const res = await giveNoCharge(hotelId, order.id, reason);
      setBusy(false);
      if (!res.ok) return { refused: res.reason };
      toast.success(`Bill ${order.orderNo} is NC`);
      onChanged();
      void bill.print(order.id);
      return undefined;
    },
  });

  /* VOIDING A PAID BILL (D27-324): the owner, an administrator or the GM -
     `approve` on a booking is exactly those three, as the server asks. A
     bill that reached a room's or a function's bill is reversed there. */
  const mayVoid = can(useRole(), "approve", "reservation");
  const allowance = useQuery({ queryKey: ["owner-allowance", hotelId], queryFn: () => getOwnerAllowance(hotelId),
    enabled: mayVoid, staleTime: 60_000 });
  /* A discount, too, is for those three only (the owner's D27-352). */
  const mayDiscount = mayVoid;
  const voidBlock = order.paymentMethod === "room"
    ? `This bill went to room ${order.room ?? "-"} - reverse it on the guest's bill.`
    : order.paymentMethod === "function"
      ? `This bill went to ${order.eventTitle ?? "the function"}'s bill - reverse it on the function's bill.`
      : null;
  const voidBill = () => {
    const cash = order.tenders.filter((t) => t.method === "cash").reduce((s, t) => s + t.amount, 0);
    const needsReference = order.tenders.some((t) => t.method !== "cash");
    const go = async (reason: string, reference?: string): Promise<Reply | undefined> => {
      if (!mayVoid) {
        return send({ kind: "void_bill", reason, ...(reference ? { reference } : {}) },
          `Bill ${order.orderNo} is void when they approve.`);
      }
      setBusy(true);
      const res = await voidPaidBill(hotelId, order.id, reason, reference);
      setBusy(false);
      if (!res.ok) return { refused: res.reason };
      toast.success(`Bill ${order.orderNo} is void`,
        cash > 0 ? `Give ${moneyPrecise(cash)} back to the guest out of the restaurant's tin.` : undefined);
      onChanged();
      return undefined;
    };
    setAsk({
      title: mayVoid ? `Void bill ${order.orderNo}?` : `Send to the GM: void bill ${order.orderNo}?`,
      body: [
        !mayVoid && "The GM decides, on their own screen.",
        cash > 0 && `${moneyPrecise(cash)} in cash goes back to the guest out of the restaurant's tin.`,
        needsReference && "Refund the card or UPI payment on its machine or app first: its reference is asked next.",
        "The bill keeps its number and prints VOID. The kitchen's KOTs stay as they are.",
      ].filter(Boolean).join(" "),
      field: { label: "Why is it being voided?", required: true },
      confirm: needsReference ? "Next" : mayVoid ? "Void the bill" : "Send to the GM",
      onConfirm: (reason) => needsReference
        ? {
            next: {
              title: `Void bill ${order.orderNo}?`,
              field: { label: "The refund's reference: the UPI reference or the card approval", required: true },
              confirm: mayVoid ? "Void the bill" : "Send to the GM",
              onConfirm: (reference: string) => go(reason, reference),
            },
          }
        : go(reason),
    });
  };

  const live = order.lines.filter((l) => !l.voided);
  const settled = order.status !== "open";
  const unsent = live.some((l) => l.kotStatus === "pending");

  /* D27-166: the Till sends to the kitchen as the Terminal does. It had
     no send at all, so its dishes never reached the kitchen (the speed
     check's W-1, 29 September). */
  const kot = async () => {
    setBusy(true);
    const res = await sendToKitchen(hotelId, order.id);
    setBusy(false);
    if (!res.ok) return void toast.error("Not sent", res.reason);
    toast.success(`Order ${res.kotNo} is with the kitchen`, "They can start on it now.");
    onChanged();
  };

  return (
    <Card>
      {/* The order's number is the card's heading (16px, the ladder). */}
      <div className="px-4 py-3.5 flex items-center gap-2.5 border-b border-grey-200">
        <IconChip size={24}><Receipt /></IconChip>
        <p className="text-md font-semibold text-ink-900 tabular flex-1 min-w-0 truncate">
          {order.orderNo}
          {order.table && ` · ${order.table}`}
        </p>
        <StatusPill
          tone={
            order.status === "open" ? "warning"
              : order.status === "settled" ? "success" : "neutral"
          }
        >
          {/* D27-351: NC in its own words, not the stored "no_charge". */}
          {order.status === "no_charge" ? "NC" : order.status}
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
            className="pb-3"
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
            {/* The same dish of two rounds is one line (D27-353); its buttons
                act on the newest round's line, whose id it carries. */}
            {oneLinePerDish(order.lines).map((line) => (
              <li
                key={line.id}
                className={cn(
                  "flex items-center gap-2",
                  line.voided && "opacity-45",
                  /* A side is indented under its dish, exactly as the
                     printed kitchen docket has it. Flat, the bill reads
                     "Bhaaji Pau / Sides: Onions" as two dishes. An add-on
                     line (D27-291) the same. */
                  line.parentLineId !== null && "pl-5",
                )}
              >
                <span className={cn(
                  "tabular text-sm shrink-0",
                  line.parentLineId !== null ? "w-6 text-grey-500" : "w-7 text-grey-500",
                )}>
                  {line.qty}×
                </span>
                <span className="flex-1 min-w-0">
                  {/* The whole name, on two lines if it needs them (D27-349):
                      "Tubor..." told nobody which beer. */}
                  <span
                    className={cn(
                      "block break-words",
                      line.parentLineId !== null
                        ? "text-sm text-grey-600"
                        : "text-base text-ink-900",
                      line.voided && "line-through",
                    )}
                  >
                    {line.extra ? `+ ${line.name}` : line.name}
                  </span>
                  {/* The owner's breakdown (D27-289): what the dish and each
                      numbered add-on cost, under the one line. */}
                  {line.numberedAddons && order.status !== "no_charge" && (
                    <span className="block truncate text-2xs text-grey-600 tabular">
                      {addonBreakdown(line.numberedAddons)}
                    </span>
                  )}
                </span>
                {/* An NC bill shows its prices too, as its paper (D27-394). */}
                <span className="tabular text-base text-ink-900 shrink-0">
                  {money(line.qty * line.unitPrice)}
                </span>
                {/* Customise on any dish (D27-289); once the kitchen has it, its
                    add-ons are lines of their own for the next Send (D27-291). */}
                {!settled && !line.voided && line.parentLineId === null && !line.packing && (
                  <button
                    type="button"
                    onClick={() => onCustomise(order.lines.find((l) => l.id === line.id) ?? line)}
                    aria-label={`Customise ${line.name}`}
                    title="Customise"
                    className="press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-ink-900 hover:border-grey-400 hover:bg-grey-50 shrink-0 cursor-pointer"
                  >
                    <SlidersHorizontal className="size-4" />
                  </button>
                )}
                {/* A side follows its dish (D27-192, Q8), and an add-on line's
                    number is set when it goes on (D27-291): only the dish has a −. */}
                {!settled && !line.voided && line.parentLineId === null && !line.packing && (
                  <button
                    type="button"
                    onClick={() => onFewer(line.id)}
                    aria-label={`One fewer ${line.name}`}
                    className="press size-11 grid place-items-center rounded-full text-grey-500 hover:text-ink-900 hover:bg-grey-100 shrink-0 cursor-pointer"
                  >
                    <Minus className="size-4" />
                  </button>
                )}
                {!settled && !line.voided && line.parentLineId === null && !line.packing && (
                  <button
                    type="button"
                    onClick={() => onMore(line.id)}
                    aria-label={`One more ${line.name}`}
                    className="press size-11 grid place-items-center rounded-full text-grey-500 hover:text-ink-900 hover:bg-grey-100 shrink-0 cursor-pointer"
                  >
                    <Plus className="size-4" />
                  </button>
                )}
                {!settled && !line.voided && (
                  <button
                    type="button"
                    onClick={() => onStrike(line.id)}
                    aria-label={`Strike ${line.name}`}
                    className="press size-11 grid place-items-center rounded-full text-grey-500 hover:text-brand-red-700 hover:bg-brand-red-50 shrink-0 cursor-pointer"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {order.status === "no_charge" ? (
          <div className="border-t border-grey-200 pt-2.5 space-y-1">
            <Row label="Bill total" value={money(order.net)} />
            <Row label="NC · No charge" value={`${money(0)} to pay`} strong />
          </div>
        ) : (
        <div className="border-t border-grey-200 pt-2.5 space-y-1">
          <Row label="Net" value={money(order.net)} />
          {order.discount > 0 && (
            <>
              {/* The rate, not just the money. A guest querying the bill
                  next month needs the statement that was actually made. */}
              <Row
                label={`${order.couponCode ? `Coupon ${order.couponCode}` : "Discount"}${
                  order.discountType === "percent" ? ` ${order.discountValue}%` : ""}`}
                value={`-${money(order.discount)}`}
              />
              {!order.serviceCharge && <Row label="Taxable" value={money(order.taxable)} />}
            </>
          )}
          {/* The voluntary service charge the guest agreed to (264). */}
          {Boolean(order.serviceCharge) && (
            <>
              <Row label={`Service charge ${order.serviceChargePct}% (voluntary)`} value={money(order.serviceCharge ?? 0)} />
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
        )}

        {order.discountReason && (
          <p className="text-sm text-grey-600 mt-1.5">
            Discounted - {order.discountReason}
          </p>
        )}

        {settled ? (
          <div className="mt-3.5 space-y-2">
            <p className="text-sm text-grey-600">
              {order.status === "no_charge"
                ? `NC · No charge - ${order.ncReason ?? "-"}. Approved by ${order.ncBy ?? "-"} at ${order.ncAt ?? "-"}.`
                : order.status === "void"
                ? `VOID - ${order.voidReason ?? "-"}. Voided by ${order.voidedBy ?? "-"} at ${order.voidedAt ?? "-"}`
                  + `${order.voidReference ? `; refund reference ${order.voidReference}` : ""}.`
                : order.status === "settled"
                ? order.paymentMethod === "function"
                  ? `On ${order.eventTitle ?? "the function"}'s bill${order.settledBy ? `, settled by ${order.settledBy}` : ""}.`
                  : allowanceWords(order.tenders)
                  ? `${allowanceWords(order.tenders)}${order.settledBy ? `, taken by ${order.settledBy}` : ""}.`
                  : `Paid by ${order.paymentMethod}${order.paymentMethod === "room" && order.room ? ` (room ${order.room})` : ""}`
                    + `${order.settledBy ? `, taken by ${order.settledBy}` : ""}.`
                    + (order.tip ? ` Tip for the staff ${moneyPrecise(order.tip)} (${METHOD_WORD[order.tipMethod ?? ""] ?? order.tipMethod}), not part of the bill.` : "")
                : order.status === "joined"
                ? "Joined to another table: its dishes and KOTs are on that table's bill."
                : `Closed unpaid - ${order.abandonedReason}`}
            </p>
            {(order.modeChanges ?? []).map((m, i) => (
              <p key={i} className="text-sm text-grey-600">
                Payment mode changed: {METHOD_WORD[m.from] ?? m.from} to {METHOD_WORD[m.to] ?? m.to}, {moneyPrecise(m.amount)}
                {m.by ? `, by ${m.by}` : ""} at {m.at} - {m.reason}.
              </p>
            ))}
            {(order.status === "settled" || order.status === "void" || order.status === "no_charge") && (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => void bill.print(order.id)}
              >
                <Printer className="size-4" />
                Print the bill
              </Button>
            )}
            {/* D27-363: the GM, the owner or an Admin, before the night audit. */}
            {order.status === "settled" && mayVoid && voidBlock === null && (
              <ModeChange order={order} hotelId={hotelId} onDone={onChanged} />
            )}
            {/* D27-324: the owner, an administrator or the GM; anyone else sends it to the GM (D27-363). */}
            {order.status === "settled" && (
              <>
                <Button variant="ghost" size="lg" className="w-full"
                  disabled={voidBlock !== null} onClick={voidBill} loading={busy}>
                  <Ban className="size-4" />
                  {mayVoid ? "Void this paid bill" : "Ask the GM to void this bill"}
                </Button>
                {voidBlock && <p className="text-sm text-grey-600">{voidBlock}</p>}
              </>
            )}
            {bill.dialog}
          </div>
        ) : splitting ? (
          <SplitPanel
            order={order} hotelId={hotelId} busy={busy} setBusy={setBusy}
            onCancel={() => setSplitting(false)}
            onDone={onDone}
          />
        ) : (
          <div className="mt-3.5 space-y-2">
            {/* The Terminal's own button: first, because it happens several
                times per table while settling happens once. */}
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              loading={busy}
              disabled={!unsent}
              onClick={() => void kot()}
            >
              <Flame className="size-4" />
              {unsent ? "Send to the kitchen" : "Kitchen has it all"}
            </Button>
            {/* Before the payment buttons, because the bill has to be
                right before it is taken. */}
            <div className="grid gap-2 grid-cols-2">
              <Button
                variant="secondary"
                size="lg"
                disabled={live.length === 0}
                onClick={() => setDiscounting(true)}
              >
                <Percent className="size-4" />
                {!mayDiscount ? "Ask for a discount" : order.discount > 0 ? "Change discount" : "Discount"}
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
            {/* Offered only where the GM set a rate (264). */}
            {(order.serviceChargeOffered != null || serviceOn) && (
              <Button variant="secondary" size="lg" className="w-full" loading={busy}
                disabled={live.length === 0} onClick={serviceCharge}>
                {serviceOn
                  ? `Take off the service charge (${order.serviceChargePct}%)`
                  : `Service charge ${order.serviceChargeOffered}%, if the guest agrees`}
              </Button>
            )}

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
                onClick={askRoom}
              >
                <BedDouble className="size-4" />
                Charge to room
              </Button>
            </div>

            {order.payable > 100000 && <CashIdFields value={cashId} onChange={setCashId} />}
            {/* A TIP (264): money for the staff, taken the same way as the
                bill below - not a sale, not taxed, not on the bill's total. */}
            <div className="flex items-center gap-2">
              <label htmlFor="till-tip" className="text-sm text-grey-600 shrink-0">Tip for the staff</label>
              <input id="till-tip" value={tip} inputMode="decimal" disabled={onFunction}
                onChange={(e) => setTip(e.target.value)} placeholder="₹ none"
                className="w-28 h-11 px-3 rounded-md border border-grey-300 text-base tabular disabled:bg-grey-50" />
              <span className="text-xs text-grey-500">with cash, card or UPI below</span>
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

            {/* D27-351: the owner, an administrator or the GM; anyone else sends it (D27-363). */}
            <Button variant="secondary" size="lg" className="w-full"
              disabled={onFunction || live.length === 0} onClick={giveNc} loading={busy}>
              <Gift className="size-4" />
              {mayVoid ? "No charge (NC)" : "Ask the GM for NC"}
            </Button>

            {/* The owner's allowance (D27-366): the GM, the owner or an Admin, once it is set. */}
            {allowance.data?.maySettle && allowance.data.monthly !== null && (
              <Button variant="secondary" size="lg" className="w-full"
                disabled={onFunction || live.length === 0} onClick={() => setOnAllowance(true)} loading={busy}>
                <Gift className="size-4" />
                Owner's allowance
              </Button>
            )}

            {/* Table shifting (D27-370, D27-372): two separate acts, a dine-in table only. */}
            {order.orderType === "dine_in" && <TableShift hotelId={hotelId} order={order} onChanged={onChanged} />}

            <Button variant="ghost" size="lg" className="w-full"
              onClick={abandon} loading={busy}>
              Close unpaid
            </Button>
          </div>
        )}
        {/* Its table moves and joins, kept (D27-370). */}
        {(order.moves ?? []).map((m, i) => (
          <p key={i} className="mt-3 text-sm text-grey-600">
            {m.joined ? `${m.from} joined ${m.to}` : `Moved from ${m.from} to ${m.to}`}
            {m.by ? ` by ${m.by}` : ""} at {m.at}.
          </p>
        ))}
        {/* What was sent to the GM about this bill, and the answer (D27-363). */}
        {(order.requests ?? []).length > 0 && (
          <ul className="mt-3 space-y-1.5" aria-label="Sent to the GM">
            {(order.requests ?? []).map((r) => (
              <li key={r.id} className={cn("text-sm rounded-md px-3 py-2",
                r.status === "pending" ? "bg-brand-yellow-50 text-ink-900"
                  : r.status === "approved" ? "bg-grey-50 text-grey-700" : "bg-brand-red-50 text-ink-900")}>
                {r.status === "pending" ? "Sent to the GM, waiting: "
                  : r.status === "approved" ? `Approved${r.decidedBy ? ` by ${r.decidedBy}` : ""}: `
                  : `Not approved${r.decidedBy ? ` by ${r.decidedBy}` : ""}${r.note ? ` (${r.note})` : ""}: `}
                {r.summary}
              </li>
            ))}
          </ul>
        )}
        {/* An open order's KOTs, reprinted at their station (D27-329 (5)). */}
        {order.status === "open" && (
          <KotsSent hotelId={hotelId} orderId={order.id} lines={order.lines} className="mt-4" />
        )}
      </CardBody>

      <AskDialog ask={ask} onClose={() => setAsk(null)} />
      {onAllowance && (
        <AllowanceDialog order={order} hotelId={hotelId} onClose={() => setOnAllowance(false)} onDone={onDone} />
      )}
      <DiscountDialog
        order={order}
        hotelId={hotelId}
        open={discounting}
        onOpenChange={setDiscounting}
        onDone={onChanged}
        send={!mayDiscount}
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
