import { api, ApiError } from "@/lib/api";
import { fetchOr } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   PRICING — one base, and everything else a difference from it

   The owner, 16 September 2026. `docs/PRICING-PLAN.md` is the plan and
   migration 090 is the arithmetic; this is the one screen's data.

   NOT TO BE CONFUSED WITH `rates.ts`, which sets a price on one cell of
   the rate calendar, or `rateGrid.ts`, which reports what rooms
   actually sold for. This is where a price comes FROM.

   A price with no figure behind it is `null` here and a dash on the
   screen. Never a zero.
   ══════════════════════════════════════════════════════════════════ */

export type Refusal = { ok: true } | { ok: false; reason: string };

/** Which of the three layers answered — the screen says which. */
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
  /** Groups the variations of one room — Deluxe, Deluxe valley view. */
  category: string | null;
  baseOccupancy: number;
  maxOccupancy: number;
}

export interface PricingOffset {
  id: string;
  kind: "room_type" | "meal_plan";
  roomTypeId: string | null;
  mealPlan: string | null;
  /** RUPEES above the base. May be negative. */
  amount: number;
  from: string;
  /** Exclusive; null is open-ended. */
  to: string | null;
  label: string | null;
}

export interface PricingCell {
  date: string;
  roomTypeId: string;
  mealPlan: string;
  /** null means nobody has priced it. A dash. */
  price: number | null;
  /** How many people that price covers: 1 for anything derived. */
  covers: number | null;
  source: PriceSource;
}

export interface Pricing {
  from: string;
  days: number;
  /** null until somebody chooses which room is the base. */
  basis: PricingBasis | null;
  roomTypes: PricingRoomType[];
  mealPlans: { code: string; name: string }[];
  offsets: PricingOffset[];
  cells: PricingCell[];
}

const EMPTY: Pricing = {
  from: "", days: 0, basis: null,
  roomTypes: [], mealPlans: [], offsets: [], cells: [],
};

/** The base, the differences and what they come to, for a run of dates. */
export async function getPricing(
  hotelId: string, from: string, days = 31,
): Promise<Pricing> {
  if (!hotelId) return EMPTY;
  return fetchOr<Pricing>(
    `/api/hotels/${hotelId}/pricing?from=${encodeURIComponent(from)}&days=${days}`,
    EMPTY,
  );
}

/** Names which room type and meal plan the property's base is. */
export async function setBasis(
  hotelId: string, input: { roomTypeId: string; mealPlan: string },
): Promise<Refusal> {
  return write(hotelId, "pricing/basis", input);
}

/**
 * Sets the base figure over a half-open range: `to` is the first date
 * NOT covered, so a price through the 31st ends on the 1st. Leave `to`
 * out for one date only — the caller passes the day after.
 *
 * `price: null` CLEARS the range rather than writing a zero.
 *
 * No room type: the base is whatever the property's basis says, and a
 * call that could name a different one could reprice the wrong room.
 */
export async function setBasePrice(
  hotelId: string,
  input: { from: string; to?: string | null; price: number | null; label?: string },
): Promise<Refusal> {
  return write(hotelId, "pricing/base", input);
}

/**
 * Sets a difference over a range. `amount: null` clears it — and
 * nothing set means the base applies, which is not the same fact as a
 * difference of zero even though they cost the same.
 */
export async function setOffset(
  hotelId: string,
  input: {
    kind: "room_type" | "meal_plan";
    roomTypeId?: string | null; mealPlan?: string | null;
    from: string; to?: string | null;
    amount: number | null; label?: string;
  },
): Promise<Refusal> {
  return write(hotelId, "pricing/offset", input);
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
