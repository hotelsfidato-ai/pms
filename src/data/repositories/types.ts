export type { Stay, Folio, StayStatus, Source } from "../fixtures/reservations";

/* ══════════════════════════════════════════════════════════════════
   The shapes screens are allowed to know about.

   Screens import from `@/data/repositories` and never from
   `@/data/fixtures`. When this project moves onto the real database,
   the fixtures folder disappears and these signatures do not.
   ══════════════════════════════════════════════════════════════════ */

export interface Room {
  number: string;
  type: string;
  floor: number;
  /** Independent of occupancy — a room can be occupied and dirty. */
  status: string;
  maxOccupancy: number;
}

export interface Property {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
  rooms: number;
  roomTypes: string[];
  rateTypes: string[];
  tax: { cgst: number; sgst: number };
  paymentMethods: string[];
}

export interface DayStatistics {
  date: string;
  availableRooms: number;
  roomsSold: number;
  occupancyPct: number;
}

export interface PeriodStatistics {
  from: string;
  to: string;
  availableRoomNights: number;
  roomsSold: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
  roomRevenue: number;
}

/** Rule 6 — a blocked action is shown disabled with a reason, never hidden. */
export interface Permitted {
  allowed: boolean;
  reason?: string;
}
