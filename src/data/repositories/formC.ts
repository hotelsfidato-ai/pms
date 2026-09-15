import { fetchOr } from "./http";
import { api } from "@/lib/api";
/* Form C, the foreign-guest register.

   Service: guests. Moved out of billing.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ── Form C ───────────────────────────────────────────────────────── */

export interface FormCRow {
  reservationId: string;
  guest: string;
  nationality: string;
  /** Null when no document has been recorded. Somebody has to go and ask. */
  passport: string | null;
  room: string;
  arrived: string;
  dueBy: string;
  overdue: boolean;
  filed: boolean;
  reference: string | null;
}

export interface FormCRegister {
  /** The API says this in its own body. It is not decoration. */
  note: string;
  due: number;
  overdue: number;
  rows: FormCRow[];
}

export async function getFormC(hotelId: string): Promise<FormCRegister | null> {
  if (!hotelId) return null;
  return fetchOr<FormCRegister | null>(`/api/hotels/${hotelId}/form-c`, null);
}

/** Record that a filing happened. The PMS does not file. */
export async function recordFormC(
  hotelId: string, reservationId: string, reference: string, notes?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return api(`/api/hotels/${hotelId}/form-c/${reservationId}`, {
    method: "POST",
    body: JSON.stringify({ reference, ...(notes ? { notes } : {}) }),
  });
}
