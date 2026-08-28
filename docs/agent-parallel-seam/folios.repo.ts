import { queryKeys } from "./index";

/* ══════════════════════════════════════════════════════════════════
   FOLIOS REPOSITORY
   Rule 2: Screens import from here, never from fixtures directly.
   Every function takes hotelId first. Returns promises.             ═════ */

export interface FolioPosting {
  id: string;
  stayId: string;
  date: string;
  description: string;
  amount: number; // positive = charge, negative = payment
  category: "room" | "food" | "minibar" | "laundry" | "phone" | "other" | "payment" | "adjustment";
  reference?: string;
  createdAt: string;
  createdBy: string;
}

export interface Folio {
  stayId: string;
  guestName: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  postings: FolioPosting[];
  balance: number;
  lastUpdated: string;
}

/* Demo data - in reality this would come from a database */
const demoFolios: Map<string, Folio> = new Map();

function initDemoFolios() {
  if (demoFolios.size > 0) return;

  const now = new Date().toISOString();

  // Folio for res-012 (Current Guest - In House)
  demoFolios.set("res-012", {
    stayId: "res-012",
    guestName: "Current Guest - In House",
    roomNumber: "306",
    checkIn: "2026-08-25",
    checkOut: "2026-08-28",
    postings: [
      { id: "p-001", stayId: "res-012", date: "2026-08-25", description: "Room Charge - Deluxe", amount: 5900, category: "room", reference: "RC-001", createdAt: now, createdBy: "front_desk" },
      { id: "p-002", stayId: "res-012", date: "2026-08-25", description: "Minibar - Water", amount: 150, category: "minibar", reference: "MB-001", createdAt: now, createdBy: "front_desk" },
      { id: "p-003", stayId: "res-012", date: "2026-08-26", description: "Room Charge - Deluxe", amount: 5900, category: "room", reference: "RC-002", createdAt: now, createdBy: "front_desk" },
      { id: "p-004", stayId: "res-012", date: "2026-08-26", description: "Laundry", amount: 450, category: "laundry", reference: "LD-001", createdAt: now, createdBy: "front_desk" },
    ],
    balance: 12400,
    lastUpdated: now,
  });

  // Folio for res-013 (Another In-House Guest)
  demoFolios.set("res-013", {
    stayId: "res-013",
    guestName: "Another In-House Guest",
    roomNumber: "209",
    checkIn: "2026-08-26",
    checkOut: "2026-08-29",
    postings: [
      { id: "p-005", stayId: "res-013", date: "2026-08-26", description: "Room Charge - Superior", amount: 3100, category: "room", reference: "RC-003", createdAt: now, createdBy: "front_desk" },
      { id: "p-006", stayId: "res-013", date: "2026-08-26", description: "Food & Beverage", amount: 850, category: "food", reference: "FB-001", createdAt: now, createdBy: "front_desk" },
    ],
    balance: 3950,
    lastUpdated: now,
  });

  // Folio for res-014 (Due Out Guest) - NEGATIVE BALANCE (overpaid)
  demoFolios.set("res-014", {
    stayId: "res-014",
    guestName: "Due Out Guest",
    roomNumber: "210",
    checkIn: "2026-08-24",
    checkOut: "2026-08-27",
    postings: [
      { id: "p-007", stayId: "res-014", date: "2026-08-24", description: "Room Charge - Superior", amount: 4000, category: "room", reference: "RC-004", createdAt: now, createdBy: "front_desk" },
      { id: "p-008", stayId: "res-014", date: "2026-08-25", description: "Room Charge - Superior", amount: 4000, category: "room", reference: "RC-005", createdAt: now, createdBy: "front_desk" },
      { id: "p-009", stayId: "res-014", date: "2026-08-25", description: "Food & Beverage", amount: 1200, category: "food", reference: "FB-002", createdAt: now, createdBy: "front_desk" },
      { id: "p-010", stayId: "res-014", date: "2026-08-25", description: "Payment - Credit Card", amount: -10000, category: "payment", reference: "PAY-001", createdAt: now, createdBy: "front_desk" }, // Overpaid!
    ],
    balance: -800, // NEGATIVE BALANCE - guest overpaid
    lastUpdated: now,
  });

  // Folio for res-015 (Due In Guest) - pre-arrival, empty
  demoFolios.set("res-015", {
    stayId: "res-015",
    guestName: "Due In Guest",
    roomNumber: "307",
    checkIn: "2026-08-27",
    checkOut: "2026-08-29",
    postings: [],
    balance: 0,
    lastUpdated: now,
  });

  // Folio for res-017 (Overpaid Guest) - checked out, negative balance
  demoFolios.set("res-017", {
    stayId: "res-017",
    guestName: "Overpaid Guest",
    roomNumber: "301",
    checkIn: "2026-08-18",
    checkOut: "2026-08-20",
    postings: [
      { id: "p-011", stayId: "res-017", date: "2026-08-18", description: "Room Charge - Deluxe", amount: 5500, category: "room", reference: "RC-006", createdAt: now, createdBy: "front_desk" },
      { id: "p-012", stayId: "res-017", date: "2026-08-19", description: "Room Charge - Deluxe", amount: 5500, category: "room", reference: "RC-007", createdAt: now, createdBy: "front_desk" },
      { id: "p-013", stayId: "res-017", date: "2026-08-19", description: "Minibar", amount: 350, category: "minibar", reference: "MB-002", createdAt: now, createdBy: "front_desk" },
      { id: "p-014", stayId: "res-017", date: "2026-08-19", description: "Payment - UPI", amount: -12134, category: "payment", reference: "PAY-002", createdAt: now, createdBy: "front_desk" }, // Overpaid!
    ],
    balance: -784, // NEGATIVE BALANCE - matches real data
    lastUpdated: now,
  });
}

export const foliosRepo = {
  /** Get folio for a stay */
  get: async (hotelId: string, stayId: string): Promise<Folio | null> => {
    initDemoFolios();
    return demoFolios.get(stayId) ?? null;
  },

  /** List open folios (guests currently in-house or due out) */
  listOpen: async (hotelId: string): Promise<Folio[]> => {
    initDemoFolios();
    return Array.from(demoFolios.values());
  },

  /** Get all postings for a folio */
  getPostings: async (hotelId: string, stayId: string): Promise<FolioPosting[]> => {
    const folio = await foliosRepo.get(hotelId, stayId);
    return folio?.postings ?? [];
  },

  /** Get folio balance */
  getBalance: async (hotelId: string, stayId: string): Promise<number> => {
    const folio = await foliosRepo.get(hotelId, stayId);
    return folio?.balance ?? 0;
  },

  /** Add a posting (charge or payment) */
  addPosting: async (hotelId: string, stayId: string, posting: Omit<FolioPosting, "id" | "createdAt">): Promise<FolioPosting> => {
    initDemoFolios();
    const folio = demoFolios.get(stayId);
    if (!folio) throw new Error(`Folio for stay ${stayId} not found`);

    const newPosting: FolioPosting = {
      ...posting,
      id: `p-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    folio.postings = [...folio.postings, newPosting];
    folio.balance = folio.postings.reduce((sum, p) => sum + p.amount, 0);
    folio.lastUpdated = newPosting.createdAt;
    demoFolios.set(stayId, folio);

    return newPosting;
  },

  /** Reverse a posting (creates a negative offset) */
  reversePosting: async (hotelId: string, stayId: string, postingId: string, reason: string): Promise<FolioPosting> => {
    initDemoFolios();
    const folio = demoFolios.get(stayId);
    if (!folio) throw new Error(`Folio for stay ${stayId} not found`);

    const original = folio.postings.find((p) => p.id === postingId);
    if (!original) throw new Error(`Posting ${postingId} not found`);

    const reversal: FolioPosting = {
      id: `p-${Date.now()}`,
      stayId,
      date: new Date().toISOString().split("T")[0],
      description: `REVERSAL: ${original.description} — ${reason}`,
      amount: -original.amount,
      category: "adjustment",
      reference: `REV-${original.reference ?? original.id}`,
      createdAt: new Date().toISOString(),
      createdBy: "front_desk",
    };

    folio.postings = [...folio.postings, reversal];
    folio.balance = folio.postings.reduce((sum, p) => sum + p.amount, 0);
    folio.lastUpdated = reversal.createdAt;
    demoFolios.set(stayId, folio);

    return reversal;
  },

  /** Settle a folio (mark as closed) */
  settle: async (hotelId: string, stayId: string, paymentMethod: string, amount: number): Promise<FolioPosting> => {
    return foliosRepo.addPosting(hotelId, stayId, {
      stayId,
      date: new Date().toISOString().split("T")[0],
      description: `Settlement - ${paymentMethod}`,
      amount: -amount,
      category: "payment",
      reference: `SET-${Date.now()}`,
      createdBy: "front_desk",
    });
  },
};

/* TanStack Query helpers */

export const useFolio = (hotelId: string, stayId: string) => ({
  queryKey: queryKeys.folio(hotelId, stayId),
  queryFn: () => foliosRepo.get(hotelId, stayId),
});

export const useFolioPostings = (hotelId: string, stayId: string) => ({
  queryKey: queryKeys.folioPostings(hotelId, stayId),
  queryFn: () => foliosRepo.getPostings(hotelId, stayId),
});

export const useFolioBalance = (hotelId: string, stayId: string) => ({
  queryKey: queryKeys.folioBalance(hotelId, stayId),
  queryFn: () => foliosRepo.getBalance(hotelId, stayId),
});

export const useOpenFolios = (hotelId: string) => ({
  queryKey: queryKeys.openFolios(hotelId),
  queryFn: () => foliosRepo.listOpen(hotelId),
});