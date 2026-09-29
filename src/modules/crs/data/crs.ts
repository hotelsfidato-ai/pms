import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE CRS BRIDGE - the seam (D27-168, D27-171)

   What the reader did with each booking the CRS sold for this hotel, and
   the owner's mapping of the hotel and its room types to the CRS's ids.
   The PMS only ever READS the CRS; nothing here writes to it.
   ══════════════════════════════════════════════════════════════════ */

export interface CrsBooking {
  /** The CRS's document id: the key that never repeats. */
  crsId: string;
  /** The CRS's booking number (FH-2026-00042). It can repeat. */
  crsReference: string;
  salesperson: string | null;
  company: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  crsStatus: string;
  /** booked · full · needs_attention */
  outcome: string;
  reason: string | null;
  readAt: string;
  /** What changed in the CRS after it arrived here, for the desk to act on. */
  changeNote: string | null;
  changedAt: string | null;
  changeDone: boolean;
  /** What the CRS's register was told, once it was: confirmed · refused · full. */
  answer: string | null;
  answerError: string | null;
  bookings: Array<{ id: string; reference: string; status: string }>;
}

export interface CrsBookings {
  connection: {
    /** The four CRS settings are on the server. Never their values. */
    settingsPresent: boolean;
    mapped: boolean;
    on: boolean;
    lastReadAt: string | null;
    lastError: string | null;
  };
  bookings: CrsBooking[];
}

export const getCrsBookings = (code: string, reservation?: string) =>
  api<CrsBookings>(`/api/hotels/${code}/crs/bookings${
    reservation ? `?reservation=${encodeURIComponent(reservation)}` : ""}`);

export const markCrsNoteDone = (code: string, crsId: string) =>
  api<{ ok: true }>(`/api/hotels/${code}/crs/bookings/${encodeURIComponent(crsId)}/done`,
    { method: "POST" });

export interface CrsSetup {
  crsHotelId: string | null;
  bookingSourceId: string | null;
  isOn: boolean;
  connectedAt: string | null;
  /** The service account the reader works as; set by the master at go-live. */
  readsAs: string | null;
  roomTypes: Array<{ crsRoomTypeId: string; roomTypeId: string }>;
  hotelRoomTypes: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
}

export const getCrsSetup = (code: string) => api<CrsSetup>(`/api/hotels/${code}/crs/setup`);

export const saveCrsSetup = (code: string, setup: {
  crsHotelId: string; bookingSourceId: string; isOn: boolean;
  roomTypes: Array<{ crsRoomTypeId: string; roomTypeId: string }>;
}) => api<{ ok: true }>(`/api/hotels/${code}/crs/setup`, {
  method: "PUT", body: JSON.stringify(setup),
});
