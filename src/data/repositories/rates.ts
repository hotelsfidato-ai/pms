import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE TWO GRIDS

   Inventory — how many rooms of each type are left on each date.
   Rates     — what each type costs on each date, per meal plan.

   They are the revenue manager's whole day, and they are the last
   large surface the PMS was missing.

   NOTHING HERE INVENTS A NUMBER. An unpriced cell arrives as `null`
   and must render as a dash. Not zero: zero is a claim that the room
   is free, and it is a claim that would post a zero-value charge at
   the night audit and quietly halve an ADR.
   ══════════════════════════════════════════════════════════════════ */

/* ── Inventory ─────────────────────────────────────────────────── */

export interface InventoryCell {
  roomTypeId: string;
  roomType: string;
  date: string;
  /** Rooms of this type that exist and are not out of order. */
  sellable: number;
  /** Everything holding a room — complimentary and tentative included.
      This is what must be subtracted, because a comped room cannot be
      sold to anybody else. */
  occupied: number;
  /** The statistics definition: confirmed, in or out, and NOT
      complimentary. The numerator of occupancy and the denominator of
      ADR, where a free room would drag the average to nothing.

      Both numbers are right, and a grid showing only one of them
      disagrees with the Manager Report. */
  sold: number;
  available: number;
}

export interface Restriction {
  roomTypeId: string;
  date: string;
  stopSell: boolean;
  /** A stay may not BEGIN here. Stops a one-night booking taking the
      Friday out of a three-night weekend. */
  closedArrival: boolean;
  closedDeparture: boolean;
  minNights: number | null;
  maxNights: number | null;
}

export interface Inventory {
  from: string;
  to: string;
  cells: InventoryCell[];
  /** Only dates carrying a rule appear. Absent means unrestricted,
      which is the normal state. */
  restrictions: Restriction[];
}

export async function getInventory(
  hotelId: string, from?: string, to?: string,
): Promise<Inventory | null> {
  if (!hotelId) return null;
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  try {
    return await api<Inventory>(
      `/api/hotels/${hotelId}/inventory?${q.toString()}`);
  } catch {
    return null;
  }
}

/* ── Prices ────────────────────────────────────────────────────────
   Named for what it is, because `billing.ts` already has a `RateCell`
   and they are different questions. That one is RACK AGAINST ACHIEVED:
   a report on what rooms actually sold for. This is the pricing
   calendar — what they will cost tomorrow. */

export interface RatePlanRow {
  roomTypeId: string;
  roomType: string;
  mealPlan: string;
  mealPlanName: string;
}

export interface PriceCell {
  roomTypeId: string;
  roomType: string;
  mealPlan: string;
  date: string;
  /** NULL when nothing covers the date and the room type has no rack
      rate either. Render a dash. */
  price: number | null;
  /** The season's own name, when the price came from one. */
  season: string | null;
  /** Where the number came from, which on this screen is half the
      information:

        "rate"  somebody priced this date
        "rack"  nobody has, and this is the room type's own rate
        null    nothing covers it at all

      ₹4,099 because a manager chose it for this Saturday and ₹4,099
      because nobody has looked are different facts. Rendering them
      identically is how a season gets left at the default. */
  source: "rate" | "rack" | null;
}

export interface PriceGrid {
  from: string;
  to: string;
  /** Every room type × meal plan the property sells, priced or not.
      The empty rows ARE the screen — no price ever ships, so a new
      property is entirely empty and needs somewhere to type the
      first one. */
  plans: RatePlanRow[];
  cells: PriceCell[];
}

export async function getPriceGrid(
  hotelId: string, from?: string, to?: string,
): Promise<PriceGrid | null> {
  if (!hotelId) return null;
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  try {
    return await api<PriceGrid>(
      `/api/hotels/${hotelId}/rate-grid?${q.toString()}`);
  } catch {
    return null;
  }
}

export type Refusal = { ok: true } | { ok: false; reason: string };

/**
 * Sets a price over a half-open range: `to` is the first date NOT
 * covered, so a price through the 31st ends on the 1st.
 *
 * `price: null` CLEARS the range rather than writing a zero. The
 * server splits and trims whatever already covers those dates — the
 * rack rate usually — so the caller never has to think about the
 * overlap constraint.
 */
export async function setRate(
  hotelId: string,
  input: {
    roomTypeId: string; mealPlan: string;
    from: string; to?: string | null;
    price: number | null; label?: string;
  },
): Promise<Refusal> {
  return write(hotelId, "rate-grid", "PUT", input);
}

/**
 * Applies restrictions across a range in one call. A revenue manager
 * closing a wedding weekend sets three days at once, and doing it a
 * day at a time leaves the middle one open if the second call fails.
 */
export async function setRestriction(
  hotelId: string,
  input: {
    roomTypeId: string; from: string; to?: string;
    stopSell?: boolean; closedArrival?: boolean; closedDeparture?: boolean;
    minNights?: number | null; maxNights?: number | null;
  },
): Promise<Refusal> {
  return write(hotelId, "restrictions", "POST", input);
}

async function write(
  hotelId: string, path: string, method: string, body: unknown,
): Promise<Refusal> {
  try {
    await api(`/api/hotels/${hotelId}/${path}`, {
      method, body: JSON.stringify(body),
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
