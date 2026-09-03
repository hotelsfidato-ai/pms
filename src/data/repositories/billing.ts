import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE } from "./businessDate";

/* ══════════════════════════════════════════════════════════════════
   BILLING — over HTTP, as of CP9e

   Receipts, billable folios, the rate grid and the night-audit
   checklist.

   Two things are still deliberately NOT done, and each is refused with
   its reason on the face of the screen rather than quietly missing:

     · NO INVOICE NUMBER IS ISSUED. 5EFH154 is the hotel's real next
       GST number, and a number shown here but never printed on a filed
       return leaves a hole in a statutory sequence.

     · THE NIGHT AUDIT DOES NOT RUN. It rolls the business date, and
       the business date is still a constant. Everything it would CHECK
       is computed anyway — that is the part a manager reads.
   ══════════════════════════════════════════════════════════════════ */

async function fetchOr<T>(path: string, empty: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return empty;
    throw error;
  }
}

/* ── Payments ────────────────────────────────────────────────────── */

export interface PaymentRow {
  id: string;
  businessDate: string;
  at: string;
  guest: string;
  roomNumber: string;
  reference: string;
  method: string;
  description: string;
  amount: number;
  user: string;
  reversed: boolean;
}

export interface PaymentsByMethod {
  method: string;
  count: number;
  amount: number;
}

/**
 * A payment is a negative posting. Reversed receipts stay in the list
 * struck through rather than vanishing — the ledger is append-only, and
 * a receipt that disappeared is one somebody would go looking for.
 */
export async function listPayments(hotelId: string): Promise<PaymentRow[]> {
  if (!hotelId) return [];
  return fetchOr<PaymentRow[]>(`/api/hotels/${hotelId}/payments`, []);
}

/** Live receipts by method — reversed lines excluded, as they must be. */
export async function paymentsByMethod(hotelId: string): Promise<PaymentsByMethod[]> {
  const rows = (await listPayments(hotelId)).filter((r) => !r.reversed);
  const map = new Map<string, PaymentsByMethod>();

  for (const r of rows) {
    const entry = map.get(r.method) ?? { method: r.method, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount = Math.round((entry.amount + r.amount) * 100) / 100;
    map.set(r.method, entry);
  }

  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/* ── Billable folios ─────────────────────────────────────────────── */

export interface BillableRow {
  stayId: string;
  reference: string;
  guest: string;
  roomNumber: string;
  roomType: string;
  source: string;
  arrival: string;
  departure: string;
  nights: number;
  charges: number;
  tax: number;
  paid: number;
  balance: number;
  /** Only a settled folio can be invoiced. */
  status: "settled" | "outstanding" | "overpaid";
  /**
   * The tax invoice already issued against this stay, or null.
   *
   * A departed folio that has been billed is not "ready to bill". The
   * row stays visible — it keeps the stay's link to its number — but
   * the Issue button becomes the number.
   */
  invoice: string | null;
}

export async function listBillable(hotelId: string): Promise<BillableRow[]> {
  if (!hotelId) return [];
  return fetchOr<BillableRow[]>(`/api/hotels/${hotelId}/billable`, []);
}

export interface InvoiceSeriesState {
  prefix: string;
  /** The financial year the series belongs to — GST numbering resets. */
  finYear: string;
  next: string;
  issued: number;
  note: string;
}

/**
 * The property's real GST invoice series, from the database.
 *
 * This read the FIXTURE until Stage 8, and its comment said why: "there
 * is no `invoice_series` row to read until something issues from it.
 * Modelling a counter nothing increments would suggest it is being
 * kept." That was right, and it stopped being true the moment issuing
 * landed — a fictional counter shown beside real invoice numbers is
 * worse than the honest placeholder it replaced.
 */
export async function getInvoiceSeries(hotelId: string): Promise<InvoiceSeriesState[]> {
  if (!hotelId) return [];
  return fetchOr<InvoiceSeriesState[]>(
    `/api/hotels/${hotelId}/invoice-series`, [],
  );
}

/* ── Rates ───────────────────────────────────────────────────────── */

export interface RateCell {
  date: string;
  rackRate: number;
  /** What rooms of this type actually sold for on the date. */
  soldAdr: number | null;
  sold: number;
  sellable: number;
}

export interface RateRow {
  roomType: string;
  rackRate: number;
  cells: RateCell[];
}

/**
 * Rack against achieved: a report on what rooms actually SOLD for,
 * against the room type's rack rate.
 *
 * Not to be confused with `getPriceGrid` in `rates.ts`, which is the
 * pricing calendar — what a room WILL cost. This one looks backwards
 * and that one forwards, and every difference in the achieved line
 * here is something a person negotiated on the day.
 */
export async function getRateGrid(
  hotelId: string,
  from = BUSINESS_DATE,
  days = 14,
): Promise<RateRow[]> {
  if (!hotelId) return [];
  return fetchOr<RateRow[]>(
    `/api/hotels/${hotelId}/rates?from=${encodeURIComponent(from)}&days=${days}`,
    [],
  );
}

/* ── Night audit ─────────────────────────────────────────────────── */

export interface AuditCheck {
  id: string;
  label: string;
  detail: string;
  /** ok — nothing to do. attention — a person should look first. */
  state: "ok" | "attention";
  count: number;
  link?: string;
}

export interface NightAuditState {
  businessDate: string;
  nextBusinessDate: string;
  checks: AuditCheck[];
  /** Rule 6 — refused, with the reason on screen rather than hidden. */
  canRun: { allowed: boolean; reason?: string };
  lastRun: string | null;
}

export async function getNightAudit(hotelId: string): Promise<NightAuditState | null> {
  if (!hotelId) return null;
  return fetchOr<NightAuditState | null>(
    `/api/hotels/${hotelId}/night-audit?asOn=${BUSINESS_DATE}`,
    null,
  );
}

/** What one completed audit did. */
export interface NightAuditResult {
  ok: boolean;
  reason?: string;
  businessDate: string;
  nextBusinessDate?: string;
  roomsPosted?: number;
  revenuePosted?: number;
  complimentary?: number;
  noShows?: number;
  duplicate?: boolean;
  blockers?: Array<{ id: string; reason: string; rooms: string[] }>;
}

/**
 * Close the day.
 *
 * The only call in this system that MOVES a business date. Everything
 * else reads one.
 *
 * A refusal comes back as `{ ok: false, reason }` with a 409, which
 * `api()` surfaces as an ApiError carrying the body — the same shape
 * every other guarded action uses, so the screen shows the reason
 * rather than a status code.
 */
export async function runNightAudit(hotelId: string): Promise<NightAuditResult> {
  return api<NightAuditResult>(`/api/hotels/${hotelId}/night-audit/run`, {
    method: "POST",
  });
}


/* ══════════════════════════════════════════════════════════════════
   TAX INVOICES — Stage 8

   The InvoicesPage carried a notice for eight checkpoints saying that
   issuing would move to that screen "at Stage 8, when the numbers are
   recorded rather than displayed". These are what records them.

   A number shown but never recorded leaves a hole in a GST series, and
   a hole in a GST series is a question from an assessor — which is why
   nothing here generates a number for display.
   ══════════════════════════════════════════════════════════════════ */

export interface IssuedInvoice {
  number: string;
  recipient: string | null;
  total: number;
  taxTotal: number;
  issuedAt: string;
  businessDate: string | null;
  isCreditNote: boolean;
  /** The credit note that cancelled this one, if any. */
  creditedBy: string | null;
}

export interface InvoiceLine {
  description: string;
  category: string;
  amount: number;
  taxRate: number;
  taxAmount: number;
  date: string;
}

export interface InvoiceDetail {
  number: string;
  finYear: string;
  issuedAt: string;
  issuedBy: string | null;
  businessDate: string | null;
  supplier: {
    name: string; address: string | null; city: string | null;
    state: string | null; gstin: string | null;
  };
  recipient: { name: string | null; gstin: string | null; address: string | null };
  /** The PROPERTY's state, always — IGST Act s.12(3)(b). */
  placeOfSupply: string | null;
  sacCode: string;
  lines: InvoiceLine[];
  taxableValue: number;
  cgst: { rate: number; amount: number };
  sgst: { rate: number; amount: number };
  taxTotal: number;
  total: number;
  creditsInvoiceId: string | null;
  /** The number of the invoice this note cancels. */
  creditsNumber: string | null;
  reason: string | null;
  creditedBy: string | null;
}

export async function listInvoices(hotelId: string): Promise<IssuedInvoice[]> {
  if (!hotelId) return [];
  return fetchOr<IssuedInvoice[]>(`/api/hotels/${hotelId}/invoices`, []);
}

export async function getInvoice(
  hotelId: string, number: string,
): Promise<InvoiceDetail | null> {
  if (!hotelId || !number) return null;
  return fetchOr<InvoiceDetail | null>(
    `/api/hotels/${hotelId}/invoices/${encodeURIComponent(number)}`, null,
  );
}

/** Issue a tax invoice for a stay. The number comes from the database. */
export async function issueInvoice(
  hotelId: string, stayId: string,
): Promise<{ ok: boolean; number?: string; reason?: string; duplicate?: boolean }> {
  return api(`/api/hotels/${hotelId}/stays/${stayId}/invoice`, { method: "POST" });
}

/** Correct an issued invoice. It is never edited. */
export async function issueCreditNote(
  hotelId: string, number: string, reason: string,
): Promise<{ ok: boolean; number?: string; reason?: string }> {
  return api(
    `/api/hotels/${hotelId}/invoices/${encodeURIComponent(number)}/credit-note`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

/* ── Form C ───────────────────────────────────────────────────────── */

export interface FormCRow {
  reservationId: string;
  guest: string;
  nationality: string;
  /** Null when no document has been recorded. Somebody has to go and ask. */
  passport: string | null;
  room: string;
  arrived: string;
  dueBy: string;
  overdue: boolean;
  filed: boolean;
  reference: string | null;
}

export interface FormCRegister {
  /** The API says this in its own body. It is not decoration. */
  note: string;
  due: number;
  overdue: number;
  rows: FormCRow[];
}

export async function getFormC(hotelId: string): Promise<FormCRegister | null> {
  if (!hotelId) return null;
  return fetchOr<FormCRegister | null>(`/api/hotels/${hotelId}/form-c`, null);
}

/** Record that a filing happened. The PMS does not file. */
export async function recordFormC(
  hotelId: string, reservationId: string, reference: string, notes?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return api(`/api/hotels/${hotelId}/form-c/${reservationId}`, {
    method: "POST",
    body: JSON.stringify({ reference, ...(notes ? { notes } : {}) }),
  });
}

/* ══════════════════════════════════════════════════════════════════
   POS — the PMS side

   The bridge an outlet posts across was built at Stage 7 and had no
   interface: settling "the restaurant says they charged it, the folio
   says otherwise" meant SQL. These are what the POS screen reads.

   Note what is NOT here: no menu, no orders, no tables. Those belong
   to the POS, which is a separate system. This is the PMS looking at
   what arrived.
   ══════════════════════════════════════════════════════════════════ */

export interface PosOutlet {
  code: string;
  name: string;
  category: string;
  /** An outlet with no key cannot post. Said plainly on the screen. */
  hasKey: boolean;
  isActive: boolean;
  bills: number;
}

export async function listPosOutlets(hotelId: string): Promise<PosOutlet[]> {
  if (!hotelId) return [];
  return fetchOr<PosOutlet[]>(`/api/hotels/${hotelId}/pos/outlets`, []);
}

export interface PosTicket {
  id: string;
  outlet: string;
  outletName: string;
  /** The POS's own bill number — what a waiter reads off their terminal. */
  ticketRef: string;
  status: "posted" | "voided" | "rejected";
  /** Why a bill was refused. Null on one that landed. */
  reason: string | null;
  amount: number;
  tax: number;
  businessDate: string;
  receivedAt: string;
  /** Null on a refused bill: it never reached a folio. */
  guest: string | null;
  room: string | null;
  postingId: string | null;
  voidPostingId: string | null;
  items: unknown;
}

export interface PosTickets {
  from: string;
  to: string;
  rows: PosTicket[];
}

export async function listPosTickets(
  hotelId: string, from?: string, to?: string,
): Promise<PosTickets | null> {
  if (!hotelId) return null;
  const q = from && to ? `?from=${from}&to=${to}` : "";
  return fetchOr<PosTickets | null>(
    `/api/hotels/${hotelId}/pos/tickets${q}`, null,
  );
}
