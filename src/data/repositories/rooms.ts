import { api, ApiError } from "@/lib/api";
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

/* `getRoom` lived here until 30 Sep; the walk-in dialog was its only caller,
   and the one-page booking replaced it (D27-158). Rule 2b.

   `roomCountForDate` lived here and had NO callers.
   Its own comment carried the removal condition — "it moves when room
   blocks are modelled" — and migration 022 modelled them. What the
   tape chart actually needed was per-room block ranges, which now
   arrive on every room. A dead function that names a real figure is
   worse than none: the next reader trusts it. */

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

/** Alias some callers use. */
/** Older name, kept so existing callers keep resolving. */
export const listRooms = listSellableRooms;

/* ══════════════════════════════════════════════════════════════════
   TAKING A ROOM OUT OF INVENTORY

   `room_blocks` has existed since migration 022 with a reason, dates
   and an author, and the tape chart draws from it. Nothing ever wrote
   to it: a housekeeper finding a broken shower had nowhere to record
   it, and the only blocks in the system came from the demo loader.
   ══════════════════════════════════════════════════════════════════ */

export const BLOCK_REASONS = [
  { value: "out_of_order", label: "Out of order - something is broken" },
  { value: "out_of_service", label: "Out of service - held back deliberately" },
  { value: "refurbishment", label: "Refurbishment" },
  /* "NC" is the owner's word for it (16 September): the room the GM lives
     in at 5 Elements is NC. Same block, same reason in the database — the
     label says the word the hotel uses, and still says what it means for
     anybody who does not know it. Not for sale: availability subtracts it
     (044), so no booking site is ever offered the room. */
  { value: "house_use", label: "NC - not for sale (house use: staff, storage, an office)" },
  { value: "owner_occupied", label: "Owner occupied" },
] as const;

export async function blockRoom(
  hotelId: string,
  roomNumber: string,
  input: { reason: string; from: string; to?: string | null; note?: string },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    return await api(
      `/api/hotels/${hotelId}/rooms/${encodeURIComponent(roomNumber)}/block`,
      { method: "POST", body: JSON.stringify(input) },
    );
  } catch (e) {
    return {
      ok: false as const,
      reason: e instanceof Error ? e.message : "The room was not taken out.",
    };
  }
}

export async function unblockRoom(
  hotelId: string, roomNumber: string, blockId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    return await api(
      `/api/hotels/${hotelId}/rooms/${encodeURIComponent(roomNumber)}/block/${blockId}`,
      { method: "DELETE" },
    );
  } catch (e) {
    return {
      ok: false as const,
      reason: e instanceof Error ? e.message : "The room was not put back.",
    };
  }
}
