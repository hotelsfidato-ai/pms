import { format, formatDistanceToNow, differenceInCalendarDays } from "date-fns";

/* ── Money ─────────────────────────────────────────────────────────
   Everything in the platform is INR. Indian digit grouping (lakh /
   crore) is what the finance team reads, so we use the en-IN locale
   rather than generic thousands separators.                        */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,20,000 — the default for tables, KPIs and totals. */
export function money(value: number): string {
  return inr.format(value);
}

/** ₹1,20,000.00 — invoices and folios, where paise must be visible. */
export function moneyPrecise(value: number): string {
  return inrPrecise.format(value);
}

/** ₹1.2L / ₹4.6Cr — KPI tiles and chart axes where space is tight. */
export function moneyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(value / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(value / 1_000).toFixed(0)}K`;
  return `₹${value.toFixed(0)}`;
}

/* ── Numbers ───────────────────────────────────────────────────── */

const num = new Intl.NumberFormat("en-IN");

export function number(value: number): string {
  return num.format(value);
}

export function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** Signed delta for trend indicators: +12.4% / −3.1% */
export function delta(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/* ══════════════════════════════════════════════════════════════════
   DATES

   ⚠️ EVERY formatter here must survive bad input.

   date-fns `format()` throws `RangeError: Invalid time value` on an
   invalid date. In a table cell that throw unmounts the entire React
   tree — one user row with a missing `lastSeenAt` blanked the whole
   Users screen, which is exactly how this was found.

   A date is missing far more often than it looks:
     · `serverTimestamp()` reads back as null until the server confirms
       it, so a freshly written document has null timestamps for a moment;
     · documents written by hand in the Firebase console rarely carry
       every timestamp;
     · optional fields (`lastStayAt`, `contractEnd`) are absent by design.

   So these return a dash rather than throwing. A missing date shown as
   "—" is correct and readable; a missing date that destroys the screen
   is neither.
   ══════════════════════════════════════════════════════════════════ */

/** Shown wherever a date is absent or unparseable. */
export const NO_DATE = "—";

/** null when the value cannot become a real date. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when a value would render as a real date. */
export function isValidDate(value: string | Date | null | undefined): boolean {
  return toDate(value) !== null;
}

export function dateShort(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "d MMM yyyy") : NO_DATE;
}

export function dateCompact(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "d MMM") : NO_DATE;
}

export function dateLong(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "EEEE, d MMMM yyyy") : NO_DATE;
}

export function dateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "d MMM yyyy, h:mm a") : NO_DATE;
}

export function timeOnly(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "h:mm a") : NO_DATE;
}

export function relative(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? formatDistanceToNow(d, { addSuffix: true }) : NO_DATE;
}

/** "3 nights" — reservations are priced and read by night, not by day. */
export function nights(
  checkIn: string | Date | null | undefined,
  checkOut: string | Date | null | undefined,
): number {
  const from = toDate(checkIn);
  const to = toDate(checkOut);
  // 0 rather than NaN — NaN propagates into every total downstream.
  return from && to ? differenceInCalendarDays(to, from) : 0;
}

export function nightsLabel(checkIn: string | Date, checkOut: string | Date): string {
  const n = nights(checkIn, checkOut);
  return `${n} ${n === 1 ? "night" : "nights"}`;
}

/** ISO date (yyyy-MM-dd) — the storage format for all date-only fields. */
export function isoDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "yyyy-MM-dd") : "";
}

/* ── Text ──────────────────────────────────────────────────────── */

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** +91 98765 43210 */
export function phone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return value;
}

/** Title-cases a slug or SCREAMING_CASE enum for display. */
export function humanise(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
