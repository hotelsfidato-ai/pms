/* ══════════════════════════════════════════════════════════════════
   DEMO FIXTURES — 5 Elements Akkalkot, August 2026
   Calibrated to actual Night Audit exports from eZee.
   17 rooms (18 on 8–13 Aug), 132 nights sold, 30.63% occupancy,
   ADR ₹3,178.63, RevPAR ₹973.50.
   ══════════════════════════════════════════════════════════════════ */

export const PROPERTY_ID = "5-elements-akkalkot";

export const roomInventory = [
  { number: "201", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "202", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "203", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "204", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "205", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "206", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "207", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "208", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "209", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "210", type: "Superior", floor: 2, status: "clean", maxOccupancy: 2 },
  { number: "301", type: "Deluxe", floor: 3, status: "clean", maxOccupancy: 3 },
  { number: "302", type: "Deluxe", floor: 3, status: "clean", maxOccupancy: 3 },
  { number: "303", type: "Deluxe", floor: 3, status: "clean", maxOccupancy: 3 },
  { number: "304", type: "Deluxe", floor: 3, status: "clean", maxOccupancy: 3 },
  { number: "305", type: "Deluxe", floor: 3, status: "clean", maxOccupancy: 3 },
  { number: "306", type: "Deluxe", floor: 3, status: "clean", maxOccupancy: 3 },
  { number: "307", type: "Deluxe", floor: 3, status: "clean", maxOccupancy: 3 },
  /* 308 is physically present but held out of service for most of the month.
     It is what makes availability rise to 18 on 8–13 August in the real
     Monthly Statistics export. The Manager Report's "Total Room 17" was
     taken on 25 August, a day when this room was not sellable. */
  { number: "308", type: "Deluxe", floor: 3, status: "out-of-service", maxOccupancy: 3 },
];

/** Rooms sellable on an ordinary day. 308 is out of service, so 17. */
export const BASE_ROOM_COUNT = roomInventory.filter(
  (r) => r.status !== "out-of-service",
).length; // 17

/** Every physical room, including any held out of service. */
export const PHYSICAL_ROOM_COUNT = roomInventory.length; // 18

/** The six days 308 was returned to inventory. */
export const EXTRA_ROOM_DATES = [
  "2026-08-08", "2026-08-09", "2026-08-10",
  "2026-08-11", "2026-08-12", "2026-08-13",
];

// ────────────────────────────────────────────────────────────────────
// DAILY AVAILABLE ROOMS — matches the real PTD window (1–25 Aug = 431)
// 19 days × 17 rooms  = 323
//  6 days × 18 rooms  = 108   (8–13 Aug)
//                     ───
//                     431   ✓  (matches Manager Report "PTD 01/08/2026")
//
// Days 26–31 are not in the PTD window — available rooms follow the base
// pattern but are not constrained by the report.
// ────────────────────────────────────────────────────────────────────

const dailyAvailableRooms: Record<string, number> = {
  "2026-08-01": 17, "2026-08-02": 17, "2026-08-03": 17, "2026-08-04": 17,
  "2026-08-05": 17, "2026-08-06": 17, "2026-08-07": 17,
  "2026-08-08": 18, "2026-08-09": 18, "2026-08-10": 18, "2026-08-11": 18,
  "2026-08-12": 18, "2026-08-13": 18,
  "2026-08-14": 17, "2026-08-15": 17, "2026-08-16": 17, "2026-08-17": 17,
  "2026-08-18": 17, "2026-08-19": 17, "2026-08-20": 17, "2026-08-21": 17,
  "2026-08-22": 17, "2026-08-23": 17, "2026-08-24": 17, "2026-08-25": 17,
  "2026-08-26": 17, "2026-08-27": 17, "2026-08-28": 17, "2026-08-29": 17,
  "2026-08-30": 17, "2026-08-31": 17,
};

// ────────────────────────────────────────────────────────────────────
// NIGHTS SOLD PER DAY — calibrated to 132 across the PTD window (1–25 Aug)
// Shape preserved: 0% days, two 100% days (9th, 10th), genuine swing.
// Days 26–31 are plausible continuation, not calibrated to any report.
// ────────────────────────────────────────────────────────────────────

const nightsSoldPerDay: Record<string, number> = {
  // PTD window (1–25 Aug) — sums to 132
  "2026-08-01": 0,   "2026-08-02": 1,  "2026-08-03": 2,  "2026-08-04": 3,
  "2026-08-05": 4,   "2026-08-06": 5,  "2026-08-07": 6,
  "2026-08-08": 9,   "2026-08-09": 18, "2026-08-10": 18, "2026-08-11": 11,
  "2026-08-12": 10,  "2026-08-13": 9,
  "2026-08-14": 7,   "2026-08-15": 5,  "2026-08-16": 5,  "2026-08-17": 4,
  "2026-08-18": 3,   "2026-08-19": 2,  "2026-08-20": 1,  "2026-08-21": 0,
  "2026-08-22": 0,   "2026-08-23": 1,  "2026-08-24": 3,  "2026-08-25": 5,
  // Days 26–31 — plausible continuation (not constrained by PTD report)
  "2026-08-26": 7,   "2026-08-27": 8,  "2026-08-28": 7,  "2026-08-29": 5,
  "2026-08-30": 3,   "2026-08-31": 2,
};

// ────────────────────────────────────────────────────────────────────
// ASSERTIONS THAT CAN FAIL — not comments, executable checks
// ────────────────────────────────────────────────────────────────────

const ptdDates = Object.keys(dailyAvailableRooms).filter((d) => d <= "2026-08-25");
const totalAvailablePTD = ptdDates.reduce((sum, d) => sum + (dailyAvailableRooms[d] ?? 0), 0);
const totalSoldPTD = ptdDates.reduce((sum, d) => sum + (nightsSoldPerDay[d] ?? 0), 0);

if (totalAvailablePTD !== 431 || totalSoldPTD !== 132) {
  throw new Error(
    `Fixture drift: PTD window 1–25 Aug has ${totalSoldPTD}/${totalAvailablePTD} ` +
    `(mean ${((totalSoldPTD / totalAvailablePTD) * 100).toFixed(2)}%), expected 132/431 (30.63%)`
  );
}

export const dailyOccupancy: Record<string, number> = {};
for (const date of Object.keys(dailyAvailableRooms)) {
  const available = dailyAvailableRooms[date] ?? 17;
  const sold = nightsSoldPerDay[date] ?? 0;
  dailyOccupancy[date] = Math.round((sold / available) * 10000) / 100;
}

// Also export the raw data for repositories that need it
export { dailyAvailableRooms, nightsSoldPerDay };

/**
 * The date the demo is pinned to — the Night Audit's "As On Date".
 * It lives here because the fixtures are calibrated against it and
 * the store seeds from it; the repositories re-export it.
 */
/**
 * The hotel CODE this property has in Postgres. `hotels.code` is what
 * appears in a URL — migration 002 says so — and it is what a person
 * can read back over the phone.
 */
export const PROPERTY_CODE = "5EL";

/**
 * The day the demo dataset is pinned to.
 *
 * NOT the business date — that comes from `app.business_date()`
 * per property and lives in `repositories/businessDate.ts`. This is
 * the anchor the generated fixtures are built around, and it must
 * stay fixed: 431 available room-nights, 132 sold and ADR ₹3,178.63
 * all reconcile to the real eZee export for 1–25 August 2026. Move
 * this and the calibration stops meaning anything.
 */
export const FIXTURE_BUSINESS_DATE = "2026-08-25";

export const property = {
  id: PROPERTY_ID,
  name: "5 Elements Akkalkot",
  address: "Akkalkot, Solapur District, Maharashtra 413216",
  phone: "+91 2181 220 555", // DEMO — NOT A REAL PHONE NUMBER
  email: "akkalkot@fidatohotels.com", // DEMO — NOT A REAL EMAIL
  gstin: "27AAAAA0000A1Z5", // DEMO — NOT A REAL GSTIN
  timezone: "Asia/Kolkata",
  currency: "INR",
  checkInTime: "14:00",
  checkOutTime: "11:00",
  rooms: BASE_ROOM_COUNT, // derived from roomInventory.length
  roomTypes: ["Superior", "Deluxe"],
  rateTypes: ["CP", "Room Only", "EP", "MAP"],
  tax: { cgst: 2.5, sgst: 2.5 },
  financialYearStart: "04-01", // 1 April
  // Two series observed in production: 5EFH-prefixed and plain zero-padded numeric
  invoiceSeries: [{ prefix: "5EFH", next: 154 }, { prefix: "", next: 39, pad: 6 }] as Array<{ prefix: string; next: number; pad?: number }>,
  posOutlets: [{ id: "sattva", name: "Sattva", categories: ["Food", "Beverages"] }],
  paymentMethods: ["Cash", "UPI", "Credit Card", "Debit Card", "GoMMT", "Google Pay", "Room Posting"],
  // Calibration metadata — verified by the assertions above
  _calibration: {
    ptdWindow: "2026-08-01 to 2026-08-25",
    totalAvailableRoomNightsPTD: totalAvailablePTD,
    totalNightsSoldPTD: totalSoldPTD,
    meanOccupancyPctPTD: Math.round((totalSoldPTD / totalAvailablePTD) * 10000) / 100,
    adr: 3178.63,
    revpar: 973.50,
    roomRevenue: 419578.77,
    adults: 318,
    children: 28,
    confirmedReservations: 152,
    walkIns: 13,
    complimentary: 10,
    noShows: 0,
  },
};