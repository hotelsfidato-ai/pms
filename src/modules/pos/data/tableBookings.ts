import { api } from "@/lib/api";
import type { AdminResult } from "@/data/repositories/result";
import { write, put } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   TABLE BOOKINGS - the restaurant's side (the owner's D27-221, D27-224)

   A hotel guest asks for a table from their own page; a person here
   confirms it (a table if they like) or declines it with a reason the
   guest reads. Every refusal comes back as the server's sentence.
   ══════════════════════════════════════════════════════════════════ */

export interface TableBooking {
  id: string;
  /** When, as the server keeps it; \`date\` and \`time\` are the hotel's own. */
  at: string;
  date: string;
  time: string;
  party: number;
  note: string | null;
  /** On the night (263): arrived, seated at a table (its bill opened), a no-show. */
  status: "requested" | "confirmed" | "declined" | "cancelled" | "arrived" | "seated" | "no_show";
  /** A decline's reason, which the guest reads; a cancellation's, if one was given. */
  answer: string | null;
  table: { id: string; label: string } | null;
  outlet: string;
  /** The hotel guest's name, or the outside diner's. */
  guest: string;
  /** Null for an outside diner, who has no stay. */
  reference: string | null;
  room: string | null;
  answeredBy: string | null;
  /** Somebody not staying (263), with their own phone. Optional: an answer
      from before it has no such keys. */
  outside?: boolean;
  phone?: string | null;
  /** The area asked for, when no table is named. */
  section?: { id: string; name: string } | null;
  /** When they arrived, HH:MM on the hotel's clock. */
  arrivedAt?: string | null;
  /** The bill seating it opened. */
  order?: { id: string; orderNo: string } | null;
}

export interface TableBookingList {
  /** The hotel's today, "YYYY-MM-DD". */
  today: string;
  bookings: TableBooking[];
  /** The restaurant's tables, for Confirm's and Seat's pickers. */
  tables: { id: string; label: string; section?: string | null }[];
  /** Its areas, for a booking with no table yet. */
  sections?: { id: string; name: string }[];
}

/** Waiting first, then the chosen day (the hotel's today) and after. */
export const getTableBookings = (hotelId: string, date?: string) =>
  api<TableBookingList>(`/api/hotels/${hotelId}/table-bookings${date ? `?date=${date}` : ""}`);

export interface OutsideBooking {
  name: string; phone: string; party: number; date: string; time: string;
  tableId?: string | null; sectionId?: string | null; note?: string;
}
/** A table for somebody not staying (263): confirmed as it is taken. */
export const bookOutsideDiner = (hotelId: string, input: OutsideBooking): Promise<AdminResult> =>
  write(`/api/hotels/${hotelId}/table-bookings`, input);

/** On the night: arrived, seated at a table (which opens its bill), a no-show, cancelled. */
export const markArrived = (hotelId: string, id: string): Promise<AdminResult> =>
  write(`/api/hotels/${hotelId}/table-bookings/${id}/arrive`, {});
export const seatBooking = (hotelId: string, id: string, tableId: string): Promise<AdminResult> =>
  write(`/api/hotels/${hotelId}/table-bookings/${id}/seat`, { tableId });
export const markNoShow = (hotelId: string, id: string): Promise<AdminResult> =>
  write(`/api/hotels/${hotelId}/table-bookings/${id}/no-show`, {});
export const cancelBooking = (hotelId: string, id: string, reason: string): Promise<AdminResult> =>
  write(`/api/hotels/${hotelId}/table-bookings/${id}/cancel`, { reason });

export const confirmTableBooking = (hotelId: string, id: string, tableId: string | null): Promise<AdminResult> =>
  write(`/api/hotels/${hotelId}/table-bookings/${id}/confirm`, { tableId });

export const declineTableBooking = (hotelId: string, id: string, reason: string): Promise<AdminResult> =>
  write(`/api/hotels/${hotelId}/table-bookings/${id}/decline`, { reason });

/* ── The hours, on Restaurant setup ────────────────────────────────── */

export interface TableHours {
  code: string;
  name: string;
  /** "12:30-15:00", or "" when that meal is not offered. */
  lunch: string;
  dinner: string;
  /** Today's slots those hours give, in the hotel's time. */
  slots: string[];
}

export const getTableHours = (hotelId: string) =>
  api<{ restaurants: TableHours[] }>(`/api/hotels/${hotelId}/table-bookings/hours`);

export const setTableHours = (hotelId: string, outlet: string, lunch: string, dinner: string): Promise<AdminResult> =>
  put(`/api/hotels/${hotelId}/table-bookings/hours`, { outlet, lunch, dinner });
