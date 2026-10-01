import { api } from "@/lib/api";
import type { MenuItem } from "@/modules/pos";
import { at, withUnlock } from "./guestPage";

/* In-room dining, the guest's side (D27-224, D27-225): behind the code, its
   own door routes (api/src/routes/guestDining.ts). */

export interface GuestMenuSection { name: string; items: MenuItem[] }

export interface GuestFoodLine {
  itemId: string; qty: number; variationId?: string | null;
  moreChoiceIds?: string[]; addonIds?: string[];
  /** Filled by the server: the dish as the kitchen reads it, and the price
      of one, as the guest saw it (kept, Q1). */
  name?: string; unitPrice?: number;
}

export interface GuestFoodOrder {
  id: string; lines: Required<Pick<GuestFoodLine, "name" | "qty" | "unitPrice">>[];
  note: string | null; status: "waiting" | "accepted" | "declined" | "cancelled";
  reason: string | null; createdAt: string;
}

export const getGuestMenu = (token: string) =>
  api<{ sections: GuestMenuSection[] }>(at(token, "/menu"), withUnlock(token));

export const getMyFoodOrders = (token: string) =>
  api<{ orders: GuestFoodOrder[] }>(at(token, "/orders"), withUnlock(token));

export const placeFoodOrder = (token: string, lines: GuestFoodLine[], note: string) =>
  api<{ id: string }>(at(token, "/orders"),
    withUnlock(token, { method: "POST", body: JSON.stringify({ lines, note }) }));

export const cancelFoodOrder = (token: string, id: string) =>
  api<{ cancelled: boolean }>(at(token, `/orders/${id}/cancel`),
    withUnlock(token, { method: "POST", body: "{}" }));
