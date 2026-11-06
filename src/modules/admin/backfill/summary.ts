import { addDays } from "@/lib/format";
import type { BackfillBill, BackfillCash, BackfillStay } from "@/modules/admin/data/backfill";

/* ══════════════════════════════════════════════════════════════════
   THE DAY-BY-DAY SUMMARY OF WHAT WAS BACKFILLED (D27-398)

   One row a day, from the three registers, removed records left out:
     rooms sold       every night of a stay (arrival to the night before
                      departure)
     room charges, GST, other charges, and the payment
                      on the stay's LAST NIGHT - the hotel's paper bill is
                      one document made at check-out, and the last night
                      keeps every figure on a backfilled day (decided under
                      D27-396: the paper bill is not split across nights)
     restaurant sales the amount before GST, and its GST, on the bill's day;
                      the bill's total under its payment method
     cash in and out  on its day
   A sum of figures nobody typed is null - a dash - never a zero.
   ══════════════════════════════════════════════════════════════════ */

export interface DayRow {
  date: string;
  roomsSold: number;
  roomCharges: number | null;
  gst: number | null;
  otherCharges: number | null;
  restaurantSales: number | null;
  restaurantGst: number | null;
  /** By the hotel's own words for each method. */
  payments: Record<string, number>;
  cashIn: number | null;
  cashOut: number | null;
}

/** a + b, where a figure not typed is null and stays null until one is. */
export const plus = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.round((a + b) * 100) / 100;

const blank = (date: string): DayRow => ({
  date, roomsSold: 0, roomCharges: null, gst: null, otherCharges: null,
  restaurantSales: null, restaurantGst: null, payments: {}, cashIn: null, cashOut: null,
});

const pay = (row: DayRow, method: string | null, amount: number | null) => {
  if (!method || amount === null) return;
  row.payments[method] = plus(row.payments[method] ?? null, amount)!;
};

export function daySummary(
  stays: readonly BackfillStay[], bills: readonly BackfillBill[], cash: readonly BackfillCash[],
): DayRow[] {
  const days = new Map<string, DayRow>();
  const at = (date: string) => days.get(date) ?? days.set(date, blank(date)).get(date)!;

  for (const s of stays) {
    if (s.removedAt) continue;
    for (let d = s.arrival; d < s.departure; d = addDays(d, 1)) at(d).roomsSold += 1;
    const last = at(addDays(s.departure, -1));
    last.roomCharges = plus(last.roomCharges, s.roomCharges);
    last.gst = plus(last.gst, s.gst);
    last.otherCharges = plus(last.otherCharges, s.otherCharges);
    pay(last, s.paidBy, s.paid);
  }
  for (const b of bills) {
    if (b.removedAt) continue;
    const row = at(b.billDate);
    row.restaurantSales = plus(row.restaurantSales, b.amount);
    row.restaurantGst = plus(row.restaurantGst, b.gst);
    pay(row, b.paidBy, b.total);
  }
  for (const c of cash) {
    if (c.removedAt) continue;
    const row = at(c.cashDate);
    if (c.direction === "in") row.cashIn = plus(row.cashIn, c.amount);
    else row.cashOut = plus(row.cashOut, c.amount);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The whole period, the same rule. */
export function totalOf(rows: readonly DayRow[]): Omit<DayRow, "date"> {
  const t = blank("");
  for (const r of rows) {
    t.roomsSold += r.roomsSold;
    t.roomCharges = plus(t.roomCharges, r.roomCharges);
    t.gst = plus(t.gst, r.gst);
    t.otherCharges = plus(t.otherCharges, r.otherCharges);
    t.restaurantSales = plus(t.restaurantSales, r.restaurantSales);
    t.restaurantGst = plus(t.restaurantGst, r.restaurantGst);
    for (const [m, v] of Object.entries(r.payments)) pay(t, m, v);
    t.cashIn = plus(t.cashIn, r.cashIn);
    t.cashOut = plus(t.cashOut, r.cashOut);
  }
  const { date: _date, ...rest } = t;
  return rest;
}

/** Every method a payment was taken by, in the order first met. */
export const methodsIn = (rows: readonly DayRow[]): string[] =>
  [...new Set(rows.flatMap((r) => Object.keys(r.payments)))];
