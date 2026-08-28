import { reservations, getReservationsForDateRange, getArrivalsForDate, getDeparturesForDate, getInHouseForDate, type Reservation } from "@/data/fixtures/reservations";
import { queryKeys } from "./index";

/* ══════════════════════════════════════════════════════════════════
   RESERVATIONS REPOSITORY
   Rule 2: Screens import from here, never from fixtures directly.
   Every function takes hotelId first. Returns promises.             ════ */

export const reservationsRepo = {
  /** All reservations for a property */
  list: async (hotelId: string): Promise<Reservation[]> => {
    return reservations.filter((r) => r.hotelId === hotelId);
  },

  /** Single reservation by id */
  get: async (hotelId: string, id: string): Promise<Reservation | null> => {
    return reservations.find((r) => r.hotelId === hotelId && r.id === id) ?? null;
  },

  /** Arrivals on a specific date */
  arrivals: async (hotelId: string, date: string): Promise<Reservation[]> => {
    return getArrivalsForDate(date).filter((r) => r.hotelId === hotelId);
  },

  /** Departures on a specific date */
  departures: async (hotelId: string, date: string): Promise<Reservation[]> => {
    return getDeparturesForDate(date).filter((r) => r.hotelId === hotelId);
  },

  /** In-house guests on a specific date */
  inHouse: async (hotelId: string, date: string): Promise<Reservation[]> => {
    return getInHouseForDate(date).filter((r) => r.hotelId === hotelId);
  },

  /** Reservations overlapping a date range */
  overlapping: async (hotelId: string, from: string, to: string): Promise<Reservation[]> => {
    return getReservationsForDateRange(from, to).filter((r) => r.hotelId === hotelId);
  },

  /** Update reservation status */
  updateStatus: async (hotelId: string, id: string, status: Reservation["status"]): Promise<Reservation> => {
    const idx = reservations.findIndex((r) => r.hotelId === hotelId && r.id === id);
    if (idx === -1) throw new Error(`Reservation ${id} not found`);
    reservations[idx] = { ...reservations[idx], status, updatedAt: new Date().toISOString() };
    return reservations[idx];
  },

  /** Assign a room to a reservation */
  assignRoom: async (hotelId: string, id: string, roomNumber: string): Promise<Reservation> => {
    const idx = reservations.findIndex((r) => r.hotelId === hotelId && r.id === id);
    if (idx === -1) throw new Error(`Reservation ${id} not found`);
    reservations[idx] = { ...reservations[idx], roomNumber, updatedAt: new Date().toISOString() };
    return reservations[idx];
  },
};

/* TanStack Query helpers — hotelId in every key (Rule 5) */

export const useReservations = (hotelId: string) => ({
  queryKey: queryKeys.stays(hotelId),
  queryFn: () => reservationsRepo.list(hotelId),
});

export const useReservation = (hotelId: string, id: string) => ({
  queryKey: queryKeys.stay(hotelId, id),
  queryFn: () => reservationsRepo.get(hotelId, id),
});

export const useArrivals = (hotelId: string, date: string) => ({
  queryKey: queryKeys.arrivals(hotelId, date),
  queryFn: () => reservationsRepo.arrivals(hotelId, date),
});

export const useDepartures = (hotelId: string, date: string) => ({
  queryKey: queryKeys.departures(hotelId, date),
  queryFn: () => reservationsRepo.departures(hotelId, date),
});

export const useInHouse = (hotelId: string, date: string) => ({
  queryKey: queryKeys.inHouse(hotelId, date),
  queryFn: () => reservationsRepo.inHouse(hotelId, date),
});

export const useOverlapping = (hotelId: string, from: string, to: string) => ({
  queryKey: queryKeys.stays(hotelId, { from, to }),
  queryFn: () => reservationsRepo.overlapping(hotelId, from, to),
});