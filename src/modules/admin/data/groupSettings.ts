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
}

export interface GroupSettings {
  /** "Fidato Hotels", for "by Fidato Hotels"; null when nobody has typed one. */
  name: string | null;
  /** An <img src>; null when there is none. */
  logo: string | null;
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

/** One setting for the group, whichever hotel asks, so one cache entry. */
export const GROUP_SETTINGS_KEY = ["group-settings"] as const;

/** For every document: the group's name and its logo as an <img src>, each
    null while loading and when not set - print the hotel's name alone then. */
export function useGroupSettings(hotelCode: string): GroupSettings {
  const { data } = useQuery({
    queryKey: GROUP_SETTINGS_KEY,
    queryFn: () => getGroupSettings(hotelCode),
    enabled: Boolean(hotelCode),
  });
  return { name: data?.name ?? null, logo: logoSrc(data?.logo ?? null) };
}
