import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE } from "./businessDate";

/* ══════════════════════════════════════════════════════════════════
   REPORT DATA — over HTTP, as of CP9e

   The aggregations behind the statutory reports. All of them are now
   SQL, and all of them share the definitions in
   `api/src/routes/statistics.ts` — so the Manager Report's PTD column
   and the Monthly Statistics grid compute the same thing rather than
   agreeing by construction.

   Two of these reports print EMPTY for this property, and that is the
   correct output. A no-show report with no rows means nobody failed to
   arrive, which is worth printing.
   ══════════════════════════════════════════════════════════════════ */

const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

async function fetchOr<T>(path: string, empty: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return empty;
    throw error;
  }
}

/* ── No show ─────────────────────────────────────────────────────── */

export interface NoShowRow {
  reference: string;
  guest: string;
  roomType: string;
  arrival: string;
  departure: string;
  source: string;
  rate: number;
}

export async function getNoShowReport(
  hotelId: string,
  from = "2026-08-01",
  to = BUSINESS_DATE,
): Promise<NoShowRow[]> {
  if (!hotelId) return [];
  return fetchOr<NoShowRow[]>(
    `/api/hotels/${hotelId}/reports/no-show?${range(from, to)}`,
    [],
  );
}

/* ── City ledger ─────────────────────────────────────────────────── */

export interface CityLedgerRow {
  account: string;
  contact: string;
  phone: string | null;
  opening: number | null;
  debit: number;
  credit: number;
  closing: number | null;
}

/**
 * One row per booking source that carries a balance. Several are
 * legitimately NEGATIVE — the OTA is in credit, having paid ahead of
 * what it has been charged. Shown as it is rather than flattened.
 */
export async function getCityLedger(
  hotelId: string,
  from = "2026-08-01",
  to = BUSINESS_DATE,
): Promise<CityLedgerRow[]> {
  if (!hotelId) return [];
  return fetchOr<CityLedgerRow[]>(
    `/api/hotels/${hotelId}/reports/city-ledger?${range(from, to)}`,
    [],
  );
}

/* ── Monthly and yearly statistics ───────────────────────────────── */

export interface MonthlyStatRow {
  date: string;
  availableRooms: number;
  nightSold: number;
  complimentary: number;
  occupancyPct: number;
  adr: number;
  revPar: number;
  pax: number;
  roomCharges: number;
  extraCharges: number;
  tax: number;
  receipt: number;
  expense: number;
}

export async function getMonthlyStatistics(
  hotelId: string,
  from = "2026-08-01",
  to = "2026-08-31",
): Promise<MonthlyStatRow[]> {
  if (!hotelId) return [];
  return fetchOr<MonthlyStatRow[]>(
    `/api/hotels/${hotelId}/statistics/monthly?${range(from, to)}`,
    [],
  );
}

export interface YearlyStatRow extends Omit<MonthlyStatRow, "date"> {
  month: string;
  monthLabel: string;
}

export async function getYearlyStatistics(
  hotelId: string,
  year = 2026,
): Promise<YearlyStatRow[]> {
  if (!hotelId) return [];
  return fetchOr<YearlyStatRow[]>(
    `/api/hotels/${hotelId}/statistics/yearly?year=${year}`,
    [],
  );
}

/* ── Lodging tax ─────────────────────────────────────────────────── */

export interface LodgingTaxRow {
  date: string;
  fromBill: string;
  toBill: string;
  totalBill: number;
  totalRoomRent: number;
  nonTaxable: number;
  cgstNet: number;
  cgstTax: number;
  sgstNet: number;
  sgstTax: number;
  serviceCharges: number;
  otherBills: number;
  lessDiscount: number;
  roundOff: number;
}

/**
 * CGST and SGST are half the total each, by statute. The ledger holds
 * ONE tax figure and the report splits it — two columns that must
 * always be equal are two chances to disagree.
 */
export async function getLodgingTax(
  hotelId: string,
  from = "2026-08-01",
  to = BUSINESS_DATE,
): Promise<LodgingTaxRow[]> {
  if (!hotelId) return [];
  return fetchOr<LodgingTaxRow[]>(
    `/api/hotels/${hotelId}/reports/lodging-tax?${range(from, to)}`,
    [],
  );
}

/** The name printed at the head of every report. */
/* `REPORT_PROPERTY = property.name` lived here and had no callers.
   Every report reads the property from the API it already calls. */

/* ══════════════════════════════════════════════════════════════════
   THE FOUR REPORTS THAT WERE LISTED AND NEVER BUILT

   Each one appeared on the reports index with a `stage:` note instead
   of a path. Two of those notes were conditions, and both are met:

     "needs the invoice series to be live first"   Stage 8
     "needs passport capture at check-in"          Phase 1 item 1
   ══════════════════════════════════════════════════════════════════ */

export interface GuestLedgerRow {
  folioId: string;
  reference: string;
  guest: string;
  room: string;
  status: string;
  /** The balance strictly BEFORE the window opened. */
  opening: number;
  charges: number;
  payments: number;
  closing: number;
}

export interface GuestLedger {
  from: string;
  to: string;
  rows: GuestLedgerRow[];
}

export async function getGuestLedger(
  hotelId: string, from: string, to: string,
): Promise<GuestLedger | null> {
  if (!hotelId) return null;
  return fetchOr<GuestLedger | null>(
    `/api/hotels/${hotelId}/reports/guest-ledger?from=${from}&to=${to}`, null,
  );
}

export interface CashierShiftRow {
  staffId: string | null;
  /** Null where the posting predates staff attribution. Not "System". */
  cashier: string | null;
  method: string;
  count: number;
  amount: number;
}

export interface CashierShift {
  from: string;
  to: string;
  rows: CashierShiftRow[];
}

export async function getCashierShift(
  hotelId: string, from: string, to: string,
): Promise<CashierShift | null> {
  if (!hotelId) return null;
  return fetchOr<CashierShift | null>(
    `/api/hotels/${hotelId}/reports/cashier-shift?from=${from}&to=${to}`, null,
  );
}

export interface GstSalesRow {
  number: string;
  issued: string;
  recipient: string | null;
  gstin: string | null;
  placeOfSupply: string | null;
  sac: string;
  taxable: number;
  cgst: number;
  sgst: number;
  total: number;
  /** Set on a credit note: the invoice it cancels. */
  creditsInvoice: string | null;
}

export interface GstSales {
  from: string;
  to: string;
  rows: GstSalesRow[];
}

export async function getGstSales(
  hotelId: string, from: string, to: string,
): Promise<GstSales | null> {
  if (!hotelId) return null;
  return fetchOr<GstSales | null>(
    `/api/hotels/${hotelId}/reports/gst-sales?from=${from}&to=${to}`, null,
  );
}

export interface CFormRow {
  guest: string;
  nationality: string;
  /** Null where nothing was captured — shown, not hidden. */
  passport: string | null;
  passportExpiry: string | null;
  visaNumber: string | null;
  visaExpiry: string | null;
  address: string | null;
  room: string;
  arrived: string;
  departed: string;
  reference: string | null;
  filedAt: string | null;
}

export interface CFormReport {
  from: string;
  to: string;
  /** The API says this in its own body. It is not decoration. */
  note: string;
  rows: CFormRow[];
}

export async function getCForm(
  hotelId: string, from: string, to: string,
): Promise<CFormReport | null> {
  if (!hotelId) return null;
  return fetchOr<CFormReport | null>(
    `/api/hotels/${hotelId}/reports/c-form?from=${from}&to=${to}`, null,
  );
}
