import {
  PROPERTY_ID,
  property,
  dailyAvailableRooms,
  nightsSoldPerDay,
  dailyOccupancy,
} from "../fixtures/property";
import type { DayStatistics, PeriodStatistics } from "./types";

/* ══════════════════════════════════════════════════════════════════
   STATISTICS

   The figures the Manager Report and the Monthly Statistics report
   are built from. Calibrated to the real PTD window, 1–25 August
   2026 — 431 available room-nights, 132 sold, 30.63% occupancy.

   ADR and RevPAR follow the standard definitions:
     ADR    = room revenue / rooms sold
     RevPAR = room revenue / available room-nights
   ══════════════════════════════════════════════════════════════════ */

export const PTD_FROM = "2026-08-01";
export const PTD_TO = "2026-08-25";

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

export async function listDailyStatistics(
  hotelId: string,
  from = PTD_FROM,
  to = PTD_TO,
): Promise<DayStatistics[]> {
  if (hotelId !== PROPERTY_ID) return [];
  return Object.keys(dailyAvailableRooms)
    .filter((d) => inRange(d, from, to))
    .sort()
    .map((date) => ({
      date,
      availableRooms: dailyAvailableRooms[date] ?? 0,
      roomsSold: nightsSoldPerDay[date] ?? 0,
      occupancyPct: dailyOccupancy[date] ?? 0,
    }));
}

export async function getPeriodStatistics(
  hotelId: string,
  from = PTD_FROM,
  to = PTD_TO,
): Promise<PeriodStatistics | null> {
  if (hotelId !== PROPERTY_ID) return null;

  const days = await listDailyStatistics(hotelId, from, to);
  const availableRoomNights = days.reduce((t, d) => t + d.availableRooms, 0);
  const roomsSold = days.reduce((t, d) => t + d.roomsSold, 0);

  /* Room revenue is taken from the report for the calibrated window.
     Outside it, it is derived from the same ADR so the numbers stay
     internally consistent rather than silently wrong. */
  const isCalibratedWindow = from === PTD_FROM && to === PTD_TO;
  const adr = property._calibration.adr;
  const roomRevenue = isCalibratedWindow
    ? property._calibration.roomRevenue
    : Math.round(roomsSold * adr * 100) / 100;

  return {
    from,
    to,
    availableRoomNights,
    roomsSold,
    occupancyPct: availableRoomNights
      ? Math.round((roomsSold / availableRoomNights) * 10000) / 100
      : 0,
    adr: roomsSold ? Math.round((roomRevenue / roomsSold) * 100) / 100 : 0,
    revpar: availableRoomNights
      ? Math.round((roomRevenue / availableRoomNights) * 100) / 100
      : 0,
    roomRevenue,
  };
}

/** Headline numbers for the top of the Stay View. */
export async function getTodaySnapshot(hotelId: string, date = "2026-08-25") {
  if (hotelId !== PROPERTY_ID) return null;
  const available = dailyAvailableRooms[date] ?? 0;
  const sold = nightsSoldPerDay[date] ?? 0;
  return {
    date,
    available,
    sold,
    vacant: available - sold,
    occupancyPct: dailyOccupancy[date] ?? 0,
  };
}
