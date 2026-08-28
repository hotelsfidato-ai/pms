/* ══════════════════════════════════════════════════════════════════
   ROOMS REPOSITORY
   hotelId first — the seam that let CRS swap its backend without
   touching 34 screens.                                   ══════════ */

import { roomInventory, PROPERTY_ID, BASE_ROOM_COUNT, PHYSICAL_ROOM_COUNT, EXTRA_ROOM_DATES } from "@/data/fixtures/property";

export interface RoomStatus {
  number: string;
  type: string;
  floor: number;
  status: "clean" | "dirty" | "inspected" | "out-of-order" | "out-of-service";
  maxOccupancy: number;
}

export const roomRepo = {
  /** List all rooms for a property. */
  async list(hotelId: string): Promise<RoomStatus[]> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    await new Promise((r) => setTimeout(r, 40));
    return roomInventory;
  },

  /** Get sellable room count for a specific date (accounts for extra room on 8–13 Aug). */
  async getAvailableCount(hotelId: string, date: string): Promise<number> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    await new Promise((r) => setTimeout(r, 20));
    const isExtra = EXTRA_ROOM_DATES.includes(date);
    return isExtra ? PHYSICAL_ROOM_COUNT : BASE_ROOM_COUNT;
  },

  /** Get base room count (ordinary days). */
  async getBaseCount(hotelId: string): Promise<number> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    await new Promise((r) => setTimeout(r, 20));
    return BASE_ROOM_COUNT;
  },

  /** Get room status for a specific date (for Stay View tape chart). */
  async getStatusForDate(hotelId: string, date: string): Promise<RoomStatus[]> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    await new Promise((r) => setTimeout(r, 40));
    // In real app this would come from housekeeping task state
    return roomInventory;
  },

  /** Update room status (housekeeping flow). */
  async updateStatus(hotelId: string, roomNumber: string, status: RoomStatus["status"]): Promise<void> {
    if (hotelId !== PROPERTY_ID) throw new Error(`Property not found: ${hotelId}`);
    await new Promise((r) => setTimeout(r, 100));
    // In real app this would persist
    const room = roomInventory.find((r) => r.number === roomNumber);
    if (room) room.status = status;
  },
};