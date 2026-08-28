import { api, ApiError } from "@/lib/api";
import { property } from "../fixtures/property";
import { BUSINESS_DATE } from "./stays";

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
}

export async function listBillable(hotelId: string): Promise<BillableRow[]> {
  if (!hotelId) return [];
  return fetchOr<BillableRow[]>(`/api/hotels/${hotelId}/billable`, []);
}

export interface InvoiceSeriesState {
  prefix: string;
  next: string;
  note: string;
}

/**
 * What the next invoice number WOULD be. Nothing consumes it, and that
 * is the point — see the note on the Invoices screen.
 *
 * Still from the fixture rather than the database, because there is no
 * `invoice_series` row to read until something issues from it. Modelling
 * a counter nothing increments would suggest it is being kept.
 */
export async function getInvoiceSeries(hotelId: string): Promise<InvoiceSeriesState[]> {
  if (!hotelId) return [];
  return property.invoiceSeries.map((s) => ({
    prefix: s.prefix || "Numeric",
    next: s.prefix ? `${s.prefix}${s.next}` : String(s.next).padStart(s.pad ?? 6, "0"),
    note: s.prefix
      ? "The GST series the hotel prints today."
      : "The internal series, zero-padded.",
  }));
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
 * Rack against achieved. Rack is flat because there is no published
 * rate calendar in this system — every difference in the achieved line
 * is something a person negotiated on the day, which is exactly what a
 * revenue manager wants to see.
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
