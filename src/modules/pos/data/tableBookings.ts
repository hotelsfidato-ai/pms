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
  status: "requested" | "confirmed" | "declined" | "cancelled";
  /** A decline's reason, which the guest reads. */
  answer: string | null;
  table: { id: string; label: string } | null;
  outlet: string;
  guest: string;
  reference: string;
  room: string | null;
  answeredBy: string | null;
}

export interface TableBookingList {
  /** The hotel's today, "YYYY-MM-DD". */
  today: string;
  bookings: TableBooking[];
  /** The restaurant's tables, for Confirm's picker. */
  tables: { id: string; label: string }[];
}

export const getTableBookings = (hotelId: string) =>
  api<TableBookingList>(`/api/hotels/${hotelId}/table-bookings`);

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
