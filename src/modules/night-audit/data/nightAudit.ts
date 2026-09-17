import { fetchOr } from "@/data/repositories/http";
import { BUSINESS_DATE } from "@/data/repositories/businessDate";
import { api } from "@/lib/api";
/* The night audit.

   Service: night-audit. Moved out of billing.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

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

/** What one closed day's night audit did — a line of the history
    (D17-13), and what a second press of Run is shown (D17-12). A figure
    the record does not hold is null, and is shown as a dash. */
export interface ClosedDay {
  businessDate: string;
  /** null where nobody was recorded (every run before 17 September). */
  ranBy: string | null;
  startedAt: string;
  completedAt: string | null;
  roomsPosted: number | null;
  /** The room charges the audit posted, before tax. */
  revenuePosted: number | null;
  noShows: number | null;
}

/** The days this property has closed, newest first (the last 60). */
export async function listClosedDays(hotelId: string): Promise<ClosedDay[]> {
  if (!hotelId) return [];
  return fetchOr<ClosedDay[]>(`/api/hotels/${hotelId}/night-audit/runs`, []);
}

/** What one completed audit did. */
export interface NightAuditResult {
  ok: boolean;
  reason?: string;
  businessDate: string;
  nextBusinessDate?: string;
  /** The day named was already closed: nothing was run, and `record` is
      what that audit did (D17-12). Arrives as a refusal (409). */
  alreadyClosed?: boolean;
  record?: ClosedDay;
  roomsPosted?: number;
  revenuePosted?: number;
  complimentary?: number;
  noShows?: number;
  retentionCharged?: number;
  noShowsWithoutTerms?: number;
  blockers?: Array<{ id: string; reason: string; rooms: string[] }>;

  /** The restaurant's day, READ from settled orders — the audit does
      not post a single line of it. The money is already on the ledger;
      a second copy would double the day. */
  restaurant?: {
    orders: number;
    covers: number;
    net: number;
    tax: number;
    gross: number;
    byTender: Array<{ method: string; amount: number }>;
  };

  /** TWO drawers, and they are never added together. The front desk
      takes deposits and settles folios; the till takes money for food.
      Different people count them, and a variance in one says nothing
      about the other. */
  drawers?: {
    frontDesk: { shifts: number; opening: number; counted: number; variances: number };
    till: { outlets: number; opening: number; counted: number; variances: number };
  };
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
 *
 * `closing` is the day the screen SAYS it is closing, and it is required.
 * A day already closed changes nothing and comes back with the record
 * that was made (NA-2, D17-12); a day the property is not on is refused.
 * Without it the server would close whatever day it is on — which, for a
 * screen that did not see the day close on another device, is tomorrow.
 */
export async function runNightAudit(hotelId: string, closing: string): Promise<NightAuditResult> {
  return api<NightAuditResult>(`/api/hotels/${hotelId}/night-audit/run`, {
    method: "POST",
    body: JSON.stringify({ businessDate: closing }),
  });
}
