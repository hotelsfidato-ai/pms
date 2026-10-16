import { api, ApiError } from "@/lib/api";
import { call } from "@/data/repositories/http";
import type { ImportReport } from "@/data/repositories/importReport";

/* ══════════════════════════════════════════════════════════════════
   SETTING UP WHAT THE PROPERTY SELLS

   Until this existed, nothing in the interface could add a room type
   or a room. `provision_property` builds a whole hotel from a template
   in one act; after that, adding a Deluxe or a room 308 meant SQL.

   Six of the seven properties are not configured yet, so this is not a
   convenience.

   NO PRICE IS SET HERE. A new room type is UNPRICED — its rack rate is
   set on the rate calendar by somebody who has decided what the room
   is worth. Defect 63 is this system shipping prices nobody at the
   hotel chose, and a create form with 3500 already in the box is the
   same fault wearing a hat.
   ══════════════════════════════════════════════════════════════════ */

export interface RoomTypeSetup {
  id: string;
  code: string;
  name: string;
  /** How many people the rate covers before an extra-person charge. */
  baseOccupancy: number;
  maxOccupancy: number;
  sortOrder: number;
  isActive: boolean;
  /** Null until somebody prices it. A dash on screen, never a zero. */
  rackRate: number | null;
  rooms: number;
  /** Physical rooms minus the ones switched off. */
  sellable: number;
  /* The Settings console (D27-258): null where nobody said. */
  baseChildren: number;
  maxAdults: number | null;
  maxChildren: number | null;
  beds: string | null;
  viewType: string | null;
  sizeSqft: number | null;
  colour: string | null;
}

export interface RoomSetup {
  id: string;
  number: string;
  roomTypeId: string;
  roomType: string;
  floor: number | null;
  smoking: boolean;
  isActive: boolean;
  /** Somebody is in it. Such a room cannot be retired — it is blocked,
      which carries dates and a reason. */
  occupied: boolean;
  /** The order the rooms are dragged into (D27-258). */
  position: number;
}

export interface FrontDeskSettings {
  /** 24-hour, the property's own clock. */
  checkInTime: string;
  checkOutTime: string;
  /** Null when the property does not charge. Not zero — "we do not
      charge" is a decision and "we charge nothing" is a price, and the
      screens show a dash for the first. */
  earlyCheckinCharge: number | null;
  lateCheckoutCharge: number | null;
  /** D27-338: today's night audit opens at this time (16:00 to begin). */
  nightAuditOpensAt: string;
}

export interface RoomSetupView {
  frontDesk: FrontDeskSettings;
  types: RoomTypeSetup[];
  rooms: RoomSetup[];
}

export async function getRoomSetup(
  hotelId: string,
): Promise<RoomSetupView | null> {
  if (!hotelId) return null;
  try {
    return await api<RoomSetupView>(`/api/hotels/${hotelId}/room-setup`);
  } catch {
    return null;
  }
}

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

export async function addRoomType(
  hotelId: string,
  input: {
    code: string; name: string;
    baseOccupancy: number; maxOccupancy: number; sortOrder?: number;
  },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${hotelId}/room-types`, "POST", input);
}

export async function amendRoomType(
  hotelId: string, id: string,
  input: {
    name?: string; baseOccupancy?: number; maxOccupancy?: number;
    sortOrder?: number; isActive?: boolean;
    baseChildren?: number; maxAdults?: number | null; maxChildren?: number | null;
    beds?: string | null; viewType?: string | null; sizeSqft?: number | null; colour?: string | null;
  },
): Promise<Result> {
  return call(`/api/hotels/${hotelId}/room-types/${id}`, "PATCH", input);
}

/** Only a type nothing uses (D27-263); the server says what does. */
export const removeRoomType = (hotelId: string, id: string): Promise<Result> =>
  call(`/api/hotels/${hotelId}/room-types/${id}`, "DELETE");

export const orderRooms = (hotelId: string, numbers: string[]): Promise<Result> =>
  call(`/api/hotels/${hotelId}/rooms/order`, "PUT", { numbers });

export interface TypePhoto { id: string; caption: string | null; width: number; height: number }
export const getTypePhotos = (hotelId: string, typeId: string) =>
  api<{ photos: TypePhoto[]; most: number }>(`/api/hotels/${hotelId}/room-types/${typeId}/photos`);
export const getTypePhoto = (hotelId: string, typeId: string, photoId: string) =>
  api<{ type: string; data: string }>(`/api/hotels/${hotelId}/room-types/${typeId}/photos/${photoId}`);
export const addTypePhoto = (hotelId: string, typeId: string, data: string): Promise<Result> =>
  call(`/api/hotels/${hotelId}/room-types/${typeId}/photos`, "POST", { data });
export const removeTypePhoto = (hotelId: string, typeId: string, photoId: string): Promise<Result> =>
  call(`/api/hotels/${hotelId}/room-types/${typeId}/photos/${photoId}`, "DELETE");
export const orderTypePhotos = (hotelId: string, typeId: string, ids: string[]): Promise<Result> =>
  call(`/api/hotels/${hotelId}/room-types/${typeId}/photos/order`, "PUT", { ids });

export interface Amenity { id: string; name: string; isActive: boolean }
/** P2's one catalogue (GET /amenities), and the ones this type has. */
export const getAmenities = (hotelId: string) =>
  api<{ amenities: Amenity[] }>(`/api/hotels/${hotelId}/amenities`);
export const getTypeAmenities = (hotelId: string, typeId: string) =>
  api<{ amenityIds: string[] }>(`/api/hotels/${hotelId}/room-types/${typeId}/amenities`);
export const setTypeAmenities = (hotelId: string, typeId: string, amenityIds: string[]): Promise<Result> =>
  call(`/api/hotels/${hotelId}/room-types/${typeId}/amenities`, "PUT", { amenityIds });

export async function addRoom(
  hotelId: string,
  input: {
    number: string; roomTypeId: string; floor?: number | null;
    smoking?: boolean;
  },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${hotelId}/rooms`, "POST", input);
}

export async function amendRoom(
  hotelId: string, number: string,
  input: {
    roomTypeId?: string; floor?: number | null; smoking?: boolean;
    isActive?: boolean;
  },
): Promise<Result> {
  return call(
    `/api/hotels/${hotelId}/rooms/${encodeURIComponent(number)}`,
    "PATCH", input);
}

/** Only a room nothing has used (D27-336); the server says what has. */
export const removeRoom = (hotelId: string, number: string): Promise<Result> =>
  call(`/api/hotels/${hotelId}/rooms/${encodeURIComponent(number)}`, "DELETE");


/** The hours the property sells the night between, and what an
    exception costs. Sending null for a charge clears it. */
export async function amendFrontDesk(
  hotelId: string,
  input: {
    checkInTime?: string; checkOutTime?: string;
    earlyCheckinCharge?: number | null;
    lateCheckoutCharge?: number | null;
    /** The owner's and an admin's (D27-338): sent only when changed. */
    nightAuditOpensAt?: string;
  },
): Promise<Result> {
  return call(`/api/hotels/${hotelId}/front-desk`, "PATCH", input);
}

/** Import room types, or rooms, from a file.

    Same two-pass shape as the menu: a dry run that changes nothing and
    reports what would happen, then the identical payload to apply. The
    endpoint differs; the contract does not, which is why one dialog
    serves all three. */
export async function importSetup(
  hotelId: string,
  what: "room-types" | "rooms",
  rows: Record<string, string>[],
  dryRun: boolean,
): Promise<ImportReport> {
  try {
    return await api<ImportReport>(
      `/api/hotels/${hotelId}/${what}/import`,
      { method: "POST", body: JSON.stringify({ rows, dryRun }) },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return {
        ok: false, reason: p?.reason ?? error.message, dryRun,
        verdicts: [], creates: 0, updates: 0, rejected: 0,
      };
    }
    throw error;
  }
}
