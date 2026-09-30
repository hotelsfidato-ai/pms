import { api, ApiError } from "@/lib/api";
import { fetchOr } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   PRICING — a base plus add-ons (D27-188, D27-194; migration 181)

   A base per room type (one guest, room only), or one base room type the
   others are derived from (+₹ or +%); add-ons set once per hotel - the
   meal plans per guest, double occupancy, extra adult, extra child. The
   Rates screen's data: the setup, each day's price, and the prices typed
   before 181, which are kept exactly.

   A price with no figure behind it is `null` here and a dash on the
   screen. Never a zero.
   ══════════════════════════════════════════════════════════════════ */

export type Refusal = { ok: true } | { ok: false; reason: string };

/** Which layer answered: a base or set price, base + add-ons, the old rack. */
export type PriceSource = "typed" | "derived" | "rack" | null;

export interface PricingBasis {
  roomTypeId: string;
  roomType: string;
  mealPlan: string;
  mealPlanName: string;
  setAt: string;
}

export interface PricingRoomType {
  id: string;
  code: string;
  name: string;
  category: string | null;
  baseOccupancy: number;
  maxOccupancy: number;
  /** The old rack rate: priced only where no base covers a date. */
  rack: number | null;
  /** Its difference from the base room type; null never set (a dash). */
  difference: { amount: number; unit: "rupees" | "percent" } | null;
}

export interface PricingCell {
  date: string;
  roomTypeId: string;
  mealPlan: string;
  /** null means nobody has priced it. A dash. */
  price: number | null;
  /** How many guests that price covers: 1 for a base. */
  covers: number | null;
  source: PriceSource;
}

/** The add-ons, set once per hotel. null: a dash, not sold. 0: Free. */
export interface Addons {
  CP: number | null; MAP: number | null; AP: number | null; AI: number | null;
  double: number | null; extraAdult: number | null; extraChild: number | null;
}

/** A price typed before 181: kept exactly, covering what it always did. */
export interface OlderPrice {
  id: string;
  roomTypeId: string;
  mealPlan: string;
  price: number;
  from: string;
  /** Exclusive; null is open-ended. */
  to: string | null;
  label: string | null;
  covers: number;
}

export interface Pricing {
  from: string;
  days: number;
  /** null: no base room type - each type has its own base. */
  basis: PricingBasis | null;
  roomTypes: PricingRoomType[];
  mealPlans: { code: string; name: string }[];
  addons: Addons;
  older: OlderPrice[];
  cells: PricingCell[];
}

const EMPTY: Pricing = {
  from: "", days: 0, basis: null, roomTypes: [], mealPlans: [],
  addons: { CP: null, MAP: null, AP: null, AI: null, double: null, extraAdult: null, extraChild: null },
  older: [], cells: [],
};

/** The setup and each day's prices, for a run of dates. */
export async function getPricing(
  hotelId: string, from: string, days = 14, plan?: string,
): Promise<Pricing> {
  if (!hotelId) return EMPTY;
  return fetchOr<Pricing>(
    `/api/hotels/${hotelId}/pricing?from=${encodeURIComponent(from)}&days=${days}`
      + (plan ? `&plan=${encodeURIComponent(plan)}` : ""),
    EMPTY,
  );
}

/** Names the base room type; null = each room type has its own base. */
export async function setBasis(
  hotelId: string, roomTypeId: string | null,
): Promise<Refusal> {
  return write(hotelId, "pricing/basis", { roomTypeId });
}

/**
 * Sets a base over a half-open range: `to` is the first date NOT covered.
 * `price: null` CLEARS the range rather than writing a zero. With no room
 * type, the base room type's.
 */
export async function setBasePrice(
  hotelId: string,
  input: {
    roomTypeId?: string; from: string; to?: string | null;
    price: number | null; label?: string; free?: boolean;
  },
): Promise<Refusal> {
  return write(hotelId, "pricing/base", input);
}

/** One add-on, or a room type's difference from the base room type, for
    every date. `amount: null` clears it: a dash, not sold. */
export async function setAddon(
  hotelId: string,
  input: {
    kind: "room_type" | "meal_plan" | "double" | "extra_adult" | "extra_child";
    roomTypeId?: string; mealPlan?: string;
    amount: number | null; unit?: "rupees" | "percent"; free?: boolean;
  },
): Promise<Refusal> {
  return write(hotelId, "pricing/addon", input);
}

async function write(
  hotelId: string, path: string, body: unknown,
): Promise<Refusal> {
  try {
    await api(`/api/hotels/${hotelId}/${path}`, {
      method: "PUT", body: JSON.stringify(body),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
