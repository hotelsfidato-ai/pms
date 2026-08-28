import type { ReactNode } from "react";
import { Printer, FileSpreadsheet, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateShort } from "@/lib/format";
import { Button, Card } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   REPORT SHELL

   Every report carries the same four things, because the real exports
   do: the property name, the report title, the period, and a
   generated-at stamp naming the user. The live system's footer reads
   `26/08/2026 07:43:49 AM   admin   Page 1 of 1` and an accountant
   reads that line.

   Print styling lives here too — `no-print` on the chrome, so what
   reaches paper is the report and nothing else.
   ══════════════════════════════════════════════════════════════════ */

export function ReportShell({
  title,
  property = "5 Elements By Fidato Hotels",
  period,
  children,
  onExportPdf,
  onExportExcel,
  /** Shown above the table — the report's own header line. */
  meta,
}: {
  title: string;
  property?: string;
  period: string;
  children: ReactNode;
  onExportPdf?: () => void;
  onExportExcel?: () => void;
  meta?: ReactNode;
}) {
  const stamp = new Date().toLocaleString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="px-5 py-6 sm:px-7 sm:py-8 max-w-[1400px] mx-auto">
      {/* Chrome — never printed */}
      <div className="no-print flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink-900">{title}</h1>
          <p className="text-base text-grey-500 mt-1.5">{period}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print
          </Button>
          {onExportPdf && (
            <Button variant="secondary" size="sm" onClick={onExportPdf}>
              <FileText className="size-4" />
              PDF
            </Button>
          )}
          {onExportExcel && (
            <Button variant="secondary" size="sm" onClick={onExportExcel}>
              <FileSpreadsheet className="size-4" />
              Excel
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        {/* The report's own header, as the exports carry it */}
        <div className="px-5 py-4 border-b border-grey-200">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <p className="text-md font-semibold text-ink-900">{property}</p>
            <p className="text-md font-semibold text-ink-900">{title}</p>
          </div>
          {meta && (
            <p className="text-sm text-grey-600 tabular mt-1.5">{meta}</p>
          )}
        </div>

        <div className="overflow-x-auto scrollbar-quiet">{children}</div>

        <div className="px-5 py-3 border-t border-grey-200 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-2xs text-grey-500 tabular">{stamp}</p>
          <p className="text-2xs text-grey-500">front desk</p>
        </div>
      </Card>
    </div>
  );
}

/* ── Shared table pieces ─────────────────────────────────────────── */

export function ReportTable({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse text-base">{children}</table>;
}

export function ReportHead({ columns }: { columns: Array<{ label: string; numeric?: boolean; width?: string }> }) {
  return (
    <thead className="bg-grey-50 border-b border-grey-200">
      <tr>
        {columns.map((c) => (
          <th
            key={c.label}
            scope="col"
            className={cn(
              "text-2xs font-semibold uppercase tracking-wide text-grey-500",
              "px-4 h-10 whitespace-nowrap",
              c.numeric ? "text-right" : "text-left",
              c.width,
            )}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** A section band across the full width, as the real exports use. */
export function ReportBand({ label, span }: { label: string; span: number }) {
  return (
    <tr>
      <td
        colSpan={span}
        className="px-4 py-2 bg-brand-orange-50 text-2xs font-semibold uppercase tracking-wide text-brand-orange-700 border-y border-grey-200"
      >
        {label}
      </td>
    </tr>
  );
}

/**
 * A money cell. Negatives are real and stay visible — never blank,
 * never in brackets. A null is a figure this system cannot derive,
 * and prints as a dash rather than a misleading zero.
 */
export function Amount({
  value, bold, format,
}: {
  value: number | null | undefined;
  bold?: boolean;
  format: (n: number) => string;
}) {
  if (value === null || value === undefined) {
    return <span className="text-grey-400" title="Not derivable from this system yet">—</span>;
  }
  return (
    <span
      className={cn(
        "tabular",
        bold && "font-semibold text-ink-900",
        value < 0 && "text-brand-red",
      )}
    >
      {format(value)}
    </span>
  );
}

export { dateShort };
