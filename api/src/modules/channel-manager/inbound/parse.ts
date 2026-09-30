/* ══════════════════════════════════════════════════════════════════
   READING SU's BOOKING MESSAGE

   SU pushes what its "Response of Reservation Information" describes: a
   `reservations` array, one booking in it, each booking carrying the guest,
   its rooms, and for every room a price per night with the rate plan and
   meal plan that night was sold on.

   What is read here is only what the PMS needs to decide what to do. The
   whole message (scrubbed of card fields) is kept anyway, so nothing that
   is not read is lost - it is in `channel_bookings.payload` for a person.

   NOTHING IS GUESSED. A field SU did not send is null, and a null never
   becomes 0 or today's date. Money stays a string, exactly as SU wrote it.
   A message this cannot make sense of is not a crash: `problems` says what
   was missing, the message is still stored, and it waits for a person.
   ══════════════════════════════════════════════════════════════════ */

export interface BookingNight {
  date: string;
  /** SU's rate plan id: which of the hotel's meal plans it was sold on. */
  rateId: string | null;
  mealPlanName: string | null;
  priceBeforeTax: string | null;
  tax: string | null;
}

export interface BookingRoom {
  /** SU's room id: the hotel's room type, as SU knows it. */
  suRoomId: string | null;
  roomReservationId: string | null;
  status: string | null;
  guestName: string | null;
  arrival: string | null;
  departure: string | null;
  adults: number | null;
  children: number | null;
  total: string | null;
  specialRequest: string | null;
  nights: BookingNight[];
}

export interface PushedBooking {
  suBookingId: string | null;
  notifId: string | null;
  suHotelId: string | null;
  status: "new" | "modified" | "cancelled" | "request" | null;
  channelCode: string | null;
  channelName: string | null;
  guestName: string | null;
  email: string | null;
  phone: string | null;
  remarks: string | null;
  arrival: string | null;
  departure: string | null;
  currency: string | null;
  total: string | null;
  commission: string | null;
  cancelReason: string | null;
  rooms: BookingRoom[];
  problems: string[];
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const text = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  if (typeof v === "number") return String(v);
  return null;
};

/** A calendar day that exists, or null (CM-6): "2031-02-30" would reach the
    database and throw before the message is kept. */
const day = (v: unknown): string | null => {
  const t = text(v);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) && new Date(`${t}T00:00:00Z`).toISOString().startsWith(t)
    ? t : null;
};

const whole = (v: unknown): number | null => {
  const n = Number(text(v));
  return Number.isInteger(n) ? n : null;
};

/** Every booking in one pushed message. SU sends one at a time, but its own
    documents show the array holding several, so every one is read. */
export function readPushedMessage(message: unknown): PushedBooking[] {
  const body = record(message);
  const list = Array.isArray(body?.["reservations"])
    ? (body!["reservations"] as unknown[])
    : body ? [body] : [];
  return list.map(readBooking);
}

function readBooking(value: unknown): PushedBooking {
  const r = record(value) ?? {};
  const customer = record(r["customer"]) ?? {};
  const affiliation = record(r["affiliation"]) ?? {};
  const rooms = (Array.isArray(r["rooms"]) ? r["rooms"] : []).map(readRoom);
  const problems: string[] = [];

  const status = text(r["status"])?.toLowerCase() ?? null;
  const known = status === "new" || status === "modified"
    || status === "cancelled" || status === "request" ? status : null;
  if (status && !known) problems.push(`SU called this booking "${status}", which this connection does not know.`);
  if (!status) problems.push("SU did not say whether this is a new, modified or cancelled booking.");

  const suBookingId = text(r["id"]) ?? text(r["channel_booking_id"]);
  if (!suBookingId) problems.push("SU did not send the booking's id.");
  if (!text(r["reservation_notif_id"])) problems.push("SU did not send the message's notification id.");
  if (!text(r["hotel_id"])) problems.push("SU did not say which hotel the booking is for.");
  if (rooms.length === 0) problems.push("SU sent no rooms with this booking.");

  const guest = [text(customer["first_name"]), text(customer["last_name"])]
    .filter(Boolean).join(" ").trim();
  const guestName = guest || rooms.find((x) => x.guestName)?.guestName || null;
  if (!guestName) problems.push("SU did not send a guest name.");

  /* CM-6: a room with no real day, or leaving before it arrives, is a
     person's; its dates are not stored, because the database refuses them. */
  const sane = rooms.every((x) => x.arrival && x.departure && x.departure > x.arrival);
  if (rooms.length > 0 && !sane) {
    problems.push("SU sent a room without a real arrival and departure date, or leaving before it arrives.");
  }
  const dates = sane ? rooms.map((x) => x.arrival!) : [];
  const leaves = sane ? rooms.map((x) => x.departure!) : [];

  return {
    suBookingId,
    notifId: text(r["reservation_notif_id"]),
    suHotelId: text(r["hotel_id"]),
    status: known,
    channelCode: text(affiliation["OTA_Code"]),
    channelName: text(affiliation["source"]) ?? text(affiliation["pos"]),
    guestName,
    email: text(customer["email"]),
    phone: text(customer["telephone"]),
    remarks: text(customer["remarks"]),
    arrival: dates.length ? dates.slice().sort()[0]! : null,
    departure: leaves.length ? leaves.slice().sort().at(-1)! : null,
    currency: text(r["currencycode"]),
    total: text(r["totalprice"]),
    commission: text(r["commissionamount"]),
    cancelReason: text(r["cancelreason"]),
    rooms,
    problems,
  };
}

function readRoom(value: unknown): BookingRoom {
  const r = record(value) ?? {};
  const prices = Array.isArray(r["price"]) ? r["price"] : [];
  return {
    suRoomId: text(r["id"]),
    roomReservationId: text(r["roomreservation_id"]),
    status: text(r["roomstaystatus"]),
    guestName: text(r["guest_name"])
      ?? (text(r["first_name"]) || text(r["last_name"])
          ? [text(r["first_name"]), text(r["last_name"])].filter(Boolean).join(" ")
          : null),
    arrival: day(r["arrival_date"]),
    departure: day(r["departure_date"]),
    adults: whole(r["numberofadults"]) ?? whole(r["numberofguests"]),
    children: whole(r["numberofchildren"]),
    total: text(r["totalprice"]),
    specialRequest: text(r["specialrequest"]),
    nights: prices.map((p) => {
      const n = record(p) ?? {};
      return {
        date: day(n["date"]) ?? "",
        rateId: text(n["rate_id"]),
        mealPlanName: text(n["mealplan"]),
        priceBeforeTax: text(n["pricebeforetax"]),
        tax: text(n["tax"]),
      };
    }).filter((n) => n.date),
  };
}
