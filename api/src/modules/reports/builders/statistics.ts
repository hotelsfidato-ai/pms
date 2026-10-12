import type { Client } from "../../../db.ts";
import {
  col, row, total, pct, ratio, round2, reportDate,
  type ReportDoc, type ReportColumn, type ReportRow,
} from "../document.ts";
import {
  dailyFigures, sumDays, heading, firstTradingDay, soldRule,
  type Property, type DayFigures,
} from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   MONTHLY STATISTICS · MONTHLY OCCUPANCY · YEARLY STATISTICS

   The owner's eZee exports of 25 August 2026, in their order and with
   their words: one row per day, then one per month, and the same bar
   chart. Every figure is dailyFigures() added up (figures.ts), so the
   grid, the chart, the Manager report and the Dashboard count one way.

     Night Sold      paying room-nights
     Complimentary   complimentary room-nights
     Occ             rooms sold ÷ available rooms
     ADR             room charges ÷ rooms sold
                     "Rooms sold" is dailyFigures().sold, the Manager
                     report's Sold Room: paying, plus complimentary and
                     half of each day use as the hotel's switches say
                     (D27-307). The footnote says how they stand.
     Rev Par         room charges ÷ available rooms
     Pax             adults and children in those rooms
     Tax             on the room and on everything else posted that day
     Receipt         money received that day
     Expense         nothing this system records: "-", not 0
   ══════════════════════════════════════════════════════════════════ */

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "YYYY-MM" → its first and last day. */
export function monthWindow(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
    name: `${MONTHS[m - 1]} ${y}`,
  };
}

/** "1 Sat", as the export labels a day. */
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${WEEKDAYS[d.getUTCDay()]}`;
};

const GRID = (first: ReportColumn): ReportColumn[] => [
  first,
  col("available", "Available Rooms", "count"),
  col("sold", "Night Sold", "count"),
  col("complimentary", "Complimentary", "count"),
  col("occupancy", "Occ %", "percent"),
  col("adr", "ADR", "money"),
  col("revpar", "Rev Par", "money"),
  col("pax", "Pax", "count"),
  col("room", "Room Charges", "money"),
  col("extra", "Extra Charges", "money"),
  col("tax", "Tax", "money"),
  col("receipt", "Receipt", "money"),
  col("expense", "Expense", "money"),
];

/** One line of the grid, from any run of days. */
function figuresRow(first: string, f: Omit<DayFigures, "date">) {
  return {
    label: first,
    available: f.available,
    sold: f.paying,
    complimentary: f.complimentary,
    occupancy: pct(f.sold, f.available),
    adr: ratio(f.room, f.sold),
    revpar: ratio(f.room, f.available),
    pax: f.adults + f.children,
    room: f.room,
    extra: f.extra,
    /* Unknown when a night not charged yet has no room GST rule (D27-173): a dash. */
    tax: f.roomTax === null ? null : round2(f.roomTax + f.extraTax),
    receipt: f.receipt,
    expense: null,
  };
}

/** How this hotel counts a room sold, as its switches stand now (D27-307). */
const soldNote = (r: Awaited<ReturnType<typeof soldRule>>) =>
  "Occupancy and ADR count rooms sold as this hotel's switches say (Settings, Front desk rules): "
  + (r.compSold ? "a complimentary room counts as sold" : "a complimentary room does not count as sold")
  + (r.dayUseHalf ? "; a day use counts as half a room sold." : "; a day use is not counted.");

const FOOTNOTES = [
  "A night's room charge is shown on that night. Nights not yet posted, from the business date on, are at the booking's rate.",
  "Expense is not recorded in this system and shows \"-\".",
];

/** Which day the available rooms were counted from (D17-93). A figure
    that divides by the house says where the house starts. */
export const countedFrom = (opened: string | null) =>
  opened
    ? `Available rooms are counted from ${reportDate(opened)}, the day this property first traded. Earlier days show nothing.`
    : "This property has not traded yet, so every day of the period counts as available.";

export async function monthlyStatistics(
  client: Client, property: Property, month: string,
): Promise<ReportDoc> {
  const w = monthWindow(month);
  const days = await dailyFigures(client, property.id, w.from, w.to);
  const opened = await firstTradingDay(client, property.id);
  const rule = await soldRule(client, property.id);

  const rows: ReportRow[] = days.map((d) => row(figuresRow(dayLabel(d.date), d)));
  rows.push(total(figuresRow("Total", sumDays(days))));

  return {
    report: "monthly-statistics",
    title: "Monthly statistics",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "Month", value: w.name, kind: "text" }],
    sections: [{
      key: "days",
      title: w.name,
      columns: GRID(col("label", "Date", "text")),
      rows,
    }],
    /* The month's occupancy as bars, above the grid (the owner's D27-243:
       it left the Dashboard, which shows the nights ahead instead). */
    chart: occupancyChart(w.name, days),
    footnotes: [soldNote(rule), ...FOOTNOTES, countedFrom(opened)],
  };
}

/** One bar per night: rooms sold, as the hotel counts them, of the rooms
    to sell. Monthly occupancy and Monthly statistics draw the same one. */
const occupancyChart = (name: string, days: Awaited<ReturnType<typeof dailyFigures>>): NonNullable<ReportDoc["chart"]> => ({
  kind: "bar",
  title: `Monthly Occupancy - ${name}`,
  x: days.map((d) => String(Number(d.date.slice(8, 10)))),
  unit: "percent",
  series: [{
    label: "Occupancy %",
    values: days.map((d) => pct(d.sold, d.available)),
  }],
});

export async function monthlyOccupancy(
  client: Client, property: Property, month: string,
): Promise<ReportDoc> {
  const w = monthWindow(month);
  const days = await dailyFigures(client, property.id, w.from, w.to);
  const opened = await firstTradingDay(client, property.id);
  const rule = await soldRule(client, property.id);

  return {
    report: "monthly-occupancy",
    title: "Monthly occupancy",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "Month", value: w.name, kind: "text" }],
    sections: [],
    chart: occupancyChart(w.name, days),
    footnotes: [soldNote(rule), countedFrom(opened)],
  };
}

export async function yearlyStatistics(
  client: Client, property: Property, year: number,
): Promise<ReportDoc> {
  /* One query for the year, grouped here — twelve round trips gave the
     same answer twelve times slower. */
  const days = await dailyFigures(client, property.id, `${year}-01-01`, `${year}-12-31`);
  const opened = await firstTradingDay(client, property.id);
  const rule = await soldRule(client, property.id);

  const rows: ReportRow[] = MONTHS.map((name, i) => {
    const prefix = `${year}-${String(i + 1).padStart(2, "0")}`;
    return row(figuresRow(name, sumDays(days.filter((d) => d.date.startsWith(prefix)))));
  });
  rows.push(total(figuresRow("Grand Total", sumDays(days))));

  return {
    report: "yearly-statistics",
    title: "Yearly statistics",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "Year", value: String(year), kind: "text" }],
    sections: [{
      key: "months",
      title: `Year ${year}`,
      columns: GRID(col("label", "Month", "text")),
      rows,
    }],
    footnotes: [soldNote(rule), ...FOOTNOTES, countedFrom(opened)],
  };
}
