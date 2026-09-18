import { api } from "@/lib/api";
/* What a property still needs before it opens.

   Service: admin. Moved out of roomSetup.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ══════════════════════════════════════════════════════════════════
   WHAT A PROPERTY STILL NEEDS

   Every line is DERIVED. Nothing is ticked off by hand and there is no
   "setup complete" flag to go stale — each check asks the database the
   same question the feature it guards asks, so a property that says it
   can take a booking can take one.

   `canTakeABooking` is a boolean, not a percentage. "80% ready" invites
   somebody to open on the strength of a number that says nothing about
   which fifth is missing, and here the missing fifth is usually the tax
   number that prints on every bill.
   ══════════════════════════════════════════════════════════════════ */

export interface CommissioningCheck {
  id: string;
  label: string;
  done: boolean;
  /** What is missing, in words somebody can act on. Null when done. */
  detail: string | null;
  blocking: boolean;
  /** Where to fix it, relative to the property. */
  to: string | null;
}

export interface Commissioning {
  property: string;
  checks: CommissioningCheck[];
  done: number;
  total: number;
  canTakeABooking: boolean;
  blockedBy: string[];
}

export async function getCommissioning(
  hotelId: string,
): Promise<Commissioning | null> {
  if (!hotelId) return null;
  try {
    return await api<Commissioning>(`/api/hotels/${hotelId}/commissioning`);
  } catch {
    return null;
  }
}
