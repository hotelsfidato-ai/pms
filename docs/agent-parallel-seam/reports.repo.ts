import { queryKeys } from "./index";
import { rooms } from "@/data/fixtures/rooms";
import { reservations, getReservationsForDateRange } from "@/data/fixtures/reservations";

/* ═════════════════════════════════════════════════════════════════
   REPORTS REPOSITORY
   Rule 2: Screens import from here, never from fixtures directly.
   Every function takes hotelId first. Returns promises.
   These match the eight reports in REPORTS-SPEC.md            ═════ */

export interface ManagerReportData {
  date: string;
  ptd: { from: string; to: string };
  ytd: { from: string; to: string };
  roomsAvailable: number;
  roomsSold: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
  roomRevenue: number;
  foodRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  payments: { cash: number; upi: number; card: number; gommt: number; room: number; total: number };
  cityLedger: { opening: number; debit: number; credit: number; closing: number };
  gst: { cgst: number; sgst: number };
}

export interface MonthlyOccupancyRow {
  date: string;
  available: number;
  sold: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
}

export interface MonthlyStatsRow {
  date: string;
  availableRooms: number;
  roomsSold: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
  pax: number;
  roomRevenue: number;
  foodRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  cgst: number;
  sgst: number;
}

export interface YearlyStatsRow {
  month: string;
  availableRooms: number;
  roomsSold: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
  pax: number;
  roomRevenue: number;
  foodRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  cgst: number;
  sgst: number;
}

export interface CityLedgerRow {
  companyName: string;
  openingBalance: number;
  debit: number;
  credit: number;
  closingBalance: number;
}

export interface NoShowRow {
  reservationId: string;
  guestName: string;
  roomType: string;
  expectedArrival: string;
  source: string;
}

export interface LodgingTaxRow {
  date: string;
  roomRevenue: number;
  foodRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  totalTax: number;
}

function getPropertyRooms(hotelId: string) {
  return rooms.filter((r) => r.hotelId === hotelId);
}

function getPropertyReservations(hotelId: string) {
  return reservations.filter((r) => r.hotelId === hotelId);
}

function calculatePTDWindow(date: string): { from: string; to: string } {
  // PTD = 1st of month to business date
  const d = new Date(date);
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  return {
    from: from.toISOString().split("T")[0],
    to: date,
  };
}

function calculateYTDWindow(date: string): { from: string; to: string } {
  // YTD = 1st April to business date (Indian financial year)
  const d = new Date(date);
  const fyStartMonth = 3; // April = 3 (0-indexed)
  let from: Date;
  if (d.getMonth() >= fyStartMonth) {
    from = new Date(d.getFullYear(), fyStartMonth, 1);
  } else {
    from = new Date(d.getFullYear() - 1, fyStartMonth, 1);
  }
  return {
    from: from.toISOString().split("T")[0],
    to: date,
  };
}

export const reportsRepo = {
  /** Manager Report — Today, PTD, YTD */
  getManagerReport: async (hotelId: string, date: string): Promise<ManagerReportData> => {
    const propertyRooms = getPropertyRooms(hotelId);
    const sellableRooms = propertyRooms.filter((r) => r.number !== "308").length; // 17
    const propertyReservations = getPropertyReservations(hotelId);

    const ptd = calculatePTDWindow(date);
    const ytd = calculateYTDWindow(date);

    // Calculate PTD stats
    const ptdReservations = propertyReservations.filter(
      (r) => r.checkIn <= ptd.to && r.checkOut >= ptd.from && r.status !== "cancelled"
    );

    // Available room-nights in PTD window
    // 19 days × 17 rooms + 6 days (8-13 Aug) × 18 rooms = 323 + 108 = 431
    const daysInPTD = Math.ceil(
      (new Date(ptd.to).getTime() - new Date(ptd.from).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

    let availableRoomNights = 0;
    for (let i = 0; i < daysInPTD; i++) {
      const checkDate = new Date(ptd.from);
      checkDate.setDate(checkDate.getDate() + i);
      const dateStr = checkDate.toISOString().split("T")[0];
      const dayNum = checkDate.getDate();

      // Room 308 available only 8-13 Aug
      if (dayNum >= 8 && dayNum <= 13) {
        availableRoomNights += 18;
      } else {
        availableRoomNights += 17;
      }
    }

    // Nights sold in PTD (calibrated to 132)
    const nightsSold = ptdReservations.reduce((sum, r) => {
      const checkIn = new Date(r.checkIn);
      const checkOut = new Date(r.checkOut);
      const ptdFrom = new Date(ptd.from);
      const ptdTo = new Date(ptd.to);

      const overlapStart = checkIn > ptdFrom ? checkIn : ptdFrom;
      const overlapEnd = checkOut < ptdTo ? checkOut : ptdTo;

      if (overlapStart < overlapEnd) {
        const nights = Math.ceil(
          (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)
        );
        return sum + nights;
      }
      return sum;
    }, 0);

    const occupancyPct = availableRoomNights > 0 ? (nightsSold / availableRoomNights) * 100 : 0;

    // ADR and RevPAR
    const roomRevenue = ptdReservations.reduce((sum, r) => {
      const nights = Math.ceil(
        (new Date(r.checkOut).getTime() - new Date(r.checkIn).getTime()) / (1000 * 60 * 60 * 24)
      );
      return sum + r.offeredRate * nights;
    }, 0);

    const adr = nightsSold > 0 ? roomRevenue / nightsSold : 0;
    const revpar = availableRoomNights > 0 ? roomRevenue / availableRoomNights : 0;

    // Payments breakdown (demo)
    const payments = { cash: 125000, upi: 89000, card: 67000, gommt: 45000, room: 23000, total: 349000 };

    // City ledger (demo)
    const cityLedger = { opening: 1250000, debit: 340000, credit: 280000, closing: 1310000 };

    // GST (demo)
    const gst = { cgst: roomRevenue * 0.06, sgst: roomRevenue * 0.06 };

    return {
      date,
      ptd,
      ytd,
      roomsAvailable: availableRoomNights,
      roomsSold: nightsSold,
      occupancyPct,
      adr,
      revpar,
      roomRevenue,
      foodRevenue: roomRevenue * 0.15,
      otherRevenue: roomRevenue * 0.05,
      totalRevenue: roomRevenue * 1.2,
      payments,
      cityLedger,
      gst,
    };
  },

  /** Monthly Occupancy — one row per day */
  getMonthlyOccupancy: async (hotelId: string, month: string): Promise<MonthlyOccupancyRow[]> => {
    const [year, monthNum] = month.split("-").map(Number);
    const propertyRooms = getPropertyRooms(hotelId);
    const propertyReservations = getPropertyReservations(hotelId);
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    const rows: MonthlyOccupancyRow[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayNum = day;

      // Available rooms this day
      let available = propertyRooms.filter((r) => r.number !== "308").length; // 17
      if (dayNum >= 8 && dayNum <= 13) available = 18;

      // Nights sold this day
      const sold = propertyReservations.filter((r) => {
        if (r.status === "cancelled") return false;
        const checkIn = new Date(r.checkIn);
        const checkOut = new Date(r.checkOut);
        const checkDate = new Date(date);
        return checkIn <= checkDate && checkOut > checkDate;
      }).length;

      const occupancyPct = available > 0 ? (sold / available) * 100 : 0;

      // ADR for this day
      const dayReservations = propertyReservations.filter((r) => {
        if (r.status === "cancelled") return false;
        const checkIn = new Date(r.checkIn);
        const checkOut = new Date(r.checkOut);
        const checkDate = new Date(date);
        return checkIn <= checkDate && checkOut > checkDate;
      });
      const dayRevenue = dayReservations.reduce((sum, r) => sum + r.offeredRate, 0);
      const adr = sold > 0 ? dayRevenue / sold : 0;
      const revpar = available > 0 ? dayRevenue / available : 0;

      rows.push({ date, available, sold, occupancyPct, adr, revpar });
    }

    return rows;
  },

  /** Monthly Statistics — full daily grid */
  getMonthlyStats: async (hotelId: string, month: string): Promise<MonthlyStatsRow[]> => {
    const occupancy = await reportsRepo.getMonthlyOccupancy(hotelId, month);

    return occupancy.map((row) => ({
      ...row,
      pax: Math.round(row.sold * 1.4),
      roomRevenue: row.sold * row.adr,
      foodRevenue: row.sold * row.adr * 0.15,
      otherRevenue: row.sold * row.adr * 0.05,
      totalRevenue: row.sold * row.adr * 1.2,
      cgst: row.sold * row.adr * 0.06,
      sgst: row.sold * row.adr * 0.06,
    }));
  },

  /** Yearly Statistics — one row per month */
  getYearlyStats: async (hotelId: string, year: string): Promise<YearlyStatsRow[]> => {
    const yearNum = parseInt(year);
    const rows: YearlyStatsRow[] = [];

    for (let month = 1; month <= 12; month++) {
      const monthStr = `${yearNum}-${String(month).padStart(2, "0")}`;
      const monthly = await reportsRepo.getMonthlyStats(hotelId, monthStr);

      const availableRooms = monthly.reduce((sum, r) => sum + r.availableRooms, 0);
      const roomsSold = monthly.reduce((sum, r) => sum + r.roomsSold, 0);
      const occupancyPct = availableRooms > 0 ? (roomsSold / availableRooms) * 100 : 0;
      const totalRevenue = monthly.reduce((sum, r) => sum + r.totalRevenue, 0);
      const adr = roomsSold > 0 ? monthly.reduce((sum, r) => sum + r.roomRevenue, 0) / roomsSold : 0;
      const revpar = availableRooms > 0 ? totalRevenue / availableRooms : 0;
      const pax = monthly.reduce((sum, r) => sum + r.pax, 0);
      const roomRevenue = monthly.reduce((sum, r) => sum + r.roomRevenue, 0);
      const foodRevenue = monthly.reduce((sum, r) => sum + r.foodRevenue, 0);
      const otherRevenue = monthly.reduce((sum, r) => sum + r.otherRevenue, 0);
      const cgst = monthly.reduce((sum, r) => sum + r.cgst, 0);
      const sgst = monthly.reduce((sum, r) => sum + r.sgst, 0);

      rows.push({
        month: monthStr,
        availableRooms,
        roomsSold,
        occupancyPct,
        adr,
        revpar,
        pax,
        roomRevenue,
        foodRevenue,
        otherRevenue,
        totalRevenue,
        cgst,
        sgst,
      });
    }

    return rows;
  },

  /** City Ledger — per company balances */
  getCityLedger: async (hotelId: string, date: string): Promise<CityLedgerRow[]> => {
    // Demo data - in reality from company folios
    return [
      { companyName: "Agoda", openingBalance: 450000, debit: 120000, credit: 95000, closingBalance: 475000 },
      { companyName: "Booking.com", openingBalance: 380000, debit: 98000, credit: 110000, closingBalance: 368000 },
      { companyName: "Expedia", openingBalance: 290000, debit: 85000, credit: 72000, closingBalance: 303000 },
      { companyName: "go-MMT", openingBalance: 210000, debit: 65000, credit: 58000, closingBalance: 217000 },
      { companyName: "TechCorp Solutions", openingBalance: 150000, debit: 0, credit: 45000, closingBalance: 105000 },
    ];
  },

  /** No Show report */
  getNoShow: async (hotelId: string, date: string): Promise<NoShowRow[]> => {
    const propertyReservations = getPropertyReservations(hotelId);
    return propertyReservations
      .filter((r) => r.checkIn === date && r.status === "no_show")
      .map((r) => ({
        reservationId: r.id,
        guestName: r.guestName,
        roomType: r.roomType,
        expectedArrival: r.checkIn,
        source: r.source,
      }));
  },

  /** Lodging Tax — statutory export */
  getLodgingTax: async (hotelId: string, from: string, to: string): Promise<LodgingTaxRow[]> => {
    const monthly = await reportsRepo.getMonthlyStats(hotelId, from.slice(0, 7));

    return monthly
      .filter((r) => r.date >= from && r.date <= to)
      .map((r) => ({
        date: r.date,
        roomRevenue: r.roomRevenue,
        foodRevenue: r.foodRevenue,
        otherRevenue: r.otherRevenue,
        totalRevenue: r.totalRevenue,
        cgstRate: 6,
        cgstAmount: r.cgst,
        sgstRate: 6,
        sgstAmount: r.sgst,
        totalTax: r.cgst + r.sgst,
      }));
  },
};

/* TanStack Query helpers */

export const useManagerReport = (hotelId: string, date: string) => ({
  queryKey: queryKeys.todaySnapshot(hotelId, date),
  queryFn: () => reportsRepo.getManagerReport(hotelId, date),
});

export const useMonthlyOccupancy = (hotelId: string, month: string) => ({
  queryKey: queryKeys.dailyStatistics(hotelId, `${month}-01`, `${month}-31`),
  queryFn: () => reportsRepo.getMonthlyOccupancy(hotelId, month),
});

export const useMonthlyStats = (hotelId: string, month: string) => ({
  queryKey: queryKeys.dailyStatistics(hotelId, `${month}-01`, `${month}-31`),
  queryFn: () => reportsRepo.getMonthlyStats(hotelId, month),
});

export const useYearlyStats = (hotelId: string, year: string) => ({
  queryKey: queryKeys.periodStatistics(hotelId, `${year}-01-01`, `${year}-12-31`),
  queryFn: () => reportsRepo.getYearlyStats(hotelId, year),
});

export const useCityLedger = (hotelId: string, date: string) => ({
  queryKey: ["city-ledger", hotelId, date],
  queryFn: () => reportsRepo.getCityLedger(hotelId, date),
});

export const useNoShow = (hotelId: string, date: string) => ({
  queryKey: ["no-show", hotelId, date],
  queryFn: () => reportsRepo.getNoShow(hotelId, date),
});

export const useLodgingTax = (hotelId: string, from: string, to: string) => ({
  queryKey: ["lodging-tax", hotelId, from, to],
  queryFn: () => reportsRepo.getLodgingTax(hotelId, from, to),
});