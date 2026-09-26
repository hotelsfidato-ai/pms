import { BUSINESS_DATE, PTD_FROM } from "@/data/repositories/businessDate";
import { fetchOr } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   REPORT DATA — over HTTP, as of CP9e

   The aggregations behind the statutory reports. All of them are now
   SQL, and all of them share the definitions in
   `api/src/modules/reports/statistics.ts` — so the Manager Report's PTD column
   and the Monthly Statistics grid compute the same thing rather than
   agreeing by construction.

   Two of these reports print EMPTY for this property, and that is the
   correct output. A no-show report with no rows means nobody failed to
   arrive, which is worth printing.
   ══════════════════════════════════════════════════════════════════ */

const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;


/* ── City ledger ─────────────────────────────────────────────────── */

export interface CityLedgerRow {
  account: string;
  /** The company's contact on file; null for a channel or a walk-in. */
  contact: string | null;
  phone: string | null;
  opening: number | null;
  debit: number;
  credit: number;
  closing: number | null;
}

/**
 * Balances by booking source: every stay's charges less its payments,
 * grouped by where it came from. For finance's "Company accounts" screen
 * only. It is NOT the City ledger report, which counts bills transferred
 * to a company (the owner's decision of 17 September); whether that
 * screen should move to the transfers is finance's question.
 */
export async function getCityLedger(
  hotelId: string,
  from = PTD_FROM,
  to = BUSINESS_DATE,
): Promise<CityLedgerRow[]> {
  if (!hotelId) return [];
  return fetchOr<CityLedgerRow[]>(
    `/api/hotels/${hotelId}/reports/balances-by-source?${range(from, to)}`,
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

/** One foreign arrival in Form III's fields (the guests service's
    app.form_iii, 146). Null where nothing was recorded - shown, not hidden. */
export interface CFormRow {
  guest: string;
  nationality: string;
  passport: string | null;
  passportIssuedOn: string | null;
  passportIssuePlace: string | null;
  passportExpiry: string | null;
  visaNumber: string | null;
  visaType: string | null;
  visaIssuedOn: string | null;
  visaExpiry: string | null;
  phoneInIndia: string | null;
  mobileInIndia: string | null;
  phoneAbroad: string | null;
  mobileAbroad: string | null;
  email: string | null;
  remarks: string | null;
  arrivedFrom: string | null;
  /** The property's clock, "YYYY-MM-DD HH:MM". */
  arrivedAt: string | null;
  purpose: string | null;
  purposeOther: string | null;
  previousStay: string | null;
  departedAt: string | null;
  nextDestination: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  arrivedInIndiaOn: string | null;
  arrivalPort: string | null;
  address: string | null;
  refAddress: string | null;
  employedInIndia: string | null;
  room: string;
  arrived: string;
  departed: string;
  /** The portal's numbers, arrival and departure, comma-separated. */
  reference: string | null;
  departureReference: string | null;
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
