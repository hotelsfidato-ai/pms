import { api, ApiError, downloadFile } from "@/lib/api";
import { can, type Role } from "@/lib/permissions";

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
  /** The order's GST rate, per cent (D27-383 item 11). Null: none agreed. */
  agreedGstRate: string | null;
  receivedQuantity: string | null;
  receivedUnitCost: string | null;
  /** What the supplier's bill charges for, on a delivery on credit. */
  billedQuantity: string | null;
  /** The bill's GST rate on the line, per cent, as the delivery recorded it. */
  billGstRate: string | null;
  note: string | null;
}

/** One way a delivered order's bill differs from the order (D27-383 item 11):
    more billed than came, a price above the agreed one, a GST rate other than
    the agreed one. `billed` is the bill's; `against` is what came or was agreed.
    Flagged, never refused. Worked out by the database, once. */
export interface BillDifference {
  lineId: string; item: string; unit: string; kind: "quantity" | "price" | "gst"; billed: string; against: string;
}

/** A difference in words: "Basmati rice: billed 26 kg, 25 kg came". */
export function differenceText(d: BillDifference): string {
  const n = (v: string) => String(Number(v));
  if (d.kind === "quantity") return `${d.item}: billed ${n(d.billed)} ${d.unit}, ${n(d.against)} ${d.unit} came`;
  if (d.kind === "price") {
    const rs = (v: string) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${d.item}: ${rs(d.billed)} a ${d.unit} on the bill, ${rs(d.against)} agreed`;
  }
  return `${d.item}: GST ${n(d.billed)}% on the bill, ${n(d.against)}% on the order`;
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

/** A supplier's bill on credit (D27-370): as printed, and when it is due. */
/** A supplier's bill without a due date of its own: the bill date + 30 days,
    offered for the clerk to accept or change (the owner's D27-372). */
export const suggestedDue = (billDate: string): string => {
  const d = new Date(`${billDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
};

export interface CreditBill { billNo: string; billDate: string; amount: number; dueOn: string }

export async function getPurchaseRequest(
  hotelId: string, id: string,
): Promise<{ request: PurchaseRequest; lines: PurchaseLine[];
             /** What is left on the bill: "0.00" once paid (249). */
             credit: (Omit<CreditBill, "amount"> & { amount: string; owed: string }) | null;
             differences: BillDifference[] }> {
  return api(`/api/hotels/${hotelId}/purchasing/requests/${id}`);
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

/** The order's GST rate for one line, per cent (D27-383 item 11); null clears
    it. Only while the order has not gone out, as the price. */
export async function setLineGst(
  hotelId: string, requestId: string, lineId: string, gstRate: number | null,
): Promise<Result<unknown>> {
  return call(`/api/hotels/${hotelId}/purchasing/requests/${requestId}/lines/${lineId}`, "PUT", { gstRate });
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
    lines: {
      lineId: string; receivedQuantity: number; receivedUnitCost?: number | null;
      /** The bill's GST for the line, all three or none, and its use-by
          (D27-238, D27-242 Q6). */
      gstRate?: number; gstAmount?: number; gstClaimable?: boolean; expiresOn?: string;
      /** On credit: what the bill charges for, every line (D27-383 item 11). */
      billedQuantity?: number;
    }[];
    /** On credit: the supplier's bill goes on the Supplier dues (D27-370). */
    credit?: CreditBill;
  },
): Promise<Result<{
  received: { item: string; quantity: number; store: string; onHandHere: number }[];
  /** How many ways the bill differs from the order: flagged, not refused. */
  differences: number;
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

/* ── Supplier dues (the owner's D27-370) ────────────────────────────
   What we owe suppliers: the bills taken on credit and not yet paid. Seen,
   and paid, by the accountant, the GM, the owner and an administrator - the
   server's DUES_ROLES, who are exactly who hold `approve` on `invoice`. */
export const seesSupplierDues = (role: Role): boolean => can(role, "approve", "invoice");

export type PayMethod = "cash" | "cheque" | "bank" | "upi";
export type TdsSection = "194C" | "194Q" | "194J" | "194I";

/** One payment on a bill (D27-372): part payments, each with its TDS when the Accountant entered it. */
export interface SupplierPayment {
  id: string; paidOn: string; method: PayMethod; reference: string | null; amount: string;
  tds: { section: TdsSection; rate: string; amount: string } | null;
  handedOverBy: string | null; recordedBy: string | null; reversed: boolean;
  /** Who confirmed they had seen the bill's differences from its order, on paying it. */
  differencesSeenBy: string | null;
}
export interface SupplierCreditNote {
  id: string; noteNo: string; noteDate: string; amount: string; issuedBy: "supplier" | "hotel"; reason: string;
}

export interface SupplierDue {
  id: string; supplierId: string | null; supplier: string; billNo: string; billDate: string;
  /** As printed on the bill. A string to the screen, as all money here. */
  amount: string; dueOn: string;
  /** What is left: the amount less what was paid, its TDS and its credit notes. */
  owed: string; paid: string; tds: string; credited: string;
  status: "unpaid" | "part-paid" | "paid";
  /** The bill this one replaced, after a reversal (D27-372). */
  replaces: string | null;
  from: { kind: "bar" } | { kind: "order"; id: string; reference: string };
  /** Where the bill differs from its order (D27-383 item 11). Paying asks first. */
  differences: BillDifference[];
  payments: SupplierPayment[];
  creditNotes: SupplierCreditNote[];
}

export interface SupplierDues {
  today: string;
  suppliers: { id: string; name: string }[];
  bills: SupplierDue[];
  /** Credit notes against a supplier rather than one bill: they lower what is owed to it. */
  credits: (Omit<SupplierCreditNote, "id"> & { id: string; supplierId: string; supplier: string })[];
}

export async function getSupplierDues(hotelId: string): Promise<SupplierDues> {
  return api(`/api/hotels/${hotelId}/purchasing/dues`);
}

/** A payment, all of what is left or a part of it. No cash drawer is touched. */
export async function paySupplierDue(
  hotelId: string, billId: string,
  input: { amount: number; method: PayMethod; reference: string | null; paidOn: string; handedOverBy: string;
           tds: { section: TdsSection; rate: number; amount: number } | null;
           /** "I have seen how this bill differs from its order" - asked of a bill with any. */
           differencesSeen?: boolean },
): Promise<Result<unknown>> {
  return call(`/api/hotels/${hotelId}/purchasing/dues/${billId}/payment`, "POST", input);
}

/** A credit note, money only: against one bill, or the supplier as a whole. */
export async function addSupplierCreditNote(hotelId: string, input: {
  billId: string | null; supplierId: string | null; issuedBy: "supplier" | "hotel";
  noteNo: string; noteDate: string; amount: number; reason: string;
}): Promise<Result<unknown>> {
  return call(`/api/hotels/${hotelId}/purchasing/dues/credit-notes`, "POST", input);
}

/** A mistake reversed with a reason: both stay on the record (D27-372). */
export async function reverseSupplierEntry(
  hotelId: string, input: { kind: "bill" | "payment" | "credit-note"; id: string; reason: string;
    /** A wrong bill's right one, on the same delivery or bar bill. */
    correct?: CreditBill | null },
): Promise<Result<unknown>> {
  return call(`/api/hotels/${hotelId}/purchasing/dues/reverse`, "POST", input);
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
