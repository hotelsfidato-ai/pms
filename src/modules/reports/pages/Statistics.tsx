import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Skeleton } from "@/components/ui";
import {
  ReportShell, ReportTable, ReportHead, Amount,
} from "@/modules/reports/components/ReportShell";
import { getMonthlyStatistics, getYearlyStatistics, type MonthlyStatRow, type YearlyStatRow } from "@/modules/reports/data/reportData";
import { PTD_FROM } from "@/modules/reports/data/statistics";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   MONTHLY OCCUPANCY · MONTHLY STATISTICS · YEARLY STATISTICS

   Three views of the same numbers, at three grains. The real exports
   keep the same column order across all of them, so a manager reading
   one already knows how to read the next.

   Available Rooms varies by row — 17 most days, 18 on 8–13 August.
   Never hardcoded, never assumed.
   ══════════════════════════════════════════════════════════════════ */

const num = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

/* ── Monthly Occupancy — the bar chart ───────────────────────────── */

export function MonthlyOccupancyPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading } = useQuery({
    queryKey: ["monthly-occupancy", hotelId],
    queryFn: () => getMonthlyStatistics(hotelId, "2026-08-01", "2026-08-31"),
  });

  const chart = (data ?? []).map((d) => ({
    day: Number(d.date.slice(-2)),
    occupancy: d.occupancyPct,
    sold: d.nightSold,
    available: d.availableRooms,
  }));

  return (
    <ReportShell
      title="Monthly occupancy"
      period="August 2026"
      meta="Monthly Occupancy — August 2026"
    >
      {isLoading ? (
        <div className="p-5"><Skeleton className="h-72 w-full" /></div>
      ) : (
        <div className="p-5">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--color-grey-200)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "var(--color-grey-500)" }}
                  axisLine={{ stroke: "var(--color-grey-200)" }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: "var(--color-grey-500)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <RTooltip
                  cursor={{ fill: "var(--color-grey-100)" }}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid var(--color-grey-200)",
                    fontSize: 13,
                  }}
                  formatter={(value, _name, item) => {
                    const p = (item as { payload?: { sold?: number; available?: number } })
                      ?.payload;
                    return [
                      `${value}%  (${p?.sold ?? 0} of ${p?.available ?? 0})`,
                      "Occupancy",
                    ];
                  }}
                  labelFormatter={(d) => `${d} August 2026`}
                />
                {/* Recharts v3 needs a fill on the Bar itself — without one the
                    rectangles render empty and Cell has nothing to override. */}
                <Bar dataKey="occupancy" radius={[3, 3, 0, 0]} fill="var(--color-brand-tangerine)" isAnimationActive={false}>
                  {chart.map((d) => (
                    <Cell
                      key={d.day}
                      /* The two full days are what a manager looks for. */
                      fill={
                        d.occupancy === 100
                          ? "var(--color-success)"
                          : d.occupancy === 0
                            ? "var(--color-grey-300)"
                            : "var(--color-brand-tangerine)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-2xs text-grey-500 mt-3">
            Green marks a full house, grey an empty one. This property swings
            between both inside a fortnight.
          </p>
        </div>
      )}
    </ReportShell>
  );
}

/* ── Monthly Statistics — the daily grid ─────────────────────────── */

const STAT_COLUMNS = [
  { label: "Date" },
  { label: "Available", numeric: true },
  { label: "Night Sold", numeric: true },
  { label: "Comp.", numeric: true },
  { label: "Occ %", numeric: true },
  { label: "ADR", numeric: true },
  { label: "RevPar", numeric: true },
  { label: "Pax", numeric: true },
  { label: "Room Charges", numeric: true },
  { label: "Extra", numeric: true },
  { label: "Tax", numeric: true },
  { label: "Receipt", numeric: true },
  { label: "Expense", numeric: true },
];

export function MonthlyStatisticsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading } = useQuery({
    queryKey: ["monthly-stats", hotelId],
    queryFn: () => getMonthlyStatistics(hotelId, "2026-08-01", "2026-08-31"),
  });

  const rows = data ?? [];
  const total = totals(rows);

  return (
    <ReportShell
      title="Monthly statistics"
      period="August 2026"
      meta="Month August, 2026   Show Unposted Inclusions Charges   No"
      csv={() => ({
        headers: [
          "Date", "Available", "Night sold", "Complimentary", "Occupancy %",
          "ADR", "RevPAR", "Pax", "Room charges", "Extra", "Tax",
          "Receipt", "Expense",
        ],
        rows: rows.map((r) => [
          r.date, r.availableRooms, r.nightSold, r.complimentary,
          r.occupancyPct, r.adr, r.revPar, r.pax,
          r.roomCharges, r.extraCharges, r.tax, r.receipt, r.expense,
        ]),
      })}
    >
      {isLoading ? (
        <div className="p-5 space-y-2">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      ) : (
        <ReportTable>
          <ReportHead columns={STAT_COLUMNS} />
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-b border-grey-100">
                <td className="px-4 py-2 tabular whitespace-nowrap">{dateShort(r.date)}</td>
                <Cellf v={r.availableRooms} f={num} />
                <Cellf v={r.nightSold} f={num} />
                <Cellf v={r.complimentary} f={num} />
                <Cellf v={r.occupancyPct} f={(n) => `${n}%`} />
                <Cellf v={r.adr} f={money} />
                <Cellf v={r.revPar} f={money} />
                <Cellf v={r.pax} f={num} />
                <Cellf v={r.roomCharges} f={money} />
                <Cellf v={r.extraCharges} f={money} />
                <Cellf v={r.tax} f={money} />
                <Cellf v={r.receipt} f={money} />
                <Cellf v={r.expense} f={money} />
              </tr>
            ))}
            <tr className="bg-grey-50 border-t-2 border-ink-900">
              <td className="px-4 py-2.5 font-semibold text-ink-900">Total</td>
              <Cellf v={total.availableRooms} f={num} bold />
              <Cellf v={total.nightSold} f={num} bold />
              <Cellf v={total.complimentary} f={num} bold />
              <Cellf v={total.occupancyPct} f={(n) => `${n}%`} bold />
              <Cellf v={total.adr} f={money} bold />
              <Cellf v={total.revPar} f={money} bold />
              <Cellf v={total.pax} f={num} bold />
              <Cellf v={total.roomCharges} f={money} bold />
              <Cellf v={total.extraCharges} f={money} bold />
              <Cellf v={total.tax} f={money} bold />
              <Cellf v={total.receipt} f={money} bold />
              <Cellf v={total.expense} f={money} bold />
            </tr>
          </tbody>
        </ReportTable>
      )}
    </ReportShell>
  );
}

/* ── Yearly Statistics — the monthly grid ────────────────────────── */

export function YearlyStatisticsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading } = useQuery({
    queryKey: ["yearly-stats", hotelId, 2026],
    queryFn: () => getYearlyStatistics(hotelId, 2026),
  });

  const rows = data ?? [];
  const total = totals(rows);

  return (
    <ReportShell title="Yearly statistics" period="2026" meta="Year 2026">
      {isLoading ? (
        <div className="p-5 space-y-2">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      ) : (
        <ReportTable>
          <ReportHead columns={[{ label: "Month" }, ...STAT_COLUMNS.slice(1)]} />
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.month}
                className={cn(
                  "border-b border-grey-100",
                  r.nightSold === 0 && "text-grey-500",
                )}
              >
                <td className="px-4 py-2 whitespace-nowrap">{r.monthLabel}</td>
                <Cellf v={r.availableRooms} f={num} />
                <Cellf v={r.nightSold} f={num} />
                <Cellf v={r.complimentary} f={num} />
                <Cellf v={r.occupancyPct} f={(n) => `${n}%`} />
                <Cellf v={r.adr} f={money} />
                <Cellf v={r.revPar} f={money} />
                <Cellf v={r.pax} f={num} />
                <Cellf v={r.roomCharges} f={money} />
                <Cellf v={r.extraCharges} f={money} />
                <Cellf v={r.tax} f={money} />
                <Cellf v={r.receipt} f={money} />
                <Cellf v={r.expense} f={money} />
              </tr>
            ))}
            <tr className="bg-grey-50 border-t-2 border-ink-900">
              <td className="px-4 py-2.5 font-semibold text-ink-900">Grand Total</td>
              <Cellf v={total.availableRooms} f={num} bold />
              <Cellf v={total.nightSold} f={num} bold />
              <Cellf v={total.complimentary} f={num} bold />
              <Cellf v={total.occupancyPct} f={(n) => `${n}%`} bold />
              <Cellf v={total.adr} f={money} bold />
              <Cellf v={total.revPar} f={money} bold />
              <Cellf v={total.pax} f={num} bold />
              <Cellf v={total.roomCharges} f={money} bold />
              <Cellf v={total.extraCharges} f={money} bold />
              <Cellf v={total.tax} f={money} bold />
              <Cellf v={total.receipt} f={money} bold />
              <Cellf v={total.expense} f={money} bold />
            </tr>
          </tbody>
        </ReportTable>
      )}
    </ReportShell>
  );
}

/* ── Shared ──────────────────────────────────────────────────────── */

function Cellf({
  v, f, bold,
}: { v: number; f: (n: number) => string; bold?: boolean }) {
  return (
    <td className="px-4 py-2 text-right align-middle whitespace-nowrap">
      <Amount value={v} format={f} bold={bold} />
    </td>
  );
}

/** Rates are recomputed from the totals, never averaged from averages. */
type StatTotals = Omit<MonthlyStatRow, "date">;

function totals(rows: Array<MonthlyStatRow | YearlyStatRow>) {
  const sum = (k: keyof StatTotals) =>
    Math.round(
      rows.reduce((t, r) => t + ((r as StatTotals)[k] ?? 0), 0) * 100,
    ) / 100;

  const availableRooms = sum("availableRooms");
  const nightSold = sum("nightSold");
  const roomCharges = sum("roomCharges");

  return {
    availableRooms,
    nightSold,
    complimentary: sum("complimentary"),
    occupancyPct: availableRooms
      ? Math.round((nightSold / availableRooms) * 10000) / 100
      : 0,
    adr: nightSold ? Math.round((roomCharges / nightSold) * 100) / 100 : 0,
    revPar: availableRooms ? Math.round((roomCharges / availableRooms) * 100) / 100 : 0,
    pax: sum("pax"),
    roomCharges,
    extraCharges: sum("extraCharges"),
    tax: sum("tax"),
    receipt: sum("receipt"),
    expense: sum("expense"),
  };
}

export { PTD_FROM, BUSINESS_DATE };
