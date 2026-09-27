import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AdminResult } from "@/data/repositories/result";
import { put, call } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   THE GROUP'S LOGO (the owner's D27-53, 27 September)

   One logo for the whole group, chosen in Settings, printed on every
   bill. None set: the bill prints the hotel's name.

   ⚠ SHOWN ONLY AS A PICTURE. `useGroupLogo` hands back a data: URL for
   an <img src>, never markup: an SVG can carry a script, and inside an
   <img> the browser runs none of it. Never put the logo into the page
   with dangerouslySetInnerHTML, an <object>, an <iframe> or an inline
   <svg>. The server refuses a script-carrying SVG as well
   (api/src/modules/admin/groupLogo.ts); this is the guard that holds if
   one ever got past it.
   ══════════════════════════════════════════════════════════════════ */

export interface GroupLogo {
  type: string;
  /** The file, base64. */
  data: string;
}

const TYPES = ["image/png", "image/svg+xml"];

/** The logo as an address an <img> can show, or null for none - or for
    anything that is not one of the two pictures the server accepts. */
export function logoSrc(logo: GroupLogo | null): string | null {
  if (!logo || !TYPES.includes(logo.type) || !/^[A-Za-z0-9+/]+=*$/.test(logo.data)) return null;
  return `data:${logo.type};base64,${logo.data}`;
}

export async function getGroupLogo(hotelCode: string): Promise<GroupLogo | null> {
  return (await api<{ logo: GroupLogo | null }>(`/api/hotels/${hotelCode}/group-logo`)).logo;
}

/** Upload: the file's bytes, base64. The server decides what it is. */
export function setGroupLogo(hotelCode: string, data: string): Promise<AdminResult<{ type: string }>> {
  return put(`/api/hotels/${hotelCode}/group-logo`, { data });
}

export function removeGroupLogo(hotelCode: string): Promise<AdminResult<object>> {
  return call(`/api/hotels/${hotelCode}/group-logo`, "DELETE");
}

/** One logo for the group, whichever hotel asks, so one cache entry. */
export const GROUP_LOGO_KEY = ["group-logo"] as const;

/** For every document: the group's logo as an <img src>, or null while it
    loads and when there is none - print the hotel's name then. */
export function useGroupLogo(hotelCode: string): string | null {
  const { data } = useQuery({
    queryKey: GROUP_LOGO_KEY,
    queryFn: () => getGroupLogo(hotelCode),
    enabled: Boolean(hotelCode),
  });
  return logoSrc(data ?? null);
}
