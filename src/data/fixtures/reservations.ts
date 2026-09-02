import {
  PROPERTY_ID,
  FIXTURE_BUSINESS_DATE as BUSINESS_DATE,
  roomInventory,
  nightsSoldPerDay,
  dailyAvailableRooms,
  EXTRA_ROOM_DATES,
} from "./property";

/* ══════════════════════════════════════════════════════════════════
   RESERVATIONS — August 2026, 5 Elements Akkalkot

   Two populations, in this order:

     1. NOTABLE stays — hand-written. Every awkward case that appears
        in the real exports: an overpaid folio, a complimentary room,
        a day-use, a back-to-back turnover, a group, a stay crossing
        the month boundary, a cancellation.

     2. GENERATED stays — fill the remaining capacity so that total
        room-nights reproduce `nightsSoldPerDay`, which is calibrated
        to the Manager Report (431 available, 132 sold, 1–25 August).

   Notable stays are placed FIRST and block their rooms, so the
   generator fills around them and no room is ever double-booked.
   The assertion at the foot of this file throws if the two
   populations together stop reproducing the calibrated occupancy.

   Tariff model, from the Night Audit export:
     offered tariff + 5% (CGST 2.5 + SGST 2.5) = total rent
     e.g. 3,476.20 + 173.80 = 3,650.00
   ══════════════════════════════════════════════════════════════════ */

/* The types live in `@/data/repositories/types` now. They were
   defined here, and one `export type` re-export in types.ts kept
   this entire fixture — guest names, bookings and all — inside the
   production bundle. Imported back so the fixture is checked
   against the same shape production uses. */
import type { Stay, Folio, StayStatus, Source }
  from "@/data/repositories/types";
export type { Stay, Folio, StayStatus, Source };

/* ── Constants from the real exports ──────────────────────────────── */

export const RACK: Record<string, number> = { Superior: 4099, Deluxe: 3699 };
const TAX_RATE = 0.05;              // CGST 2.5 + SGST 2.5
const BUSINESS_DATE_DAY = 25;       // Night Audit "As On Date 25/08/2026"

const RATE_PLANS = ["CP", "Room Only", "EP", "MAP"] as const;
const SOURCES: Source[] = [
  "Walk-in", "Fidato Hotels", "Agoda", "Booking.com", "Expedia", "go-MMT",
];

const GUEST_NAMES = [
  "Ananya Bose", "Vikram Desai", "Priya Menon", "Shridhar Kamble",
  "Sudarshan Kator", "Rohit Deshpande", "Meera Iyer", "Arjun Nair",
  "Sneha Kulkarni", "Imran Shaikh", "Deepa Rao", "Nikhil Joshi",
  "Anjali Pawar", "Vivek Thorat", "Neha Sawant", "Suresh Mane",
  "Rekha Gaikwad", "Tanvi Bhide", "Omkar Shinde", "Harsha Kamat",
];

const AUG = (d: number) => `2026-08-${String(d).padStart(2, "0")}`;

/** Day numbers past 31 roll into September, so stays can cross the boundary. */
const dateFor = (day: number) =>
  day <= 31 ? AUG(day) : `2026-09-${String(day - 31).padStart(2, "0")}`;

/** Day index within August; September dates continue past 31. */
const dayOf = (iso: string) =>
  iso.startsWith("2026-09") ? 31 + Number(iso.slice(-2)) : Number(iso.slice(-2));

/** Deterministic PRNG so the demo is identical on every reload. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stay occupies a room on the arrival night through the night before departure. */
function nightsOf(s: Stay): number[] {
  if (s.isDayUse) return [];
  const out: number[] = [];
  for (let d = dayOf(s.arrival); d < dayOf(s.departure); d++) out.push(d);
  return out;
}

/** Counts toward "rooms sold" as the Manager Report defines it. */
function countsAsSold(s: Stay): boolean {
  return !s.isDayUse && !s.isComplimentary && s.status !== "cancelled";
}

/* ══════════════════════════════════════════════════════════════════
   1 · NOTABLE STAYS — the awkward cases, placed first
   ══════════════════════════════════════════════════════════════════ */

const GROUP_ID = "grp-pancham-aug08";

/* The fields no fixture here is about.

   Spread rather than repeated on eight literals: these exist so the
   objects satisfy `Stay`, and a fixture that spells out `isVip: false`
   eight times reads as though the value mattered to the test. Any
   fixture that IS about one of them overrides it after the spread. */
const UNREMARKABLE = {
  isVip: false,
  isSingleLady: false,
  businessSource: null,
  marketSegment: null,
  salesPerson: null,
} as const;

const notableStays: Stay[] = [
  {
    /* Overpaid folio — the real Night Audit shows balance −784.00 */
    ...UNREMARKABLE,
    id: "stay-overpaid", hotelId: PROPERTY_ID, reference: "FH-2608-5001",
    guest: "Kalyani Rege", roomNumber: "301", roomType: "Deluxe",
    source: "Fidato Hotels", ratePlan: "Room Only",
    arrival: AUG(24), departure: AUG(25), nights: 1,
    adults: 1, children: 0, status: "checked-out",
    isDayUse: false, isComplimentary: false,
    rackTariff: 4000, offeredTariff: 4000,
    notes: "Guest paid ₹4,984 against ₹4,200 due. Refund pending.",
  },
  {
    /* Complimentary at ₹0, Var % = −100. The report counts comps
       separately from sold rooms, and so do we. */
    ...UNREMARKABLE,
    id: "stay-comp", hotelId: PROPERTY_ID, reference: "FH-2608-5002",
    guest: "Kapil Ganjoo", roomNumber: "206", roomType: "Superior",
    source: "Fidato Hotels", ratePlan: "CP",
    arrival: AUG(25), departure: AUG(26), nights: 1,
    adults: 2, children: 0, status: "in-house",
    isDayUse: false, isComplimentary: true,
    rackTariff: 3699, offeredTariff: 0,
    notes: "Complimentary — management guest.",
  },
  {
    /* Day-use: arrival and departure on the same date, zero nights */
    ...UNREMARKABLE,
    id: "stay-dayuse", hotelId: PROPERTY_ID, reference: "FH-2608-5003",
    guest: "Sameer Gokhale", roomNumber: "202", roomType: "Superior",
    source: "Walk-in", ratePlan: "Room Only",
    arrival: AUG(25), departure: AUG(25), nights: 0,
    adults: 1, children: 0, status: "due-out",
    isDayUse: true, isComplimentary: false,
    rackTariff: 4099, offeredTariff: 1800,
    notes: "Day use, 10:00–17:00.",
  },
  /* Back-to-back turnover on room 204 — two guests, one date boundary */
  {
    ...UNREMARKABLE,
    id: "stay-turn-out", hotelId: PROPERTY_ID, reference: "FH-2608-5004",
    guest: "Ganesh Patil", roomNumber: "204", roomType: "Superior",
    source: "go-MMT", ratePlan: "CP",
    arrival: AUG(23), departure: AUG(25), nights: 2,
    adults: 2, children: 1, status: "due-out",
    isDayUse: false, isComplimentary: false,
    rackTariff: 4099, offeredTariff: 2381,
  },
  {
    ...UNREMARKABLE,
    id: "stay-turn-in", hotelId: PROPERTY_ID, reference: "FH-2608-5005",
    guest: "Lata Bhosale", roomNumber: "204", roomType: "Superior",
    source: "Agoda", ratePlan: "CP",
    arrival: AUG(25), departure: AUG(27), nights: 2,
    adults: 2, children: 0, status: "due-in",
    isDayUse: false, isComplimentary: false,
    rackTariff: 4099, offeredTariff: 2857,
    notes: "Arrives the day room 204 vacates. Housekeeping priority.",
  },
  /* Group — Pancham Hall function, three rooms on one reference.
     Placed on the weekend the real month actually filled. */
  {
    ...UNREMARKABLE,
    id: "stay-grp-1", hotelId: PROPERTY_ID, reference: "FH-2608-5010",
    guest: "Aditya Rane", roomNumber: "302", roomType: "Deluxe",
    source: "Fidato Hotels", ratePlan: "MAP",
    arrival: AUG(8), departure: AUG(11), nights: 3,
    adults: 2, children: 0, status: "checked-out",
    isDayUse: false, isComplimentary: false,
    rackTariff: 3699, offeredTariff: 3100, groupId: GROUP_ID,
    notes: "Pancham Hall function block — the weekend that filled the house.",
  },
  {
    ...UNREMARKABLE,
    id: "stay-grp-2", hotelId: PROPERTY_ID, reference: "FH-2608-5010",
    guest: "Kavita Salunkhe", roomNumber: "303", roomType: "Deluxe",
    source: "Fidato Hotels", ratePlan: "MAP",
    arrival: AUG(8), departure: AUG(11), nights: 3,
    adults: 2, children: 2, status: "checked-out",
    isDayUse: false, isComplimentary: false,
    rackTariff: 3699, offeredTariff: 3100, groupId: GROUP_ID,
  },
  {
    ...UNREMARKABLE,
    id: "stay-grp-3", hotelId: PROPERTY_ID, reference: "FH-2608-5010",
    guest: "Pramod Jadhav", roomNumber: "305", roomType: "Deluxe",
    source: "Fidato Hotels", ratePlan: "MAP",
    arrival: AUG(8), departure: AUG(11), nights: 3,
    adults: 1, children: 0, status: "checked-out",
    isDayUse: false, isComplimentary: false,
    rackTariff: 3699, offeredTariff: 3100, groupId: GROUP_ID,
  },
  {
    /* Crosses the month boundary — departs 2 September */
    ...UNREMARKABLE,
    id: "stay-crossmonth", hotelId: PROPERTY_ID, reference: "FH-2608-5020",
    guest: "Farida Contractor", roomNumber: "307", roomType: "Deluxe",
    source: "Booking.com", ratePlan: "CP",
    arrival: AUG(30), departure: "2026-09-02", nights: 3,
    adults: 2, children: 0, status: "due-in",
    isDayUse: false, isComplimentary: false,
    rackTariff: 3699, offeredTariff: 2900,
    notes: "Departs 2 September — spans the month boundary.",
  },
  {
    /* Cancelled, so the room was released and can be resold */
    ...UNREMARKABLE,
    id: "stay-cancelled", hotelId: PROPERTY_ID, reference: "FH-2608-5030",
    guest: "Ritu Chavan", roomNumber: "210", roomType: "Superior",
    source: "Expedia", ratePlan: "Room Only",
    arrival: AUG(27), departure: AUG(29), nights: 2,
    adults: 2, children: 0, status: "cancelled",
    isDayUse: false, isComplimentary: false,
    rackTariff: 4099, offeredTariff: 3200,
    notes: "Cancelled 21 Aug. Room released.",
  },
];

/* ══════════════════════════════════════════════════════════════════
   2 · GENERATED STAYS — fill to the calibrated target around them
   ══════════════════════════════════════════════════════════════════ */

function generate(preplaced: Stay[]): Stay[] {
  const rand = mulberry32(20260801);
  const stays: Stay[] = [];

  /* Rooms already spoken for, per day, by the notable stays. A cancelled
     stay releases its room, so it blocks nothing. */
  const blocked = new Map<number, Set<string>>();
  for (const s of preplaced) {
    if (s.status === "cancelled") continue;
    const days = s.isDayUse ? [dayOf(s.arrival)] : nightsOf(s);
    for (const d of days) {
      if (!blocked.has(d)) blocked.set(d, new Set());
      blocked.get(d)!.add(s.roomNumber);
    }
  }

  /** Room-nights already contributed toward the sold target. */
  const preSold = new Map<number, number>();
  for (const s of preplaced.filter(countsAsSold)) {
    for (const d of nightsOf(s)) preSold.set(d, (preSold.get(d) ?? 0) + 1);
  }

  const occupiedUntil = new Map<string, number>();
  let seq = 0;
  let guestCursor = 0;
  const nextGuest = () => GUEST_NAMES[guestCursor++ % GUEST_NAMES.length]!;
  /** Arrays passed here are never empty, so the index always resolves. */
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  for (let day = 1; day <= 31; day++) {
    const date = AUG(day);
    const target = (nightsSoldPerDay[date] ?? 0) - (preSold.get(day) ?? 0);
    const available = dailyAvailableRooms[date] ?? 17;

    for (const [room, until] of occupiedUntil) {
      if (until <= day) occupiedUntil.delete(room);
    }

    let toOpen = target - occupiedUntil.size;

    /* Yesterday's stays overshooting today's target get shortened. This
       is what produces natural turnovers rather than scripted ones. */
    while (toOpen < 0) {
      const room = [...occupiedUntil.keys()][0];
      if (room === undefined) break;
      const stay = stays.find(
        (s) => s.roomNumber === room && dayOf(s.departure) > day,
      );
      if (!stay) break;
      stay.departure = date;
      stay.nights = dayOf(stay.departure) - dayOf(stay.arrival);
      occupiedUntil.delete(room);
      toOpen++;
    }

    /* 308 is out of service except on the six days availability is 18. */
    const sellable = roomInventory.filter(
      (r) => r.status !== "out-of-service" || EXTRA_ROOM_DATES.includes(date),
    );
    const free = sellable
      .map((r) => r.number)
      .filter((n) => !occupiedUntil.has(n) && !(blocked.get(day)?.has(n) ?? false))
      .slice(0, available);

    for (let i = 0; i < toOpen && i < free.length; i++) {
      const roomNumber = free[i]!;
      const room = roomInventory.find((r) => r.number === roomNumber)!;
      const nights = 1 + Math.floor(rand() * 3);
      const departureDay = day + nights;
      const rack = RACK[room.type] ?? 4099;
      /* Real discounts in the export ranged −15% to −42% off rack */
      const discount = 0.15 + rand() * 0.27;

      seq++;
      stays.push({
        ...UNREMARKABLE,
        id: `stay-${seq}`,
        hotelId: PROPERTY_ID,
        reference: `FH-2608-${String(4800 + seq).padStart(4, "0")}`,
        guest: nextGuest(),
        roomNumber,
        roomType: room.type,
        source: pick(SOURCES),
        ratePlan: pick(RATE_PLANS),
        arrival: date,
        departure: dateFor(departureDay),
        nights,
        adults: 1 + Math.floor(rand() * 2),
        children: rand() > 0.85 ? 1 : 0,
        status: "checked-out",
        isDayUse: false,
        isComplimentary: false,
        rackTariff: rack,
        offeredTariff: Math.round(rack * (1 - discount) * 100) / 100,
      });
      occupiedUntil.set(roomNumber, departureDay);
    }
  }

  /* Status relative to the business date */
  for (const s of stays) {
    const a = dayOf(s.arrival);
    const d = dayOf(s.departure);
    if (a > BUSINESS_DATE_DAY) s.status = "due-in";
    else if (d > BUSINESS_DATE_DAY) s.status = "in-house";
    else if (d === BUSINESS_DATE_DAY) s.status = "due-out";
    else s.status = "checked-out";
  }

  return stays;
}

function folioFor(s: Stay): Folio {
  const roomCharges = s.isComplimentary
    ? 0
    : s.offeredTariff * Math.max(s.nights, 1);
  const tax = Math.round(roomCharges * TAX_RATE * 100) / 100;
  const total = Math.round((roomCharges + tax) * 100) / 100;
  const payments = s.status === "checked-out" ? total : 0;
  return {
    stayId: s.id,
    roomCharges: Math.round(roomCharges * 100) / 100,
    extraCharges: 0,
    tax,
    discount: 0,
    payments,
    balance: Math.round((total - payments) * 100) / 100,
    status: s.status === "checked-out" ? "settled" : "open",
  };
}

const generatedStays = generate(notableStays);

/* The awkward folios, written by hand. These are the cases the screens
   exist to show — an overpayment, a comp, a disputed group bill — and
   their figures are deliberate, so the calibration above leaves them
   alone. */
const notableFolios: Folio[] = [
  { stayId: "stay-overpaid", roomCharges: 4000, extraCharges: 0, tax: 200, discount: 0, payments: 4984, balance: -784, status: "open" },
  { stayId: "stay-comp", roomCharges: 0, extraCharges: 0, tax: 0, discount: 0, payments: 0, balance: 0, status: "settled" },
  { stayId: "stay-dayuse", roomCharges: 1800, extraCharges: 0, tax: 90, discount: 0, payments: 0, balance: 1890, status: "open" },
  { stayId: "stay-turn-out", roomCharges: 4762, extraCharges: 681, tax: 272.15, discount: 0, payments: 0, balance: 5715.15, status: "open" },
  { stayId: "stay-turn-in", roomCharges: 5714, extraCharges: 0, tax: 285.7, discount: 0, payments: 0, balance: 5999.7, status: "open" },
  /* Group folio carried on the lead room, disputed by the company */
  { stayId: "stay-grp-1", roomCharges: 6200, extraCharges: 18500, tax: 1235, discount: 1000, payments: 0, balance: 24935, status: "disputed" },
  { stayId: "stay-grp-2", roomCharges: 6200, extraCharges: 0, tax: 310, discount: 0, payments: 6510, balance: 0, status: "settled" },
  { stayId: "stay-grp-3", roomCharges: 6200, extraCharges: 0, tax: 310, discount: 0, payments: 6510, balance: 0, status: "settled" },
  { stayId: "stay-crossmonth", roomCharges: 8700, extraCharges: 0, tax: 435, discount: 0, payments: 3000, balance: 6135, status: "open" },
  { stayId: "stay-cancelled", roomCharges: 0, extraCharges: 0, tax: 0, discount: 0, payments: 0, balance: 0, status: "written-off" },
];


/* ══════════════════════════════════════════════════════════════════
   CALIBRATE THE MONEY, NOT ONLY THE NIGHTS

   The fixture has always asserted its NIGHT counts — 132 sold of 431
   available, which is what makes occupancy 30.63%. It never asserted
   its REVENUE, and the generated tariffs summed to ₹3,76,745.54 while
   the real export says ₹4,19,578.77.

   Nobody noticed for a simple reason: `getPeriodStatistics` read ADR
   from `property._calibration` instead of from the folios. So the
   dashboard and the Manager Report printed ₹3,178.63 while this
   fixture's own ledger said ₹2,854.13 — two numbers, one of them
   shown, and no test comparing them.

   TWO THINGS HAD TO BE RIGHT, and each was wrong on one attempt:

   · THE POPULATION. A charge posts when a guest ARRIVES, so the
     revenue in the 1–25 August window belongs to stays arriving in it,
     not to every stay on the file. Scaling across all of them pushed
     the total DOWN to ₹3,25,688.

   · WHAT EACH STAY IS WORTH. A notable stay's folio is hand-written —
     `stay-crossmonth` carries ₹8,700 regardless of its tariff — and the
     ledger posts THAT, not tariff × nights. Measuring the notable ones
     the generated way left the total ₹9,300 short.

   So this runs after `notableFolios`, and asks each stay what the
   LEDGER will actually hold. The notable rates are left untouched:
   a ₹1,800 day-use, a ₹2,857 override, a comp at zero are the cases
   the screens exist to show.
   ══════════════════════════════════════════════════════════════════ */

const TARGET_ROOM_REVENUE = 419578.77;
const REVENUE_FROM = "2026-08-01";
const REVENUE_TO = BUSINESS_DATE;

const inWindow = (s: Stay) =>
  !s.isComplimentary && s.arrival >= REVENUE_FROM && s.arrival <= REVENUE_TO;

/** What this stay will actually put on the ledger. */
const ledgerRoomCharge = (s: Stay): number => {
  const written = notableFolios.find((f) => f.stayId === s.id);
  if (written) return written.roomCharges;
  return s.offeredTariff * Math.max(s.nights, 1);
};

const revenueOf = (list: Stay[]) =>
  list.filter(inWindow).reduce((t, s) => t + ledgerRoomCharge(s), 0);

{
  const fixed = revenueOf(notableStays);
  const scalable = generatedStays.filter(inWindow);
  const current = revenueOf(scalable);

  if (current <= 0) {
    throw new Error("Fixture drift: no generated revenue in the window to calibrate.");
  }

  const factor = (TARGET_ROOM_REVENUE - fixed) / current;
  if (factor <= 0) {
    throw new Error(
      `Fixture drift: the notable stays alone are worth ₹${fixed.toFixed(2)}, ` +
        `which already exceeds the ₹${TARGET_ROOM_REVENUE} target.`,
    );
  }

  for (const stay of scalable) {
    stay.offeredTariff = Math.round(stay.offeredTariff * factor * 100) / 100;
  }

  /* Rounding leaves a few paise. They go on the largest generated stay,
     where a rupee either way is invisible, rather than letting the
     total miss its own assertion. */
  const residue =
    Math.round((TARGET_ROOM_REVENUE - revenueOf([...notableStays, ...generatedStays])) * 100) / 100;

  if (Math.abs(residue) >= 0.01) {
    const biggest = [...scalable].sort(
      (a, b) => ledgerRoomCharge(b) - ledgerRoomCharge(a),
    )[0];
    if (biggest) {
      biggest.offeredTariff =
        Math.round((biggest.offeredTariff + residue / Math.max(biggest.nights, 1)) * 100) / 100;
    }
  }
}

/* The assertion that would have caught this from the beginning. */
{
  const actual = Math.round(revenueOf([...notableStays, ...generatedStays]) * 100) / 100;
  if (Math.abs(actual - TARGET_ROOM_REVENUE) > 1) {
    throw new Error(
      `Fixture drift: room revenue in ${REVENUE_FROM}..${REVENUE_TO} is ` +
        `₹${actual.toFixed(2)}, the real Night Audit export says ` +
        `₹${TARGET_ROOM_REVENUE}. ADR would read ₹${(actual / 132).toFixed(2)} ` +
        `instead of ₹3,178.63.`,
    );
  }
}

export const stays: Stay[] = [...notableStays, ...generatedStays];
export const folios: Folio[] = [
  ...notableFolios,
  ...generatedStays.map(folioFor),
];

export const groups = [
  {
    id: GROUP_ID,
    hotelId: PROPERTY_ID,
    name: "Pancham Hall function",
    reference: "FH-2608-5010",
    rooms: 3,
    arrival: AUG(8),
    departure: AUG(11),
  },
];

/* ══════════════════════════════════════════════════════════════════
   ASSERTION — every stay together must reproduce the calibrated
   occupancy. If they diverge, the demo is telling two different
   stories about the same month.
   ══════════════════════════════════════════════════════════════════ */

export function occupancyFromStays(source: Stay[] = stays) {
  const counts: Record<string, number> = {};
  for (const s of source.filter(countsAsSold)) {
    for (const d of nightsOf(s)) {
      if (d <= 31) counts[AUG(d)] = (counts[AUG(d)] ?? 0) + 1;
    }
  }
  return counts;
}

const derived = occupancyFromStays();
const mismatches = Object.keys(nightsSoldPerDay).filter(
  (d) => (derived[d] ?? 0) !== nightsSoldPerDay[d],
);

if (mismatches.length > 0) {
  const detail = mismatches
    .map((d) => `${d}: stays say ${derived[d] ?? 0}, calibration says ${nightsSoldPerDay[d]}`)
    .join("; ");
  throw new Error(`Reservation fixture diverges from calibrated occupancy — ${detail}`);
}

/* ══════════════════════════════════════════════════════════════════
   COMPATIBILITY VIEW

   Repositories written against a `Reservation` shape — `guestName`,
   `checkIn`/`checkOut`, `offeredRate`, snake_case statuses — read
   through here rather than keeping a second list of bookings.

   Derived, so it cannot drift: change a stay above and this changes
   with it. The calibrated occupancy assertion still governs both.
   ══════════════════════════════════════════════════════════════════ */

export interface Reservation {
  id: string;
  hotelId: string;
  reference: string;
  guestId: string;
  guestName: string;
  source: string;
  roomType: string;
  roomNumber?: string;
  rateType: string;
  baseRate: number;
  offeredRate: number;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  status: "confirmed" | "checked_in" | "due_out" | "checked_out" | "cancelled" | "no_show";
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  specialRequests?: string;
  isComplimentary: boolean;
  isDayUse: boolean;
  groupId?: string;
}

const STATUS_MAP: Record<StayStatus, Reservation["status"]> = {
  "due-in": "confirmed",
  "in-house": "checked_in",
  "due-out": "due_out",
  "checked-out": "checked_out",
  "no-show": "no_show",
  cancelled: "cancelled",
};

function toReservation(s: Stay): Reservation {
  return {
    id: s.id,
    hotelId: s.hotelId,
    reference: s.reference,
    guestId: `guest-${s.id}`,
    guestName: s.guest,
    source: s.source,
    roomType: s.roomType,
    roomNumber: s.roomNumber,
    rateType: s.ratePlan,
    baseRate: s.rackTariff,
    offeredRate: s.offeredTariff,
    checkIn: s.arrival,
    checkOut: s.departure,
    adults: s.adults,
    children: s.children,
    status: STATUS_MAP[s.status],
    createdAt: `${s.arrival}T09:00:00Z`,
    updatedAt: `${s.arrival}T09:00:00Z`,
    createdBy: "admin",
    specialRequests: s.notes,
    isComplimentary: s.isComplimentary,
    isDayUse: s.isDayUse,
    groupId: s.groupId,
  };
}

export const reservations: Reservation[] = stays.map(toReservation);

export function getReservationsForDateRange(from: string, to: string): Reservation[] {
  return reservations.filter((r) => r.checkOut >= from && r.checkIn <= to);
}

export function getArrivalsForDate(date: string): Reservation[] {
  return reservations.filter((r) => r.checkIn === date && r.status !== "cancelled");
}

export function getDeparturesForDate(date: string): Reservation[] {
  return reservations.filter((r) => r.checkOut === date && r.status !== "cancelled");
}

export function getInHouseForDate(date: string): Reservation[] {
  return reservations.filter(
    (r) => r.status !== "cancelled" && !r.isDayUse && r.checkIn <= date && r.checkOut > date,
  );
}
