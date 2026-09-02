import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE TILL — the POS built into the PMS

   The POS screen built at Stage 7 reads the BRIDGE: what an outside
   till sent and what became of it. This is the other half, and it
   WRITES — a waiter opens an order, adds to it, settles it.

   Every refusal here comes back as `{ ok: false, reason }` rather than
   an exception, because every one of them is something a person at a
   terminal has to act on: the room has two guests, the dish is off,
   the bill is already paid. Rule 6 — say what was refused and why.
   ══════════════════════════════════════════════════════════════════ */

export interface MenuItem {
  id: string;
  name: string;
  /** The item's own price. **Meaningless once it has variations** — the
      variation carries the price, and the database refuses a line that
      names none. */
  price: number;
  /** Per ITEM, not per outlet: 5% on food, 18% on packaged water. */
  taxRate: number;
  isActive: boolean;

  /** What a fast biller types. Null for most items. */
  shortCode: string | null;
  /** THREE states. `null` means nobody has said, and it must not render
      as the green mark — an unmarked dish is not a vegetarian one. */
  isVeg: boolean | null;
  isFavourite: boolean;
  /** "We are out of paneer", until this moment. A timestamp rather than
      a flag somebody must remember to unset. */
  offUntil: string | null;
  offReason: string | null;

  /** Oil ₹300, Butter ₹400. Empty for most of a menu. */
  variations: MenuVariation[];
  addonGroups: AddonGroup[];
}

export interface MenuVariation {
  id: string;
  label: string;
  price: number;
}

export interface AddonGroup {
  id: string;
  label: string;
  /** `minSelect` above zero makes the group a required choice. */
  minSelect: number;
  maxSelect: number | null;
  addons: Addon[];
}

export interface Addon {
  id: string;
  label: string;
  price: number;
  offUntil: string | null;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface OrderLine {
  id: string;
  name: string;
  qty: number;
  /** Copied onto the line when it was added, so a price rise next
      month does not re-price a bill printed today. */
  unitPrice: number;
  taxRate: number;
  note: string | null;
  /** Struck, not removed. A manager settling a dispute wants to see
      that a dish was added and cancelled four times. */
  voided: boolean;
  /** pending · sent · preparing · ready · served.
   *
   *  `pending` until a waiter sends the ticket. The till shows it so a
   *  second KOT does not re-fire the starters while they are being
   *  eaten. */
  kotStatus: string;
  addedBy: string;

  /** Set on an ADD-ON line, naming the dish it belongs to. The bill and
      the kitchen docket both indent on it, exactly as the printed
      ticket does. */
  parentLineId: string | null;
  isAddon: boolean;
  variationId: string | null;
}

export interface KitchenLine {
  id: string;
  orderNo: string;
  table: string | null;
  orderType: string;
  outlet: string;
  name: string;
  qty: number;
  note: string | null;
  status: string;
  /** Since it reached the kitchen. The pass sorts and colours by this. */
  waitedSeconds: number;
  /** Struck after the kitchen already had it — stop cooking. */
  cancelled: boolean;
}

export interface Order {
  id: string;
  orderNo: string;
  outlet: string;
  outletName: string;
  /** Copied onto the order, so a reprint next year is not re-dressed
      in whatever the property list says by then. */
  hotelName: string;
  hotelCity: string | null;
  hotelGstin: string | null;
  table: string | null;
  status: "open" | "settled" | "abandoned";
  businessDate: string;
  paymentMethod: string | null;
  openedBy: string;
  settledBy: string | null;
  settledAt: string | null;
  abandonedReason: string | null;
  ticketId: string | null;
  lines: OrderLine[];

  net: number;
  /** As APPLIED, which is what the arithmetic used. */
  discount: number;
  /** What the biller ENTERED, and what the bill prints. "10% off" reads
      differently from "₹115.70 off" even when the money is identical, and
      recomputing the rate from the amount fails once a line moves. */
  discountType: "percent" | "fixed" | null;
  discountValue: number | null;
  discountReason: string | null;
  taxable: number;
  tax: number;
  gross: number;
  /** Signed, and under a rupee. Its own line on the bill. */
  roundOff: number;
  /** gross + roundOff. What the guest actually hands over. */
  payable: number;
  tenders: Tender[];

  /* ── The header ──────────────────────────────────────────────────
     `covers` is people EATING, not seats. Average per cover is the
     metric a restaurant runs on, and a table for two that seats six
     says nothing. Null means nobody recorded it — which is excluded
     from the average, not counted as one. */
  covers: number | null;
  /** Who took the order. Not `openedBy`, which on a shared terminal is
      one person for the whole evening. */
  waiter: string | null;
  orderType: "dine_in" | "takeaway" | "room_service" | "delivery";
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerLocality: string | null;
  /** Parked. A table on drinks and not ready for food should not be a
      bill a waiter has to remember. */
  heldAt: string | null;
}

/** One payment against a bill. Several when the guest paid two ways. */
export interface Tender {
  id: string;
  method: "room" | "cash" | "card" | "upi";
  amount: number;
  /** Cash handed over. Null for every other method. */
  tendered: number | null;
  /** Derived from `tendered`, never stored — a stored figure is one more
      thing that can disagree with the arithmetic. */
  change: number | null;
  reference: string | null;
  takenBy: string;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  outlet: string;
  table: string | null;
  status: string;
  businessDate: string;
  gross: number;
  paymentMethod: string | null;
  openedAt: string;
  lines: number;
}

export interface ChargeableRoom {
  room: string;
  guest: string;
  folioId: string;
}

/** A refusal a person can act on, or the order as it now stands. */
export type TillResult =
  | { ok: true; order: Order; guest?: string; room?: string }
  | { ok: false; reason: string; choices?: { folioId: string; guest: string }[] };

/* ── Reads ────────────────────────────────────────────────────────── */

export async function getMenu(hotelId: string): Promise<MenuCategory[]> {
  if (!hotelId) return [];
  try {
    const body = await api<{ categories: MenuCategory[] }>(
      `/api/hotels/${hotelId}/till/menu`,
    );
    return body.categories;
  } catch {
    return [];
  }
}

export async function listOrders(
  hotelId: string,
): Promise<{ businessDate: string; orders: OrderSummary[] } | null> {
  if (!hotelId) return null;
  try {
    return await api<{ businessDate: string; orders: OrderSummary[] }>(
      `/api/hotels/${hotelId}/till/orders`,
    );
  } catch {
    return null;
  }
}

export async function getOrder(
  hotelId: string, orderId: string,
): Promise<Order | null> {
  if (!hotelId || !orderId) return null;
  try {
    return await api<Order>(`/api/hotels/${hotelId}/till/orders/${orderId}`);
  } catch {
    return null;
  }
}

export async function listChargeableRooms(
  hotelId: string,
): Promise<ChargeableRoom[]> {
  if (!hotelId) return [];
  try {
    const body = await api<{ rooms: ChargeableRoom[] }>(
      `/api/hotels/${hotelId}/till/rooms`,
    );
    return body.rooms;
  } catch {
    return [];
  }
}

/* ── Writes ───────────────────────────────────────────────────────── */

/**
 * Every write goes through here.
 *
 * A 409 from the till is not a failure, it is an ANSWER — the room has
 * two guests, the dish is off today, the bill is already paid. `api`
 * throws on any non-2xx, so the reason has to be recovered here rather
 * than lost as a generic error. The same shape `setHousekeeping` uses.
 */
async function write(path: string, body?: unknown): Promise<TillResult> {
  try {
    const result = await api<Order & { ok: true; guest?: string; room?: string }>(
      path,
      {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return {
      ok: true,
      order: result,
      ...(result.guest ? { guest: result.guest } : {}),
      ...(result.room ? { room: result.room } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as
        | { reason?: string; choices?: { folioId: string; guest: string }[] }
        | undefined;
      return {
        ok: false,
        reason: payload?.reason ?? error.message,
        ...(payload?.choices ? { choices: payload.choices } : {}),
      };
    }
    throw error;
  }
}

export function openOrder(
  hotelId: string, outlet: string, table?: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders`, { outlet, table });
}

export function addLine(
  hotelId: string, orderId: string, itemId: string, qty: number,
  note?: string,
  /* Chosen in the dish dialog. A dish WITH variations requires one and
     the server refuses without it; a dish with none must not be sent
     one. Sides always start a new line rather than joining one whose
     add-ons nobody checked. */
  variationId?: string, addonIds?: string[],
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/lines`,
    { itemId, qty, note, variationId, addonIds });
}

export function voidLine(
  hotelId: string, orderId: string, lineId: string,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/orders/${orderId}/lines/${lineId}/void`,
  );
}

/**
 * Change a line's quantity.
 *
 * Zero strikes it — a waiter counting down to none means the same as
 * pressing the cross, and the struck line stays visible either way.
 */
export function setLineQty(
  hotelId: string, orderId: string, lineId: string, qty: number,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/orders/${orderId}/lines/${lineId}/qty`,
    { qty },
  );
}

/**
 * Send the pending lines to the kitchen.
 *
 * KOT and BILL are different acts. Only PENDING lines go — firing the
 * whole order again would put the starters back on the pass while they
 * are being eaten.
 */
export async function sendToKitchen(
  hotelId: string, orderId: string,
): Promise<TillResult & { kotNo?: number }> {
  /* The docket number comes back with the send, so the till can offer
     the paper without asking again — and so a waiter who wants it knows
     which number to expect out of the machine. */
  try {
    const result = await api<Order & { ok: true; kotNo: number }>(
      `/api/hotels/${hotelId}/till/orders/${orderId}/kot`, { method: "POST" });
    return { ok: true, order: result, kotNo: result.kotNo };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/**
 * Discount an open bill.
 *
 * A discount is allowed and it must say WHY. A till with nowhere to record
 * one does not stop discounts happening — it moves them somewhere invisible,
 * and the biller strikes a line instead.
 */
export function applyDiscount(
  hotelId: string, orderId: string,
  type: "percent" | "fixed", value: number, reason: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/discount`,
    { type, value, reason });
}

export function clearDiscount(
  hotelId: string, orderId: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/discount/clear`);
}

/** To the nearest rupee, so the biller takes a note rather than coins. */
export function setRoundOff(
  hotelId: string, orderId: string, apply: boolean,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/round-off`,
    { apply });
}

export async function getKitchen(hotelId: string): Promise<KitchenLine[]> {
  if (!hotelId) return [];
  try {
    const body = await api<{ lines: KitchenLine[] }>(
      `/api/hotels/${hotelId}/kitchen`,
    );
    return body.lines;
  } catch {
    return [];
  }
}

export async function moveKitchenLine(
  hotelId: string, lineId: string, to: "preparing" | "ready" | "served",
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/kitchen/lines/${lineId}/${to}`,
      { method: "POST" });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export function settleOrder(
  hotelId: string, orderId: string,
  method: "room" | "cash" | "card" | "upi",
  room?: string, folioId?: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/settle`,
    { method, room, folioId });
}

/** What the biller is handing the till for one of several payments. */
export interface TenderInput {
  method: "room" | "cash" | "card" | "upi";
  amount: number;
  /** Cash only. The change is worked out from it. */
  tendered?: number;
  /** Card last four, a UPI reference. Never validated — the shape differs
      per method and a wrong format must not stop a guest leaving. */
  reference?: string;
}

/**
 * Settle a bill across several payments — the Part button.
 *
 * They must add up to the payable exactly. Short is a drawer that will not
 * reconcile at day end; over is change that was never given.
 *
 * A room payment has to be the ONLY one. Paying part of a bill to a room
 * would mean apportioning that part across tax rates again, and there is no
 * defensible way to choose which rate a partial payment settles.
 */
export function settleSplit(
  hotelId: string, orderId: string, tenders: TenderInput[],
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/settle`,
    { tenders });
}

export function abandonOrder(
  hotelId: string, orderId: string, reason: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/abandon`,
    { reason });
}

/* ── The menu, as the hotel maintains it ──────────────────────────── */

export async function addCategory(
  hotelId: string, name: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/menu/categories`,
      { method: "POST", body: JSON.stringify({ name }) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

export async function addItem(
  hotelId: string, categoryId: string, name: string,
  price: number, taxRate: number,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/menu/items`, {
      method: "POST",
      body: JSON.stringify({ categoryId, name, price, taxRate }),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

export async function toggleItem(
  hotelId: string, itemId: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/menu/items/${itemId}/toggle`,
      { method: "POST" });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

/* ── Off, and back on ─────────────────────────────────────────────
   `toggleItem` above is the PERMANENT one: a dish taken off the card,
   which is a menu decision. This is the shift decision — out of paneer
   until eight — and it is a different act with a different word for it.

   A DURATION, never a switch. Off with no end is a dish that stays off
   for a week because whoever took it off went home, and nobody can say
   since when. */

export type OffFor = "2h" | "4h" | "8h" | "24h" | "next_business_day" | "custom";

export async function takeItemOff(
  hotelId: string, itemId: string, until: OffFor,
  reason?: string, customUntil?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(
    `/api/hotels/${hotelId}/till/menu/items/${itemId}/off`,
    { until, reason, customUntil });
}

export async function putItemBack(
  hotelId: string, itemId: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/menu/items/${itemId}/on`);
}

export async function setOutletClosed(
  hotelId: string, outlet: string,
  closed: boolean, until?: OffFor, reason?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(
    `/api/hotels/${hotelId}/till/outlet/${outlet}/closed`,
    { closed, until, reason });
}

/** A refusal a person can act on, or nothing. The shape used by every
    write on this page that has no order to hand back. */
async function simplePost(
  path: string, body?: unknown,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(path, {
      method: "POST",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/* ── The floor ────────────────────────────────────────────────────
   Every table with whatever is sitting on it, in one request. A grid
   that fetched a tile at a time would flicker as it filled, and a
   waiter reads the whole room at once or not at all. */

/** blank · running · kot · printed · paid — DERIVED from the order,
    never stored. A stored colour is a sixth thing to keep in step, and
    the one that will be wrong on the night a manager is watching. */
export type TableState = "blank" | "running" | "kot" | "printed" | "paid";

export interface FloorTable {
  id: string;
  label: string;
  seats: number | null;
  row: number;
  col: number;
  orderId: string | null;
  orderNo: string | null;
  state: TableState;
  /** How long the table has been sitting. The number a manager scans
      the room for. Null when nothing is on it. */
  minutes: number | null;
  payable: number | null;
}

export interface FloorSection {
  id: string;
  name: string;
  tables: FloorTable[];
}

export interface Floor {
  outlet: { code: string; name: string; closedUntil: string | null } | null;
  sections: FloorSection[];
}

export async function getFloor(
  hotelId: string, outlet = "REST",
): Promise<Floor> {
  if (!hotelId) return { outlet: null, sections: [] };
  try {
    return await api<Floor>(
      `/api/hotels/${hotelId}/till/floor?outlet=${encodeURIComponent(outlet)}`);
  } catch {
    return { outlet: null, sections: [] };
  }
}

export function openOrderOnTable(
  hotelId: string, outlet: string, tableId: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders`, { outlet, tableId });
}

export function markPrinted(
  hotelId: string, orderId: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/printed`);
}

/** Frees the table. Refused while the bill is unsettled — clearing one
    takes a live order off the floor with money on it. */
export async function clearTable(
  hotelId: string, orderId: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/orders/${orderId}/clear`);
}

/* ── The order header ─────────────────────────────────────────────
   ONE call for five fields, because they are one panel. Four calls
   would mean a waiter who fills it in and taps away produces four
   writes, three of which can fail on their own and leave the header
   half entered with nothing saying which half.

   Only what is PASSED is written — sending `covers` must not blank the
   waiter somebody set a minute ago. */
export interface OrderHeader {
  covers?: number | null;
  waiterId?: string | null;
  orderType?: Order["orderType"];
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerLocality?: string | null;
  held?: boolean;
}

export async function setOrderHeader(
  hotelId: string, orderId: string, header: OrderHeader,
): Promise<TillResult> {
  try {
    const result = await api<Order & { ok: true }>(
      `/api/hotels/${hotelId}/till/orders/${orderId}`,
      { method: "PATCH", body: JSON.stringify(header) },
    );
    return { ok: true, order: result };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/** Everyone with access to this property. Nobody holds a `waiter` role,
    and inventing one would leave the list empty on the first evening —
    the same answer housekeeping gives, for the same reason. */
export async function listWaiters(
  hotelId: string,
): Promise<{ id: string; name: string }[]> {
  if (!hotelId) return [];
  try {
    const body = await api<{ waiters: { id: string; name: string }[] }>(
      `/api/hotels/${hotelId}/till/waiters`);
    return body.waiters;
  } catch {
    return [];
  }
}

/* ── The kitchen docket ───────────────────────────────────────────
   One BATCH of lines, not the order. Starters, then mains, then the
   dessert somebody changed their mind about: three dockets, three
   numbers, one bill.

   No prices on it, and there never will be. A chef reading a docket is
   deciding what to cook and in what order; a column of rupees is noise
   on a rail above a hotplate. */
export interface Docket {
  kotNo: number;
  orderNo: string;
  table: string | null;
  orderType: string;
  outlet: string;
  hotel: string;
  sentAt: string | null;
  lines: {
    id: string;
    /** Set on a side, naming the dish it goes on. The paper indents. */
    parentId: string | null;
    name: string;
    qty: number;
    note: string | null;
    isAddon: boolean;
  }[];
}

export async function getDocket(
  hotelId: string, orderId: string, kotNo: number,
): Promise<Docket | null> {
  if (!hotelId || !orderId || !Number.isInteger(kotNo)) return null;
  try {
    return await api<Docket>(
      `/api/hotels/${hotelId}/till/orders/${orderId}/kot/${kotNo}`);
  } catch {
    return null;
  }
}
