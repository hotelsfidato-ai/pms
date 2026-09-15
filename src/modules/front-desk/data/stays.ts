import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE } from "@/data/repositories/businessDate";
import type { Stay } from "@/data/repositories/types";

/* ══════════════════════════════════════════════════════════════════
   STAYS AND FOLIOS — over HTTP, as of CP9

   Every query takes `hotelId` first. That is not ceremony while there
   is one property — it is the shape RLS already enforces, and it is
   why adding six more is a data change rather than a rewrite.

   THE FILTERING STAYS HERE, not in the API. Arrivals, in-house and
   departures are three questions about one list, and eighty-three
   rows is not a dataset worth three endpoints that can disagree with
   each other. One request, cached by TanStack, sliced three ways —
   which is exactly what the in-memory store did, so the swap changes
   the transport and nothing else.

   Folios moved WITH stays rather than after. A folio is keyed by its
   reservation id; swapping stays alone would have left the interface
   asking for postings under a uuid the store has never seen, and
   every folio would have read zero. Silently.
   ══════════════════════════════════════════════════════════════════ */

/** The business date the demo is pinned to — the Night Audit's "As On Date". */
export { BUSINESS_DATE } from "@/data/repositories/businessDate";

const clone = <T,>(rows: T[]): T[] => rows.map((r) => ({ ...r }));

/** A property the caller cannot see is empty, not an error. */
export async function fetchStays(hotelId: string): Promise<Stay[]> {
  if (!hotelId) return [];
  try {
    return await api<Stay[]>(`/api/hotels/${hotelId}/stays`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

export interface StayFilter {
  status?: Stay["status"][];
  source?: Stay["source"][];
  roomNumber?: string;
  /** Matches guest name, reference or room number, case-insensitively. */
  search?: string;
  /** Stays overlapping this range. */
  from?: string;
  to?: string;
}

export async function listStays(
  hotelId: string,
  filter: StayFilter = {},
): Promise<Stay[]> {
  let rows = await fetchStays(hotelId);

  if (filter.status?.length) rows = rows.filter((s) => filter.status!.includes(s.status));
  if (filter.source?.length) rows = rows.filter((s) => filter.source!.includes(s.source));
  if (filter.roomNumber) rows = rows.filter((s) => s.roomNumber === filter.roomNumber);

  if (filter.from) rows = rows.filter((s) => s.departure >= filter.from!);
  if (filter.to) rows = rows.filter((s) => s.arrival <= filter.to!);

  if (filter.search) {
    const q = filter.search.trim().toLowerCase();
    rows = rows.filter(
      (s) =>
        s.guest.toLowerCase().includes(q) ||
        s.reference.toLowerCase().includes(q) ||
        s.roomNumber.includes(q),
    );
  }

  return clone(rows).sort((a, b) => a.arrival.localeCompare(b.arrival));
}

export async function getStay(hotelId: string, id: string): Promise<Stay | null> {
  if (!hotelId || !id) return null;
  try {
    return await api<Stay>(`/api/hotels/${hotelId}/stays/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/* ── The front desk's three working lists ──────────────────────────
   Named for what a clerk is doing, not for a status value.        ═══ */

export async function listArrivals(hotelId: string, date = BUSINESS_DATE) {
  const rows = (await fetchStays(hotelId)).filter(
    (s) => s.arrival === date && s.status !== "cancelled",
  );
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
}

/** The arrivals STILL TO COME — the ones a desk has work left on.
 *
 *  ⚠ NOT the same question as `listArrivals`, and the group dashboard
 *  used that one to answer this one. On 5 September the property had
 *  five reservations arriving: two checked in and out again, one was
 *  in house, and two had not turned up. The dashboard's tile read
 *  "5 · arrivals due today" while the night audit, three clicks away,
 *  read "Arrivals still outstanding — 2". Both were counting; only one
 *  was counting what its label said.
 *
 *  The arrivals LIST is right to show all five — that is the day's
 *  register, and a clerk wants to see who has already come. A number
 *  labelled *due* is a different question and now has its own name.
 *
 *  `due-in` is the same set the night audit blocks on
 *  (`status = 'confirmed' and check_in = business date`, billing.ts),
 *  so the tile and the audit cannot drift apart again. */
export async function listArrivalsOutstanding(
  hotelId: string, date = BUSINESS_DATE,
) {
  return (await listArrivals(hotelId, date)).filter((s) => s.status === "due-in");
}

export async function listInHouse(hotelId: string, date = BUSINESS_DATE) {
  const rows = (await fetchStays(hotelId)).filter(
    (s) =>
      s.status !== "cancelled" &&
      !s.isDayUse &&
      s.arrival <= date &&
      s.departure > date,
  );
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
}

export async function listDepartures(hotelId: string, date = BUSINESS_DATE) {
  const rows = (await fetchStays(hotelId)).filter(
    (s) => s.departure === date && s.status !== "cancelled",
  );
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
}

/** Rooms with nobody in them tonight — what a walk-in can be given. */
export async function listVacant(hotelId: string, date = BUSINESS_DATE) {
  const taken = new Set((await listInHouse(hotelId, date)).map((s) => s.roomNumber));
  const arriving = new Set((await listArrivals(hotelId, date)).map((s) => s.roomNumber));
  return { taken, arriving };
}
