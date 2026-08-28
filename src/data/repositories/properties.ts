import { api } from "@/lib/api";
import type { Property } from "./types";

/* ══════════════════════════════════════════════════════════════════
   PROPERTIES — over HTTP, as of CP9

   This module used to read a fixture. It now fetches, and NOT ONE
   SCREEN CHANGED — which is the whole point of the seam, and the only
   evidence that the rule was worth enforcing for six checkpoints.

   The id a screen sees is the hotel CODE (`5EL`), not its uuid.
   `hotels.code` is commented "appears in URLs" in migration 002, and
   it is what a person can read back over the phone. Screens put it in
   the URL without knowing either fact.

   Never `properties[0]`. Never a hardcoded id. Never a branch on
   `length === 1`.
   ══════════════════════════════════════════════════════════════════ */

interface ScopeResponse {
  scope: { isGroupAdmin: boolean; hotels: Array<{ hotelId: string }> };
  hotels: Array<{ id: string; code: string }>;
}

/** Every property the signed-in user may see. */
export async function listProperties(): Promise<Property[]> {
  const { hotels } = await api<ScopeResponse>("/api/hotels");

  /* One request per property. Seven is not worth batching, and a
     dedicated endpoint would be a second shape of the same thing —
     one more place for the two to drift apart. */
  const full = await Promise.all(
    hotels.map((h) =>
      api<Property>(`/api/hotels/${h.code}`).catch(() => null),
    ),
  );

  return full.filter((p): p is Property => p !== null);
}

export async function getProperty(hotelId: string): Promise<Property | null> {
  try {
    return await api<Property>(`/api/hotels/${hotelId}`);
  } catch {
    /* A property that is not there and one the caller may not see give
       the same answer, deliberately — see the route comment. */
    return null;
  }
}

/** The property to land on when none is named in the URL. */
export async function defaultPropertyId(): Promise<string> {
  const { hotels } = await api<ScopeResponse>("/api/hotels");
  return hotels[0]?.code ?? "";
}

/* Room queries live in ./rooms — one home each, so `export *` from the
   seam index cannot become ambiguous. */
