import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE BANQUET HALL

   From the group's own description of what a banquet booking is:

     "the banquet is booked for events so it needs to be specified till
      when the hall is booked till, so it is the GM responsibility and
      he needs to register"

   A TIME RANGE, not a date. A room is sold by the night; a hall is
   taken from six until midnight, and a different party can have it the
   next morning. The same shape covers a three-day wedding — it is one
   range that happens to be long.

   NOTHING HERE SHIPS A PRICE. A hall may carry a default rate the
   screen OFFERS, and it is null until somebody types one. An event
   with no agreed amount is UNPRICED — a dash, never a zero — and it
   makes the whole total null rather than quoting for the hall alone.
   ══════════════════════════════════════════════════════════════════ */

export interface BanquetEventSummary {
  id: string;
  reference: string;
  title: string;
  /** enquiry · confirmed · cancelled · completed. Only `confirmed`
      holds the hall: two families asking about one Saturday is normal
      business, and refusing the second loses a booking. */
  status: string;
  startsAt: string;
  endsAt: string;
  hostName: string;
  pax: number | null;
  /** Null means nobody has priced it. Renders as a dash. */
  agreedAmount: number | null;
  registeredBy: string | null;
}

export interface BanquetVenueDay {
  id: string;
  name: string;
  /** Empty is a real answer, not a missing one — an empty hall is what
      somebody opening this screen is usually looking for. */
  events: BanquetEventSummary[];
}

export interface BanquetDiary {
  businessDate: string;
  from: string;
  to: string;
  venues: BanquetVenueDay[];
}

export interface BanquetCourse {
  id: string;
  name: string;
  pax: number;
  /** Null when the menu is settled and the price is not. A real state
      on the day a wedding is pencilled in. */
  ratePerHead: number | null;
  notes: string | null;
  addedBy: string;
}

export interface BanquetMoney {
  venue: number | null;
  food: number | null;
  /** Settled POS bills charged to this function. An open order is
      deliberately excluded — a bill still being added to is not yet an
      amount. */
  pos: number | null;
  /** NULL when ANY component is unpriced. Never a partial sum. */
  total: number | null;
  /** The sentence naming what has no price yet, or null when
      everything does. */
  unpriced: string | null;
}

export interface BanquetEvent {
  id: string;
  reference: string;
  title: string;
  eventType: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  businessDate: string;
  hostName: string;
  hostPhone: string | null;
  hostEmail: string | null;
  pax: number | null;
  paxGuaranteed: number | null;
  agreedAmount: number | null;
  notes: string | null;
  cancelReason: string | null;
  venue: {
    id: string;
    name: string;
    seated: number | null;
    floating: number | null;
    defaultRate: number | null;
  };
  registeredBy: string;
  registeredAt: string;
  confirmedBy: string | null;
  folioId: string | null;
  catering: BanquetCourse[];
  money: BanquetMoney;
}

export interface BanquetVenue {
  id: string;
  name: string;
  seated: number | null;
  floating: number | null;
  defaultRate: number | null;
  isActive: boolean;
  notes: string | null;
}

export interface BanquetPackage {
  id: string;
  name: string;
  description: string | null;
  ratePerHead: number | null;
  mealType: string | null;
  isActive: boolean;
}

export interface BanquetSetup {
  venues: BanquetVenue[];
  packages: BanquetPackage[];
}

/**
 * The diary.
 *
 * Returns null when the property has no banquet module, which is a
 * REAL answer and not an error — most properties do not have a hall.
 * The screen shows what to do about it rather than a spinner.
 */
export async function getBanquetDiary(
  hotelCode: string,
  from?: string,
  to?: string,
): Promise<BanquetDiary | null> {
  if (!hotelCode) return null;
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  try {
    return await api<BanquetDiary>(
      `/api/hotels/${hotelCode}/banquet${q.size ? `?${q}` : ""}`);
  } catch {
    return null;
  }
}

export async function getBanquetEvent(
  hotelCode: string, id: string,
): Promise<BanquetEvent | null> {
  if (!hotelCode || !id) return null;
  try {
    return await api<BanquetEvent>(
      `/api/hotels/${hotelCode}/banquet/events/${id}`);
  } catch {
    return null;
  }
}

export async function getBanquetSetup(
  hotelCode: string,
): Promise<BanquetSetup | null> {
  if (!hotelCode) return null;
  try {
    return await api<BanquetSetup>(`/api/hotels/${hotelCode}/banquet/setup`);
  } catch {
    return null;
  }
}

type Result<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; reason: string };

export interface RegisterEventInput {
  venueId: string;
  title: string;
  eventType?: string;
  startsAt: string;
  /** Required, and the API refuses without it. The whole module exists
      because this question was not being asked. */
  endsAt: string;
  hostName: string;
  hostPhone?: string;
  hostEmail?: string;
  pax?: number | null;
  /** Only ever what a person typed. The screen may OFFER the venue's
      default rate; leaving it out means UNPRICED, not free. */
  agreedAmount?: number | null;
  notes?: string;
}

export async function registerBanquetEvent(
  hotelCode: string, input: RegisterEventInput,
): Promise<Result<{ id: string; reference: string; warning: string | null }>> {
  return call(`/api/hotels/${hotelCode}/banquet/events`, "POST", input);
}

/**
 * Confirms, which is the moment the hall is actually taken.
 *
 * A refusal here carries the sentence the database wrote, and that
 * sentence NAMES the function standing in the way. Do not replace it
 * with "unavailable" — a GM on the telephone can act on "the Sharma
 * sangeet, until 23:00" and cannot act on "conflict".
 */
export async function confirmBanquetEvent(
  hotelCode: string, id: string,
): Promise<Result<{ folioId: string }>> {
  return call(`/api/hotels/${hotelCode}/banquet/events/${id}/confirm`, "POST");
}

export async function cancelBanquetEvent(
  hotelCode: string, id: string, reason: string,
): Promise<Result> {
  return call(
    `/api/hotels/${hotelCode}/banquet/events/${id}/cancel`, "POST", { reason });
}

export async function amendBanquetEvent(
  hotelCode: string, id: string,
  input: {
    agreedAmount?: number | null; pax?: number | null;
    paxGuaranteed?: number | null; startsAt?: string; endsAt?: string;
    notes?: string; title?: string;
  },
): Promise<Result> {
  return call(`/api/hotels/${hotelCode}/banquet/events/${id}`, "PATCH", input);
}

export async function addBanquetCourse(
  hotelCode: string, eventId: string,
  input: {
    packageId?: string; name: string; pax: number;
    ratePerHead?: number | null; notes?: string;
  },
): Promise<Result> {
  return call(
    `/api/hotels/${hotelCode}/banquet/events/${eventId}/catering`, "POST", input);
}

export async function removeBanquetCourse(
  hotelCode: string, eventId: string, lineId: string,
): Promise<Result> {
  return call(
    `/api/hotels/${hotelCode}/banquet/events/${eventId}/catering/${lineId}`,
    "DELETE");
}

export async function addBanquetVenue(
  hotelCode: string,
  input: {
    name: string; seated?: number | null; floating?: number | null;
    defaultRate?: number | null; notes?: string;
  },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${hotelCode}/banquet/venues`, "POST", input);
}

export async function amendBanquetVenue(
  hotelCode: string, id: string,
  input: {
    name?: string; seated?: number | null; floating?: number | null;
    defaultRate?: number | null; isActive?: boolean; notes?: string;
  },
): Promise<Result> {
  return call(`/api/hotels/${hotelCode}/banquet/venues/${id}`, "PATCH", input);
}

export async function addBanquetPackage(
  hotelCode: string,
  input: {
    name: string; description?: string; ratePerHead?: number | null;
    mealType?: string;
  },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${hotelCode}/banquet/packages`, "POST", input);
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
