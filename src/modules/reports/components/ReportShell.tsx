import { useState, type ReactNode } from "react";
import { Printer, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateShort } from "@/lib/format";
import { Button, Card, Term, toast } from "@/components/ui";
import { downloadFile, ApiError } from "@/lib/api";
import type { TermKey } from "@/lib/glossary";
import { toCsv, downloadCsv, reportFilename } from "@/lib/csv";
import { useDocumentIdentity } from "@/lib/documentIdentity";
import { useDocumentTitle } from "@/lib/documentTitle";

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

const DASH = "-";

export function ReportShell({
  title,
  /** The property this report is for.
   *
   *  ⚠ THIS DEFAULTED TO THE LITERAL "5 Elements By Fidato Hotels" and
   *  not one of the thirty report screens passed it, so every report of
   *  every property printed that one name. It now comes from the
   *  property in view; an override is still accepted for a report that
   *  genuinely knows better. */
  property,
  period,
  children,
  onExportPdf,
  csv,
  /** Shown above the table — the report's own header line. */
  meta,
  /** The report's own settings (a switch, a date), above it and never printed. */
  controls,
  /** The report and its query, for the files the server makes of it. */
  download,
}: {
  title: string;
  property?: string;
  period: string;
  children: ReactNode;
  onExportPdf?: () => void;
  /** The report's own rows, for the export.
   *
   *  A FUNCTION rather than an array so a report with ten thousand rows
   *  does not build the whole export on every render just in case
   *  somebody clicks.
   *
   *  This replaced `onExportExcel`, which one report passed as
   *  `() => window.print()` — a button labelled Excel that opened a
   *  print dialogue. A control that lies about what it does is worse
   *  than one that is missing. */
  csv?: () => { headers: string[]; rows: unknown[][] };
  meta?: ReactNode;
  controls?: ReactNode;
  download?: { path: (kind: "pdf" | "xlsx" | "csv") => string; ready: boolean };
}) {
  const identity = useDocumentIdentity();
  useDocumentTitle(title);
  const propertyName = property ?? identity.property ?? DASH;
  /* WHO RAN IT. The footer said "front desk" whoever was signed in. An
     accountant reading a stamp needs the person, and the session has
     had their name all along. */
  const ranBy = identity.user ?? DASH;

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
          {download && <Downloads download={download} />}
          {csv && !download && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const { headers, rows } = csv();
                downloadCsv(
                  reportFilename(propertyName, title, period),
                  toCsv(headers, rows),
                );
              }}
            >
              <FileSpreadsheet className="size-4" />
              {/* CSV and not "Excel". It writes a .csv, Excel opens it,
                  and a label naming a product the file is not is the
                  same lie in a smaller font. */}
              CSV
            </Button>
          )}
        </div>
      </div>

      {controls && (
        <div className="no-print flex flex-wrap items-center gap-4 mb-4">{controls}</div>
      )}

      <Card className="overflow-hidden">
        {/* The report's own header, as the exports carry it */}
        <div className="px-5 py-4 border-b border-grey-200">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <p className="text-md font-semibold text-ink-900">{propertyName}</p>
            <p className="text-md font-semibold text-ink-900">{title}</p>
          </div>
          {meta && (
            <p className="text-sm text-grey-600 tabular mt-1.5">{meta}</p>
          )}
        </div>

        <div className="overflow-x-auto scrollbar-quiet">{children}</div>

        <div className="px-5 py-3 border-t border-grey-200 flex items-center justify-between gap-4 flex-wrap">
          {/* Labelled: a bare date and time under a report headed "As on
              25 Aug 2026" reads as a second report date. It is when this
              copy was produced. */}
          <p className="text-2xs text-grey-500 tabular">Printed {stamp}</p>
          <p className="text-2xs text-grey-500">{ranBy}</p>
        </div>
      </Card>
    </div>
  );
}

/* ── The files the server makes of a report ────────────────────────
   PDF, a real spreadsheet and a CSV (D17-31, D17-32), all made on the
   server from the same document the screen is drawing, so what is
   filed and what is read cannot differ. The button says what went
   wrong in the server's own words, and it is disabled until the report
   itself has loaded — a file of a report nobody has seen is a file of
   nothing. */

const FILES: Array<{ kind: "pdf" | "xlsx" | "csv"; label: string; icon: typeof FileText }> = [
  { kind: "pdf", label: "PDF", icon: FileText },
  { kind: "xlsx", label: "Excel", icon: FileSpreadsheet },
  { kind: "csv", label: "CSV", icon: Table2 },
];

function Downloads({ download }: {
  download: { path: (kind: "pdf" | "xlsx" | "csv") => string; ready: boolean };
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const get = async (kind: "pdf" | "xlsx" | "csv", label: string) => {
    setBusy(kind);
    try {
      const name = await downloadFile(download.path(kind));
      toast.success(`${label} saved`, name);
    } catch (error) {
      toast.error(
        `The ${label} was not made`,
        error instanceof ApiError ? error.message : String(error),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {FILES.map((f) => (
        <Button
          key={f.kind}
          variant="secondary"
          size="sm"
          disabled={!download.ready || busy !== null}
          onClick={() => void get(f.kind, f.label)}
        >
          <f.icon className="size-4" />
          {busy === f.kind ? "Saving…" : f.label}
        </Button>
      ))}
    </>
  );
}

/* ── Shared table pieces ─────────────────────────────────────────── */

export function ReportTable({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse text-base">{children}</table>;
}

export function ReportHead({ columns }: {
  columns: Array<{ label: string; numeric?: boolean; width?: string; term?: TermKey }>;
}) {
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
            {c.term ? <Term name={c.term}>{c.label}</Term> : c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** A section band across the full width, as the real exports use. */
export function ReportBand({ label, span }: { label: ReactNode; span: number }) {
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
    return <span className="text-grey-500" title="Not held in this system yet">-</span>;
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
