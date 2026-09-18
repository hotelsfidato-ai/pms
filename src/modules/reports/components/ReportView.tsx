import { Fragment } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
  ResponsiveContainer, Legend,
} from "recharts";
import { cn } from "@/lib/cn";
import { moneyPrecise, number, percent, dateReport, dateTimeReport, isValidDate } from "@/lib/format";
import type {
  ReportDoc, ReportSection, ReportColumn, ReportRow, Cell, CellKind, ReportFact,
} from "@/modules/reports/data/document";

/* ══════════════════════════════════════════════════════════════════
   REPORT VIEW — draws any report document

   Every report in the owner's eZee layout (D17-62) arrives from the
   server as one ReportDoc, and this is the one thing that draws them on
   screen, in the Fidato look (D17-70): sections under a band, a header
   that spans its groups, totals ruled off, negatives in red, a dash for
   a figure this system does not hold. The master's PDF and .xlsx draw
   the same object on the server, so what is on screen is what prints.
   ══════════════════════════════════════════════════════════════════ */

/** A figure nobody holds (D17-49): a short hyphen, never a zero. */
export const NO_FIGURE = "-";

/** Dates as the owner's eZee reports print them (D17-77): 25/08/2026. */
export function formatCell(value: Cell, kind: CellKind, timeZone = "Asia/Kolkata"): string {
  if (value === null || value === undefined || value === "") return NO_FIGURE;
  if (typeof value === "string") {
    /* A label in a date column ("Total") is words, not a broken date. */
    if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateReport(value);
    if (kind === "datetime" && isValidDate(value)) return dateTimeReport(value, timeZone);
    return value;
  }
  switch (kind) {
    case "money": return moneyPrecise(value);
    case "percent": return percent(value, 2);
    case "count": return number(value);
    case "ratio": return number(Math.round(value * 100) / 100);
    default: return String(value);
  }
}

const numeric = (kind: CellKind) => kind !== "text" && kind !== "date" && kind !== "datetime";

export function factsLine(facts: ReportFact[], timeZone?: string) {
  return facts.map((f) => `${f.label} ${formatCell(f.value, f.kind, timeZone)}`).join("   ");
}

export function ReportView({ doc }: { doc: ReportDoc }) {
  const runs = runsOf(doc.sections);
  return (
    <div data-report={doc.report}>
      {runs.map((run) => (
        <table key={run[0]!.key} className="w-full border-collapse text-sm">
          <Head columns={run[0]!.columns} />
          {run.map((section) => (
            <SectionBody key={section.key} section={section} timeZone={doc.property.timezone ?? "Asia/Kolkata"} />
          ))}
        </table>
      ))}

      {doc.chart && <Chart doc={doc} />}

      {doc.footnotes.length > 0 && (
        <div className="px-4 py-4 border-t border-grey-200 space-y-1">
          {doc.footnotes.map((f) => (
            <p key={f} className="text-2xs text-grey-500 leading-relaxed">* {f}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sections with the same columns share one header, as the exports do. */
function runsOf(sections: ReportSection[]): ReportSection[][] {
  const same = (a: ReportColumn[], b: ReportColumn[]) =>
    a.length === b.length && a.every((c, i) => c.key === b[i]!.key && c.label === b[i]!.label);
  const runs: ReportSection[][] = [];
  for (const s of sections) {
    const last = runs.at(-1);
    if (last && same(last[0]!.columns, s.columns)) last.push(s);
    else runs.push([s]);
  }
  return runs;
}

const TH = "text-2xs font-semibold uppercase tracking-wide text-grey-600 px-3 py-2 align-bottom";

function Head({ columns }: { columns: ReportColumn[] }) {
  const grouped = columns.some((c) => c.group);
  if (!grouped) {
    return (
      <thead className="bg-grey-50 border-b border-grey-300">
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cn(TH, numeric(c.kind) ? "text-right" : "text-left")}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
    );
  }

  /* Consecutive columns of one group get one heading across them. */
  const top: Array<{ label: string; span: number; group: boolean; kind: CellKind; key: string }> = [];
  for (const c of columns) {
    const last = top.at(-1);
    if (c.group && last?.group && last.label === c.group) last.span += 1;
    else top.push({ label: c.group ?? c.label, span: 1, group: Boolean(c.group), kind: c.kind, key: c.key });
  }
  return (
    <thead className="bg-grey-50 border-b border-grey-300">
      <tr>
        {top.map((t) => (
          <th
            key={t.key}
            scope="col"
            colSpan={t.group ? t.span : undefined}
            rowSpan={t.group ? undefined : 2}
            className={cn(
              TH,
              t.group ? "text-center border-b border-grey-200" : numeric(t.kind) ? "text-right" : "text-left",
            )}
          >
            {t.label}
          </th>
        ))}
      </tr>
      <tr>
        {columns.filter((c) => c.group).map((c) => (
          <th key={c.key} scope="col" className={cn(TH, numeric(c.kind) ? "text-right" : "text-left")}>
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function SectionBody({ section, timeZone }: { section: ReportSection; timeZone: string }) {
  const span = section.columns.length;
  return (
    <tbody>
      <tr>
        <th
          colSpan={span}
          scope="colgroup"
          className="px-3 pt-4 pb-1.5 text-left text-sm font-semibold text-brand-orange-700 border-b border-grey-200"
        >
          {section.title}
        </th>
      </tr>
      {section.rows.length === 0 ? (
        <tr>
          <td colSpan={span} className="px-3 py-3 text-sm text-grey-500">
            {section.empty ?? "Nothing to report."}
          </td>
        </tr>
      ) : (
        section.rows.map((r, i) => (
          <Line key={i} row={r} columns={section.columns} timeZone={timeZone} />
        ))
      )}
      {section.note && (
        <tr>
          <td colSpan={span} className="px-3 pb-3 pt-1 text-2xs text-grey-500 leading-relaxed">
            {section.note}
          </td>
        </tr>
      )}
    </tbody>
  );
}

const INDENT = ["", "pl-7", "pl-11", "pl-15"];

function Line({ row, columns, timeZone }: { row: ReportRow; columns: ReportColumn[]; timeZone: string }) {
  if (row.kind === "band") {
    const first = columns[0]!;
    return (
      <tr>
        <td colSpan={columns.length} className="px-3 pt-3 pb-1 text-sm font-semibold text-ink-900">
          {formatCell(row.cells[first.key] ?? null, "text")}
        </td>
      </tr>
    );
  }
  const isTotal = row.kind === "total";
  return (
    <tr
      className={cn(
        isTotal
          ? "border-y border-dashed border-grey-400 font-semibold text-ink-900"
          : "border-b border-grey-100",
      )}
    >
      {columns.map((c, i) => {
        const kind = numeric(c.kind) && row.unit ? row.unit : c.kind;
        const value = row.cells[c.key] ?? null;
        const isNumber = numeric(c.kind);
        /* A total row leaves its empty words blank. A dash means "this
           system does not hold the figure", and a total has no guest. */
        const blank = value === null && !isNumber && isTotal;
        return (
          <td
            key={c.key}
            className={cn(
              "px-3 py-1.5 align-top",
              isNumber ? "text-right tabular whitespace-nowrap" : "text-left",
              String(value ?? "").length <= 22 ? "whitespace-nowrap" : undefined,
              i === 0 && INDENT[row.indent ?? 0],
              value === null && "text-grey-500",
              typeof value === "number" && value < 0 && kind === "money" && "text-brand-red",
            )}
          >
            {blank ? "" : formatCell(value, kind, timeZone)}
          </td>
        );
      })}
    </tr>
  );
}

function Chart({ doc }: { doc: ReportDoc }) {
  const chart = doc.chart!;
  const series = chart.series[0];
  if (!series) return null;
  const data = chart.x.map((x, i) => ({ x, value: series.values[i] ?? 0 }));

  return (
    <Fragment>
      <p className="px-4 pt-5 text-center text-md font-semibold text-ink-900">{chart.title}</p>
      <div className="px-2 sm:px-4 pb-4 h-80" role="img" aria-label={chart.title}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 8, bottom: 4, left: -12 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--color-grey-200)" />
            <XAxis
              dataKey="x"
              interval={0}
              tick={{ fontSize: 11, fill: "var(--color-grey-600)" }}
              axisLine={{ stroke: "var(--color-grey-300)" }}
              tickLine={false}
            />
            <YAxis
              domain={chart.unit === "percent" ? [0, 120] : [0, "auto"]}
              ticks={chart.unit === "percent" ? [0, 20, 40, 60, 80, 100, 120] : undefined}
              tick={{ fontSize: 11, fill: "var(--color-grey-600)" }}
              axisLine={false}
              tickLine={false}
            />
            <Legend verticalAlign="top" align="right" iconType="square" wrapperStyle={{ fontSize: 13 }} />
            <Bar
              dataKey="value"
              name={series.label}
              fill="var(--color-brand-tangerine)"
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="top"
                style={{ fontSize: 10, fill: "var(--color-grey-700)" }}
                formatter={(v: unknown) => (typeof v === "number" ? String(v) : "")}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Fragment>
  );
}

/** Every section as CSV lines, one after another — until the master's
    server CSV and .xlsx replace this button. */
export function documentCsv(doc: ReportDoc) {
  const width = Math.max(1, ...doc.sections.map((s) => s.columns.length));
  const rows: unknown[][] = [];
  for (const s of doc.sections) {
    rows.push([s.title]);
    rows.push(s.columns.map((c) => (c.group ? `${c.group} ${c.label}` : c.label)));
    for (const r of s.rows) {
      rows.push(s.columns.map((c) => r.cells[c.key] ?? null));
    }
    rows.push([]);
  }
  if (doc.chart) {
    rows.push([doc.chart.title]);
    for (const s of doc.chart.series) {
      rows.push(["", ...doc.chart.x]);
      rows.push([s.label, ...s.values]);
    }
  }
  return {
    headers: [doc.title, ...Array(width - 1).fill("")] as string[],
    rows,
  };
}
