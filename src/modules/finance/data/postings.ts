import type { Posting } from "@/modules/front-desk";
import { api, ApiError } from "@/lib/api";
import { getFolio } from "./folios";
import type { ChargeCategory, PaymentMethod } from "@/lib/rules";
import type { OperationResult } from "@/data/repositories/result";
import { getStay } from "@/modules/front-desk";
import { refuse } from "@/data/repositories/result";
import { canPostCharge, canReverse } from "@/lib/rules";
import type { Permitted } from "@/data/repositories/types";
/* Folio reads, charges, reversals and settling a bill.

   Service: finance. Moved out of operations.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ── Folio reads ──────────────────────────────────────────────────── */

export async function getFolioPostings(hotelId: string, stayId: string): Promise<Posting[]> {
  if (!hotelId || !stayId) return [];
  try {
    return await api<Posting[]>(`/api/hotels/${hotelId}/stays/${stayId}/postings`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

/** What this stay owes, or null when it has no bill (FIN-2, D17-16): a
    stay nobody has billed shows the no-figure mark, never ₹0. */
export async function getFolioBalance(hotelId: string, stayId: string): Promise<number | null> {
  const folio = await getFolio(hotelId, stayId);
  return folio ? folio.balance : null;
}

/* ── B · In house → charge ────────────────────────────────────────── */

export async function postCharge(
  hotelId: string,
  stayId: string,
  input: {
    category: ChargeCategory;
    description: string;
    amount: number;
    taxable: boolean;
    businessDate: string;
  },
): Promise<OperationResult<Posting>> {
  /* The tax rate comes from the PROPERTY, server-side — `taxOn()` in
     src/lib/rules.ts still shows the clerk what will be charged, but
     the figure that lands in the ledger is computed where the rate
     lives. GST is a state subject; a constant in the browser is the
     wrong place for it. */
  /* The browser's copy of the rule answers instantly and without a
     round trip. It is not the enforcement — the server refuses too —
     but a clerk should not wait on the network to be told a closed
     folio cannot take a charge. */
  const stay = await getStay(hotelId, stayId);
  if (!stay) return refuse("Reservation not found.");
  const permitted = canPostCharge(stay);
  if (!permitted.allowed) return refuse(permitted.reason!);
  if (!input.description.trim()) return refuse("A charge needs a description.");
  if (input.amount === 0) return refuse("A charge of zero is not a charge.");

  try {
    await api(`/api/hotels/${hotelId}/stays/${stayId}/charges`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  const posting = (await getFolioPostings(hotelId, stayId)).at(-1);
  return posting ? { ok: true, data: posting } : { ok: true };
}

export async function reverseChargeAllowed(
  hotelId: string, stayId: string, postingId: string,
): Promise<Permitted> {
  /* Reads the same postings the reversal will act on. A gate that
     consults a different source from the action it guards is not a
     gate — see MEMORY.md 14. */
  const posting = (await getFolioPostings(hotelId, stayId)).find((p) => p.id === postingId);
  if (!posting) return { allowed: false, reason: "Posting not found." };
  return canReverse({ reversed: posting.reversed, isReversal: posting.kind === "reversal" });
}

export async function reverseCharge(
  hotelId: string, stayId: string, postingId: string,
): Promise<OperationResult<Posting>> {
  /* The reversal is a NEW row. Nothing is edited and nothing is
     deleted, so the posting count goes UP when something is undone —
     which is the opposite of what most people expect and exactly what
     makes the ledger auditable. */
  try {
    await api(
      `/api/hotels/${hotelId}/stays/${stayId}/charges/${postingId}/reverse`,
      { method: "POST" },
    );
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  const reversal = (await getFolioPostings(hotelId, stayId)).at(-1);
  return reversal ? { ok: true, data: reversal } : { ok: true };
}

export async function settle(
  hotelId: string,
  stayId: string,
  input: {
    method: PaymentMethod; amount: number; businessDate: string;
    /** D25-40: more than ₹1,00,000 in cash at once needs one of these. */
    pan?: string; form97?: boolean;
  },
): Promise<OperationResult<Posting>> {
  try {
    await api(`/api/hotels/${hotelId}/stays/${stayId}/payments`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  const posting = (await getFolioPostings(hotelId, stayId)).at(-1);
  return posting ? { ok: true, data: posting } : { ok: true };
}
