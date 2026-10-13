import { api, ApiError } from "@/lib/api";
import type { Folio, Stay } from "@/data/repositories/types";
import { fetchStays } from "@/modules/front-desk";

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

/* ── Folios ───────────────────────────────────────────────────────── */

export async function getFolio(hotelId: string, stayId: string): Promise<Folio | null> {
  if (!hotelId || !stayId) return null;
  try {
    return await api<Folio>(`/api/hotels/${hotelId}/stays/${stayId}/folio`);
  } catch (error) {
    /* An unknown stay is null, not a folio of zeros — a zeroed folio
       reads as "settled", which is the wrong answer to "does this
       guest owe anything". Refused (403: a role that reads bookings but not
       bills, D27-143) is no figure too - the same dash, never an error. */
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}

/** Folios still carrying a balance — includes overpayments, which are negative. */
/** The groups' master bills carrying a balance (the owner's D27-226): the
    company's nights, listed once under the group, never under each guest. */
export async function listGroupBills(
  hotelId: string,
): Promise<Array<{ groupId: string; group: string | null; balance: number }>> {
  if (!hotelId) return [];
  const folios = await api<Folio[]>(`/api/hotels/${hotelId}/folios`).catch((error) => {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  });
  return folios.flatMap((f) => (f.groupId ? [{ groupId: f.groupId, group: f.group ?? null, balance: f.balance }] : []));
}

/** The open bills of `stays` - every booking unless a screen passes the
    ones it shows (the Calendar's window, D27-316 (1)): the Folios page needs
    every one, as a guest who has left can still owe. */
export async function listOpenFolios(
  hotelId: string,
  stays: Stay[] | Promise<Stay[]> = fetchStays(hotelId),
): Promise<Array<Folio & { stay: Stay }>> {
  if (!hotelId) return [];

  const [folios, ofStays] = await Promise.all([
    api<Folio[]>(`/api/hotels/${hotelId}/folios`).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }),
    stays,
  ]);

  const byId = new Map(ofStays.map((s) => [s.id, s]));

  return folios
    .filter((f) => byId.has(f.stayId))
    .map((f) => ({ ...f, stay: byId.get(f.stayId)! }))
    .sort((a, b) => a.balance - b.balance);
}
