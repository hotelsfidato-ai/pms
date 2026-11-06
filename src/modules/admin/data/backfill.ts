import { api } from "@/lib/api";
import { call } from "@/data/repositories/http";
import type { AdminResult } from "@/data/repositories/result";

/* ══════════════════════════════════════════════════════════════════
   BACKFILL DATA - the four calls (the owner's D27-398)

   The register of what happened before the hotel's first day: stays,
   restaurant bills and cash, each added, corrected (with a reason) and
   removed (with a reason, and kept). The server decides who may and which
   days (api/src/modules/admin/backfill.ts); a refusal is its sentence, as a
   value. A figure nobody typed is null - shown as a dash, never a zero.
   ══════════════════════════════════════════════════════════════════ */

export type BackfillKind = "stays" | "bills" | "cash";

export interface Trail {
  enteredBy: string | null; enteredAt: string | null;
  changedBy: string | null; changedAt: string | null; changeReason: string | null;
  removedBy: string | null; removedAt: string | null; removedReason: string | null;
}

export interface BackfillStay extends Trail {
  id: string; guestId: string; guestName: string;
  phone: string | null; email: string | null; nationality: string;
  idType: string;
  /** Null for somebody who may not read guests' ID (the Accountant, D25-38);
      an Aadhaar is its last four (D25-37). */
  idNumber: string | null; visaNumber: string | null; formCReference: string | null;
  roomId: string; room: string; arrival: string; departure: string;
  adults: number; children: number;
  rate: number | null; roomCharges: number | null; gst: number | null;
  otherCharges: number | null; otherChargesFor: string | null;
  paid: number | null; paidBy: string | null; billNumber: string | null;
  /** The send tick, as it was when the stay was added. */
  sendBill: boolean;
  message: { status: "sent" | "failed"; at: string | null; detail: string | null } | null;
}

export interface BackfillBill extends Trail {
  id: string; outletId: string; outlet: string; billDate: string; billNumber: string | null;
  amount: number | null; gst: number | null; total: number | null; paidBy: string | null; note: string | null;
}

export interface BackfillCash extends Trail {
  id: string; cashDate: string; direction: "in" | "out"; amount: number; purpose: string; person: string;
}

export interface BackfillView {
  /** The hotel's first live day: only days before it are backfilled. */
  firstDay: string;
  today: string;
  /** The owner, an Admin or the GM; the Accountant reads only. */
  mayWrite: boolean;
  showsId: boolean;
  /** Whether the send tick can send here, and the sentence when not. */
  sending: { ok: boolean; reason: string | null };
  rooms: { id: string; number: string }[];
  outlets: { id: string; name: string }[];
  /** The hotel's payment methods, by their words. */
  methods: string[];
  stays: BackfillStay[];
  bills: BackfillBill[];
  cash: BackfillCash[];
}

const base = (hotelId: string) => `/api/hotels/${hotelId}/backfill`;

export const getBackfill = (hotelId: string) => api<BackfillView>(base(hotelId));

/** `sent`: true once the bill went, the reason when it did not, null when not ticked. */
export const addBackfill = (hotelId: string, kind: BackfillKind, body: object) =>
  call<{ id: string; sent?: true | string | null }>(`${base(hotelId)}/${kind}`, "POST", body);

export const correctBackfill = (
  hotelId: string, kind: BackfillKind, id: string, body: object & { reason: string },
): Promise<AdminResult> => call(`${base(hotelId)}/${kind}/${id}`, "PUT", body);

export const removeBackfill = (hotelId: string, kind: BackfillKind, id: string, reason: string): Promise<AdminResult> =>
  call(`${base(hotelId)}/${kind}/${id}/remove`, "POST", { reason });
