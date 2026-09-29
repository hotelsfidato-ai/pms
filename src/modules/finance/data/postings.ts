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

/** A line as the Bill tab reads it: the core's Posting, and why Edit is off
    for it before anybody types (D27-157) - its day closed by the night
    audit, or the tax invoice standing on its bill. */
export type BillLine = Posting & { dayClosed?: boolean; invoice?: string | null };

export async function getFolioPostings(hotelId: string, stayId: string): Promise<BillLine[]> {
  if (!hotelId || !stayId) return [];
  try {
    return await api<BillLine[]>(`/api/hotels/${hotelId}/stays/${stayId}/postings`);
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
  /** One per press of Post charge, kept until it lands: a repeat posts once. */
  idempotencyKey?: string,
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
  if (!(input.amount > 0)) {
    return refuse("A charge is more than zero. To take money off a bill, reverse the charge it corrects.");
  }

  let made: { data?: { id?: string } };
  try {
    made = await api(`/api/hotels/${hotelId}/stays/${stayId}/charges`, {
      method: "POST",
      body: JSON.stringify(input),
      ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  /* THE LINE THAT WAS STORED, by its id - what the toast names (QA FI-11).
     The last line of the list is another bill's on a split stay. */
  const posting = (await getFolioPostings(hotelId, stayId)).find((p) => p.id === made.data?.id);
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
  /** D27-117: required - the server refuses a reversal without one. */
  reason: string,
): Promise<OperationResult<Posting>> {
  /* The reversal is a NEW row. Nothing is edited and nothing is
     deleted, so the posting count goes UP when something is undone —
     which is the opposite of what most people expect and exactly what
     makes the ledger auditable. */
  try {
    await api(
      `/api/hotels/${hotelId}/stays/${stayId}/charges/${postingId}/reverse`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  const reversal = (await getFolioPostings(hotelId, stayId)).at(-1);
  return reversal ? { ok: true, data: reversal } : { ok: true };
}

/** EDIT A CHARGE (the owner's D27-157): its price, its words, or both, with a
    reason. The server reverses the old line and posts the corrected one in
    one step, and says no - with the sentence - where it may not. */
export async function editCharge(
  hotelId: string, stayId: string, postingId: string,
  edit: { description: string; amount: number; reason: string },
): Promise<OperationResult> {
  try {
    await api(`/api/hotels/${hotelId}/stays/${stayId}/charges/${postingId}/edit`,
      { method: "POST", body: JSON.stringify(edit) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }
}

export async function settle(
  hotelId: string,
  stayId: string,
  input: {
    method: PaymentMethod; amount: number; businessDate: string;
    /** D25-40: more than ₹1,00,000 in cash at once needs one of these. */
    pan?: string; form97?: boolean;
    /** D27-4: the desk confirmed a payment larger than the bill. */
    heldAsCredit?: boolean;
    /** Which bill, when the stay's is split (QA FI-2). */
    folioId?: string;
  },
  /** One per press of Take payment, kept until it lands. */
  idempotencyKey?: string,
): Promise<OperationResult<Posting>> {
  try {
    await api(`/api/hotels/${hotelId}/stays/${stayId}/payments`, {
      method: "POST",
      body: JSON.stringify(input),
      ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  const posting = (await getFolioPostings(hotelId, stayId)).at(-1);
  return posting ? { ok: true, data: posting } : { ok: true };
}
