import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE } from "./businessDate";
import { fetchOr } from "./http";
/* ══════════════════════════════════════════════════════════════════
   DIRECTORY — over HTTP, as of CP9e

   Guests, companies, staff, the audit trail, and what the property is
   configured as.

   Two things here are still NOT from the database, and both are
   deliberate rather than unfinished:

     · The ROLE MATRIX is `src/lib/permissions.ts`. It is the single
       source the navigation, every disabled button and the API all
       read. Serving it over HTTP would make it two sources.

     · INTEGRATION STATUS is a statement about the PROJECT, not about
       a hotel. There is no table for it because there is nothing to
       store: STAAH is quoted, Sattva is live in eZee, the CRS runs 32
       properties. Those are facts about a plan.
   ══════════════════════════════════════════════════════════════════ */


/* ── Guests ──────────────────────────────────────────────────────── */

export interface GuestRecord {
  id: string;
  name: string;
  stays: number;
  nights: number;
  /** Latest departure that has already happened. */
  lastStay: string | null;
  /** Earliest arrival still ahead — a returning guest. */
  nextStay: string | null;
  totalSpend: number;
  openBalance: number;
  sources: string[];
  /**
   * Two stays under one name that OVERLAP. Either these are two people
   * sharing a name — in which case grouping them is wrong — or
   * something was entered twice. A guest who simply booked through
   * Agoda once and walked in the next month is NOT flagged: that is one
   * guest behaving normally, and a warning that fires on half the list
   * is a warning nobody reads.
   */
  possibleDuplicate: boolean;
}

export async function listGuests(hotelId: string): Promise<GuestRecord[]> {
  if (!hotelId) return [];
  return fetchOr<GuestRecord[]>(
    `/api/hotels/${hotelId}/guests?asOn=${BUSINESS_DATE}`,
    [],
  );
}

/* ── Companies ───────────────────────────────────────────────────── */

export interface CompanyRecord {
  id: string;
  name: string;
  kind: "OTA" | "Direct" | "Corporate";
  bookings: number;
  roomNights: number;
  revenue: number;
  openBalance: number;
  /** OTA commission is charged outside the PMS today. */
  commissionPct: number | null;
}

export async function listCompanies(hotelId: string): Promise<CompanyRecord[]> {
  if (!hotelId) return [];
  return fetchOr<CompanyRecord[]>(`/api/hotels/${hotelId}/companies`, []);
}

/**
 * Marks a guest as a VIP, or unmarks them.
 *
 * IT TRAVELS WITH THE GUEST, not the booking — somebody who is a VIP
 * this visit was one last visit, which is why `is_vip` sits on
 * `guests`. Marking them on one stay marks them on the next.
 *
 * The column has been readable since 043 and writable by nothing:
 * half a feature, with the visible half the wrong half.
 */
export async function setGuestVip(
  hotelId: string, guestId: string, isVip: boolean,
): Promise<{ ok: true; guest: string } | { ok: false; reason: string }> {
  try {
    return await api(`/api/hotels/${hotelId}/guests/${guestId}/vip`, {
      method: "POST", body: JSON.stringify({ isVip }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
