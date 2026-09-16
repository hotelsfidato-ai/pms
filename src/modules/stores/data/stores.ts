import { api, ApiError } from "@/lib/api";
import type { ImportReport } from "@/data/repositories/importReport";

/* ══════════════════════════════════════════════════════════════════
   THE STORE

   What the hotel keeps and where it went. A ledger, built like the
   folio because it is the same shape.

   ON HAND IS DERIVED, always, from the movements. There is no
   quantity column to read and none to go stale — a stock figure that
   can disagree with its own history is worse than no stock figure.

   AN ITEM HAS NO PRICE. A DELIVERY has a price. `unitCost` is the
   weighted average of what was actually paid, and it is NULL until
   something has been received — an item nobody has bought has no
   value, and zero would claim it is worthless.
   ══════════════════════════════════════════════════════════════════ */

export type StockKind =
  | "receipt" | "issue" | "wastage" | "adjustment" | "return";

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  onHand: number;
  /** Null means nobody asked to be warned about this one — which is not
      the same as "warn me when it runs out". */
  reorderLevel: number | null;
  /** Derived on the server so a list and a report cannot disagree. */
  low: boolean;
  /** Null until something has been received. A dash, never a zero. */
  unitCost: number | null;
  value: number | null;
  lastMovement: string | null;
  movements: number;
  isActive: boolean;
}

export interface StockMovement {
  id: string;
  date: string;
  kind: StockKind;
  /** Signed: positive came in, negative went out. */
  quantity: number;
  unitCost: number | null;
  supplier: string | null;
  reference: string | null;
  note: string | null;
  outlet: string | null;
  who: string | null;
  /** This row UNDID another. */
  isReversal: boolean;
  /** When it did: the kind of the row it undid, so the history can say
      "Undo of a delivery" rather than "Adjusted" (STO-6). */
  reversesKind: StockKind | null;
  /** This row WAS undone. Different fact, and the history is unreadable
      without both. */
  reversed: boolean;
}

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

/* THE READS THROW (STO-2). They ended in `catch { return [] }`, so a store
   that could not be read arrived at the screen as an empty one: with the
   server unreachable, nine items read "Nothing in the store yet — Add the
   first". The screen tells failed from empty now, the way the till (POS-4)
   and Rooms do. */
export async function getStore(hotelId: string): Promise<StockItem[]> {
  if (!hotelId) return [];
  const out = await api<{ items: StockItem[] }>(
    `/api/hotels/${hotelId}/stores`);
  return out.items;
}

export async function getStockHistory(
  hotelId: string, itemId: string,
): Promise<StockMovement[]> {
  if (!hotelId || !itemId) return [];
  const out = await api<{ movements: StockMovement[] }>(
    `/api/hotels/${hotelId}/stores/items/${itemId}/movements`);
  return out.movements;
}

export async function addStockItem(
  hotelId: string,
  input: {
    name: string; unit: string; category?: string;
    reorderLevel?: number | null;
  },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${hotelId}/stores/items`, "POST", input);
}

/** Record a movement.

    `quantity` is ALWAYS POSITIVE from here. The kind decides the
    direction and the server applies the sign — a screen that has to
    remember to send -5 for an issue will one day send 5 and quietly
    double the stock. */
export async function recordStockMovement(
  hotelId: string,
  input: {
    itemId: string;
    kind: StockKind;
    quantity: number;
    unitCost?: number | null;
    supplier?: string;
    reference?: string;
    note?: string;
    outletId?: string | null;
  },
): Promise<Result<{ id: string; onHand: number; unit: string; name: string }>> {
  return call(`/api/hotels/${hotelId}/stores/movements`, "POST", input);
}

/** Undo one. Both rows stay — the store's history is what somebody
    reads when the count is wrong. */
export async function reverseStockMovement(
  hotelId: string, movementId: string, note?: string,
): Promise<Result<{ id: string }>> {
  return call(
    `/api/hotels/${hotelId}/stores/movements/${movementId}/reverse`,
    "POST", { note });
}

async function call<T>(
  path: string, method: string, body?: unknown,
): Promise<Result<T>> {
  try {
    const out = await api<T & { ok?: boolean }>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(out as T), ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/** Bring a store list in from a file. Same two passes as the menu: a dry
    run that changes nothing, then the identical payload to apply.

    NOTHING GETS A QUANTITY FROM THIS. An import creates the things the
    property keeps; receiving a delivery is what puts something on the
    shelf, with a note behind it. */
export async function importStockItems(
  hotelId: string,
  rows: Record<string, string>[],
  dryRun: boolean,
): Promise<ImportReport> {
  try {
    return await api<ImportReport>(
      `/api/hotels/${hotelId}/stores/import`,
      { method: "POST", body: JSON.stringify({ rows, dryRun }) },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return {
        ok: false, reason: p?.reason ?? error.message, dryRun,
        verdicts: [], creates: 0, updates: 0, rejected: 0,
      };
    }
    throw error;
  }
}
