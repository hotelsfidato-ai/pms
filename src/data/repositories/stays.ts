import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE } from "./businessDate";
import type { Stay, Folio } from "./types";

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
export { BUSINESS_DATE } from "./businessDate";

const clone = <T,>(rows: T[]): T[] => rows.map((r) => ({ ...r }));

/** A property the caller cannot see is empty, not an error. */
async function fetchStays(hotelId: string): Promise<Stay[]> {
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

/* ── Folios ───────────────────────────────────────────────────────── */

export async function getFolio(hotelId: string, stayId: string): Promise<Folio | null> {
  if (!hotelId || !stayId) return null;
  try {
    return await api<Folio>(`/api/hotels/${hotelId}/stays/${stayId}/folio`);
  } catch (error) {
    /* An unknown stay is null, not a folio of zeros — a zeroed folio
       reads as "settled", which is the wrong answer to "does this
       guest owe anything". */
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Folios still carrying a balance — includes overpayments, which are negative. */
export async function listOpenFolios(
  hotelId: string,
): Promise<Array<Folio & { stay: Stay }>> {
  if (!hotelId) return [];

  const [folios, stays] = await Promise.all([
    api<Folio[]>(`/api/hotels/${hotelId}/folios`).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }),
    fetchStays(hotelId),
  ]);

  const byId = new Map(stays.map((s) => [s.id, s]));

  return folios
    .filter((f) => byId.has(f.stayId))
    .map((f) => ({ ...f, stay: byId.get(f.stayId)! }))
    .sort((a, b) => a.balance - b.balance);
}

/* ── Groups ───────────────────────────────────────────────────────── */

export interface StayGroup {
  id: string;
  hotelId: string;
  name: string;
  reference: string;
  rooms: number;
  arrival: string;
  departure: string;
}

export async function listGroups(hotelId: string): Promise<StayGroup[]> {
  if (!hotelId) return [];
  try {
    return await api<StayGroup[]>(`/api/hotels/${hotelId}/groups`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

export async function listGroupMembers(
  hotelId: string,
  groupId: string,
): Promise<Stay[]> {
  return clone((await fetchStays(hotelId)).filter((s) => s.groupId === groupId));
}

/* ══════════════════════════════════════════════════════════════════
   OBJECT SURFACE

   The same functions, exposed as `staysRepo`, because callers in this
   project use both conventions. One implementation, two surfaces, so
   neither style of import can fail — and there is no second copy of
   the logic to drift.
   ══════════════════════════════════════════════════════════════════ */

export const staysRepo = {
  list: listStays,
  get: getStay,
  arrivals: listArrivals,
  inHouse: listInHouse,
  departures: listDepartures,
  vacant: listVacant,
  folio: getFolio,
  openFolios: listOpenFolios,
  groups: listGroups,
  groupMembers: listGroupMembers,
};

export const stayRepo = staysRepo;
