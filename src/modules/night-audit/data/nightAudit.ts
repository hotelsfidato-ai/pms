import { fetchOr, write, put } from "@/data/repositories/http";
import { dateShort } from "@/lib/format";
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
  /** The hotel's own today, and when the last audit finished: the window
      before Run shows both (D27-389). Absent from a server before it. */
  calendarDate?: string | null;
  lastCompletedAt?: string | null;
  /** The 16 hours, for this person: null when they do not apply. */
  early?: EarlyAudit | null;
}

/** Today closed under 16 hours after the last audit (D27-389): the owner or
    an Admin give a reason; the GM is warned and gives one; anyone else is
    refused. */
export interface EarlyAudit {
  lastAt: string;
  /** "23:36 on 1 Nov", by the hotel's clock. */
  lastClock: string;
  hours: number;
  may: "reason" | "warning" | "refused";
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
  /** How many corrections the day has had (D24-6); the record above stays
      as the audit made it. Absent from a list cached before 24 September. */
  corrections?: number;
  /** Room revenue after the day's corrections; null where no room charge
      was corrected. */
  correctedRevenue?: number | null;
  /** Why it closed under 16 hours after the last audit, and who said so
      (D27-389); null for an audit that waited. */
  earlyReason?: string | null;
  earlyBy?: string | null;
}

/* ── Cancelling night audits (D27-390) ───────────────────────────── */

/** What a cancel back to `backTo` would do - the server's dry run, the same
    function that does it - or why it is refused. */
export interface AuditUndo {
  ok: boolean;
  refusal: string | null;
  /** The group's setting: back to any closed day, or the latest only. */
  mode: "any_date" | "one_at_a_time";
  /** The closed days it can go back to, newest first. */
  days: string[];
  latest: string | null;
  backTo: string | null;
  audits: Array<{
    businessDate: string; completedAt: string; ranBy: string | null;
    roomsPosted: number | null; revenuePosted: number | null; noShows: number | null;
  }>;
  chargesReversed: number;
  chargesTotal: number;
  noShowsRestored: number;
  /** What moves back to `backTo`, by the day it is on now. */
  moves: Array<{ table: string; what: string; byDay: Record<string, number> }>;
}

export interface AuditUndoDone extends AuditUndo {
  businessDate: string;
  roomsHeldAgain: number;
  /** Bookings whose room somebody else holds now: named, not moved. */
  roomsNotHeld: string[];
}

/** One cancel, kept: the Night audit screen's history. */
export interface AuditUndoRecord {
  id: string;
  backTo: string;
  lastDay: string;
  reason: string;
  undoneBy: string | null;
  undoneAt: string;
  audits: number;
}

export async function getAuditUndo(hotelId: string, to?: string): Promise<AuditUndo> {
  return api<AuditUndo>(`/api/hotels/${hotelId}/night-audit/undo${to ? `?to=${to}` : ""}`);
}

export async function undoAudits(hotelId: string, backTo: string, reason: string) {
  return write<AuditUndoDone>(`/api/hotels/${hotelId}/night-audit/undo`, { backTo, reason });
}

export async function setUndoMode(hotelId: string, mode: AuditUndo["mode"]) {
  return put<{ mode: AuditUndo["mode"] }>(`/api/hotels/${hotelId}/night-audit/undo-mode`, { mode });
}

export async function listUndos(hotelId: string): Promise<AuditUndoRecord[]> {
  if (!hotelId) return [];
  return fetchOr<AuditUndoRecord[]>(`/api/hotels/${hotelId}/night-audit/undos`, []);
}

/** What Tally needs after a cancel (the owner's D27-390): the days whose
    audits it undid - closed before it, so possibly exported - deleted there
    and exported again once closed again. The PMS keeps no record of an
    export, so it says "if". One sentence, for the cancel and the export card. */
export const tallyDays = (first: string, last: string) =>
  first === last
    ? `Tally: if ${dateShort(first)} was already imported into Tally, delete that day there and export it again once it is closed again.`
    : `Tally: if ${dateShort(first)} to ${dateShort(last)} were already imported into Tally, delete those days there and export them again once each is closed again.`;

/** The days this property has closed, newest first (the last 60). */
export async function listClosedDays(hotelId: string): Promise<ClosedDay[]> {
  if (!hotelId) return [];
  return fetchOr<ClosedDay[]>(`/api/hotels/${hotelId}/night-audit/runs`, []);
}

/* ── Correcting a closed day (D22-18; D24-1 to D24-8, D25-5 to D25-9) ── */

/** A charge still standing on a closed day (D25-5). */
export interface DayCharge {
  id: string;
  description: string;
  /** "room", "no-show", "restaurant" (a restaurant bill charged to the
      room), or the bill's own category: "minibar", "laundry", "misc"... */
  kind: string;
  guest: string | null;
  amount: number;
  tax: number;
  /** The tax invoice standing on its bill: that bill is corrected by a
      credit note, not here (D24-4). */
  invoice: string | null;
  /** The VAT bill standing on a drinks line's bill: it is cancelled
      instead (D25-7). */
  vatBill: string | null;
}

export interface DayCorrection {
  id: string;
  description: string;
  oldAmount: number;
  /** 0: the charge was taken off. */
  newAmount: number;
  reason: string;
  by: string | null;
  at: string;
}

export async function getClosedDay(
  hotelId: string, day: string,
): Promise<{ charges: DayCharge[]; corrections: DayCorrection[] }> {
  return api(`/api/hotels/${hotelId}/night-audit/days/${day}/charges`);
}

/** `newAmount` 0 takes the charge off. A refusal comes back as the server's
    sentence. */
export async function correctClosedDay(
  hotelId: string, day: string,
  correction: { postingId: string; newAmount: number; reason: string },
) {
  return write<{ id: string }>(`/api/hotels/${hotelId}/night-audit/days/${day}/corrections`, correction);
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
    /** Dishes struck after the kitchen had them, with who and why
        (D27-119, the owner's answer of 28 September). */
    struck?: Array<{
      orderNo: string; table: string | null; name: string; qty: number;
      value: number; reason: string | null; by: string | null; at: string;
    }>;
    /** Paid bills voided that day (D27-324), left out of the figures
        above: who, when, why and how much. */
    voided?: Array<{
      orderNo: string; outlet: string; amount: number; method: string | null;
      reason: string; reference: string | null; by: string | null; at: string;
    }>;
    /** Bills given free, NC (D27-351): who, when and why - no value. */
    noCharge?: Array<{
      orderNo: string; table: string | null; outlet: string; reason: string;
      by: string | null; at: string;
    }>;
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
export async function runNightAudit(
  hotelId: string, closing: string, reason?: string,
): Promise<NightAuditResult> {
  return api<NightAuditResult>(`/api/hotels/${hotelId}/night-audit/run`, {
    method: "POST",
    /* The reason only when the 16 hours ask for one (D27-389). */
    body: JSON.stringify({ businessDate: closing, ...(reason ? { reason } : {}) }),
  });
}
