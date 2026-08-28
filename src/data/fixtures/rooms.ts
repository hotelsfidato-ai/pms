import { roomInventory, PROPERTY_ID, BASE_ROOM_COUNT, PHYSICAL_ROOM_COUNT, EXTRA_ROOM_DATES } from "./property";

/* ══════════════════════════════════════════════════════════════════
   ROOMS — a view over the property fixture

   Room data has one home: `roomInventory` in `property.ts`, where it
   sits beside the occupancy calibration that depends on it.

   This module exists because repositories written against a
   `fixtures/rooms` layout kept failing to resolve. Rather than have
   two lists of rooms drift apart, this is a derived view: same rows,
   the shape those repositories expect, and `hotelId` attached.

   If room data ever needs its own file, move it — do not copy it.
   ══════════════════════════════════════════════════════════════════ */

export interface RoomRecord {
  id: string;
  hotelId: string;
  number: string;
  type: string;
  floor: number;
  /** Housekeeping state. Independent of whether anyone is in the room. */
  status: string;
  maxOccupancy: number;
  /** False while the room is held out of the sellable house. */
  sellable: boolean;
}

export const rooms: RoomRecord[] = roomInventory.map((r) => ({
  id: `room-${r.number}`,
  hotelId: PROPERTY_ID,
  number: r.number,
  type: r.type,
  floor: r.floor,
  status: r.status,
  maxOccupancy: r.maxOccupancy,
  sellable: r.status !== "out-of-service",
}));

/** Rooms sellable on an ordinary day — 17. */
export const sellableRooms = rooms.filter((r) => r.sellable);

export { BASE_ROOM_COUNT, PHYSICAL_ROOM_COUNT, EXTRA_ROOM_DATES, PROPERTY_ID };

/** How many rooms could be sold on a given date. 308 returns for six days. */
export function roomCountForDate(date: string): number {
  return EXTRA_ROOM_DATES.includes(date) ? PHYSICAL_ROOM_COUNT : BASE_ROOM_COUNT;
}

export function roomsForProperty(hotelId: string): RoomRecord[] {
  return rooms.filter((r) => r.hotelId === hotelId);
}
