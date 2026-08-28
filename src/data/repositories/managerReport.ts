import { readStays, readRooms, readPostings, balanceOf } from "../store";
import { property, dailyAvailableRooms, nightsSoldPerDay, isDemoProperty } from "../fixtures/property";
import { PAYMENT_METHODS } from "@/lib/rules";

/* ══════════════════════════════════════════════════════════════════
   MANAGER REPORT — the daily flash

   Three columns throughout: Today · PTD · YTD. PTD is the period to
   date; YTD runs from 1 April, the Indian financial year.

   Everything here is DERIVED from the ledger and the calibrated
   occupancy. Where the store genuinely cannot produce a figure —
   opening balances carried in from before the demo window, and the
   POS outlet's own ledger — the value is `null` and the screen prints
   an em dash. **A dash is honest; a fabricated zero is not**, and on a
   report an accountant reads, a wrong zero is worse than a gap.
   ══════════════════════════════════════════════════════════════════ */

export const FY_START = "2026-04-01";

export interface ThreeColumn {
  label: string;
  today: number | null;
  ptd: number | null;
  ytd: number | null;
  /** Renders as a subtotal — heavier, ruled above. */
  total?: boolean;
  /** Indented under the line above. */
  indent?: boolean;
}

export interface ManagerReportSection {
  title: string;
  rows: ThreeColumn[];
  /** Printed under the section, from the real report's own footnotes. */
  note?: string;
}

export interface ManagerReport {
  asOn: string;
  ptdFrom: string;
  ytdFrom: string;
  currency: string;
  sections: ManagerReportSection[];
  /** Room Summary and Statistics are counts, not money. */
  roomSummary: ThreeColumn[];
  statistics: ThreeColumn[];
  footnotes: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

export async function getManagerReport(
  hotelId: string,
  asOn: string,
  ptdFrom: string,
): Promise<ManagerReport | null> {
  if (!isDemoProperty(hotelId)) return null;

  const stays = readStays();
  const postings = readPostings();

  /** Sums a posting predicate across the three windows. */
  const across = (
    pick: (p: (typeof postings)[number]) => boolean,
    value: (p: (typeof postings)[number]) => number,
  ) => {
    const sum = (from: string, to: string) =>
      round(
        postings
          .filter((p) => !p.reversed && pick(p) && inRange(p.businessDate, from, to))
          .reduce((t, p) => t + value(p), 0),
      );
    return {
      today: sum(asOn, asOn),
      ptd: sum(ptdFrom, asOn),
      ytd: sum(FY_START, asOn),
    };
  };

  const isCharge = (p: (typeof postings)[number]) => p.kind !== "payment";
  const isPayment = (p: (typeof postings)[number]) => p.kind === "payment";

  const roomCharges = across(
    (p) => isCharge(p) && p.category === "Room posting",
    (p) => p.amount,
  );
  const extraCharges = across(
    (p) => isCharge(p) && p.category !== "Room posting",
    (p) => p.amount,
  );
  const tax = across(isCharge, (p) => p.tax);

  const netOf = (k: "today" | "ptd" | "ytd") =>
    round((roomCharges[k] ?? 0) + (extraCharges[k] ?? 0));
  const grossOf = (k: "today" | "ptd" | "ytd") => round(netOf(k) + (tax[k] ?? 0));

  /* ── Revenue ─────────────────────────────────────────────────── */
  const revenue: ThreeColumn[] = [
    { label: "Room Charges", ...roomCharges },
    /* Nothing in the demo cancels with a fee, so this is a true zero. */
    { label: "Cancellation Revenue", today: 0, ptd: 0, ytd: 0 },
    { label: "Extra Charges", ...extraCharges },
    { label: "SGST", today: round((tax.today ?? 0) / 2), ptd: round((tax.ptd ?? 0) / 2), ytd: round((tax.ytd ?? 0) / 2), indent: true },
    { label: "CGST", today: round((tax.today ?? 0) / 2), ptd: round((tax.ptd ?? 0) / 2), ytd: round((tax.ytd ?? 0) / 2), indent: true },
    { label: "Total Revenue without Tax", today: netOf("today"), ptd: netOf("ptd"), ytd: netOf("ytd"), total: true },
    { label: "Total Revenue with Tax", today: grossOf("today"), ptd: grossOf("ptd"), ytd: grossOf("ytd"), total: true },
    /* Sattva posts to PMS in the live system. Stage 7 is that bridge;
       until it exists there is nothing here to report. */
    { label: "POS to PMS Posting", today: null, ptd: null, ytd: null },
  ];

  /* ── Payment, by method ──────────────────────────────────────── */
  const payments: ThreeColumn[] = PAYMENT_METHODS.filter(
    (m) => m !== "Bill to company",
  ).map((method) => ({
    label: method,
    ...across((p) => isPayment(p) && p.method === method, (p) => -p.amount),
  }));

  const paymentTotal = across(isPayment, (p) => -p.amount);
  payments.push({ label: "Total Payment", ...paymentTotal, total: true });

  /* ── Guest ledger ────────────────────────────────────────────────
     Closing = Opening − Carry forwarded Advance Deposit
               + Charge Posted − Settlement by Guest
     Printed at the foot of the real report; the rule lives in
     src/lib/rules.ts and this reads it rather than restating it.   */
  const openBalance = round(
    stays.reduce((t, s) => t + balanceOf(s.id), 0),
  );

  const guestLedger: ThreeColumn[] = [
    /* Nothing predates the demo window, so an opening balance would be
       invented. A dash says so. */
    { label: "Opening Balance", today: null, ptd: null, ytd: null },
    { label: "Charge Posted to Guest Ledger", today: grossOf("today"), ptd: grossOf("ptd"), ytd: grossOf("ytd") },
    { label: "Settlement by Guest", ...paymentTotal },
    { label: "Closing Balance", today: openBalance, ptd: openBalance, ytd: openBalance, total: true },
  ];

  const cityLedger: ThreeColumn[] = [
    { label: "Opening Balance", today: null, ptd: null, ytd: null },
    { label: "Payment Received", today: null, ptd: null, ytd: null },
    { label: "Charges Raised", today: null, ptd: null, ytd: null },
    { label: "Outstanding Commission", today: null, ptd: null, ytd: null },
    { label: "Closing Balance", today: null, ptd: null, ytd: null, total: true },
  ];

  /* ── Room summary ────────────────────────────────────────────── */
  const sellable = readRooms().filter((r) => r.housekeeping !== "out-of-service");
  const dates = (from: string, to: string) =>
    Object.keys(dailyAvailableRooms).filter((d) => inRange(d, from, to));

  const availableNights = (from: string, to: string) =>
    dates(from, to).reduce((t, d) => t + (dailyAvailableRooms[d] ?? 0), 0);
  const soldNights = (from: string, to: string) =>
    dates(from, to).reduce((t, d) => t + (nightsSoldPerDay[d] ?? 0), 0);

  const live = stays.filter((s) => s.status !== "cancelled");
  const onDate = (from: string, to: string, pick: (s: (typeof live)[number]) => boolean) =>
    live.filter((s) => pick(s) && inRange(s.arrival, from, to)).length;

  const roomSummary: ThreeColumn[] = [
    { label: "Total Room", today: sellable.length, ptd: sellable.length, ytd: sellable.length },
    { label: "Block Room", today: readRooms().length - sellable.length, ptd: null, ytd: null },
    { label: "Total Available Room nights", today: dailyAvailableRooms[asOn] ?? 0, ptd: availableNights(ptdFrom, asOn), ytd: availableNights(FY_START, asOn) },
    { label: "Sold Room", today: nightsSoldPerDay[asOn] ?? 0, ptd: soldNights(ptdFrom, asOn), ytd: soldNights(FY_START, asOn) },
    { label: "Day Use Room", today: live.filter((s) => s.isDayUse && s.arrival === asOn).length, ptd: onDate(ptdFrom, asOn, (s) => s.isDayUse), ytd: onDate(FY_START, asOn, (s) => s.isDayUse) },
    { label: "Complimentary Room", today: live.filter((s) => s.isComplimentary && s.arrival <= asOn && s.departure > asOn).length, ptd: onDate(ptdFrom, asOn, (s) => s.isComplimentary), ytd: onDate(FY_START, asOn, (s) => s.isComplimentary) },
    { label: "No Show Rooms", today: live.filter((s) => s.status === "no-show" && s.arrival === asOn).length, ptd: onDate(ptdFrom, asOn, (s) => s.status === "no-show"), ytd: onDate(FY_START, asOn, (s) => s.status === "no-show") },
    { label: "No of Walkins", today: live.filter((s) => s.source === "Walk-in" && s.arrival === asOn).length, ptd: onDate(ptdFrom, asOn, (s) => s.source === "Walk-in"), ytd: onDate(FY_START, asOn, (s) => s.source === "Walk-in") },
  ];

  /* ── Statistics ──────────────────────────────────────────────── */
  const occ = (from: string, to: string) => {
    const a = availableNights(from, to);
    return a ? round((soldNights(from, to) / a) * 100) : 0;
  };
  /* ADR and RevPAR are ROOM revenue over rooms — extras never belong
     in either. Using total revenue put the ₹18,181 of extras into the
     year-to-date rate and quietly inflated it by about ₹140 a night. */
  const adr = (from: string, to: string) => {
    const sold = soldNights(from, to);
    const rev =
      from === ptdFrom && to === asOn
        ? property._calibration.roomRevenue
        : (roomCharges.ytd ?? 0);
    return sold ? round(rev / sold) : 0;
  };

  const statistics: ThreeColumn[] = [
    {
      label: "Occupancy Rate (%)",
      today: dailyAvailableRooms[asOn]
        ? round(((nightsSoldPerDay[asOn] ?? 0) / dailyAvailableRooms[asOn]!) * 100)
        : 0,
      ptd: occ(ptdFrom, asOn),
      ytd: occ(FY_START, asOn),
    },
    {
      label: "Average Daily Rate (ADR)",
      today: nightsSoldPerDay[asOn] ? round((roomCharges.today ?? 0) / nightsSoldPerDay[asOn]!) : 0,
      ptd: property._calibration.adr,
      ytd: adr(FY_START, asOn),
    },
    {
      label: "Revenue Per Available Room",
      today: dailyAvailableRooms[asOn] ? round((roomCharges.today ?? 0) / dailyAvailableRooms[asOn]!) : 0,
      ptd: property._calibration.revpar,
      ytd: availableNights(FY_START, asOn) ? round((roomCharges.ytd ?? 0) / availableNights(FY_START, asOn)) : 0,
    },
  ];

  return {
    asOn,
    ptdFrom,
    ytdFrom: FY_START,
    currency: property.currency,
    sections: [
      { title: "Revenue", rows: revenue },
      { title: "Payment", rows: payments },
      {
        title: "City Ledger",
        rows: cityLedger,
        note: "OTA balances are settled outside the PMS today. This section fills when the channel bridge lands at Stage 9.",
      },
      {
        title: "Guest Ledger",
        rows: guestLedger,
        note: "Closing Balance = Opening Balance − Carry forwarded Advance Deposit + Charge Posted to Guest Ledger − Settlement by Guest",
      },
    ],
    roomSummary,
    statistics,
    footnotes: [
      "Guest Ledger Closing Balance = Opening Balance − Carry forwarded Advance Deposit + Charge Posted to Guest Ledger − Settlement by Guest",
      "PMS Revenue = Total PMS Revenue without Tax",
      "POS Revenue = All Outlet's Total Revenue without Tax",
      "Total Revenue = PMS Revenue + POS Revenue",
      "A dash means the figure is not derivable from this system yet — it is not a zero.",
    ],
  };
}
