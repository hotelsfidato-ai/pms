import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE } from "./businessDate";

/* ══════════════════════════════════════════════════════════════════
   NOTIFICATIONS — over HTTP, as of CP9e

   Derived, never stored.

   These began as a hand-written list, and the figures in it — a
   ₹45,000 settlement, a ₹1,24,500 night audit — existed nowhere in the
   ledger. Anyone comparing the bell against the Manager Report would
   have found two different hotels.

   Every notification is now a CONDITION computed from the same rows
   every other screen reads. Check a guest in and the arrival notice
   disappears, because nothing keeps it alive.
   ══════════════════════════════════════════════════════════════════ */

export type NotificationCategory =
  | "approval"
  | "reservation"
  | "payment"
  | "automation"
  | "customer"
  | "system";

export interface Notification {
  id: string;
  hotelId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  isRead: boolean;
  at: string;
  link?: string;
  actionRequired: boolean;
}

/**
 * Dismissals — the one piece of genuine state here.
 *
 * Deliberately NOT in the database. A dismissal says "I have seen
 * this", which is a fact about a person, not about the hotel. Storing
 * it per-property would mean one clerk dismissing a notice for
 * everybody; storing it per-person needs a table nothing else wants
 * yet. It lives here until somebody asks for it to survive a reload.
 */
const dismissed = new Set<string>();

async function fetchLive(hotelId: string): Promise<Notification[]> {
  if (!hotelId) return [];
  try {
    const rows = await api<Notification[]>(
      `/api/hotels/${hotelId}/notifications?asOn=${BUSINESS_DATE}`,
    );
    return rows.map((n) => ({ ...n, isRead: dismissed.has(n.id) }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

export const notificationsRepo = {
  /** Conditions worth someone's attention, recomputed on every read. */
  list: async (hotelId: string): Promise<Notification[]> => fetchLive(hotelId),

  markRead: async (hotelId: string, id: string): Promise<Notification | null> => {
    dismissed.add(id);
    return (await fetchLive(hotelId)).find((n) => n.id === id) ?? null;
  },

  markAllRead: async (hotelId: string): Promise<number> => {
    const unread = (await fetchLive(hotelId)).filter((n) => !n.isRead);
    for (const n of unread) dismissed.add(n.id);
    return unread.length;
  },

  /**
   * Nothing to create. A notification here is a query, so the way to
   * raise one is to create the condition it describes.
   */
  create: async (): Promise<null> => null,
};
