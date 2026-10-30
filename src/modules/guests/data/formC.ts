import { fetchOr } from "@/data/repositories/http";
import { api } from "@/lib/api";
/* The Form III register (Form C until the 2025 Act, D27-25).

   Service: guests. Moved out of billing.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). The address keeps
   "form-c"; the words people read say Form III. */

/* ── Form III ─────────────────────────────────────────────────────── */

export interface FormCRow {
  reservationId: string;
  /** Whose row: every foreigner on a stay has their own (D27-382). */
  guestId: string;
  /** Not the booking's lead guest: a filing and Complete details name them. */
  companion: boolean;
  guest: string;
  nationality: string;
  /** Null when no document has been recorded. Somebody has to go and ask. */
  passport: string | null;
  room: string;
  adults: number;
  /** The lead guest, and each companion with a document number on record. */
  recorded: number;
  children: number;
  /** The booking's arrival and departure dates. */
  arrived: string;
  checkOut: string;
  status: "checked_in" | "checked_out";
  /** The property's clock, "YYYY-MM-DD HH:MM"; null when not recorded. */
  arrivedAt: string | null;
  departedAt: string | null;
  /** 24 hours after each (Rule 17(5), 17(6)); departure's null while in house. */
  dueBy: string;
  departureDueBy: string | null;
  overdue: boolean;
  departureOverdue: boolean;
  /** The portal's numbers: this person's. */
  arrivalNumbers: string[];
  departureNumbers: string[];
  /** The arrival's, as the register has always answered. */
  filed: boolean;
  reference: string | null;
  /** Every other Form III and portal field, null when not recorded. */
  [field: string]: string | number | boolean | string[] | null;
}

export interface FormCRegister {
  /** The API says this in its own body. It is not decoration. */
  note: string;
  premises: { name: string; address: string | null; city: string | null;
              state: string | null; phone: string | null } | null;
  due: number;
  overdue: number;
  /** Stays in house with an adult not recorded and no row here to say so:
      the person may be a foreigner (D27-382). */
  unrecorded: { room: string; adults: number; recorded: number }[];
  rows: FormCRow[];
}

export async function getFormC(hotelId: string): Promise<FormCRegister | null> {
  if (!hotelId) return null;
  return fetchOr<FormCRegister | null>(`/api/hotels/${hotelId}/form-c`, null);
}

/** Record that a filing happened. The PMS does not file. */
export async function recordFormC(
  hotelId: string, reservationId: string, reference: string,
  kind: "arrival" | "departure" = "arrival", guestId?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return api(`/api/hotels/${hotelId}/form-c/${reservationId}`, {
    method: "POST",
    body: JSON.stringify({ reference, kind, ...(guestId ? { guestId } : {}) }),
  });
}

/** "Complete details": what check-in left blank, filled in later. */
export async function completeFormIII(
  hotelId: string, reservationId: string,
  body: { identity: Record<string, string>; visit: Record<string, string | boolean>; guestId?: string },
): Promise<{ ok: boolean; reason?: string }> {
  return api(`/api/hotels/${hotelId}/form-c/${reservationId}/details`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
