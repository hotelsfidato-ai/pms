import { api, ApiError } from "@/lib/api";
import type { Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   THE APPROVALS INBOX — the owner's D18-19, 18 September

   The ENGINE has been one since migration 076, and every service decides
   through it. What did not exist was a SCREEN. Equipment decides inside
   the equipment register, purchasing inside the purchase request — both
   correctly, one engine, no second Approve button — but a GM with four
   things waiting on them had nowhere to see four things waiting on them.
   The build plan said there was such a screen. There was not.

   ⚠ THIS ADDS NO ENDPOINT AND NO SECOND ENGINE. `GET /:code/approvals`
   already answers every kind and already computes `mayDecide` and
   `blockedBecause` with the same test `app.decide_approval` applies — so
   the button and the server cannot disagree (Rule 6). This is those same
   rows, unfiltered. The service screens keep their own buttons.
   ══════════════════════════════════════════════════════════════════ */

export interface Approval {
  id: string;
  kind: string;
  subject: { table: string; id: string };
  reason: string;
  /** A STRING from the database to the screen. A JS number cannot hold
      every numeric(12,2) without loss, and this is the column where that
      matters. Null is a real answer — a stock adjustment has no amount —
      and a dash is honest where a zero would be a claim. */
  amount: string | null;
  status: string;
  approverRole: string;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The server's own answer, not this screen's guess. */
  mayDecide: boolean;
  blockedBecause?: string;
}

export interface ApprovalsAnswer {
  me: { staffId: string; role: Role };
  rows: Approval[];
}

/* What each kind is called, and where the thing itself lives. A kind with
   no entry here still SHOWS — with its own word and no link — because a
   service adding a new kind must never make a waiting request invisible. */
const KINDS: Record<string, { label: string; where?: (a: Approval, code: string) => string }> = {
  purchase: {
    label: "Purchase request",
    /* The page purchasing mounts (routes.tsx); ".../requests/<id>" matched
       nothing and the catch-all sent the approver home (PUR-3). */
    where: (a, code) => `/h/${code}/purchasing/${a.subject.id}`,
  },
  cash_expense: { label: "Cash expense" },
  stock_adjustment: { label: "Stock adjustment", where: (_a, code) => `/h/${code}/stores` },
  equipment_issue: { label: "Equipment leaving the store", where: (_a, code) => `/h/${code}/equipment` },
  equipment_retire: {
    label: "Equipment being retired",
    where: (a, code) => `/h/${code}/equipment/${a.subject.id}`,
  },
};

export const labelFor = (kind: string): string =>
  KINDS[kind]?.label ?? kind.replace(/_/g, " ");

export const whereFor = (a: Approval, code: string): string | null =>
  KINDS[a.kind]?.where?.(a, code) ?? null;

/** The roles that can decide ANYTHING, so the menu does not offer a till
    operator an inbox that is empty by construction. The SERVER still
    decides every row; this only keeps the menu honest. */
export const APPROVER_ROLES: readonly Role[] =
  ["owner", "admin", "gm", "hotel_manager", "stores"];

export const decidesSomething = (role: Role): boolean => APPROVER_ROLES.includes(role);

export const listApprovals = (hotelCode: string, status: "pending" | "all" = "pending") =>
  api<ApprovalsAnswer>(`/api/hotels/${hotelCode}/approvals?status=${status}`);

/** Approve, or refuse with a note. A refusal without one is refused by the
    SERVER, which is where that rule belongs. */
export async function decide(
  hotelCode: string, id: string, decision: "approved" | "rejected", note?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await api(`/api/hotels/${hotelCode}/approvals/${id}/${decision}`, {
      method: "POST", body: JSON.stringify(note ? { note } : {}),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const body = error.body as { reason?: string; error?: string } | undefined;
      return { ok: false, reason: body?.reason ?? body?.error ?? error.message };
    }
    throw error;
  }
}
