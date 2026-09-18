import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   SWAPPING TWO ROOMS, AND WHAT A RATE INCLUDES

   An exchange is not two moves. `ra_no_double_booking` is checked per
   statement, so writing one guest into the other's room while they
   still hold it collides every time — the database suite asserts that,
   so this stays one call and never becomes a loop.

   An inclusion is a promise attached to a rate. Its price is
   snapshotted onto the booking for the same reason every agreed number
   here is: repricing the airport pickup in March must not reprice a
   stay sold in January.
   ══════════════════════════════════════════════════════════════════ */

export interface Exchangeable {
  id: string;
  guest: string;
  room: string;
  reference: string;
  departs: string;
}

export interface StayInclusion {
  id: string;
  name: string;
  quantity: number;
  /** Null means included at no extra charge — which is what an
      inclusion usually is. A dash on screen, never a zero. */
  rate: number | null;
  notes: string | null;
  addedBy: string;
  at: string;
}

export interface Inclusion {
  id: string;
  name: string;
  description: string | null;
  rate: number | null;
  category: string;
}

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

/** Everybody else in a room right now. An exchange swaps two OCCUPIED
    rooms; to move one guest into an empty one, that is a room move. */
export async function exchangeableWith(
  hotelId: string, stayId: string,
): Promise<Exchangeable[]> {
  if (!hotelId || !stayId) return [];
  try {
    const out = await api<{ rooms: Exchangeable[] }>(
      `/api/hotels/${hotelId}/stays/${stayId}/exchangeable`);
    return out.rooms;
  } catch {
    return [];
  }
}

export async function exchangeRooms(
  hotelId: string, stayId: string,
  input: { withStayId: string; from?: string; reason: string },
): Promise<Result<{ from: string; to: string; nights: number }>> {
  return call(`/api/hotels/${hotelId}/stays/${stayId}/exchange`, "POST", input);
}

export async function listInclusions(hotelId: string): Promise<Inclusion[]> {
  if (!hotelId) return [];
  try {
    const out = await api<{ inclusions: Inclusion[] }>(
      `/api/hotels/${hotelId}/inclusions`);
    return out.inclusions;
  } catch {
    return [];
  }
}

export async function addInclusion(
  hotelId: string,
  input: {
    name: string; description?: string;
    defaultRate?: number | null; category?: string;
  },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${hotelId}/inclusions`, "POST", input);
}

export async function stayInclusions(
  hotelId: string, stayId: string,
): Promise<StayInclusion[]> {
  if (!hotelId || !stayId) return [];
  try {
    const out = await api<{ inclusions: StayInclusion[] }>(
      `/api/hotels/${hotelId}/stays/${stayId}/inclusions`);
    return out.inclusions;
  } catch {
    return [];
  }
}

export async function addStayInclusion(
  hotelId: string, stayId: string,
  input: {
    inclusionId?: string; name?: string; quantity?: number;
    rate?: number | null; notes?: string;
  },
): Promise<Result<{ id: string }>> {
  return call(
    `/api/hotels/${hotelId}/stays/${stayId}/inclusions`, "POST", input);
}

export async function removeStayInclusion(
  hotelId: string, stayId: string, lineId: string,
): Promise<Result> {
  return call(
    `/api/hotels/${hotelId}/stays/${stayId}/inclusions/${lineId}`, "DELETE");
}

async function call<T>(
  path: string, method: string, body?: unknown,
): Promise<Result<T>> {
  try {
    const out = await api<T & { ok?: boolean }>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(out as T), ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
