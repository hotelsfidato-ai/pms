import { api, ApiError } from "@/lib/api";
import type { ImportReport } from "./till";

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
  },
): Promise<Result> {
  return call(`/api/hotels/${hotelId}/room-types/${id}`, "PATCH", input);
}

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

/** The hours the property sells the night between, and what an
    exception costs. Sending null for a charge clears it. */
export async function amendFrontDesk(
  hotelId: string,
  input: {
    checkInTime?: string; checkOutTime?: string;
    earlyCheckinCharge?: number | null;
    lateCheckoutCharge?: number | null;
  },
): Promise<Result> {
  return call(`/api/hotels/${hotelId}/front-desk`, "PATCH", input);
}

/* ══════════════════════════════════════════════════════════════════
   GST, ONCE, FOR BOTH SIDES OF THE HOUSE

   A KIND is what is being sold. A SLAB is a rate that applies above an
   amount, because the rate on a room turns on what the room costs:
   5% at or under ₹7,500, 18% above it.

   Everything the front desk posts — the night, an early arrival, a
   late departure, laundry — follows 'room'. Every menu category names
   the kind it sells under, which is how a bar section on the same card
   carries a different rate from the food.

   A kind with no slabs is UNSET, and unset refuses to bill. It does
   not bill at zero. That is the same rule as every price in this
   system: a dash is an admission, a zero is a claim.
   ══════════════════════════════════════════════════════════════════ */

export type TaxKind = "room" | "restaurant" | "bar" | "banquet" | "other";

export interface TaxSlab {
  id: string;
  /** The rate applies above this amount. 0 is the base slab, and a
      kind without one has a hole under its lowest rate. */
  overAmount: number;
  rate: number;
  note: string | null;
  setBy: string | null;
}

export interface TaxKindRules {
  kind: TaxKind;
  slabs: TaxSlab[];
}

export interface MenuCategoryTax {
  name: string;
  /** Null cannot be sold — the till refuses and names the category. */
  kind: TaxKind | null;
  items: number;
}

export interface TaxSetup {
  kinds: TaxKindRules[];
  categories: MenuCategoryTax[];
}

export async function getTaxSetup(hotelId: string): Promise<TaxSetup> {
  if (!hotelId) return { kinds: [], categories: [] };
  return api<TaxSetup>(`/api/hotels/${hotelId}/tax`);
}

/** Replaces every slab for one kind. Whole-kind rather than row-by-row
    because the slabs only mean anything together — saving them one at a
    time passes through states where an ordinary room has no rate. An
    empty list puts the kind back to unset. */
export async function setTaxRules(
  hotelId: string,
  kind: TaxKind,
  slabs: { overAmount: number; rate: number; note?: string | null }[],
): Promise<Result<{ slabs: number }>> {
  return call(`/api/hotels/${hotelId}/tax/${kind}`, "PUT", { slabs });
}

export async function setCategoryTaxKind(
  hotelId: string, category: string, kind: TaxKind | null,
): Promise<Result> {
  return call(
    `/api/hotels/${hotelId}/menu-categories/${encodeURIComponent(category)}/tax-kind`,
    "PATCH", { kind });
}

/* ══════════════════════════════════════════════════════════════════
   WHAT A PROPERTY STILL NEEDS

   Every line is DERIVED. Nothing is ticked off by hand and there is no
   "setup complete" flag to go stale — each check asks the database the
   same question the feature it guards asks, so a property that says it
   can take a booking can take one.

   `canTakeABooking` is a boolean, not a percentage. "80% ready" invites
   somebody to open on the strength of a number that says nothing about
   which fifth is missing, and here the missing fifth is usually the tax
   number that prints on every bill.
   ══════════════════════════════════════════════════════════════════ */

export interface CommissioningCheck {
  id: string;
  label: string;
  done: boolean;
  /** What is missing, in words somebody can act on. Null when done. */
  detail: string | null;
  blocking: boolean;
  /** Where to fix it, relative to the property. */
  to: string | null;
}

export interface Commissioning {
  property: string;
  checks: CommissioningCheck[];
  done: number;
  total: number;
  canTakeABooking: boolean;
  blockedBy: string[];
}

export async function getCommissioning(
  hotelId: string,
): Promise<Commissioning | null> {
  if (!hotelId) return null;
  try {
    return await api<Commissioning>(`/api/hotels/${hotelId}/commissioning`);
  } catch {
    return null;
  }
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
