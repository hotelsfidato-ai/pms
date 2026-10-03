import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S LISTS AND THE FRONT DESK'S SETTINGS (phase 5 of the settings
   plan, the owner's D27-260; migration 193). Read by the desk's screens
   (New booking's segments, the ready reasons, holidays) and changed from
   the Settings console.
   ══════════════════════════════════════════════════════════════════ */

export type ListKind = "market_segment" | "reason_block" | "reason_cancel" | "reason_void" | "reason_correction";
export interface ListItem { id: string; label: string; colour: string | null; sort: number; active: boolean }
export interface Holiday { id: string; day: string; name: string; colour: string | null }
type Saved = { ok: true; id?: string } | { ok: false; reason: string };

async function send(path: string, method: string, body?: unknown): Promise<Saved> {
  try {
    const out = await api<{ ok: true; id?: string }>(path,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ok: true, ...(out?.id ? { id: out.id } : {}) };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, reason: error.message };
    throw error;
  }
}

export const listOf = (hotelId: string, kind: ListKind) =>
  api<ListItem[]>(`/api/hotels/${hotelId}/lists/${kind}`);
export const addToList = (hotelId: string, kind: ListKind, item: { label: string; colour?: string | null }) =>
  send(`/api/hotels/${hotelId}/lists/${kind}`, "POST", item);
export const changeListItem = (hotelId: string, kind: ListKind, id: string, change: Partial<Omit<ListItem, "id">>) =>
  send(`/api/hotels/${hotelId}/lists/${kind}/${id}`, "PATCH", change);
export const removeListItem = (hotelId: string, kind: ListKind, id: string) =>
  send(`/api/hotels/${hotelId}/lists/${kind}/${id}`, "DELETE");

export const holidaysOf = (hotelId: string) => api<Holiday[]>(`/api/hotels/${hotelId}/holidays`);
export const addHoliday = (hotelId: string, h: { day: string; name: string; colour?: string | null }) =>
  send(`/api/hotels/${hotelId}/holidays`, "POST", h);
export const removeHoliday = (hotelId: string, id: string) =>
  send(`/api/hotels/${hotelId}/holidays/${id}`, "DELETE");

/* The group's VIP levels: one list, reached through any hotel. */
export const vipLevels = (hotelId: string) => api<ListItem[]>(`/api/hotels/${hotelId}/vip-levels`);
export const addVipLevel = (hotelId: string, item: { label: string; colour?: string | null }) =>
  send(`/api/hotels/${hotelId}/vip-levels`, "POST", item);
export const changeVipLevel = (hotelId: string, id: string, change: Partial<Omit<ListItem, "id">>) =>
  send(`/api/hotels/${hotelId}/vip-levels/${id}`, "PATCH", change);
export const removeVipLevel = (hotelId: string, id: string) =>
  send(`/api/hotels/${hotelId}/vip-levels/${id}`, "DELETE");

export const saveDeskSettings = (hotelId: string, settings: object) =>
  send(`/api/hotels/${hotelId}/desk-settings`, "PATCH", settings);
