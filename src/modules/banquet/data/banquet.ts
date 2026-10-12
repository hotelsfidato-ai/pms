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
  /** Null where the viewer may not know who added it (BQ-7) — a dash. */
  addedBy: string | null;
}

/** A restaurant order charged to this function (D17-21). */
export interface BanquetRestaurantOrder {
  id: string;
  orderNo: string;
  table: string | null;
  /** Null only if the outlet cannot be read; shown as a dash. */
  outlet: string | null;
  /** `open` or `settled`. Abandoned orders charged nothing and are not sent. */
  status: string;
  openedAt: string;
  settledAt: string | null;
  /** What the order comes to now. Only a settled order is in the total. */
  amount: number | null;
}

export interface BanquetMoney {
  venue: number | null;
  food: number | null;
  /** Settled restaurant orders charged to this function. An open order is
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
  /** Null where the viewer may not know who registered it (BQ-7) — a
      dash. The function itself always shows. */
  registeredBy: string | null;
  /** `YYYY-MM-DDTHH:MM`, shown through `format.ts`. */
  registeredAt: string;
  confirmedBy: string | null;
  folioId: string | null;
  /** D27-124: "Banquet tax is not set: ..." while the property has no
      banquet GST rule, else null. */
  taxWarning: string | null;
  /** The function's bill as finance adds it up (folioBalance), or null
      while nothing is on it. */
  bill: FunctionBill | null;
  /** The tax invoice standing for this bill (not credited), or null. */
  invoice: string | null;
  catering: BanquetCourse[];
  restaurantOrders: BanquetRestaurantOrder[];
  money: BanquetMoney;
}

export interface FunctionBill {
  /** Before tax. */
  charges: number;
  tax: number;
  paid: number;
  /** Negative when more has been paid than billed - an advance. */
  balance: number;
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

/* ⚠ THE THREE READS THROW (BQ-3, 17 September).

   They used to end in `catch { return null }`, and each screen read null
   as "the module is off". So a server fault, or no network, told a GM
   at a property WITH a hall "This property has no banquet hall", and
   told them a function that exists was "No such function".

   A property with banquet switched off is still an answer: the server
   refuses with a 403 and its own sentence, and `ReadFailed` shows that
   sentence as it is. Nothing here guesses which failure it was. */

/** The diary: every hall over a window, with whatever is booked in it. */
export async function getBanquetDiary(
  hotelCode: string,
  from?: string,
  to?: string,
): Promise<BanquetDiary> {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return api<BanquetDiary>(
    `/api/hotels/${hotelCode}/banquet${q.size ? `?${q}` : ""}`);
}

export async function getBanquetEvent(
  hotelCode: string, id: string,
): Promise<BanquetEvent> {
  return api<BanquetEvent>(`/api/hotels/${hotelCode}/banquet/events/${id}`);
}

export async function getBanquetSetup(hotelCode: string): Promise<BanquetSetup> {
  return api<BanquetSetup>(`/api/hotels/${hotelCode}/banquet/setup`);
}

export interface AttachableFunction {
  id: string;
  reference: string;
  title: string;
  venueName: string;
  hostName: string;
  /** Local to the property, `YYYY-MM-DDTHH:MM`. */
  startsAt: string;
  endsAt: string;
}

export interface AttachableFunctions {
  /** False at a property whose banquet module is off: offer no way to
      attach an order there at all. */
  enabled: boolean;
  businessDate: string;
  functions: AttachableFunction[];
}

/**
 * The functions a restaurant order may be attached to right now — for
 * the till, through this service's front door (D17-21).
 *
 * The owner's rule, 17 September: a CONFIRMED function at this property,
 * whose bill is OPEN, running on the business date (from its first day
 * to its last). The server holds the rule (`api/src/modules/banquet/
 * attach.ts`) and refuses an attachment outside it, so the till must not
 * filter this list again.
 *
 * Throws on failure, like the reads above. At a property with no hall it
 * answers `{ enabled: false, functions: [] }` rather than refusing.
 */
export async function getAttachableFunctions(
  hotelCode: string,
): Promise<AttachableFunctions> {
  return api<AttachableFunctions>(`/api/hotels/${hotelCode}/banquet/attachable`);
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
  /** D27-120: a 0 is kept only when this is true. */
  free?: boolean;
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
    agreedAmount?: number | null; free?: boolean; pax?: number | null;
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
    ratePerHead?: number | null; free?: boolean; notes?: string;
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
    defaultRate?: number | null; free?: boolean; notes?: string;
  },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${hotelCode}/banquet/venues`, "POST", input);
}

export async function amendBanquetVenue(
  hotelCode: string, id: string,
  input: {
    name?: string; seated?: number | null; floating?: number | null;
    defaultRate?: number | null; free?: boolean; isActive?: boolean; notes?: string;
  },
): Promise<Result> {
  return call(`/api/hotels/${hotelCode}/banquet/venues/${id}`, "PATCH", input);
}

export async function addBanquetPackage(
  hotelCode: string,
  input: {
    name: string; description?: string; ratePerHead?: number | null;
    free?: boolean; mealType?: string;
  },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${hotelCode}/banquet/packages`, "POST", input);
}

/** Off takes a package out of what new catering is offered; functions that
    have it keep it as sold. Nothing else about a package changes (D27-305). */
export async function switchBanquetPackage(
  hotelCode: string, id: string, isActive: boolean,
): Promise<Result> {
  return call(`/api/hotels/${hotelCode}/banquet/packages/${id}`, "PATCH", { isActive });
}

/* ── The function's bill (BQ-1, D27-132 to D27-138) ────────────────
   Owner, Admin and GM take money and bill it; the tax invoice as well by
   the Accountant. Finance does the sums, the payment and the invoice. */

/** Puts the hall and the courses on the function's bill under the
    Banquet GST rule; after it the price and courses are fixed. */
export async function billBanquetEvent(hotelCode: string, id: string): Promise<Result> {
  return call(`/api/hotels/${hotelCode}/banquet/events/${id}/bill`, "POST");
}

/** Takes the billed hall and courses off again, with a reason, while no tax
    invoice stands (the owner's D27-154). */
export async function reopenBanquetEvent(hotelCode: string, id: string, reason: string): Promise<Result> {
  return call(`/api/hotels/${hotelCode}/banquet/events/${id}/reopen`, "POST", { reason });
}

/** An advance before the function is billed, or a payment after. One
    `pressKey` per press, kept until it lands: a repeat takes it once. */
export async function payBanquetEvent(
  hotelCode: string, id: string,
  input: { method: string; amount: number; pan?: string; form97?: boolean; heldAsCredit?: boolean },
  pressKey: string,
): Promise<Result> {
  return call(`/api/hotels/${hotelCode}/banquet/events/${id}/payments`, "POST", input,
    { "idempotency-key": pressKey });
}

export async function invoiceBanquetEvent(
  hotelCode: string, id: string,
): Promise<Result<{ number: string }>> {
  return call(`/api/hotels/${hotelCode}/banquet/events/${id}/invoice`, "POST");
}

async function call<T>(
  path: string, method: string, body?: unknown, headers?: Record<string, string>,
): Promise<Result<T>> {
  try {
    const out = await api<T & { ok?: boolean }>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(headers ? { headers } : {}),
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
