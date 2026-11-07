import { api, ApiError } from "@/lib/api";
import type { Preferences } from "../../../../api/src/modules/guests/preferenceRules.ts";

/* A guest's preferences (D27-383 item 10), over HTTP:
   api/src/modules/guests/preferences.ts. */

export type { Preferences };

export interface StayPreferences {
  stayId: string;
  guestId: string;
  /** The room the stay is in or was given, else null. */
  room: string | null;
  /** Due in on the business date. */
  arriving: boolean;
  inHouse: boolean;
  preferences: Preferences;
}

/** Every stay still to come or in house whose guest has a preference. */
export const listPreferences = (hotelId: string) =>
  api<{ smokingOffered: boolean; stays: StayPreferences[] }>(`/api/hotels/${hotelId}/guest-preferences`);

export const getPreferences = (hotelId: string, guestId: string) =>
  api<{ preferences: Preferences; smokingOffered: boolean }>(
    `/api/hotels/${hotelId}/guests/${guestId}/preferences`);

/** The whole set is sent; the server keeps a smoking choice the hotel does
    not offer. Its sentence on a refusal. */
export async function savePreferences(
  hotelId: string, guestId: string, preferences: Preferences,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await api(`/api/hotels/${hotelId}/guests/${guestId}/preferences`, {
      method: "PUT", body: JSON.stringify({ preferences }),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; error?: string } | undefined;
      return { ok: false, reason: p?.reason ?? p?.error ?? error.message };
    }
    throw error;
  }
}
