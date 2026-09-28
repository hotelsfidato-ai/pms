import { api, ApiError, downloadFile } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING — the seam

   A request becomes an approved order becomes goods arriving in a store.
   Nothing here decides anything: the approval is the one inbox the GM
   already uses, and the stock is the Store's ledger.

   MONEY ARRIVES AS A STRING and stays one until it is shown. A JS number
   cannot hold every numeric(12,2) without loss, and a price on an order
   is exactly the figure where that matters. NULL IS A REAL ANSWER — an
   agreed price nobody has agreed is null, it shows "-", and it is never
   0 (the owner's oldest rule).
   ══════════════════════════════════════════════════════════════════ */

/** Where a request has got to. Derived ONCE, on the server, from the
    request's own status and the approval it points at. */
export type PurchaseState =
  | "waiting" | "refused" | "sent_back" | "ready" | "ordered" | "received" | "cancelled";

export interface PurchaseRequest {
  id: string;
  reference: string;
  state: PurchaseState;
  reason: string;
  store: { id: string; name: string };
  supplier: { id: string; name: string | null } | null;
  approvalId: string | null;
  /** The order's total, or null while a line has no agreed price — a total
      over some of the lines is a smaller number shown as the whole bill. */
  total: string | null;
  lines: number;
  unpriced: number;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decisionNote: string | null;
  orderedBy: string | null;
  orderedAt: string | null;
  receivedBy: string | null;
  receivedAt: string | null;
  deliveryNote: string | null;
  cancelledReason: string | null;
}

export interface PurchaseLine {
  id: string;
  lineNo: number;
  itemId: string;
  item: string;
  unit: string;
  quantity: string;
  /** Null until somebody agrees one. */
  unitPrice: string | null;
  receivedQuantity: string | null;
  receivedUnitCost: string | null;
  note: string | null;
}

export interface PurchaseStore { id: string; name: string; isMain: boolean }
export interface PurchaseSupplier { id: string; name: string }
export interface PurchaseItem { id: string; name: string; unit: string; onHand: number }

export interface PurchasingList {
  me: { mayRaise: boolean; maySetRequesters: boolean };
  stores: PurchaseStore[];
  suppliers: PurchaseSupplier[];
  items: PurchaseItem[];
  requests: PurchaseRequest[];
}

export interface RequesterSetting {
  mayChange: boolean;
  roles: { role: string; mayRaise: boolean }[];
}

/* ── The approval, from the ONE inbox ──────────────────────────────
   ⚠ THERE IS NO APPROVALS SCREEN IN THIS SYSTEM. The engine is real
   (migration 076) and so are its routes, but nothing draws a shared
   inbox: equipment decides its own requests on the equipment screen
   (src/modules/equipment/flows/Decide.tsx) and purchasing does the same
   on the order. Told to the owner and the master, 18 September - if a
   shared inbox is built later, both services drop their buttons and
   point at it.

   `mayDecide` and `blockedBecause` come from the core queue, never from
   a copy of its rule here, so the button and the server cannot disagree
   - the fault that file's own comment forbids.
   ═══════════════════════════════════════════════════════════════════ */
export interface PurchaseApproval {
  id: string;
  subject: { table: string; id: string };
  status: string;
  amount: string | null;
  requestedBy: string | null;
  mayDecide: boolean;
  blockedBecause?: string;
}

/** The approval waiting on one purchase request, or null. */
export async function getPurchaseApproval(
  hotelId: string, requestId: string,
): Promise<PurchaseApproval | null> {
  const out = await api<{ rows: (PurchaseApproval & { kind: string })[] }>(
    `/api/hotels/${hotelId}/approvals?status=all`);
  return out.rows.find(
    (r) => r.kind === "purchase" && r.subject.table === "purchase_requests"
      && r.subject.id === requestId) ?? null;
}

/** Approve, refuse or send back. A refusal with no words is refused by
    the server: the person who asked has to know what to do next. */
export async function decidePurchase(
  hotelId: string, approvalId: string,
  decision: "approved" | "rejected" | "clarify", note?: string,
): Promise<Result<{ status: string }>> {
  return call(`/api/hotels/${hotelId}/approvals/${approvalId}/${decision}`,
    "POST", note ? { note } : {});
}

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

/* ⚠ THE READS THROW. They must not end in `catch { return [] }`: a screen
   that cannot reach the server would then draw "no purchases yet", which
   is the fault STO-2 and POS-4 were both filed for. */

export async function getPurchasing(hotelId: string): Promise<PurchasingList> {
  return api<PurchasingList>(`/api/hotels/${hotelId}/purchasing`);
}

export async function getPurchaseRequest(
  hotelId: string, id: string,
): Promise<{ request: PurchaseRequest; lines: PurchaseLine[] }> {
  return api<{ request: PurchaseRequest; lines: PurchaseLine[] }>(
    `/api/hotels/${hotelId}/purchasing/requests/${id}`);
}

export async function getRequesters(hotelId: string): Promise<RequesterSetting> {
  return api<RequesterSetting>(`/api/hotels/${hotelId}/purchasing/requesters`);
}

/** Switch a role's permission to raise a request on or off, for this
    property (D18-2). No deploy: it is a row. */
export async function setRequester(
  hotelId: string, role: string, mayRaise: boolean,
): Promise<Result<unknown>> {
  return call(`/api/hotels/${hotelId}/purchasing/requesters/${role}`, "PUT", { mayRaise });
}

export async function raiseRequest(
  hotelId: string,
  input: {
    storeId: string;
    reason: string;
    /* unitPriceFree: 0 only when ticked Free (X-1, D27-120). */
    lines: { itemId: string; quantity: number; unitPrice?: number | null; unitPriceFree?: boolean }[];
  },
): Promise<Result<{ request: PurchaseRequest }>> {
  return call(`/api/hotels/${hotelId}/purchasing/requests`, "POST", input);
}

/** The agreed price for one line. Null takes it back to "not agreed" — a
    dash, and an order that cannot be sent. */
export async function priceLine(
  hotelId: string, requestId: string, lineId: string, unitPrice: number | null, free = false,
): Promise<Result<unknown>> {
  return call(
    `/api/hotels/${hotelId}/purchasing/requests/${requestId}/lines/${lineId}`,
    "PUT", { unitPrice, ...(free ? { free } : {}) });
}

export async function sendOrder(
  hotelId: string, requestId: string, supplierId: string,
): Promise<Result<{ request: PurchaseRequest }>> {
  return call(
    `/api/hotels/${hotelId}/purchasing/requests/${requestId}/order`,
    "POST", { supplierId });
}

export async function cancelRequest(
  hotelId: string, requestId: string, reason: string,
): Promise<Result<unknown>> {
  return call(
    `/api/hotels/${hotelId}/purchasing/requests/${requestId}/cancel`,
    "POST", { reason });
}

/** The delivery. What came may differ from what was ordered, and both
    stay: the quantities sent here are written beside the ordered ones,
    never over them. The stock lands in the Store. */
export async function recordDelivery(
  hotelId: string, requestId: string,
  input: {
    note?: string;
    lines: { lineId: string; receivedQuantity: number; receivedUnitCost?: number | null }[];
  },
): Promise<Result<{
  received: { item: string; quantity: number; store: string; onHandHere: number }[];
}>> {
  return call(
    `/api/hotels/${hotelId}/purchasing/requests/${requestId}/delivery`,
    "POST", input);
}

/** The order as a PDF, saved under the name the server gave it. Made on
    the server by the SHARED renderer (D18-3) - the same one that draws
    every report, so an order cannot drift away from the group's layout.

    Sent BY HAND after that: printed, or attached to a message by whoever
    orders. Nothing here sends anything, and nothing waits on n8n. */
export async function downloadOrder(hotelId: string, requestId: string): Promise<string> {
  return downloadFile(`/api/hotels/${hotelId}/purchasing/orders/${requestId}.pdf`);
}

async function call<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
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
