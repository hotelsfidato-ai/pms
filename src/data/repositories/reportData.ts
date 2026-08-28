import { readStays, readPostings, balanceOf } from "../store";
import {
  property, dailyAvailableRooms, nightsSoldPerDay, dailyOccupancy, isDemoProperty } from "../fixtures/property";
import type { Stay } from "./types";

/* ══════════════════════════════════════════════════════════════════
   REPORT DATA — the aggregations behind the statutory reports

   Every figure derives from the ledger or the calibrated occupancy.
   Where a report needs something this system does not yet hold — an
   OTA's own commission, a bill series that predates the demo window —
   the value is `null` and the screen prints a dash.
   ══════════════════════════════════════════════════════════════════ */

const round = (n: number) => Math.round(n * 100) / 100;
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;
const guard = isDemoProperty;

/* ── No Show ─────────────────────────────────────────────────────── */

export interface NoShowRow {
  reference: string;
  guest: string;
  roomType: string;
  arrival: string;
  departure: string;
  source: string;
  rate: number;
}

/**
 * Usually empty, and it still prints. The real export for 25 August
 * carries nothing but the property, the title and the date — that is
 * correct behaviour, not an empty state asking you to create one.
 */
export async function getNoShowReport(
  hotelId: string, date: string,
): Promise<NoShowRow[]> {
  if (!guard(hotelId)) return [];
  return readStays()
    .filter((s) => s.status === "no-show" && s.arrival === date)
    .map((s) => ({
      reference: s.reference,
      guest: s.guest,
      roomType: s.roomType,
      arrival: s.arrival,
      departure: s.departure,
      source: s.source,
      rate: s.offeredTariff,
    }));
}

/* ── City Ledger ─────────────────────────────────────────────────── */

export interface CityLedgerRow {
  account: string;
  contact: string;
  phone: string | null;
  opening: number | null;
  debit: number;
  credit: number;
  closing: number | null;
}

/**
 * One row per booking source that carries a balance. The real export
 * lists Agoda, Booking.com, Expedia, go-MMT and Walk-in, and several
 * balances are NEGATIVE — the OTA owes the hotel. That is normal.
 */
export async function getCityLedger(
  hotelId: string, from: string, to: string,
): Promise<CityLedgerRow[]> {
  if (!guard(hotelId)) return [];

  const stays = readStays();
  const bySource = new Map<string, Stay[]>();
  for (const s of stays) {
    if (!bySource.has(s.source)) bySource.set(s.source, []);
    bySource.get(s.source)!.push(s);
  }

  const postings = readPostings().filter(
    (p) => !p.reversed && inRange(p.businessDate, from, to),
  );

  return [...bySource.entries()]
    .map(([source, list]) => {
      const ids = new Set(list.map((s) => s.id));
      const lines = postings.filter((p) => ids.has(p.folioId));
      const debit = round(
        lines.filter((p) => p.kind !== "payment").reduce((t, p) => t + p.amount + p.tax, 0),
      );
      const credit = round(
        lines.filter((p) => p.kind === "payment").reduce((t, p) => t + -p.amount, 0),
      );
      const closing = round(list.reduce((t, s) => t + balanceOf(s.id), 0));

      return {
        account: source,
        contact: `Mr. ${source}`,
        /* The real export shows a dash — the phone is not held here. */
        phone: null,
        /* Nothing predates the demo window, so an opening balance
           would be invented. */
        opening: null,
        debit,
        credit,
        closing,
      };
    })
    .sort((a, b) => a.account.localeCompare(b.account));
}

/* ── Monthly Statistics — one row per day ────────────────────────── */

export interface MonthlyStatRow {
  date: string;
  availableRooms: number;
  nightSold: number;
  complimentary: number;
  occupancyPct: number;
  adr: number;
  revPar: number;
  pax: number;
  roomCharges: number;
  extraCharges: number;
  tax: number;
  receipt: number;
  expense: number;
}

export async function getMonthlyStatistics(
  hotelId: string, from: string, to: string,
): Promise<MonthlyStatRow[]> {
  if (!guard(hotelId)) return [];

  const stays = readStays().filter((s) => s.status !== "cancelled");
  const postings = readPostings().filter((p) => !p.reversed);

  return Object.keys(dailyAvailableRooms)
    .filter((d) => inRange(d, from, to))
    .sort()
    .map((date) => {
      const available = dailyAvailableRooms[date] ?? 0;
      const sold = nightsSoldPerDay[date] ?? 0;

      const onDate = postings.filter((p) => p.businessDate === date);
      const roomCharges = round(
        onDate.filter((p) => p.kind !== "payment" && p.category === "Room posting")
          .reduce((t, p) => t + p.amount, 0),
      );
      const extraCharges = round(
        onDate.filter((p) => p.kind !== "payment" && p.category !== "Room posting")
          .reduce((t, p) => t + p.amount, 0),
      );
      const tax = round(
        onDate.filter((p) => p.kind !== "payment").reduce((t, p) => t + p.tax, 0),
      );
      const receipt = round(
        onDate.filter((p) => p.kind === "payment").reduce((t, p) => t + -p.amount, 0),
      );

      const inHouse = stays.filter(
        (s) => !s.isDayUse && s.arrival <= date && s.departure > date,
      );

      return {
        date,
        availableRooms: available,
        nightSold: sold,
        complimentary: inHouse.filter((s) => s.isComplimentary).length,
        occupancyPct: dailyOccupancy[date] ?? 0,
        adr: sold ? round(roomCharges / sold) : 0,
        revPar: available ? round(roomCharges / available) : 0,
        pax: inHouse.reduce((t, s) => t + s.adults + s.children, 0),
        roomCharges,
        extraCharges,
        tax,
        receipt,
        /* No expense ledger in this system. The real export shows 0.00. */
        expense: 0,
      };
    });
}

/* ── Yearly Statistics — one row per month ───────────────────────── */

export interface YearlyStatRow extends Omit<MonthlyStatRow, "date"> {
  month: string;
  monthLabel: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function getYearlyStatistics(
  hotelId: string, year: number,
): Promise<YearlyStatRow[]> {
  if (!guard(hotelId)) return [];

  const rows: YearlyStatRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const from = `${year}-${mm}-01`;
    const to = `${year}-${mm}-31`;
    const days = await getMonthlyStatistics(hotelId, from, to);

    const sum = (k: keyof MonthlyStatRow) =>
      round(days.reduce((t, d) => t + (d[k] as number), 0));
    const available = sum("availableRooms");
    const sold = sum("nightSold");
    const roomCharges = sum("roomCharges");

    rows.push({
      month: `${year}-${mm}`,
      monthLabel: MONTHS[m - 1]!,
      availableRooms: available,
      nightSold: sold,
      complimentary: sum("complimentary"),
      occupancyPct: available ? round((sold / available) * 100) : 0,
      adr: sold ? round(roomCharges / sold) : 0,
      revPar: available ? round(roomCharges / available) : 0,
      pax: sum("pax"),
      roomCharges,
      extraCharges: sum("extraCharges"),
      tax: sum("tax"),
      receipt: sum("receipt"),
      expense: 0,
    });
  }
  return rows;
}

/* ── Lodging Tax — the statutory one ─────────────────────────────── */

export interface LodgingTaxRow {
  date: string;
  fromBill: string;
  toBill: string;
  totalBill: number;
  totalRoomRent: number;
  nonTaxable: number;
  cgstNet: number;
  cgstTax: number;
  sgstNet: number;
  sgstTax: number;
  serviceCharges: number;
  otherBills: number;
  lessDiscount: number;
  roundOff: number;
}

/**
 * Filed with authorities, so the format is not ours to redesign. Bill
 * numbers are contiguous per day and continuous across the month — a
 * gap is an audit finding, not a display quirk.
 */
export async function getLodgingTax(
  hotelId: string, from: string, to: string,
): Promise<LodgingTaxRow[]> {
  if (!guard(hotelId)) return [];

  const postings = readPostings().filter(
    (p) => !p.reversed && inRange(p.businessDate, from, to),
  );

  const dates = [...new Set(postings.map((p) => p.businessDate))].sort();
  let bill = 736; // continues the real July series

  return dates.map((date) => {
    const onDate = postings.filter((p) => p.businessDate === date);
    const charges = onDate.filter((p) => p.kind !== "payment");
    if (charges.length === 0) return null;

    const roomRent = round(
      charges.filter((p) => p.category === "Room posting").reduce((t, p) => t + p.amount, 0),
    );
    const other = round(
      charges.filter((p) => p.category !== "Room posting").reduce((t, p) => t + p.amount, 0),
    );
    const tax = round(charges.reduce((t, p) => t + p.tax, 0));
    const half = round(tax / 2);
    const gross = round(roomRent + other + tax);
    const rounded = Math.round(gross);

    const fromBill = bill;
    bill += Math.max(1, charges.length);

    return {
      date,
      fromBill: String(fromBill),
      toBill: String(bill - 1),
      totalBill: rounded,
      totalRoomRent: roomRent,
      /* Nothing in this system is non-taxable yet. */
      nonTaxable: 0,
      cgstNet: roomRent,
      cgstTax: half,
      sgstNet: roomRent,
      sgstTax: half,
      /* Service charge is not levied at this property. */
      serviceCharges: 0,
      otherBills: other,
      lessDiscount: round(
        -charges.filter((p) => p.amount < 0).reduce((t, p) => t + p.amount, 0),
      ),
      roundOff: round(rounded - gross),
    } satisfies LodgingTaxRow;
  }).filter((r): r is LodgingTaxRow => r !== null);
}

export const REPORT_PROPERTY = property.name;
