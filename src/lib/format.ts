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
/** "3 bottles + 420 ml" for what is poured, "12 cans" for what is not
    (the bar's stock, D27-354): full ones, then the ml of the next. */
export function bottlesAndMl(quantity: number, unit: string, sizeMl: number | null | undefined): string {
  const plural = (n: number, u: string) => `${n} ${u}${n === 1 || u.endsWith("s") ? "" : "s"}`;
  if (!sizeMl) return plural(Math.round(quantity * 1000) / 1000, unit);
  const whole = Math.floor(quantity + 1e-9);
  const ml = Math.round((quantity - whole) * sizeMl);
  return ml > 0 ? `${plural(whole, unit)} + ${ml} ml` : plural(whole, unit);
}

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
export const NO_DATE = "-";

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

/* ══════════════════════════════════════════════════════════════════
   A DAY FORWARD OR BACK, ON A "YYYY-MM-DD" STRING — the same answer in
   every time zone

   ⚠ WRITTEN 21 SEPTEMBER, BECAUSE THE BANQUET DIARY HAD ITS OWN COPY AND
   IT WAS WRONG IN INDIA. It built LOCAL midnight — `new Date(iso +
   "T00:00:00")` — moved it with the local `setDate`, and read it back
   with `toISOString()`, which answers in UTC. In India midnight on the
   20th IS 18:30 on the 19th in UTC, so every step came back one day
   short: "From today" covered 29 days, and every Earlier or Later moved
   the window a day less than it said and let it creep.

   Nothing caught it because every gate ran in UTC, where local and UTC
   are the same clock and the bug cannot happen at all. The browser at the
   desk runs in IST. `format.test.ts` now pins this in Asia/Kolkata.

   This version never leaves UTC: UTC midnight, UTC setters, read back in
   UTC. Four services already carry a correct private copy of exactly this
   (stay view, move room, the rate grids, new booking); they are right and
   were left alone. Banquet uses this one. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

/* ── Dates on reports (the owner's D17-77) ─────────────────────────
   Reports print dates as eZee does: 25/08/2026, and a moment as
   25/08/2026 04:12:43 PM in the PROPERTY's time, on screen, in the PDF
   and in the spreadsheet. The server's renderer (api/src/reportRender.ts)
   keeps its own copy, because the API never imports web code;
   api/test/reportFiles.test.ts holds the two to the same answers.

   No date-fns here, and no `new Date("2026-08-25")`: a calendar date has
   no time zone, and parsing one as midnight UTC prints the day before
   anywhere west of Greenwich. */

/** "2026-08-25" -> "25/08/2026". Anything that is not a calendar date: "-". */
export function dateReport(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : NO_DATE;
}

/** An ISO moment -> "25/08/2026 04:12:43 PM" in the given time zone. */
export function dateTimeReport(value: string | Date | null | undefined, timeZone: string): string {
  const d = toDate(value);
  if (!d) return NO_DATE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod").toUpperCase()}`;
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

/* ── Amount in words ─────────────────────────────────────────────── */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
  "Ninety",
];

/** 0–99, and 0 is empty rather than "Zero" — callers compose. */
function underHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = ONES[n % 10]!;
  return o ? `${t} ${o}` : t;
}

/** 0–999. */
function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = underHundred(n % 100);
  if (!h) return rest;
  return rest ? `${ONES[h]} Hundred ${rest}` : `${ONES[h]} Hundred`;
}

/**
 * An amount written out, in INDIAN numbering, for a tax invoice.
 *
 * Not a nicety. A tax invoice states the total in words as well as
 * figures, and the words are what settles a dispute about a smudged
 * or altered figure — which is the entire reason the convention
 * exists.
 *
 * INDIAN grouping, not international: crore (10^7) and lakh (10^5),
 * so ₹1,23,45,678 is "One Crore Twenty Three Lakh Forty Five Thousand
 * Six Hundred Seventy Eight". Writing "Twelve Million" on an Indian
 * invoice is wrong in the way that gets a document sent back.
 *
 * Paise are stated separately — "and Fifty Paise" — because rounding
 * them into the rupee figure would make the words disagree with the
 * numerals beside them, and the words are the tie-breaker.
 *
 * ROUNDING. Every amount reaching here comes from Postgres `numeric(12,2)`
 * via `Number()`, so it already has exactly two decimal places and
 * `Math.round(v * 100)` is exact for it. Hand it 1.005 — three places,
 * which the database cannot produce — and you get 1.00, because the
 * float nearest 1.005 is 1.00499999999999989. That is arithmetically
 * right for the value actually held and would still be surprising, so:
 * do not do money arithmetic in JavaScript and then print the words.
 * Sum in SQL and print what came back.
 */
export function amountInWords(value: number): string {
  if (!Number.isFinite(value)) return "-";

  const negative = value < 0;
  const abs = Math.abs(value);

  /* Round to paise FIRST. `Math.round(x * 100)` on a float that is
     already the sum of other floats is where a rupee goes missing. */
  const totalPaise = Math.round(abs * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rest = rupees % 1_000;

  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));

  const rupeeWords = parts.length ? parts.join(" ") : "Zero";

  /* "One Rupee", not "One Rupees". A document that cannot manage the
     singular invites doubt about the figures on it. Same for paise. */
  const rupeeUnit = rupees === 1 ? "Rupee" : "Rupees";
  const paiseUnit = paise === 1 ? "Paisa" : "Paise";

  const words = paise
    ? `${rupeeWords} ${rupeeUnit} and ${underHundred(paise)} ${paiseUnit}`
    : `${rupeeWords} ${rupeeUnit}`;

  /* A credit note is a negative document and says so in words too. */
  return `${negative ? "Minus " : ""}${words} Only`;
}
