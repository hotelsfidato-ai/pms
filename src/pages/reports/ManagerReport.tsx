import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Skeleton, Term } from "@/components/ui";
import { termFor } from "@/lib/glossary";
import {
  ReportShell, ReportTable, ReportHead, ReportBand, Amount,
} from "@/components/reports/ReportShell";
import {
  getManagerReport, PTD_FROM, BUSINESS_DATE,
  type ThreeColumn, type ManagerReport,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   MANAGER REPORT

   The daily flash. Three columns throughout — Today, PTD, YTD — and
   the section order the live export uses, because a manager reads it
   in that order every morning.

   Counts render plain; money renders as money. A dash means the
   figure is not derivable from this system yet, and the footnote says
   so — an invented zero on a report an accountant reads is worse than
   a visible gap.
   ══════════════════════════════════════════════════════════════════ */

/* PTD and YTD are the two abbreviations on the report a new manager is
   least likely to know, so they are the ones that explain themselves. */
const COLUMNS = [
  { label: "Particulars" },
  { label: "Today (₹)", numeric: true, width: "w-[150px]" },
  { label: "PTD (₹)", numeric: true, width: "w-[150px]", term: "ptd" as const },
  { label: "YTD (₹)", numeric: true, width: "w-[150px]", term: "ytd" as const },
];

const COUNT_COLUMNS = [
  { label: "Particulars" },
  { label: "Today", numeric: true, width: "w-[150px]" },
  { label: "PTD", numeric: true, width: "w-[150px]", term: "ptd" as const },
  { label: "YTD", numeric: true, width: "w-[150px]", term: "ytd" as const },
];

/** The label as printed, tappable where the glossary has it. */
function Labelled({ label }: { label: string }) {
  const term = termFor(label);
  return term ? <Term name={term}>{label}</Term> : <>{label}</>;
}

export default function ManagerReportPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading } = useQuery({
    queryKey: ["manager-report", hotelId, BUSINESS_DATE, PTD_FROM],
    queryFn: () => getManagerReport(hotelId, BUSINESS_DATE, PTD_FROM),
  });

  if (isLoading || !data) {
    return (
      <div className="px-5 py-6 sm:px-7 sm:py-8 max-w-[1400px] mx-auto space-y-2">
        {Array.from({ length: 14 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <ReportShell
      title="Manager report"
      period={`As on ${dateShort(data.asOn)} · PTD from ${dateShort(data.ptdFrom)} · YTD from ${dateShort(data.ytdFrom)}`}
      meta={`As on Date ${dateShort(data.asOn)}   PTD ${dateShort(data.ptdFrom)}   YTD ${dateShort(data.ytdFrom)}   Currency ${data.currency}`}
      csv={() => exportRows(data)}
    >
      <ReportTable>
        <ReportHead columns={COLUMNS} />
        <tbody>
          {data.sections.map((section) => (
            <ReportSection
              key={section.title}
              title={section.title}
              rows={section.rows}
              note={section.note}
              format={money}
            />
          ))}
        </tbody>
      </ReportTable>

      {/* Counts, not money — a separate table so the units never mix. */}
      <div className="border-t-2 border-ink-900">
        <ReportTable>
          <ReportHead columns={COUNT_COLUMNS} />
          <tbody>
            <ReportSection
              title="Room Summary"
              rows={data.roomSummary}
              format={(n) => String(n)}
            />
            <ReportSection
              title="Statistics"
              rows={data.statistics}
              format={(n) => (n % 1 === 0 ? String(n) : n.toFixed(2))}
            />
          </tbody>
        </ReportTable>
      </div>

      <div className="px-4 py-4 border-t border-grey-200 space-y-1">
        {data.footnotes.map((f) => (
          <p key={f} className="text-2xs text-grey-500 leading-relaxed">
            * {f}
          </p>
        ))}
      </div>
    </ReportShell>
  );
}

/* ── The export ──────────────────────────────────────────────────────
   The report an owner opens first was the one report with no way out of
   it: seven of the eleven had a CSV button and this did not. Same rows
   in the same order as the screen, section by section, so a column can
   be read straight down.

   A null stays EMPTY. `toCsv` writes nothing for it, which is the
   spreadsheet's own way of saying "no figure" — an invented 0 in a
   column an accountant sums is the whole reason the screen prints a
   dash. */
function exportRows(data: ManagerReport) {
  const rows: unknown[][] = [];

  const push = (section: string, list: ThreeColumn[]) => {
    for (const row of list) {
      rows.push([section, row.label, row.today, row.ptd, row.ytd]);
    }
  };

  for (const section of data.sections) push(section.title, section.rows);
  push("Room Summary", data.roomSummary);
  push("Statistics", data.statistics);

  return {
    headers: ["Section", "Particulars", "Today", "PTD", "YTD"],
    rows,
  };
}

function ReportSection({
  title, rows, note, format,
}: {
  title: string;
  rows: ThreeColumn[];
  note?: string;
  format: (n: number) => string;
}) {
  return (
    <>
      <ReportBand label={<Labelled label={title} />} span={4} />
      {rows.map((row) => (
        <tr
          key={`${title}-${row.label}`}
          className={cn(
            "border-b border-grey-100 last:border-b-0",
            row.total && "bg-grey-50",
          )}
        >
          <td
            className={cn(
              "px-4 py-2 align-middle",
              row.indent && "pl-9 text-grey-600",
              row.total ? "font-semibold text-ink-900" : "text-ink-900",
            )}
          >
            <Labelled label={row.label} />
          </td>
          <td className="px-4 py-2 text-right align-middle">
            <Amount value={row.today} bold={row.total} format={format} />
          </td>
          <td className="px-4 py-2 text-right align-middle">
            <Amount value={row.ptd} bold={row.total} format={format} />
          </td>
          <td className="px-4 py-2 text-right align-middle">
            <Amount value={row.ytd} bold={row.total} format={format} />
          </td>
        </tr>
      ))}
      {note && (
        <tr>
          <td colSpan={4} className="px-4 pb-3 pt-1">
            <p className="text-2xs text-grey-500 leading-relaxed">{note}</p>
          </td>
        </tr>
      )}
    </>
  );
}
