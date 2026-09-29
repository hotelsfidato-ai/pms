import { api, ApiError } from "@/lib/api";
import type { Stay } from "@/data/repositories/types";
import { fetchStays } from "@/modules/front-desk";

/* ══════════════════════════════════════════════════════════════════
   A GROUP, AND WHO PAYS FOR IT

   Twelve rooms under "Sharma Wedding". The host settles the
   accommodation; every guest pays their own bar tab.

   That was never a choice between one folio and twelve. `folios` has
   been many-per-reservation since 006, with `reservation_id` nullable
   precisely so a master could exist — the group is BOTH: a master
   folio for the host, and each room's own folio for its extras.

   TWO BALANCES, NEVER ONE. What the host owes and what the guests owe
   are different debts settled by different people, and one combined
   number tells nobody what to collect from whom.
   ══════════════════════════════════════════════════════════════════ */

export interface GroupRoom {
  reservationId: string;
  reference: string;
  guest: string;
  /** Null once they have left — the assignment is released, and
      inventing a room number for somebody who has gone would put them
      back in it. */
  room: string | null;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: string;
  agreedRate: number;
  /** True when this room's charge goes to the host's account. Per
      room, not per group: the couple's own room is usually settled by
      them while the rest go to the host. */
  routed: boolean;
  /** What is on this stay's OWN folio — its extras, and its room
      charge too when it is not routed. */
  balance: number;
  /** How many people. The first thing anybody asks about a group: nine
      rooms is meaningless until you know whether it is nine couples or
      nine families, and it is what housekeeping sets the beds from. */
  adults: number;
  children: number;
}

export interface GroupMasterLine {
  date: string;
  description: string;
  category: string;
  amount: number;
  /** Which room the line is for. A master folio holding twelve room
      charges is unreadable without it. */
  room: string | null;
}

export interface GroupDetail {
  id: string;
  name: string;
  blockCode: string | null;
  company: string | null;
  notes: string | null;
  /** The group's lead room (D22-52): the one the desk assigned, else the
      room booked first that still stands. Null when no room stands. */
  leadId: string | null;
  rooms: GroupRoom[];
  /** Null until somebody opens one. Most groups never need one —
      a block where everybody settles their own room has no host
      account to keep. */
  master: { id: string; balance: number; lines: GroupMasterLine[] } | null;
  /** The sum of the rooms' own folios. Kept apart from the master's
      balance on purpose. */
  guestBalance: number;
}

export async function getGroup(
  hotelId: string, groupId: string,
): Promise<GroupDetail | null> {
  if (!hotelId || !groupId) return null;
  try {
    return await api<GroupDetail>(`/api/hotels/${hotelId}/groups/${groupId}`);
  } catch {
    return null;
  }
}

type Refused = { ok: true } | { ok: false; reason: string };

/** Opens the host's account. Calling it twice is not an error — the
    second call returns the one that already exists. */
export async function openMasterFolio(
  hotelId: string, groupId: string,
): Promise<Refused> {
  return post(`/api/hotels/${hotelId}/groups/${groupId}/master`, {});
}

/**
 * Says whether this room's charge goes to the host.
 *
 * ROOM CHARGES ONLY. A bar tab follows whoever signed for it, which
 * is the arrangement every hotel operates and the one a guest expects.
 */
export async function routeRoomToGroup(
  hotelId: string, stayId: string, toGroup: boolean,
): Promise<Refused> {
  return post(`/api/hotels/${hotelId}/stays/${stayId}/routing`, { toGroup });
}

/** Makes this room the group's lead: its guest gets the group's one
    confirmation and its one review request (D22-52, D22-10). */
export async function setGroupLead(
  hotelId: string, groupId: string, reservationId: string,
): Promise<Refused> {
  return post(`/api/hotels/${hotelId}/groups/${groupId}/lead`, { reservationId });
}

async function post(path: string, body: unknown): Promise<Refused> {
  try {
    await api(path, { method: "POST", body: JSON.stringify(body) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}


/* ── Booking several rooms at once ─────────────────────────────────
   Four Deluxes and two Superiors for the same three nights. A group
   is created only for MORE than one room — inventing a group of one
   puts a row in every group list that nobody means. */

export interface BookingLine {
  roomTypeId: string;
  mealPlan?: string;
  adults?: number;
  children?: number;
  rooms?: number;
  /** A rate somebody negotiated. Absent means "use the calendar", and
      the server refuses rather than guessing when the calendar has no
      price for the party. */
  agreedRate?: number;
  /** ₹0 and nothing posted; the owner, an administrator or the GM only. */
  complimentary?: boolean;
}

export async function createBooking(
  hotelId: string,
  input: {
    guestName: string; phone?: string; email?: string;
    checkIn: string; checkOut: string;
    groupName?: string; blockCode?: string;
    /* ⚠ REQUIRED. The channel the booking arrived through, as a row in
       booking_sources. `source` is the free text 042 left behind and is
       still accepted so nothing older breaks — but a booking with no
       channel is refused by the server, and cannot be corrected later
       because nobody remembers where a booking came from a week on. */
    bookingSourceId: string;
    source?: string; businessSource?: string; marketSegment?: string;
    /** The hour they said they would arrive, 24-hour. Absent when they
        did not say — which is most bookings, and is not midnight. */
    expectedArrival?: string;
    lines: BookingLine[];
    /** The returning guest the clerk confirmed (D21-20). The server checks
        it again against the phone and email typed. */
    guestId?: string;
    /** "Guest agreed to WhatsApp" (D21-72). */
    whatsappAgreed?: boolean;
    /** "Guest agreed to offers" - kept against the phone and email (D25-39). */
    offersAgreed?: boolean;
    /* Phase 1 (D27-33), each checked on the server. */
    /** Waiting for the hotel: holds the room, sends nothing. */
    tentative?: boolean;
    expectedDeparture?: string;
    salesPerson?: string;
    /** Bill to this company. */
    companyId?: string;
    discount?: { percent?: number; reason?: string; promotionId?: string };
    title?: string;
    nationality?: string;
    address?: {
      addressLine?: string; city?: string; state?: string;
      pincode?: string; country?: string;
    };
    /** D27-163: the one page's Notes box, and the walk-in's tick. */
    notes?: string;
    isSingleLady?: boolean;
    /** The lead's campaign, when the booking came from "Book this lead" (D27-170). */
    campaign?: string;
  },
): Promise<
  | { ok: true; groupId: string | null; rooms: number; guest: string;
      /** `id` is the stay's, for front desk's doors. Optional: a booking
          queued offline before Phase 1 was answered without one. */
      bookings: { id?: string; reference: string; roomType: string; rate: number }[];
      nightly: number; status?: "confirmed" | "tentative" }
  | { ok: false; reason: string }
> {
  try {
    return await api(`/api/hotels/${hotelId}/bookings`, {
      method: "POST", body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

const clone = <T,>(rows: T[]): T[] => rows.map((r) => ({ ...r }));

/* ── Groups ───────────────────────────────────────────────────────── */

export interface StayGroup {
  id: string;
  hotelId: string;
  name: string;
  reference: string;
  company: string | null;
  rooms: number;
  /** Room-nights across the group, summed from the bookings. */
  nights: number;
  arrival: string;
  departure: string;

  /* WHERE THE GROUP IS TODAY. Counted from the rooms, never stored — a
     group whose bookings have been amended must not keep reporting the
     shape it had when it was made. */
  inHouse: number;
  dueIn: number;
  departed: number;
  cancelled: number;

  /** How many rooms bill to the host. Per room, not per group. */
  routedRooms: number;

  /** What the HOST owes. Null when there is no host account, which is
      most groups — and null is not zero, which would say the host owes
      nothing when there is no host. */
  masterBalance: number | null;
  /** The sum of the rooms' own folios. Kept apart from the master's:
      adding them produces a number nobody is being asked to pay. */
  guestBalance: number;
}

export async function listGroups(
  hotelId: string, scope: "current" | "all" = "current",
): Promise<StayGroup[]> {
  if (!hotelId) return [];
  try {
    return await api<StayGroup[]>(
      `/api/hotels/${hotelId}/groups?scope=${scope}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

export async function listGroupMembers(
  hotelId: string,
  groupId: string,
): Promise<Stay[]> {
  return clone((await fetchStays(hotelId)).filter((s) => s.groupId === groupId));
}
