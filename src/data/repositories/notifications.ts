import { readStays, readPostings, readRooms, balanceOf } from "../store";
import { isDemoProperty } from "../fixtures/property";
import { BUSINESS_DATE } from "./stays";

/* ══════════════════════════════════════════════════════════════════
   NOTIFICATIONS

   Derived, never stored.

   These began as a hand-written list, and the figures in it — a
   ₹45,000 settlement, a ₹1,24,500 night audit — existed nowhere in
   the ledger. Anyone comparing the bell against the Manager Report
   would have found two different hotels. So every notification here
   is now a condition computed from the same stays and postings every
   other screen reads. Check a guest in and the arrival notice
   disappears, because there is nothing to keep it alive.

   `isRead` is the one piece of genuine state: a dismissal is a
   decision a person made, and cannot be recomputed.
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

/** Dismissals. The only thing here a person owns rather than a query. */
const dismissed = new Set<string>();

const money = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function build(hotelId: string): Notification[] {
  if (!isDemoProperty(hotelId)) return [];

  const at = `${BUSINESS_DATE}T09:00:00+05:30`;
  /* The guard above already settled which property this is. Comparing
     stay.hotelId to the passed id again would fail for the database
     code, and fail silently — an empty bell rather than an error. */
  const stays = readStays();
  const out: Notification[] = [];

  /* ── Arrivals still outstanding ────────────────────────────────── */
  const due = stays.filter(
    (s) => s.status === "due-in" && s.arrival === BUSINESS_DATE,
  );
  if (due.length) {
    out.push({
      id: "arrivals-outstanding",
      hotelId,
      category: "reservation",
      title: `${due.length} arrival${due.length === 1 ? "" : "s"} not yet checked in`,
      body: due
        .map((s) => `${s.guest} · room ${s.roomNumber}`)
        .slice(0, 3)
        .join(", ") + (due.length > 3 ? ` and ${due.length - 3} more` : ""),
      isRead: false,
      at,
      link: `/h/${hotelId}/arrivals`,
      actionRequired: true,
    });
  }

  /* ── Money leaving the building ────────────────────────────────── */
  const owing = stays
    .filter((s) => s.status === "due-out" || s.departure === BUSINESS_DATE)
    .filter((s) => s.status !== "checked-out" && s.status !== "cancelled")
    .map((s) => ({ stay: s, balance: balanceOf(s.id) }))
    .filter((r) => r.balance > 0.5);

  for (const { stay, balance } of owing) {
    out.push({
      id: `balance-${stay.id}`,
      hotelId,
      category: "payment",
      title: `${money(balance)} outstanding on room ${stay.roomNumber}`,
      body: `${stay.guest} is due out today. Settle the folio before the room releases.`,
      isRead: false,
      at,
      link: `/h/${hotelId}/folios`,
      actionRequired: true,
    });
  }

  /* ── Refunds. An overpayment is the hotel holding someone's money ─ */
  const overpaid = stays
    .map((s) => ({ stay: s, balance: balanceOf(s.id) }))
    .filter((r) => r.balance < -0.5);

  for (const { stay, balance } of overpaid) {
    out.push({
      id: `refund-${stay.id}`,
      hotelId,
      category: "payment",
      title: `${money(balance)} to refund — ${stay.guest}`,
      body: `Room ${stay.roomNumber} is paid beyond its charges. The hotel is holding money that is not its own.`,
      isRead: false,
      at,
      link: `/h/${hotelId}/folios`,
      actionRequired: true,
    });
  }

  /* ── Rooms out of the sellable house ───────────────────────────── */
  const oos = readRooms().filter((r) => r.housekeeping === "out-of-service");
  if (oos.length) {
    out.push({
      id: "rooms-out-of-service",
      hotelId,
      category: "system",
      title: `${oos.length} room${oos.length === 1 ? "" : "s"} out of service`,
      body: `Room ${oos.map((r) => r.number).join(", ")}. Occupancy divides by the sellable house, not the physical one.`,
      isRead: false,
      at,
      link: `/h/${hotelId}/housekeeping`,
      actionRequired: false,
    });
  }

  /* ── Reversals. Every one is somebody correcting something ─────── */
  const reversals = readPostings().filter(
    (p) => p.kind === "reversal" && p.businessDate === BUSINESS_DATE,
  );
  if (reversals.length) {
    out.push({
      id: "reversals-today",
      hotelId,
      category: "approval",
      title: `${reversals.length} posting${reversals.length === 1 ? "" : "s"} reversed today`,
      body: "The ledger is append-only, so each reversal is its own line. Worth a look before the night audit.",
      isRead: false,
      at,
      link: `/h/${hotelId}/admin/audit-log`,
      actionRequired: false,
    });
  }

  return out.map((n) => ({ ...n, isRead: dismissed.has(n.id) }));
}

export const notificationsRepo = {
  /** Conditions worth someone's attention, recomputed on every read. */
  list: async (hotelId: string): Promise<Notification[]> => build(hotelId),

  markRead: async (hotelId: string, id: string): Promise<Notification | null> => {
    dismissed.add(id);
    return build(hotelId).find((n) => n.id === id) ?? null;
  },

  markAllRead: async (hotelId: string): Promise<number> => {
    const unread = build(hotelId).filter((n) => !n.isRead);
    for (const n of unread) dismissed.add(n.id);
    return unread.length;
  },

  /**
   * Nothing to create. A notification here is a query, so the way to
   * raise one is to create the condition it describes.
   */
  create: async (): Promise<null> => null,
};

export const useNotifications = (hotelId: string) => ({
  queryKey: ["notifications", hotelId],
  queryFn: () => notificationsRepo.list(hotelId),
});
