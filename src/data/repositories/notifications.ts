
/* ═════════════════════════════════════════════════════════════════
   NOTIFICATIONS REPOSITORY
   Rule 2: Screens import from here, never from fixtures directly.
   Every function takes hotelId first. Returns promises.             ═════ */

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

/* Demo notifications */
const demoNotifications: Notification[] = [
  {
    id: "notif-001",
    hotelId: "5-elements-akkalkot",
    category: "reservation",
    title: "New arrival: Rajesh Sharma (TechCorp group)",
    body: "Room 301 assigned. Guest arriving at 14:00.",
    isRead: false,
    at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    link: "/h/5-elements-akkalkot/arrivals",
    actionRequired: false,
  },
  {
    id: "notif-002",
    hotelId: "5-elements-akkalkot",
    category: "approval",
    title: "Rate override requested for room 206",
    body: "Front desk requested ₹3,800 (rack ₹4,500) for Agoda booking. Requires manager approval.",
    isRead: false,
    at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    link: "/h/5-elements-akkalkot/reservations/res-007",
    actionRequired: true,
  },
  {
    id: "notif-003",
    hotelId: "5-elements-akkalkot",
    category: "payment",
    title: "Payment failed: GoMMT settlement",
    body: "₹45,000 settlement for July bookings declined. Retry initiated.",
    isRead: true,
    at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    actionRequired: false,
  },
  {
    id: "notif-004",
    hotelId: "5-elements-akkalkot",
    category: "system",
    title: "Night audit completed successfully",
    body: "Business date rolled to 26/08/2026. 17 rooms posted, ₹1,24,500 revenue.",
    isRead: true,
    at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    actionRequired: false,
  },
  {
    id: "notif-005",
    hotelId: "5-elements-akkalkot",
    category: "customer",
    title: "Guest complaint: Room 304 AC noise",
    body: "Guest reports loud AC unit. Engineering dispatched. Complimentary minibar offered.",
    isRead: false,
    at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    link: "/h/5-elements-akkalkot/folios/res-008",
    actionRequired: true,
  },
];

export const notificationsRepo = {
  /** List notifications for a property */
  list: async (hotelId: string): Promise<Notification[]> => {
    return demoNotifications
      .filter((n) => n.hotelId === hotelId)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  },

  /** Mark a single notification as read */
  markRead: async (hotelId: string, id: string): Promise<Notification | null> => {
    const notif = demoNotifications.find((n) => n.hotelId === hotelId && n.id === id);
    if (notif) {
      notif.isRead = true;
      return notif;
    }
    return null;
  },

  /** Mark all notifications as read */
  markAllRead: async (hotelId: string): Promise<number> => {
    let count = 0;
    for (const n of demoNotifications) {
      if (n.hotelId === hotelId && !n.isRead) {
        n.isRead = true;
        count++;
      }
    }
    return count;
  },

  /** Create a notification (for testing/demo) */
  create: async (hotelId: string, notification: Omit<Notification, "id" | "hotelId" | "at">): Promise<Notification> => {
    const newNotif: Notification = {
      ...notification,
      id: `notif-${Date.now()}`,
      hotelId,
      at: new Date().toISOString(),
    };
    demoNotifications.unshift(newNotif);
    return newNotif;
  },
};

/* TanStack Query helpers */

export const useNotifications = (hotelId: string) => ({
  queryKey: ["notifications", hotelId],
  queryFn: () => notificationsRepo.list(hotelId),
});