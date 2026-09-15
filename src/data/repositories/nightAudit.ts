import { fetchOr } from "./http";
import { BUSINESS_DATE } from "./businessDate";
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
  retentionCharged?: number;
  noShowsWithoutTerms?: number;
  duplicate?: boolean;
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
 */
export async function runNightAudit(hotelId: string): Promise<NightAuditResult> {
  return api<NightAuditResult>(`/api/hotels/${hotelId}/night-audit/run`, {
    method: "POST",
  });
}
