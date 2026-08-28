/* ══════════════════════════════════════════════════════════════════
   PROPERTY REPOSITORY
   Single property for Stage 1, but the seam takes hotelId for CP4+.    ═════ */

import { property, PROPERTY_ID, dailyOccupancy, dailyAvailableRooms, nightsSoldPerDay } from "@/data/fixtures/property";

export const propertyRepo = {
  /** Get property by ID — hotelId first for the seam. */
  async get(hotelId: string): Promise<typeof property> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    // Simulate async
    await new Promise((r) => setTimeout(r, 50));
    return property;
  },

  /** Get daily occupancy for a date range. */
  async getDailyOccupancy(hotelId: string, from: string, to: string): Promise<Record<string, number>> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    const slice: Record<string, number> = {};
    for (const date of Object.keys(dailyOccupancy)) {
      if (date >= from && date <= to) slice[date] = dailyOccupancy[date];
    }
    await new Promise((r) => setTimeout(r, 30));
    return slice;
  },

  /** Get available rooms per day for a date range. */
  async getDailyAvailability(hotelId: string, from: string, to: string): Promise<Record<string, number>> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    const slice: Record<string, number> = {};
    for (const date of Object.keys(dailyAvailableRooms)) {
      if (date >= from && date <= to) slice[date] = dailyAvailableRooms[date];
    }
    await new Promise((r) => setTimeout(r, 30));
    return slice;
  },

  /** Get nights sold per day for a date range. */
  async getNightsSold(hotelId: string, from: string, to: string): Promise<Record<string, number>> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    const slice: Record<string, number> = {};
    for (const date of Object.keys(nightsSoldPerDay)) {
      if (date >= from && date <= to) slice[date] = nightsSoldPerDay[date];
    }
    await new Promise((r) => setTimeout(r, 30));
    return slice;
  },
};