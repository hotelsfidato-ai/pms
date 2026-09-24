import { api, ApiError } from "@/lib/api";
import { fetchOr } from "@/data/repositories/http";

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
  /** `rate` is null when the bill's lines do not share one rate — since
      067 a single folio can hold a room at 5% beside a suite at 18%,
      and there is then no single rate the header can honestly name.
      The document shows a rate-wise summary instead. */
  cgst: { rate: number | null; amount: number };
  sgst: { rate: number | null; amount: number };
  taxTotal: number;
  total: number;
  creditsInvoiceId: string | null;
  /** The number of the invoice this note cancels. */
  creditsNumber: string | null;
  reason: string | null;
  creditedBy: string | null;
  /** D22-44: the VAT bill issued with it for the alcohol, if any. */
  vatBill?: string | null;
}

/* ── VAT bills for alcohol (D22-44) ─────────────────────────────────
   Issued beside the GST document of the same sale, from their own series,
   and cancelled like a credit note. */

export interface IssuedVatBill {
  number: string;
  recipient: string | null;
  total: number;
  vatTotal: number;
  issuedAt: string;
  isCancellation: boolean;
  cancelledBy: string | null;
}

export interface VatBillDetail {
  number: string;
  finYear: string;
  issuedAt: string;
  issuedBy: string | null;
  businessDate: string | null;
  supplier: { name: string; address: string | null; city: string | null; state: string | null };
  recipient: string | null;
  /** The GST tax invoice it was issued with, or the restaurant bill it is for. */
  invoice: string | null;
  order: string | null;
  lines: { description: string; qty: number | null; amount: number }[];
  discount: number;
  taxableValue: number;
  vatRate: number | null;
  vatTotal: number;
  total: number;
  cancelsNumber: string | null;
  reason: string | null;
  cancelledBy: string | null;
}

export async function listVatBills(hotelId: string): Promise<IssuedVatBill[]> {
  if (!hotelId) return [];
  return fetchOr<IssuedVatBill[]>(`/api/hotels/${hotelId}/vat-bills`, []);
}

export async function getVatBill(hotelId: string, number: string): Promise<VatBillDetail | null> {
  if (!hotelId || !number) return null;
  return fetchOr<VatBillDetail | null>(
    `/api/hotels/${hotelId}/vat-bills/${encodeURIComponent(number)}`, null,
  );
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
): Promise<{ ok: boolean; number?: string; vatBill?: string | null; reason?: string; duplicate?: boolean }> {
  return api(`/api/hotels/${hotelId}/stays/${stayId}/invoice`, { method: "POST" });
}

/**
 * Cancels an issued invoice by issuing a credit note against it.
 *
 * AN INVOICE IS NEVER EDITED and never deleted — a GST document that
 * changes after it was given to a guest is the one an auditor asks
 * about. The correction is its own numbered document that points back
 * at the original.
 *
 * The refusals come back as `{ ok: false, reason }` rather than as an
 * exception, because every one of them is something a person at the
 * desk has to act on: the invoice is already credited, it IS a credit
 * note, the reason is missing. Rule 6.
 */
export async function issueCreditNote(
  hotelId: string, number: string, reason: string,
): Promise<{ ok: true; number: string } | { ok: false; reason: string }> {
  return withReason(
    `/api/hotels/${hotelId}/invoices/${encodeURIComponent(number)}/credit-note`, reason);
}

/** Cancels a VAT bill the same way (D22-44): a bill of its own, from the VAT
    series, with the reason the server requires. */
export async function cancelVatBill(
  hotelId: string, number: string, reason: string,
): Promise<{ ok: true; number: string } | { ok: false; reason: string }> {
  return withReason(
    `/api/hotels/${hotelId}/vat-bills/${encodeURIComponent(number)}/cancel`, reason);
}

async function withReason(
  url: string, reason: string,
): Promise<{ ok: true; number: string } | { ok: false; reason: string }> {
  try {
    return await api(url, { method: "POST", body: JSON.stringify({ reason }) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
