import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   SYSTEM HEALTH (the owner's D27-91 and D27-92, 28 September)

   What the server is doing, from its own records: its version and
   uptime, the database, the disk, the requests of the last hour, day and
   week, each hotel's business date and last night audit, and the last
   nightly backup. The owner and an administrator only; the server refuses
   anybody else (api/src/modules/admin/systemHealth.ts).
   ══════════════════════════════════════════════════════════════════ */

export interface TrafficSlot {
  requests: number;
  errors: number;
  /** The step 95 in 100 answered within, in ms; null for no requests, -1 for over 10 s. */
  p95Ms: number | null;
}

export interface Traffic extends TrafficSlot {
  /** Oldest first: 12 five-minute slots, 24 hours, or 28 quarter-days. */
  series: TrafficSlot[];
}

export interface SystemHealth {
  /** The git commit the API is running, or "-". */
  version: string;
  startedAt: string;
  uptimeSeconds: number;
  pool: { inUse: number; waiting: number; max: number };
  disk: { freeBytes: number; totalBytes: number } | null;
  backup: {
    state: "passed" | "failed" | "unknown" | "none" | "unreadable";
    at: string | null;
    offsite: "copied" | "failed" | "this disk only" | null;
  };
  databaseBytes: number;
  traffic: { hour: Traffic; day: Traffic; week: Traffic };
  slowest: { method: string; route: string; requests: number; avgMs: number; maxMs: number }[];
  errors: { place: string; what: string; count: number; last: string }[];
  slowQueries: { what: string; count: number; maxMs: number | null; last: string }[];
  hotels: {
    code: string; name: string; businessDate: string; today: string;
    lastAuditAt: string | null; lastRun: string | null;
  }[];
}

export function getSystemHealth(hotelCode: string): Promise<SystemHealth> {
  return api<SystemHealth>(`/api/hotels/${hotelCode}/system-health`);
}

/** How far behind a hotel's day is (the owner, 28 September): today is up to
    date; yesterday is normal until the night audit runs, so amber; two days
    or more is red. Both dates are the hotel's own, from the server. */
export function auditLag(businessDate: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(businessDate)) / 86_400_000);
}
