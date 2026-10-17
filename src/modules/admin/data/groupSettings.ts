import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AdminResult } from "@/data/repositories/result";
import { put, call } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   THE GROUP'S NAME AND LOGO (the owner's D27-53 and D27-65, 27 September)

   One group setting, chosen in Settings, printed on every bill: the
   masthead is the property's name and under it "by <group name>"; the
   logo beside it. Neither set: the bill prints the hotel's name alone.

   ⚠ THE LOGO IS SHOWN ONLY AS A PICTURE. `useGroupSettings` hands back
   a data: URL for an <img src>, never markup: an SVG can carry a script,
   and inside an <img> the browser runs none of it. Never put the logo
   into the page with dangerouslySetInnerHTML, an <object>, an <iframe>
   or an inline <svg>. The server refuses a script-carrying SVG as well
   (api/src/modules/admin/groupSettings.ts); this is the guard that holds
   if one ever got past it.
   ══════════════════════════════════════════════════════════════════ */

export interface GroupLogo {
  type: string;
  /** The file, base64. */
  data: string;
}

interface GroupSettingsRead {
  name: string | null;
  logo: GroupLogo | null;
  /** The hotel's OWN logo (D27-214), for the hotel that was asked about. */
  hotelLogo?: GroupLogo | null;
  /** The group's office details (D27-215): the booking voucher's footer, and
      its Instagram line. Each null until typed. */
  office?: GroupOffice;
}

export type GroupOffice = Record<"address" | "phone" | "email" | "website" | "gstin" | "instagram", string | null>;

/** Sent blank, a field is cleared. */
export function setGroupOffice(
  hotelCode: string, office: Record<keyof GroupOffice, string>,
): Promise<AdminResult<object>> {
  return put(`/api/hotels/${hotelCode}/group/office`, office);
}

export interface GroupSettings {
  /** "Fidato Hotels", for "by Fidato Hotels"; null when nobody has typed one. */
  name: string | null;
  /** An <img src>; null when there is none. */
  logo: string | null;
  /** Each logo on its own, for the tax invoice's two (D27-343); null when none. */
  hotelLogo?: string | null;
  groupLogo?: string | null;
  /** The group's office, for a document's footer (D27-215); null until read. */
  office?: GroupOffice | null;
}

const TYPES = ["image/png", "image/svg+xml"];

/** The logo as an address an <img> can show, or null for none - or for
    anything that is not one of the two pictures the server accepts. */
export function logoSrc(logo: GroupLogo | null): string | null {
  if (!logo || !TYPES.includes(logo.type) || !/^[A-Za-z0-9+/]+=*$/.test(logo.data)) return null;
  return `data:${logo.type};base64,${logo.data}`;
}

export async function getGroupSettings(hotelCode: string): Promise<GroupSettingsRead> {
  return api<GroupSettingsRead>(`/api/hotels/${hotelCode}/group`);
}

/** Blank clears it. */
export function setGroupName(hotelCode: string, name: string): Promise<AdminResult<{ name: string | null }>> {
  return put(`/api/hotels/${hotelCode}/group/name`, { name });
}

/** Upload: the file's bytes, base64. The server decides what it is. */
export function setGroupLogo(hotelCode: string, data: string): Promise<AdminResult<{ type: string }>> {
  return put(`/api/hotels/${hotelCode}/group/logo`, { data });
}

export function removeGroupLogo(hotelCode: string): Promise<AdminResult<object>> {
  return call(`/api/hotels/${hotelCode}/group/logo`, "DELETE");
}

/** A hotel's own logo (D27-214): the same picture rules as the group's. */
export function setHotelLogo(hotelCode: string, data: string): Promise<AdminResult<{ type: string }>> {
  return put(`/api/hotels/${hotelCode}/logo`, { data });
}

export function removeHotelLogo(hotelCode: string): Promise<AdminResult<object>> {
  return call(`/api/hotels/${hotelCode}/logo`, "DELETE");
}

/** The group's name and logo are one setting whichever hotel asks; the
    hotel's own logo rides on the same answer, so the hotel is in the key.
    Invalidate by this prefix. */
export const GROUP_SETTINGS_KEY = ["group-settings"] as const;
export const groupSettingsKey = (hotelCode: string) => [...GROUP_SETTINGS_KEY, hotelCode] as const;

/** For every document: the group's name, and the logo as an <img src> - the
    HOTEL'S OWN where it has one (D27-214), the group's where it has not.
    Each null while loading and when not set: print the hotel's name alone. */
export function useGroupSettings(hotelCode: string): GroupSettings {
  const { data } = useQuery({
    queryKey: groupSettingsKey(hotelCode),
    queryFn: () => getGroupSettings(hotelCode),
    enabled: Boolean(hotelCode),
  });
  const hotelLogo = logoSrc(data?.hotelLogo ?? null);
  const groupLogo = logoSrc(data?.logo ?? null);
  return {
    name: data?.name ?? null,
    logo: hotelLogo ?? groupLogo,
    hotelLogo, groupLogo,
    office: data?.office ?? null,
  };
}
