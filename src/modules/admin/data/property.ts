import { api } from "@/lib/api";
import type { AdminResult } from "@/data/repositories/result";
import { call, patch, put, write } from "@/data/repositories/http";

/* The property's profile (phase 2 of the settings plan; D27-249, D27-257):
   four more registration numbers, the highlights and policy texts (plain
   text), the child ages (words only - no price reads them), and ONE
   amenities list for the group. api/src/modules/admin/property.ts. */

export const HIGHLIGHTS = [
  ["about", "About the property"], ["attractions", "Local attractions"],
  ["directions", "Directions and transport"], ["activities", "Activities nearby"],
  ["landmarks", "Famous landmarks"],
] as const;
export const POLICY_TEXTS = [
  ["parking", "Parking and arrival"], ["family", "Family and extra guests"],
  ["reservation_terms", "Reservation terms"],
] as const;
export type TextKind = (typeof HIGHLIGHTS)[number][0] | (typeof POLICY_TEXTS)[number][0];

export interface Registration { label: string; number: string }
export interface PropertyProfile {
  registrations: Registration[];
  texts: Partial<Record<TextKind, string>>;
  childFreeAge: number | null; childMaxAge: number | null;
  map: { latitude: number; longitude: number } | null;
}
export interface Amenity { id: string; name: string; icon: string; isActive: boolean; on: boolean; used: boolean }

const at = (code: string, rest: string) => `/api/hotels/${encodeURIComponent(code)}${rest}`;
export const PROFILE_KEY = (code: string) => ["property-profile", code] as const;
export const AMENITIES_KEY = (code: string) => ["amenities", code] as const;

export const getProfile = (code: string) => api<PropertyProfile>(at(code, "/property-profile"));
export const saveRegistrations = (code: string, registrations: Registration[]): Promise<AdminResult<object>> =>
  put(at(code, "/registrations"), { registrations });
export const saveText = (code: string, kind: TextKind, body: string): Promise<AdminResult<object>> =>
  put(at(code, `/texts/${kind}`), { body });
export const saveChildAges = (code: string, free: number | null, max: number | null): Promise<AdminResult<object>> =>
  put(at(code, "/child-ages"), { free, max });

export const getAmenities = (code: string) => api<{ amenities: Amenity[]; mayKeep: boolean }>(at(code, "/amenities"));
export const switchAmenity = (code: string, id: string, on: boolean): Promise<AdminResult<object>> =>
  put(at(code, `/amenities/${id}`), { on });
export const addAmenity = (code: string, name: string): Promise<AdminResult<{ id: string }>> =>
  write(at(code, "/amenities"), { name });
export const changeAmenity = (code: string, id: string, change: { name?: string; isActive?: boolean }): Promise<AdminResult<object>> =>
  patch(at(code, `/amenities/${id}`), change);
export const orderAmenities = (code: string, ids: string[]): Promise<AdminResult<object>> =>
  put(at(code, "/amenities/order"), { ids });
export const removeAmenity = (code: string, id: string): Promise<AdminResult<object>> =>
  call(at(code, `/amenities/${id}`), "DELETE");
