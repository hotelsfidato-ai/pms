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

export type Refusal = { ok: true } | { ok: false; reason: string };

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

/* ── What a party actually pays ────────────────────────────────────
   Per night, because a season can change mid-stay and one nightly
   figure would be wrong for half of it. */

export interface TariffNight {
  night: string;
  base: number | null;
  extraAdults: number;
  adultRate: number | null;
  extraChildren: number;
  childRate: number | null;
  total: number | null;
  /** Names what has no price, when something does not. */
  unpriced: string | null;
}

export interface Tariff {
  roomType: string;
  nights: TariffNight[];
  /** NULL when ANY night is unpriced. Summing the rest would quote a
      number short by a night nobody notices. */
  total: number | null;
  unpriced: string | null;
}

export async function getTariff(
  hotelId: string,
  input: { roomTypeId: string; mealPlan?: string; from: string; to: string;
           adults: number; children: number },
): Promise<Tariff | null> {
  if (!hotelId || !input.roomTypeId) return null;
  const q = new URLSearchParams({
    roomType: input.roomTypeId,
    mealPlan: input.mealPlan ?? "EP",
    from: input.from, to: input.to,
    adults: String(input.adults), children: String(input.children),
  });
  try {
    return await api<Tariff>(`/api/hotels/${hotelId}/tariff?${q.toString()}`);
  } catch {
    return null;
  }
}
