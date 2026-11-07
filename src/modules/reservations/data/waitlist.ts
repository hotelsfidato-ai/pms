import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE WAITLIST over HTTP (D27-383 item 8, migration 272). Nothing is
   booked or sent by the system: the list shows who is waiting and the
   rooms free now, and the desk decides.
   ══════════════════════════════════════════════════════════════════ */

export interface WaitlistEntry {
  id: string;
  guestName: string;
  /** Null for a role that does not read guests' details (D27-143). */
  phone: string | null;
  roomTypeId: string;
  roomType: string;
  arrival: string;
  departure: string;
  note: string | null;
  createdAt: string;
  addedBy: string | null;
  /** The fewest rooms of the type free on any of their nights, now; null
      once the arrival has passed. */
  free: number | null;
}

export interface Waitlist { today: string; entries: WaitlistEntry[] }

export interface WaitlistInput {
  guestName: string; phone: string; roomTypeId: string; arrival: string; departure: string; note: string;
}

type Saved = { ok: true; id?: string } | { ok: false; reason: string };

async function send(path: string, body: unknown): Promise<Saved> {
  try {
    return await api<Saved>(path, { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export const listWaitlist = (hotelId: string) => api<Waitlist>(`/api/hotels/${hotelId}/waitlist`);

export const addToWaitlist = (hotelId: string, input: WaitlistInput) =>
  send(`/api/hotels/${hotelId}/waitlist`, input);

export const removeFromWaitlist = (hotelId: string, id: string, reason: string) =>
  send(`/api/hotels/${hotelId}/waitlist/${id}/remove`, { reason });
