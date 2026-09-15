import { api, ApiError } from "@/lib/api";
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

/**
 * Which modules a property has.
 *
 * Not every hotel in the group runs a restaurant, and one with no kitchen
 * should not be showing its staff a menu screen that will never have
 * anything in it.
 *
 * A property with no rows keeps its POS. The default is never "off", or
 * shipping this would close the till at a property that was using it.
 */
export async function getModules(
  hotelId: string,
): Promise<Record<string, boolean>> {
  if (!hotelId) return {};
  try {
    const body = await api<{ modules: { module: string; enabled: boolean }[] }>(
      `/api/hotels/${hotelId}/modules`,
    );
    return Object.fromEntries(body.modules.map((m) => [m.module, m.enabled]));
  } catch {
    /* Unreadable is not the same as off. Returning {} keeps every section
       visible and lets the API give the reason, rather than making a
       network hiccup look like a property losing its restaurant. */
    return {};
  }
}

export async function setModule(
  hotelId: string, module: string, enabled: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/modules/${module}`,
      { method: "POST", body: JSON.stringify({ enabled }) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
