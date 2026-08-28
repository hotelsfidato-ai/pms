import { api, ApiError } from "@/lib/api";
import { EXTRA_ROOM_DATES, BASE_ROOM_COUNT, PHYSICAL_ROOM_COUNT } from "../fixtures/property";
import type { Room, Permitted } from "./types";

/* ══════════════════════════════════════════════════════════════════
   ROOMS — over HTTP, as of CP9

   Reads and writes moved together, deliberately. Swapping only the
   reads would have left a clerk marking a room clean in one store and
   reading it back from another, and the screen would have shown the
   old state with no error to explain it.

   The rules still live in `src/lib/rules.ts` for the interface — the
   same function that disables the button — but the REFUSAL is now the
   database's. A rule enforced only in the browser is a suggestion.

   This module exports its functions BOTH ways — as named functions
   and as a `roomsRepo` object — because callers in this project use
   both conventions. One implementation, two surfaces.
   ══════════════════════════════════════════════════════════════════ */

/** Every physical room, including any held out of service. */
export async function listAllRooms(hotelId: string): Promise<Room[]> {
  if (!hotelId) return [];
  try {
    return await api<Room[]>(`/api/hotels/${hotelId}/rooms`);
  } catch (error) {
    /* A property the caller cannot see is an empty house, not a crash.
       Anything else is a real failure and belongs on screen. */
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

/** Rooms that can actually be sold today — 17 of the 18. */
export async function listSellableRooms(hotelId: string): Promise<Room[]> {
  return (await listAllRooms(hotelId)).filter((r) => r.status !== "out-of-service");
}

export async function getRoom(hotelId: string, number: string): Promise<Room | null> {
  return (await listAllRooms(hotelId)).find((r) => r.number === number) ?? null;
}

/**
 * How many rooms could be sold on a given date. 308 returns for six days.
 *
 * Still calibration metadata rather than data: the six dates come from
 * the real Monthly Statistics export, which shows Available Rooms of 18
 * on 8–13 August. Nothing in the schema records why a room came back
 * into inventory for a week, so nothing in the database can answer
 * this yet. It moves when room blocks are modelled.
 */
export function roomCountForDate(date: string): number {
  return EXTRA_ROOM_DATES.includes(date) ? PHYSICAL_ROOM_COUNT : BASE_ROOM_COUNT;
}

export async function setHousekeeping(
  hotelId: string,
  number: string,
  state: "clean" | "inspected" | "dirty",
): Promise<Permitted> {
  try {
    return await api<Permitted>(
      `/api/hotels/${hotelId}/rooms/${number}/housekeeping`,
      { method: "PUT", body: JSON.stringify({ state }) },
    );
  } catch (error) {
    /* A refused change comes back as 409 with its reason, and `api`
       throws on any non-2xx — so the reason has to be recovered here
       rather than lost as a generic failure. Rule 6: the person is
       told why, not merely that. */
    if (error instanceof ApiError) {
      return { allowed: false, reason: error.message };
    }
    throw error;
  }
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

/** Older name, kept so existing callers keep resolving. */
export const listRooms = listSellableRooms;
