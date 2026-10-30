import { api, ApiError } from "@/lib/api";

/* The other adults in a room (D27-382): each a guest record tied to the stay,
   entered on their own call so that nothing here can stop a check-in. */

export interface Companion {
  guestId: string;
  name: string;
  nationality: string;
  idType: string | null;
  /** Masked where the registration card masks it (an Aadhaar, its last four). */
  idNumber: string | null;
  /** A filed Form III: corrections are the register's, and they stay on the stay. */
  filed: boolean;
  /** Form III's other answers, under the names the shared fields use. */
  [answer: string]: string | boolean | null;
}

export interface StayPeople {
  adults: number;
  /** The lead guest, and each companion with a document number on record. */
  recorded: number;
  lead: string;
  leadNationality: string;
  /** The lead's saved visit answers, for "Same as the guest". */
  leadVisit: Record<string, string | null> | null;
  /** False for a booking that did not go ahead: nobody can be added. */
  open: boolean;
  companions: Companion[];
}

export interface CompanionInput {
  fullName: string;
  nationality: string;
  identity: Record<string, string>;
  visit?: Record<string, string | boolean>;
}

type Saved = { ok: true } | { ok: false; reason: string };

async function send(path: string, method: string, body?: unknown): Promise<Saved> {
  try {
    return await api<Saved>(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export const getCompanions = (hotelId: string, stayId: string) =>
  api<StayPeople>(`/api/hotels/${hotelId}/stays/${stayId}/companions`);

export const addCompanion = (hotelId: string, stayId: string, person: CompanionInput) =>
  send(`/api/hotels/${hotelId}/stays/${stayId}/companions`, "POST", person);

export const saveCompanion = (hotelId: string, stayId: string, guestId: string, person: CompanionInput) =>
  send(`/api/hotels/${hotelId}/stays/${stayId}/companions/${guestId}`, "PUT", person);

export const removeCompanion = (hotelId: string, stayId: string, guestId: string) =>
  send(`/api/hotels/${hotelId}/stays/${stayId}/companions/${guestId}`, "DELETE");
