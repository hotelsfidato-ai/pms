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
  price: number;
  /** Per ITEM, not per outlet: 5% on food, 18% on packaged water. */
  taxRate: number;
  isActive: boolean;
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
  addedBy: string;
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
  tax: number;
  gross: number;
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
  hotelId: string, orderId: string, itemId: string, qty: number, note?: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/lines`,
    { itemId, qty, note });
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

export function settleOrder(
  hotelId: string, orderId: string,
  method: "room" | "cash" | "card" | "upi",
  room?: string, folioId?: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/settle`,
    { method, room, folioId });
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

/** Object surface, so either import convention resolves. */
export const tillRepo = {
  getMenu, listOrders, getOrder, listChargeableRooms,
  openOrder, addLine, voidLine, settleOrder, abandonOrder,
  addCategory, addItem, toggleItem,
};
