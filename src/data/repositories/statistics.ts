import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE, PTD_FROM, PTD_TO } from "./businessDate";
import type { DayStatistics, PeriodStatistics } from "./types";

/* ══════════════════════════════════════════════════════════════════
   STATISTICS — over HTTP, as of CP9e

   Every figure is now DERIVED by SQL. Nothing here is carried by the
   product, and that is a change worth naming:

   Until migration 022 the availability curve — 17 rooms most days, 18
   on 8–13 August — lived in a TypeScript fixture, because nothing in
   the schema could say when a room was sellable. And ADR came from
   `property._calibration`, a constant the demo's own folios did not
   support: the dashboard printed ₹3,178.63 while the ledger said
   ₹2,854.13.

   Both are fixed. `app.sellable_rooms()` gives the denominator, the
   folios give the revenue, and the calibration has stopped being data
   the product carries and become a CHECK on what the database says:

       431 available · 132 sold · 30.63%
       ADR ₹3,178.63 · RevPAR ₹973.50

   If any of those move, the query is wrong — not the number.
   ══════════════════════════════════════════════════════════════════ */

/** The window the Manager Report's PTD column covers. */
/* The period-to-date window follows the property's own month.
   Both were literals pinned to August 2026: every PTD figure in
   the system would have kept reporting August after the property
   moved into September. */
export { PTD_FROM, PTD_TO } from "./businessDate";

const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/** A property the caller cannot see has no statistics, not an error. */
async function fetchOr<T>(path: string, empty: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return empty;
    throw error;
  }
}

export async function listDailyStatistics(
  hotelId: string,
  from = PTD_FROM,
  to = PTD_TO,
): Promise<DayStatistics[]> {
  if (!hotelId) return [];
  return fetchOr<DayStatistics[]>(
    `/api/hotels/${hotelId}/statistics/daily?${range(from, to)}`,
    [],
  );
}

export async function getPeriodStatistics(
  hotelId: string,
  from = PTD_FROM,
  to = PTD_TO,
): Promise<PeriodStatistics | null> {
  if (!hotelId) return null;
  return fetchOr<PeriodStatistics | null>(
    `/api/hotels/${hotelId}/statistics/period?${range(from, to)}`,
    null,
  );
}

/** Headline numbers for the top of the Stay View. */
export async function getTodaySnapshot(hotelId: string, date = BUSINESS_DATE) {
  if (!hotelId) return null;
  return fetchOr<{
    date: string;
    available: number;
    sold: number;
    vacant: number;
    occupancyPct: number;
  } | null>(
    `/api/hotels/${hotelId}/statistics/snapshot?date=${encodeURIComponent(date)}`,
    null,
  );
}

export const statisticsRepo = {
  daily: listDailyStatistics,
  period: getPeriodStatistics,
  snapshot: getTodaySnapshot,
};
