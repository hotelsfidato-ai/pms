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

   ⚠ EIGHTY-THREE BECAME 793 (the day check, 13 October): every booking
   ever made, ~3.5 s, read on every check-in and every payment's refresh.
   The three desk lists now ask the same endpoint for `from`/`to` - only
   who is checked in and who arrives that day (D27-313) - and still slice
   here; the full list is `listStays`, for the screens that need it.

   Folios moved WITH stays rather than after. A folio is keyed by its
   reservation id; swapping stays alone would have left the interface
   asking for postings under a uuid the store has never seen, and
   every folio would have read zero. Silently.
   ══════════════════════════════════════════════════════════════════ */

/** The business date the demo is pinned to — the Night Audit's "As On Date". */
export { BUSINESS_DATE } from "@/data/repositories/businessDate";

const clone = <T,>(rows: T[]): T[] => rows.map((r) => ({ ...r }));

/** A property the caller cannot see is empty, not an error. With `from`
    (D27-313): only the bookings checked in now and those arriving from..to,
    `to` defaulting to `from` - the desk's lists, not every booking ever made
    (793 and ~3.5 s on the demo, read on every check-in). With `board` too
    (D27-316): every booking with a day in from..to, whoever is checked in, and
    the bookings still to arrive that hold a room - what Rooms, the Calendar and
    the Dashboard draw. */
export async function fetchStays(hotelId: string, from?: string, to = from, board = false): Promise<Stay[]> {
  if (!hotelId) return [];
  try {
    return await api<Stay[]>(`/api/hotels/${hotelId}/stays${from ? `?from=${from}&to=${to}${board ? "&board=1" : ""}` : ""}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

/** A bounded read by its own question (D27-387): `owing=1`, the stays whose
    bill carries a balance; `source=`, the bookings of one source. */
export async function fetchStaysWhere(hotelId: string, query: string): Promise<Stay[]> {
  if (!hotelId) return [];
  try {
    return await api<Stay[]>(`/api/hotels/${hotelId}/stays?${query}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

/** One room on the business date, by the one rule (D21-36, D21-37). */
export interface HouseNowRoom {
  number: string;
  /** A checked-in guest is in it now, whatever their departure date. */
  inHouse: boolean;
  /** A block covers tonight. */
  outOfOrder: boolean;
  /** Neither: nobody in it and sellable tonight. */
  empty: boolean;
}

export interface HouseNow {
  rooms: HouseNowRoom[];
  /** Rooms, both. */
  inHouse: number;
  empty: number;
}

/**
 * THE HOUSE NOW — In house, Empty and Out of service, counted ONCE, by the
 * server (app.house_now, migration 129). Every screen that prints either
 * number reads this rather than counting stays itself: that is how the
 * property page came to say 11 in house while the Dashboard said 10.
 * Null for a property the caller cannot see.
 */
export async function getHouseNow(hotelId: string): Promise<HouseNow | null> {
  if (!hotelId) return null;
  try {
    return await api<HouseNow>(`/api/hotels/${hotelId}/house-now`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
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
        s.roomNumber.toLowerCase().includes(q),
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

/** A booking that is not happening: cancelled, or voided (FD-32, the owner's
    D27-326 (1)). The API says `void`, which StayStatus does not name, so a bare
    `!== "cancelled"` let a voided booking through every list that used one:
    Arrivals Today and Upcoming listed and counted it, and the Dashboard's tile. */
export const isCancelledOrVoid = (s: Pick<Stay, "status">) =>
  s.status === "cancelled" || (s.status as string) === "void";

/* ── The front desk's three working lists ──────────────────────────
   Named for what a clerk is doing, not for a status value.        ═══ */

export async function listArrivals(hotelId: string, date = BUSINESS_DATE) {
  const rows = (await fetchStays(hotelId, date)).filter(
    (s) => s.arrival === date && !isCancelledOrVoid(s),
  );
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
}

/* ══ IN HOUSE IS WHO HAS CHECKED IN — the owner's D17-10, 17 September ══
   "Guests checked in now": checked in and not checked out. This list read
   DATES — every booking covering tonight — so it showed guests who had not
   arrived and even void bookings, 8 rows while the Dashboard, the housekeeping
   board and All bookings (which read status) said 1. One definition now, and
   Due out is the part of it leaving today. The date is kept in the signature
   so every caller still names the day it asks about; it asks the server for
   the desk's rows only (D27-313), which hold everyone checked in. */
export async function listInHouse(hotelId: string, date = BUSINESS_DATE) {
  const rows = (await fetchStays(hotelId, date)).filter(
    (s) => s.status === "in-house" || s.status === "due-out",
  );
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
}

/** Checked-in guests leaving today (D17-10: a part of In house). */
export async function listDepartures(hotelId: string, date = BUSINESS_DATE) {
  const rows = (await fetchStays(hotelId, date)).filter((s) => s.status === "due-out");
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
}

/** Every booking holding a room tonight, arrived or not — what a walk-in may
    NOT be given. Not "In house": a room sold for tonight is taken even before
    its guest checks in. */
async function listSoldTonight(hotelId: string, date: string) {
  return (await fetchStays(hotelId)).filter(
    (s) =>
      !isCancelledOrVoid(s) &&
      !s.isDayUse &&
      s.arrival <= date &&
      s.departure > date,
  );
}

/** Rooms with nobody in them tonight — what a walk-in can be given. */
export async function listVacant(hotelId: string, date = BUSINESS_DATE) {
  const taken = new Set((await listSoldTonight(hotelId, date)).map((s) => s.roomNumber));
  const arriving = new Set((await listArrivals(hotelId, date)).map((s) => s.roomNumber));
  return { taken, arriving };
}

/** The guest registration card (D27-344): what the server prints on it.
    Aadhaar arrives as its last four only; `grCardNo` is null for a stay
    checked in before the cards were numbered. */
export interface RegistrationCard {
  hotel: { name: string; address: string | null; city: string | null; state: string | null;
           phone: string | null; email: string | null; website: string | null; gstin: string | null };
  housePolicies: string[];
  grCardNo: number | null;
  stay: { reference: string; roomType: string; room: string | null; adults: number; children: number;
          plan: string | null; nights: number; arrival: string; departure: string };
  /** The agreed rate a night, before GST. */
  rate: string | null;
  guest: { title: string | null; name: string; email: string | null; phone: string | null; nationality: string | null;
           address: { line: string | null; city: string | null; state: string | null; pincode: string | null; country: string | null };
           idType: string | null; idNumber: string | null };
  /** The other adults in the room (D27-382), masked as the guest's ID is. */
  companions: { name: string; nationality: string; idType: string | null; idNumber: string | null }[];
  company: { name: string | null; email: string | null; phone: string | null } | null;
  agent: { name: string | null; email: string | null; phone: string | null; voucher: string | null } | null;
  arrivedFrom: string | null;
  nextDestination: string | null;
}

export const getRegistrationCard = (hotelId: string, stayId: string) =>
  api<RegistrationCard>(`/api/hotels/${hotelId}/stays/${stayId}/registration-card`);
