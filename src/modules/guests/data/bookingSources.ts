import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   BOOKING SOURCES

   The list belongs to the GROUP; the commission belongs to the
   PROPERTY. Every call here is addressed with a hotel id because that
   is where the person is standing, but adding "Agoda" adds it
   everywhere and setting 18% against Agoda sets it here only. The
   screen has to say so — a path that reads `/h/AKK/booking-sources`
   invites exactly the wrong assumption.

   ⚠ NULL IS NOT ZERO, ALL THE WAY THROUGH. A source with no rate
   agreed at this property carries `commissionPct: null` and the screen
   renders a dash. Zero is a different statement — "we agreed we pay
   them nothing" — and a manager is allowed to make it. Nothing in this
   file converts one into the other; `?? 0` anywhere below would be
   defect 63 arriving through a new door.
   ══════════════════════════════════════════════════════════════════ */

/** ota | direct | corporate | travel_agent | walk_in | other. */
export type BookingSourceKind =
  | "ota" | "direct" | "corporate" | "travel_agent" | "walk_in" | "other";

export interface BookingSource {
  id: string;
  name: string;
  /** What the name cannot answer: how much came through OTAs at all. */
  kind: BookingSourceKind;
  /** What a channel manager will send. Null until there is one — a
      walk-in has none and never will. */
  channelCode: string | null;
  isActive: boolean;
  /** THIS property's rate. Null means nobody has agreed one. */
  commissionPct: number | null;
  /** How many bookings at this property came through it. */
  bookings: number;
}

export const SOURCE_KINDS: { value: BookingSourceKind; label: string }[] = [
  { value: "ota", label: "OTA" },
  { value: "travel_agent", label: "Travel agent" },
  { value: "corporate", label: "Corporate account" },
  { value: "direct", label: "Direct" },
  { value: "walk_in", label: "Walk-in" },
  { value: "other", label: "Other" },
];

export const kindLabel = (kind: string): string =>
  SOURCE_KINDS.find((k) => k.value === kind)?.label ?? kind;

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

async function call<T>(
  path: string, method: string, body?: unknown,
): Promise<Result<T>> {
  try {
    const out = await api<T & { ok?: boolean }>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(out as T), ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export async function listBookingSources(
  hotelId: string,
): Promise<BookingSource[]> {
  if (!hotelId) return [];
  return api<BookingSource[]>(`/api/hotels/${hotelId}/booking-sources`);
}

/** Adds it for the WHOLE GROUP. Managers only — the server refuses a
    clerk with a sentence rather than a 500. */
export async function addBookingSource(
  hotelId: string,
  input: { name: string; kind: BookingSourceKind; channelCode?: string },
): Promise<Result<{ source: BookingSource }>> {
  return call(`/api/hotels/${hotelId}/booking-sources`, "POST", input);
}

/** Rename, re-classify, re-code, or take out of use. A source is never
    deleted — bookings point at it, and a booking whose origin vanished
    is one nobody can explain.

    `channelCode: null` clears it; omitting the field leaves it alone. */
export async function amendBookingSource(
  hotelId: string, id: string,
  input: {
    name?: string; kind?: BookingSourceKind;
    channelCode?: string | null; isActive?: boolean;
  },
): Promise<Result<{ source: BookingSource }>> {
  return call(`/api/hotels/${hotelId}/booking-sources/${id}`, "PATCH", input);
}

/** THIS property's commission. `null` means no rate agreed, and is not
    the same as 0 — see the note at the top of this file. */
export async function setBookingSourceCommission(
  hotelId: string, id: string, commissionPct: number | null,
): Promise<Result<{ source: BookingSource }>> {
  return call(
    `/api/hotels/${hotelId}/booking-sources/${id}/commission`,
    "PUT", { commissionPct });
}
