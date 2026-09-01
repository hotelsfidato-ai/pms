import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   SPLIT BILLING

   Migration 006 modelled two folios on one stay from the start — "a
   company pays the room while the guest pays their own bar tab" — and
   nothing ever used it. `bill_to` and `company_id` were columns no code
   had written, so the commonest corporate arrangement in an Indian
   hotel could not be expressed.

   A transfer is a REVERSAL plus a fresh posting, never an edit. The
   ledger is append-only and a folio may already have been invoiced.
   ══════════════════════════════════════════════════════════════════ */

export interface StayFolio {
  id: string;
  billTo: string;
  companyId: string | null;
  /** Null is a guest folio, not a missing name — the schema refuses a
      company folio with no company. */
  company: string | null;
  status: string;
  balance: number;
  lines: number;
}

export async function listStayFolios(
  hotelId: string, stayId: string,
): Promise<StayFolio[]> {
  if (!hotelId || !stayId) return [];
  return await api<StayFolio[]>(
    `/api/hotels/${hotelId}/stays/${stayId}/folios`,
  );
}

export async function openFolio(
  hotelId: string, stayId: string,
  input: { billTo: "guest" | "company"; companyId?: string },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    return await api(`/api/hotels/${hotelId}/stays/${stayId}/folios`, {
      method: "POST", body: JSON.stringify(input),
    });
  } catch (e) {
    return {
      ok: false as const,
      reason: e instanceof Error ? e.message : "The folio was not opened.",
    };
  }
}

export async function transferPosting(
  hotelId: string, postingId: string, toFolioId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    return await api(`/api/hotels/${hotelId}/postings/${postingId}/transfer`, {
      method: "POST", body: JSON.stringify({ toFolioId }),
    });
  } catch (e) {
    return {
      ok: false as const,
      reason: e instanceof Error ? e.message : "The charge was not moved.",
    };
  }
}

/** Companies a bill can be addressed to — real rows, real uuids. */
export interface BillingCompany {
  id: string;
  name: string;
  gstin: string | null;
}

export async function listBillingCompanies(
  hotelId: string,
): Promise<BillingCompany[]> {
  if (!hotelId) return [];
  return await api<BillingCompany[]>(
    `/api/hotels/${hotelId}/billing-companies`,
  );
}
