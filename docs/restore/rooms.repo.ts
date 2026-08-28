import { readRooms, setRoomHousekeeping } from "../store";
import { PROPERTY_ID, EXTRA_ROOM_DATES, BASE_ROOM_COUNT, PHYSICAL_ROOM_COUNT } from "../fixtures/property";
import { canMarkClean, canMarkInspected } from "@/lib/rules";
import type { Room, Permitted } from "./types";

/* ══════════════════════════════════════════════════════════════════
   ROOMS

   Reads the live store, so a check-in that marks a room occupied and
   a check-out that marks it dirty both show up here immediately.

   This module exports its functions BOTH ways — as named functions
   and as a `roomsRepo` object — because callers in this project use
   both conventions. One implementation, two surfaces, so neither
   style of import can fail.
   ══════════════════════════════════════════════════════════════════ */

const guard = (hotelId: string) => hotelId === PROPERTY_ID;
const byNumber = (a: Room, b: Room) => a.number.localeCompare(b.number);

/** Every physical room, including any held out of service. */
export async function listAllRooms(hotelId: string): Promise<Room[]> {
  if (!guard(hotelId)) return [];
  return readRooms()
    .map((r) => ({
      number: r.number,
      type: r.type,
      floor: r.floor,
      status: r.housekeeping,
      maxOccupancy: r.maxOccupancy,
    }))
    .sort(byNumber);
}

/** Rooms that can actually be sold today — 17 of the 18. */
export async function listSellableRooms(hotelId: string): Promise<Room[]> {
  return (await listAllRooms(hotelId)).filter((r) => r.status !== "out-of-service");
}

export async function getRoom(hotelId: string, number: string): Promise<Room | null> {
  return (await listAllRooms(hotelId)).find((r) => r.number === number) ?? null;
}

/** How many rooms could be sold on a given date. 308 returns for six days. */
export function roomCountForDate(date: string): number {
  return EXTRA_ROOM_DATES.includes(date) ? PHYSICAL_ROOM_COUNT : BASE_ROOM_COUNT;
}

export async function setHousekeeping(
  hotelId: string,
  number: string,
  state: "clean" | "inspected" | "dirty",
): Promise<Permitted> {
  if (!guard(hotelId)) return { allowed: false, reason: "Unknown property." };
  const room = readRooms().find((r) => r.number === number);
  if (!room) return { allowed: false, reason: "Room not found." };

  /* The rule lives in src/lib/rules.ts — the same one that disables the
     button in the interface refuses the write here. */
  if (state === "clean") {
    const permitted = canMarkClean(room);
    if (!permitted.allowed) return permitted;
  }
  if (state === "inspected") {
    const permitted = canMarkInspected(room);
    if (!permitted.allowed) return permitted;
  }

  setRoomHousekeeping(number, state);
  return { allowed: true };
}

/** Object surface, for callers written against `roomsRepo.list(...)`. */
export const roomsRepo = {
  list: listAllRooms,
  listAll: listAllRooms,
  listSellable: listSellableRooms,
  get: getRoom,
  countForDate: roomCountForDate,
  setHousekeeping,
  updateRoomStatus: setHousekeeping,
};

/** Alias some callers use. */
export const roomRepo = roomsRepo;
